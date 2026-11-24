import type { ByteReader } from '@/core/contracts';
import { zeroize } from '@/core/crypto/bytes';
import { CoreError, throwIfAborted } from '@/core/crypto/errors';
import {
  checkSourceSize,
  expectEof,
  readChunk,
  streamProgress,
} from '@/core/io';
import { maxChunkBytes } from '@/core/sizes';
import {
  decryptXfile,
  encryptXfile,
  planXfile,
  type EncryptResult,
  type XfileMetadataInput,
} from '@/core/xfile';
import { planStoreZip, writeStoreZip } from '@/core/zip';
import {
  checkCapacity,
  preflight,
  writeSpaceCheck,
  type CapacityWarning,
} from './capacity';
import { cryptoAdapters } from './crypto';
import {
  createWriter,
  savedFile,
  withReader,
  type Destination,
  type PickedSource,
  type SavedFile,
} from './file-io';
import { runFileJob, type JobControls } from './job';
import { nativeCall } from './native';

const binaryMime = 'application/octet-stream';
type JobDestination = {
  destination: Destination;
  controls: JobControls;
  onUnknownCapacity: CapacityWarning;
};
type Protection = { mode: 'raw' } | { mode: 'password'; password: string };
type Credential =
  { mode: 'raw'; fileKey: Uint8Array } | { mode: 'password'; password: string };

export async function encryptToDestination(
  options: JobDestination & {
    sources: readonly PickedSource[];
    protection: Protection;
    outputName: string;
    bundleName: string;
    createdAtUnixSec: number;
  },
) {
  const {
    sources,
    protection,
    outputName,
    bundleName,
    createdAtUnixSec,
    controls,
    onUnknownCapacity,
  } = options;
  const { tree, label } = options.destination;
  const zip = sources.length > 1 ? planStoreZip(sources) : undefined;
  const first = sources[0];
  if (!first) throw new CoreError('IO_ERROR');
  const metadata: XfileMetadataInput = zip
    ? {
        name: bundleName,
        isZip: true,
        totalSize: zip.totalSize,
        entryCount: sources.length,
        mime: 'application/zip',
      }
    : {
        name: first.name.normalize('NFC'),
        isZip: false,
        totalSize: first.size,
        entryCount: 1,
        mime: first.mime,
      };
  const planned = planXfile(metadata);
  await preflight(tree, planned.totalSize, onUnknownCapacity, zip?.totalSize);
  return runFileJob(
    controls,
    async (job) => {
      let result: EncryptResult | undefined;
      try {
        const { generation } = job;
        const temp = zip
          ? await createWriter(
              generation,
              null,
              '',
              'application/zip',
              writeSpaceCheck(null, zip.totalSize),
            )
          : undefined;
        if (temp) {
          await writeStoreZip(
            sources.map((source) => ({
              ...source,
              withReader: (use) => withReader(generation, source.uri, use),
            })),
            temp,
            job,
          );
        }
        throwIfAborted(job.signal);
        const output = await createWriter(
          generation,
          tree,
          outputName,
          binaryMime,
          writeSpaceCheck(tree, planned.totalSize),
        );
        await withReader(generation, temp?.id ?? first.uri, async (reader) => {
          result = await encryptXfile(reader, output, {
            ...job,
            ...cryptoAdapters,
            protection:
              protection.mode === 'password'
                ? { ...protection, kdf: cryptoAdapters.kdf }
                : protection,
            metadata,
            createdAtUnixSec,
          });
          return result;
        });
        if (temp) await temp.abort();
        return {
          recovery: result!,
          file: savedFile(output, binaryMime, 'ciphertext'),
          savedTo: label,
        };
      } catch (error) {
        if (result?.mode === 'raw') zeroize(result.fileKey);
        throw error;
      }
    },
    ({ recovery }) => {
      if (recovery.mode === 'raw') zeroize(recovery.fileKey);
    },
  );
}

export async function decryptToDestination(
  options: JobDestination & {
    source: PickedSource;
    credential: Credential;
    mode: 'save' | 'extract';
  },
) {
  const { source, credential, mode, onUnknownCapacity } = options;
  const { tree, label } = options.destination;
  const volume = await nativeCall((native) => native.volume(tree));
  if (!volume) await onUnknownCapacity();

  return runFileJob(options.controls, async (job) => {
    const { generation } = job;
    const files: SavedFile[] = [];
    let checkSpace = writeSpaceCheck(tree, 0);
    const create = async (name: string, mime: string) => {
      const output = await createWriter(
        generation,
        tree,
        name,
        mime,
        checkSpace,
      );
      files.push(savedFile(output, mime, 'plaintext'));
      return output;
    };
    const result = await withReader(generation, source.uri, (reader) =>
      decryptXfile(reader, {
        ...job,
        aead: cryptoAdapters.aead,
        credential:
          credential.mode === 'password'
            ? { ...credential, kdf: cryptoAdapters.kdf }
            : credential,
        async beforeOutput(metadata) {
          // In a sequential extraction the authenticated ZIP size is an upper
          // bound on entry bytes. Do not allocate an additional ZIP in cache.
          const current = await nativeCall((native) => native.volume(tree));
          if (!current && volume) await onUnknownCapacity();
          checkCapacity([{ bytes: metadata.totalSize, volume: current }]);
          checkSpace = writeSpaceCheck(tree, metadata.totalSize);
        },
        destination:
          mode === 'extract'
            ? { mode, createOutput: (name) => create(name, binaryMime) }
            : { mode, createOutput: ({ name, mime }) => create(name, mime) },
      }),
    );
    return { ...result, files, savedTo: label };
  });
}

export async function saveCopy(
  options: JobDestination & {
    file: SavedFile;
    name: string;
    confirmPlaintext?: boolean;
  },
) {
  const {
    file,
    name,
    destination: { tree, label },
  } = options;
  if (file.kind === 'plaintext' && !options.confirmPlaintext)
    throw new CoreError('CANCELLED');
  const size = await nativeCall((native) => native.sourceSize(file.uri));
  await preflight(tree, size, options.onUnknownCapacity);
  return runFileJob(options.controls, (job) =>
    withReader(job.generation, file.uri, async (reader: ByteReader) => {
      await checkSourceSize(reader, size, job.signal);
      const output = await createWriter(
        job.generation,
        tree,
        name,
        file.mime,
        writeSpaceCheck(tree, size),
      );
      const checkpoint = streamProgress(size, job);
      let remaining = size;
      while (remaining > 0) {
        const bytes = await readChunk(
          reader,
          Math.min(maxChunkBytes, remaining),
          job.signal,
        );
        if (!bytes) throw new CoreError('SOURCE_CHANGED');
        try {
          await output.write(bytes);
          remaining -= bytes.length;
        } finally {
          zeroize(bytes);
        }
        await checkpoint(size - remaining);
      }
      await expectEof(reader, 'SOURCE_CHANGED', job.signal);
      await checkSourceSize(reader, size, job.signal);
      await output.close();
      return { file: savedFile(output, file.mime, file.kind), savedTo: label };
    }),
  );
}
