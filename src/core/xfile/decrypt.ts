import type {
  Aead,
  ByteReader,
  ByteWriter,
  Kdf,
  KdfProgress,
} from '../contracts';
import { zeroize } from '../crypto/bytes';
import { CoreError, throwIfAborted } from '../crypto/errors';
import { createPolicyKdf } from '../crypto/kdf-policy';
import { passwordToBytes } from '../crypto/password';
import {
  abortOutputs,
  expectEof,
  streamProgress,
  yieldToEventLoop,
  type StreamOptions,
} from '../io';
import { addSize } from '../sizes';
import { extractStoreZip, type CreateZipOutput } from '../zip/extract';
import { readHeader, type HeaderFacts, type ParsedHeader } from './header';
import { decodeMetadata, type XfileMetadata } from './metadata';
import { maxMetadataBytes, maxPayloadRecords } from './plan';
import { openRecord } from './records';

type DecryptCredential =
  | { mode: 'raw'; fileKey: Uint8Array }
  | { mode: 'password'; password: string; kdf: Kdf };
type Destination =
  | {
      mode: 'save';
      createOutput: (metadata: XfileMetadata) => Promise<ByteWriter>;
    }
  | { mode: 'extract'; createOutput: CreateZipOutput };

type DecryptOptions = StreamOptions & {
  aead: Aead;
  credential: DecryptCredential;
  destination: Destination;
  onKdfProgress?: KdfProgress;
  beforeOutput?: (metadata: XfileMetadata) => Promise<void>;
};

export type DecryptResult = {
  header: HeaderFacts & { readonly verified: true };
  metadata: XfileMetadata;
};

async function getKey(
  header: ParsedHeader,
  { credential, signal, onKdfProgress }: DecryptOptions,
) {
  if (header.facts.mode !== credential.mode) throw new CoreError('AUTH_FAILED');
  if (credential.mode === 'raw') {
    if (credential.fileKey.length !== 32) throw new CoreError('AUTH_FAILED');
    return Uint8Array.from(credential.fileKey);
  }
  const password = passwordToBytes(credential.password);
  try {
    return await createPolicyKdf(credential.kdf).derive(
      password,
      header.salt,
      header.kdf!,
      signal,
      onKdfProgress,
    );
  } finally {
    zeroize(password);
  }
}

async function verifyFinal(
  input: ByteReader,
  processed: number,
  metadata: XfileMetadata,
  signal?: AbortSignal,
) {
  await expectEof(input, 'AUTH_FAILED', signal);
  if (processed < metadata.totalSize) throw new CoreError('TRUNCATED');
}

async function* payloadRecords(
  input: ByteReader,
  hash: Uint8Array,
  fileKey: Uint8Array,
  metadata: XfileMetadata,
  chunkSize: number,
  { aead, signal }: DecryptOptions,
  checkpoint: (position: number) => Promise<void>,
): AsyncGenerator<Uint8Array, void> {
  let processed = 0;
  for (let counter = 1; counter <= maxPayloadRecords; counter++) {
    const { plaintext, final } = await openRecord(
      aead,
      fileKey,
      hash,
      counter,
      input,
      chunkSize,
      signal,
    );
    try {
      if (!plaintext.length || (!final && plaintext.length !== chunkSize))
        throw new CoreError('BAD_HEADER');
      processed = addSize(processed, plaintext.length);
      if (processed > metadata.totalSize) throw new CoreError('AUTH_FAILED');
      if (final) await verifyFinal(input, processed, metadata, signal);
      yield plaintext;
    } finally {
      zeroize(plaintext);
    }
    await checkpoint(processed);
    if (final) return;
  }
  await expectEof(input, 'RESOURCE_LIMIT', signal);
  throw new CoreError('TRUNCATED');
}

async function* emptyPayload(): AsyncGenerator<Uint8Array, void> {
  // Metadata was FINAL and terminal EOF was already checked.
}

/** Partial reads borrow a disjoint slice of the current authenticated record. */
function payloadReader(
  records: AsyncGenerator<Uint8Array, void>,
  size: number,
): ByteReader {
  let pending: Uint8Array | undefined;
  let offset = 0;
  return {
    async size() {
      return size;
    },
    async read(max) {
      if (!pending || offset === pending.length) {
        const next = await records.next();
        if (next.done) return null;
        pending = next.value;
        offset = 0;
      }
      const bytes = pending.subarray(offset, offset + max);
      offset += bytes.length;
      return bytes;
    },
  };
}

/** One pass. Output creation is deferred until record 0 authenticates. */
export async function decryptXfile(
  input: ByteReader,
  options: DecryptOptions,
): Promise<DecryptResult> {
  const { aead, signal, destination } = options;
  const outputs: ByteWriter[] = [];
  let fileKey: Uint8Array | undefined;
  try {
    const header = await readHeader(input, signal);
    const { facts, hash } = header;
    fileKey = await getKey(header, options);
    const chunkSize = 2 ** facts.chunkSizeLog2;
    const { plaintext, final } = await openRecord(
      aead,
      fileKey,
      hash,
      0,
      input,
      maxMetadataBytes,
      signal,
    );
    let metadata: XfileMetadata;
    try {
      metadata = decodeMetadata(plaintext, facts.isZip, facts.chunkSizeLog2);
    } finally {
      zeroize(plaintext);
    }
    if (final) await verifyFinal(input, 0, metadata, signal);
    if (destination.mode === 'extract' && !metadata.isZip)
      throw new CoreError('UNSUPPORTED_ARCHIVE');
    await options.beforeOutput?.(metadata);
    throwIfAborted(signal);
    const checkpoint =
      destination.mode === 'save'
        ? streamProgress(metadata.totalSize, options)
        : () => yieldToEventLoop(options);
    await checkpoint(0);
    const records = final
      ? emptyPayload()
      : payloadRecords(
          input,
          hash,
          fileKey,
          metadata,
          chunkSize,
          options,
          checkpoint,
        );
    try {
      if (destination.mode === 'extract') {
        // ZIP owns the transaction for its files, including failures from outer AEAD/EOF.
        await extractStoreZip(
          payloadReader(records, metadata.totalSize),
          metadata,
          destination.createOutput,
          options,
        );
      } else {
        const output = await destination.createOutput(metadata);
        outputs.push(output);
        throwIfAborted(signal);
        for await (const bytes of records) await output.write(bytes);
        throwIfAborted(signal);
        await output.close();
        throwIfAborted(signal);
      }
    } finally {
      await records.return();
    }
    return { header: { ...facts, verified: true }, metadata };
  } catch (error) {
    return await abortOutputs(outputs, error);
  } finally {
    zeroize(fileKey);
  }
}
