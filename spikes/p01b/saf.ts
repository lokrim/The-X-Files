import {
  Directory,
  File,
  FileMode,
  Paths,
  type FileHandle,
} from 'expo-file-system';
import writeReference from '../../test-utils/p01b/write-reference.json';

export const CHUNK = 1_048_576;
type Metric = string | number | boolean | null;
export type Report = (event: string, fields: Record<string, Metric>) => void;
export class SpikeError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
  }
}
export const yieldJS = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 0));
export function checkedAdd(a: number, b: number): number {
  const result = a + b;
  if (!Number.isSafeInteger(result) || result < 0)
    throw new SpikeError('RESOURCE_LIMIT');
  return result;
}
function check(signal: AbortSignal) {
  if (signal.aborted) throw new SpikeError('CANCELLED');
}
function cacheSize(): number | null {
  return Paths.cache.size;
}
function heapSize(): number | null {
  const runtime = (
    globalThis as typeof globalThis & {
      HermesInternal?: { getInstrumentedStats?: () => Record<string, unknown> };
    }
  ).HermesInternal;
  const stats = runtime?.getInstrumentedStats?.();
  const value = stats?.js_heapSize;
  return typeof value === 'number' ? value : null;
}
export async function readSource(
  uri: string,
  signal: AbortSignal,
  report: Report,
) {
  const source = new File(uri);
  const planned = source.size;
  if (!Number.isSafeInteger(planned) || planned < 2_000_000_000)
    throw new SpikeError('INPUT_TOO_SMALL');
  const cacheBefore = cacheSize();
  let cachePeak = cacheBefore;
  const heapBefore = heapSize();
  let heapPeak = heapBefore;
  // First pass measures sequential bounded reads; second pass proves reopening.
  for (let pass = 1; pass <= 2; pass++) {
    check(signal);
    const handle = source.open(FileMode.ReadOnly);
    let bytes = 0;
    let chunks = 0;
    let shorts = 0;
    const start = performance.now();
    let lastProgress = start;
    try {
      for (;;) {
        check(signal);
        const part = await handle.readBytes(CHUNK);
        if (part.length === 0) break;
        if (part.length < CHUNK) shorts++;
        bytes = checkedAdd(bytes, part.length);
        chunks++;
        if (bytes > planned) throw new SpikeError('SOURCE_CHANGED');
        const heap = heapSize();
        if (heap !== null) heapPeak = Math.max(heapPeak ?? heap, heap);
        if (chunks % 128 === 0) {
          const cache = cacheSize();
          if (cache !== null) cachePeak = Math.max(cachePeak ?? cache, cache);
        }
        const now = performance.now();
        if (now - lastProgress >= 100) {
          report('READ_PROGRESS', { pass, bytes, planned });
          lastProgress = now;
        }
        part.fill(0);
        await yieldJS();
      }
      if (bytes !== planned || source.size !== planned)
        throw new SpikeError('SOURCE_CHANGED');
      const elapsedMs = performance.now() - start;
      report('READ_COMPLETE', {
        pass,
        bytes,
        chunks,
        shorts,
        elapsedMs,
        MBps: bytes / 1_000_000 / (elapsedMs / 1000),
        cacheBefore,
        cachePeak,
        cacheAfter: cacheSize(),
        heapBefore,
        heapPeak,
      });
    } finally {
      handle.close();
    }
  }
}
export async function directOutput(
  directory: Directory,
  signal: AbortSignal,
  report: Report,
  cancelAfterChunks?: number,
) {
  check(signal);
  // Destination capacity is provider-specific; do not substitute app-volume space.
  report('CAPACITY_UNKNOWN', { warning: true });
  const total = 2_000_000_003;
  if (writeReference.bytes !== total || writeReference.chunkBytes !== CHUNK)
    throw new SpikeError('REFERENCE_MISMATCH');
  const heapBefore = heapSize();
  let heapPeak = heapBefore;
  const cacheBefore = cacheSize();
  let cachePeak = cacheBefore;
  function sampleMemory() {
    const heap = heapSize();
    if (heap !== null) heapPeak = Math.max(heapPeak ?? heap, heap);
    const cache = cacheSize();
    if (cache !== null) cachePeak = Math.max(cachePeak ?? cache, cache);
  }
  const output = directory.createFile(
    `p01b-output-${Date.now()}.bin`,
    'application/octet-stream',
  );
  const chunk = new Uint8Array(CHUNK);
  for (let i = 0; i < chunk.length; i++) chunk[i] = i % 251;
  const recordMarker = new DataView(chunk.buffer);
  let bytes = 0;
  let chunks = 0;
  let closed = false;
  let handle: FileHandle | undefined;
  const start = performance.now();
  let lastProgress = start;
  try {
    handle = output.open(FileMode.WriteOnly);
    while (bytes < total) {
      check(signal);
      if (cancelAfterChunks !== undefined && chunks >= cancelAfterChunks)
        throw new SpikeError('CANCELLED');
      recordMarker.setUint32(0, chunks, true);
      const part = chunk.subarray(0, Math.min(CHUNK, total - bytes));
      await handle.writeBytes(part);
      bytes = checkedAdd(bytes, part.length);
      chunks++;
      if (chunks % 128 === 0) sampleMemory();
      const now = performance.now();
      if (now - lastProgress >= 100) {
        report('WRITE_PROGRESS', { bytes, planned: total });
        lastProgress = now;
      }
      await yieldJS();
    }
    handle.close();
    closed = true;
    const elapsedMs = performance.now() - start;
    report('WRITE_COMPLETE', {
      bytes,
      chunks,
      elapsedMs,
      MBps: bytes / 1_000_000 / (elapsedMs / 1000),
    });
    const readStart = performance.now();
    const reader = output.open(FileMode.ReadOnly);
    let readBytes = 0;
    try {
      for (;;) {
        check(signal);
        const part = await reader.readBytes(CHUNK);
        if (!part.length) break;
        readBytes = checkedAdd(readBytes, part.length);
        sampleMemory();
        if (readBytes > total) throw new SpikeError('INTEGRITY_FAILED');
        part.fill(0);
        await yieldJS();
      }
    } finally {
      reader.close();
    }
    const readElapsedMs = performance.now() - readStart;
    const digestStart = performance.now();
    // SDK native implementation streams 64 KiB through ContentResolver, without
    // caching/read-all; independent Node reference remains outside the app graph.
    const integrity =
      (await output.digest('SHA-256')) === writeReference.sha256;
    check(signal);
    if (readBytes !== total || !integrity || output.size !== total)
      throw new SpikeError('INTEGRITY_FAILED');
    report('WRITE_VERIFIED', {
      bytes,
      readBytes,
      chunks,
      elapsedMs,
      MBps: bytes / 1_000_000 / (elapsedMs / 1000),
      readElapsedMs,
      nativeDigestElapsedMs: performance.now() - digestStart,
      heapBefore,
      heapPeak,
      cacheBefore,
      cachePeak,
      cacheAfter: cacheSize(),
      integrity: true,
    });
  } finally {
    try {
      if (!closed) handle?.close();
    } finally {
      chunk.fill(0);
      try {
        output.delete();
        if (output.exists) throw new SpikeError('CLEANUP_FAILED');
        report('OUTPUT_CLEANUP', { deleted: !output.exists, bytes });
      } catch {
        throw new SpikeError('CLEANUP_FAILED');
      }
    }
  }
}

export async function crcBenchmark(report: Report) {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let word = i;
    for (let b = 0; b < 8; b++)
      word = word & 1 ? (word >>> 1) ^ 0xedb88320 : word >>> 1;
    table[i] = word >>> 0;
  }
  function update(crc: number, bytes: Uint8Array) {
    for (let i = 0; i < bytes.length; i++)
      crc = table[(crc ^ bytes[i]!) & 255]! ^ (crc >>> 8);
    return crc >>> 0;
  }
  const kat =
    (update(0xffffffff, new Uint8Array([49, 50, 51, 52, 53, 54, 55, 56, 57])) ^
      0xffffffff) >>>
    0;
  if (kat !== 0xcbf43926) throw new SpikeError('CRC_KAT_FAILED');
  const chunk = new Uint8Array(CHUNK);
  update(0xffffffff, chunk); // warm-up, excluded from timing
  const count = 64;
  let cpuMs = 0;
  let crc = 0xffffffff;
  const wallStart = performance.now();
  for (let i = 0; i < count; i++) {
    const start = performance.now();
    crc = update(crc, chunk);
    cpuMs += performance.now() - start;
    await yieldJS();
  }
  // Consume result without logging a data-derived checksum.
  if (!Number.isInteger(crc)) throw new SpikeError('CRC_INVALID');
  const bytes = CHUNK * count;
  const bytesPerSecond = bytes / (cpuMs / 1000);
  report('CRC_COMPLETE', {
    kat: true,
    bytes,
    chunkBytes: CHUNK,
    chunks: count,
    cpuMs,
    wallMs: performance.now() - wallStart,
    MBps: bytesPerSecond / 1_000_000,
    twoPass2GBEstimatedSeconds: 4_000_000_000 / bytesPerSecond,
  });
}
