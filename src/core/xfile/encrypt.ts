import type {
  Aead,
  ByteReader,
  ByteWriter,
  Kdf,
  KdfProgress,
  Rng,
} from '../contracts';
import { zeroize } from '../crypto/bytes';
import { throwIfAborted } from '../crypto/errors';
import { sha256 } from '../crypto/hash';
import { createPolicyKdf, writerScryptParams } from '../crypto/kdf-policy';
import { passwordToBytes } from '../crypto/password';
import { createRequiredRng } from '../crypto/rng';
import {
  abortOutputs,
  checkSourceSize,
  expectEof,
  readExact,
  streamProgress,
  type StreamOptions,
} from '../io';
import { addSize, checkedSize, maxChunkBytes } from '../sizes';
import { encodeHeader, writerChunkLog2 } from './header';
import { encodeMetadata, type XfileMetadataInput } from './metadata';
import { containerSize, payloadRecordCount } from './plan';
import { sealRecord } from './records';

export type EncryptPassword = { mode: 'password' } & (
  { password: string } | { takePassword: () => string }
);
type EncryptProtection = { mode: 'raw' } | (EncryptPassword & { kdf: Kdf });

type EncryptOptions = StreamOptions & {
  aead: Aead;
  rng: Rng;
  protection: EncryptProtection;
  metadata: XfileMetadataInput;
  createdAtUnixSec: number;
  onKdfProgress?: KdfProgress;
};

export type EncryptResult =
  { mode: 'raw'; fileKey: Uint8Array } | { mode: 'password' };

export function planXfile(metadata: XfileMetadataInput) {
  const encoded = encodeMetadata(metadata, writerChunkLog2);
  try {
    return {
      payloadBytes: metadata.totalSize,
      metadataBytes: encoded.length,
      payloadRecords: payloadRecordCount(metadata.totalSize, writerChunkLog2),
      totalSize: containerSize(metadata.totalSize, encoded.length),
    };
  } finally {
    zeroize(encoded);
  }
}

/** On success a raw key belongs to the caller. Password mode releases no key. */
export async function encryptXfile(
  input: ByteReader,
  output: ByteWriter,
  options: EncryptOptions,
): Promise<EncryptResult> {
  const { signal, aead, protection, createdAtUnixSec } = options;
  let metadata: Uint8Array | undefined;
  let fileKey: Uint8Array | undefined;
  let salt: Uint8Array | undefined;
  let transferred = false;
  try {
    throwIfAborted(signal);
    const { totalSize, isZip } = options.metadata;
    metadata = encodeMetadata(options.metadata, writerChunkLog2);
    checkedSize(createdAtUnixSec);
    const records = payloadRecordCount(totalSize, writerChunkLog2);
    const checkpoint = streamProgress(totalSize, options);
    const rng = createRequiredRng(options.rng);
    await checkSourceSize(input, totalSize, signal);
    salt = rng.bytes(16);
    if (protection.mode === 'password') {
      const passwordBytes = passwordToBytes(
        'password' in protection
          ? protection.password
          : protection.takePassword(),
      );
      try {
        fileKey = await createPolicyKdf(protection.kdf).derive(
          passwordBytes,
          salt,
          writerScryptParams,
          signal,
          options.onKdfProgress,
        );
      } finally {
        zeroize(passwordBytes);
      }
    } else {
      fileKey = rng.bytes(32);
    }
    const header = encodeHeader(protection.mode, isZip, createdAtUnixSec, salt);
    const hash = sha256(header);
    throwIfAborted(signal);
    await output.write(header);
    await sealRecord(
      aead,
      fileKey,
      hash,
      0,
      metadata,
      records === 0,
      output,
      signal,
    );
    zeroize(metadata);
    await checkpoint(0);

    let processed = 0;
    for (let counter = 1; counter <= records; counter++) {
      const length = Math.min(totalSize - processed, maxChunkBytes);
      const plaintext = await readExact(
        input,
        length,
        'SOURCE_CHANGED',
        signal,
      );
      try {
        await sealRecord(
          aead,
          fileKey,
          hash,
          counter,
          plaintext,
          counter === records,
          output,
          signal,
        );
        processed = addSize(processed, plaintext.length);
      } finally {
        zeroize(plaintext);
      }
      await checkpoint(processed);
    }
    await expectEof(input, 'SOURCE_CHANGED', signal);
    await checkSourceSize(input, totalSize, signal);
    await output.close();
    throwIfAborted(signal);
    if (protection.mode === 'raw') {
      transferred = true;
      return { mode: 'raw', fileKey };
    }
    return { mode: 'password' };
  } catch (error) {
    return await abortOutputs([output], error);
  } finally {
    zeroize(metadata, salt);
    if (!transferred) zeroize(fileKey);
  }
}
