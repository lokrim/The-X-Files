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
  type EncryptPassword,
  type EncryptResult,
} from '@/core/xfile';
import { writeStoreZip } from '@/core/zip';
import {
  checkCapacity,
  preflight,
  writeSpaceCheck,
  type CapacityWarning,
} from './capacity';
import { cryptoAdapters, type ScryptCancellation } from './crypto';
import { planEncryption } from './encryption-plan';
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
type Protection = { mode: 'raw' } | EncryptPassword;
type Credential =
  { mode: 'raw'; fileKey: Uint8Array } | { mode: 'password'; password: string };

export type EncryptionStage = 'preparing' | 'deriving' | 'running';

type EncryptionJob = JobDestination & {
  sources: readonly PickedSource[];
  protection: Protection;
  outputName: string;
  bundleName: string;
  createdAtUnixSec: number;
  onStage?: (stage: EncryptionStage) => void;
  onScryptCancellation?: (status: ScryptCancellation) => void;
};

export function encryptToDestination(options: EncryptionJob) {
  return encryptWithRecovery(options, (result) => result, wipeEncryptionKey);
}

function wipeEncryptionKey(result: EncryptResult) {
  if (result.mode === 'raw') zeroize(result.fileKey);
}

export async function encryptWithRecovery<T>(
  options: EncryptionJob,
  recover: (result: EncryptResult) => T,
  discard: (recovery: T) => void,
) {
  const {
    sources,
    protection,
    outputName,
    bundleName,
    createdAtUnixSec,
    controls,
    onUnknownCapacity,
    onStage,
    onScryptCancellation,
  } = options;
  const { tree, label } = options.destination;
  const planned = planEncryption(sources, bundleName);
  const { zip, metadata } = planned;
  const first = sources[0]!;
  await preflight(tree, planned.totalSize, onUnknownCapacity, zip?.totalSize);
  return runFileJob(
    controls,
    async (job) => {
      let result: EncryptResult | undefined;
      try {
        const { generation } = job;
        if (zip) onStage?.('preparing');
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
        const kdf =
          cryptoAdapters.kdf.withCancellationStatus(onScryptCancellation);
        if (protection.mode === 'raw') onStage?.('running');
        await withReader(generation, temp?.id ?? first.uri, async (reader) => {
          result = await encryptXfile(reader, output, {
            ...job,
            ...cryptoAdapters,
            protection:
              protection.mode === 'password'
                ? {
                    ...protection,
                    kdf: {
                      async derive(...args) {
                        onStage?.('deriving');
                        const key = await kdf.derive(...args);
                        onStage?.('running');
                        return key;
                      },
                    },
                  }
                : protection,
            metadata,
            createdAtUnixSec,
          });
          return result;
        });
        if (temp) await temp.abort();
        const name = await nativeCall((native) =>
          native.outputLabel(generation, output.id),
        ).catch(() => null);
        throwIfAborted(job.signal);
        return {
          fileName: name,
          byteSize: planned.totalSize,
          file: savedFile(output, binaryMime, 'ciphertext'),
          savedTo: label,
          recovery: recover(result!),
        };
      } catch (error) {
        if (result) wipeEncryptionKey(result);
        throw error;
      }
    },
    ({ recovery }) => discard(recovery),
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
