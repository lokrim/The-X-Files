import type { ByteReader, ByteWriter } from '../contracts';
import { zeroize } from '../crypto/bytes';
import { Crc32 } from '../crypto/crc32';
import { CoreError, throwIfAborted } from '../crypto/errors';
import { encodeFlatName } from '../file-names';
import {
  abortOutputs,
  checkSourceSize,
  expectEof,
  readChunk,
  streamProgress,
  yieldToEventLoop,
  type StreamOptions,
} from '../io';
import { addSize, maxChunkBytes, multiplySize } from '../sizes';
import {
  centralHeader,
  endRecords,
  localHeader,
  type EntryFacts,
} from './layout';
import { planStoreZip, type ZipInput } from './plan';

export type ZipSource = ZipInput & {
  /** Open a fresh reader at byte zero per call and close it when use settles. */
  withReader<T>(use: (reader: ByteReader) => Promise<T>): Promise<T>;
};

async function scanSource(
  reader: ByteReader,
  size: number,
  signal: AbortSignal | undefined,
  consume: (bytes: Uint8Array) => Promise<void>,
): Promise<number> {
  await checkSourceSize(reader, size, signal);
  const crc = new Crc32();
  let remaining = size;
  while (remaining > 0) {
    const bytes = await readChunk(
      reader,
      Math.min(remaining, maxChunkBytes),
      signal,
    );
    if (!bytes) throw new CoreError('SOURCE_CHANGED');
    try {
      crc.update(bytes);
      await consume(bytes);
      remaining -= bytes.length;
    } finally {
      zeroize(bytes);
    }
  }
  await expectEof(reader, 'SOURCE_CHANGED', signal);
  await checkSourceSize(reader, size, signal);
  return crc.digest();
}

/** Create a private ZIP with two bounded passes over each stat-sized source. */
export async function writeStoreZip(
  sources: readonly ZipSource[],
  output: ByteWriter,
  options: StreamOptions = {},
) {
  const { signal } = options;
  const entries: EntryFacts[] = [];
  try {
    throwIfAborted(signal);
    const plan = planStoreZip(sources);
    const checkpoint = streamProgress(multiplySize(plan.dataSize, 2), options);
    let processed = 0;
    for (const [index, entry] of plan.entries.entries()) {
      throwIfAborted(signal);
      const crc = await sources[index]!.withReader((reader) =>
        scanSource(reader, entry.size, signal, async (bytes) => {
          processed = addSize(processed, bytes.length);
          await checkpoint(processed);
        }),
      );
      if (entry.size === 0 && index % 64 === 0) await yieldToEventLoop(options);
      entries.push({
        ...entry,
        name: encodeFlatName(entry.name, 'UNSUPPORTED_ARCHIVE'),
        crc,
      });
    }
    for (const [index, entry] of entries.entries()) {
      throwIfAborted(signal);
      const header = localHeader(entry);
      try {
        await output.write(header);
      } finally {
        zeroize(header);
      }
      const crc = await sources[index]!.withReader((reader) =>
        scanSource(reader, entry.size, signal, async (bytes) => {
          await output.write(bytes);
          processed = addSize(processed, bytes.length);
          await checkpoint(processed);
        }),
      );
      if (crc !== entry.crc) throw new CoreError('SOURCE_CHANGED');
      if (entry.size === 0 && index % 64 === 0) await checkpoint(processed);
    }
    for (const [index, entry] of entries.entries()) {
      throwIfAborted(signal);
      const header = centralHeader(entry);
      try {
        await output.write(header);
      } finally {
        zeroize(header);
      }
      if (index % 64 === 0) await yieldToEventLoop(options);
    }
    throwIfAborted(signal);
    await output.write(endRecords(plan.directory));
    throwIfAborted(signal);
    await output.close();
    throwIfAborted(signal);
    return plan;
  } catch (error) {
    return await abortOutputs([output], error);
  } finally {
    for (const entry of entries) zeroize(entry.name);
  }
}
