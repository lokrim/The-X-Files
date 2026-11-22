import { File, FileMode, Paths } from 'expo-file-system';
import { measurement, type Measurement } from './native';
import { CHUNK, SpikeError, yieldJS, type Report } from './saf';
import zero from '../../test-utils/p01b/zero-reference.json';
const AUTH = 'content://com.xfiles.p01bprovider';
const SOURCE = AUTH + '/document/short';
const LARGE = AUTH + '/document/large';
const PARENT = AUTH + '/tree/root/document/root';
const pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
function bridge() {
  const m = measurement();
  if (!m) throw new SpikeError('NATIVE_MODULE_MISSING');
  return m;
}
async function readAll(
  m: Measurement,
  uri: string,
  report: Report,
  label: string,
) {
  let reader: { id: number; size: number };
  try {
    reader = await m.openReader(uri);
  } catch (error: unknown) {
    report('SAF_STREAM_OPEN_FAILED', {
      label,
      errorType: error instanceof Error ? error.name : 'UNKNOWN',
    });
    throw new SpikeError('IO_ERROR');
  }
  if (
    !Number.isSafeInteger(reader.size) ||
    reader.size < 0 ||
    reader.size > 2 ** 40
  ) {
    await m.closeReader(reader.id);
    throw new SpikeError('RESOURCE_LIMIT');
  }
  let bytes = 0;
  let chunks = 0;
  let shortReads = 0;
  let maxRead = 0;
  let last = performance.now();
  const start = performance.now();
  const baseline = m.metrics();
  let nativePeak = baseline.nativeAllocatedBytes;
  let rssPeak = baseline.rssKiB;
  try {
    for (;;) {
      const raw: unknown = await m.read(reader.id, CHUNK);
      const data =
        raw instanceof Uint8Array
          ? raw
          : raw instanceof ArrayBuffer
            ? new Uint8Array(raw)
            : Array.isArray(raw)
              ? new Uint8Array(raw as number[])
              : null;
      if (!data) {
        report('SAF_NATIVE_BUFFER_TYPE', {
          label,
          array: Array.isArray(raw),
          buffer: raw instanceof ArrayBuffer,
          view: ArrayBuffer.isView(raw),
          type: typeof raw,
        });
        throw new SpikeError('NATIVE_BUFFER_TYPE');
      }
      if (!data.length) break;
      if (data.length > CHUNK) throw new SpikeError('BUFFER_BOUND_FAILED');
      bytes += data.length;
      if (!Number.isSafeInteger(bytes) || bytes > reader.size)
        throw new SpikeError('SOURCE_CHANGED');
      if (data.length < CHUNK) shortReads++;
      maxRead = Math.max(maxRead, data.length);
      chunks++;
      data.fill(0);
      const now = performance.now();
      if (now - last >= 500) {
        const stats = m.metrics();
        nativePeak = Math.max(nativePeak, stats.nativeAllocatedBytes);
        rssPeak = Math.max(rssPeak, stats.rssKiB);
        report('SAF_STREAM_PROGRESS', { label, bytes, planned: reader.size });
        last = now;
      }
      await yieldJS();
    }
  } finally {
    await m.closeReader(reader.id);
  }
  if (bytes !== reader.size) throw new SpikeError('SOURCE_CHANGED');
  const elapsedMs = performance.now() - start;
  report('SAF_STREAM_READ', {
    label,
    bytes,
    chunks,
    shortReads,
    maxRead,
    elapsedMs,
    MBps: bytes / 1e6 / (elapsedMs / 1000),
    nativeBaseline: baseline.nativeAllocatedBytes,
    nativePeak,
    rssBaselineKiB: baseline.rssKiB,
    rssPeakKiB: rssPeak,
    cacheBytes: Paths.cache.size,
  });
}
export async function safFaults(report: Report) {
  const m = bridge();
  let sdkPipe = false;
  let sdk: ReturnType<File['open']> | undefined;
  try {
    sdk = new File(SOURCE).open(FileMode.ReadOnly);
    await sdk.readBytes(CHUNK);
    sdkPipe = true;
  } catch {
    report('SAF_SDK_PIPE_FAILED', {
      // A failed open/read alone does not establish ESPIPE: the URI grant
      // must first be verified after the most recent app restart.
      reason: 'UNCLASSIFIED_SDK_OPEN_OR_READ_FAILURE',
      fallbackRequired: true,
    });
  } finally {
    sdk?.close();
  }
  report('SAF_SDK_PIPE', { supported: sdkPipe });
  await readAll(m, SOURCE, report, 'short-pipe');
  let unsafeRejected = false;
  try {
    await readAll(m, AUTH + '/document/unsafe', report, 'unsafe');
  } catch {
    unsafeRejected = true;
  }
  report('SAF_UNSAFE_METADATA', { rejected: unsafeRejected });
  let denied = false;
  try {
    const r = await m.openReader(AUTH + '/document/denied');
    await m.closeReader(r.id);
  } catch {
    denied = true;
  }
  report('SAF_PROVIDER_DENIAL', {
    explicit: denied,
    cacheBytes: Paths.cache.size,
  });
  for (const scenario of [
    'full',
    'denied',
    'closeFault',
    'deleteDenied',
  ] as const) {
    const uri = await m.createOutput(PARENT, scenario);
    let id: number | undefined;
    let operationFailed = false;
    let deleted = false;
    try {
      id = await m.openWriter(uri);
      await m.write(id, new Uint8Array([7]));
      if (scenario === 'closeFault') await pause(250);
      await m.closeWriter(id);
      id = undefined;
    } catch {
      operationFailed = true;
    } finally {
      if (id !== undefined) {
        try {
          await m.closeWriter(id);
        } catch {}
      }
      deleted = await m.deleteOutput(uri);
    }
    report('SAF_OUTPUT_FAULT', {
      scenario,
      operationFailed,
      deleted,
      cleanupFailureExplicit: !deleted,
    });
  }
  const cancelReader = await m.openReader(SOURCE);
  const start = performance.now();
  const pending = m.read(cancelReader.id, CHUNK).then(
    (bytes) => {
      bytes.fill(0);
      return true;
    },
    () => false,
  );
  await pause(10);
  const abortAt = performance.now();
  await m.closeReader(cancelReader.id);
  await pending;
  report('SAF_STREAM_CANCEL', {
    elapsedMs: performance.now() - start,
    cleanupAfterAbortMs: performance.now() - abortAt,
    lateWrite: false,
  });
  report('SAF_READY_FOR_REVOKE', { ready: true });
}
export async function revokedProbe(report: Report) {
  const m = bridge();
  let sdkDenied = false;
  let nativeDenied = false;
  try {
    const r = new File(SOURCE).open(FileMode.ReadOnly);
    r.close();
  } catch {
    sdkDenied = true;
  }
  try {
    const r = await m.openReader(SOURCE);
    await m.closeReader(r.id);
  } catch {
    nativeDenied = true;
  }
  report('SAF_REVOKED_GRANT', {
    sdkDenied,
    nativeDenied,
    cacheBytes: Paths.cache.size,
  });
}
export async function streamLarge(report: Report) {
  const m = bridge();
  await readAll(m, LARGE, report, 'large-source');
  const uri = await m.createOutput(PARENT, 'normal');
  const baseline = m.metrics();
  let nativePeak = baseline.nativeAllocatedBytes;
  let rssPeakKiB = baseline.rssKiB;
  let id: number | undefined;
  let bytes = 0;
  let last = performance.now();
  const chunk = new Uint8Array(CHUNK);
  const start = performance.now();
  try {
    id = await m.openWriter(uri);
    while (bytes < zero.bytes) {
      const amount = Math.min(CHUNK, zero.bytes - bytes);
      await m.write(id, chunk.subarray(0, amount));
      bytes += amount;
      const now = performance.now();
      if (now - last >= 500) {
        const stats = m.metrics();
        nativePeak = Math.max(nativePeak, stats.nativeAllocatedBytes);
        rssPeakKiB = Math.max(rssPeakKiB, stats.rssKiB);
        report('SAF_STREAM_PROGRESS', {
          label: 'large-output',
          bytes,
          planned: zero.bytes,
        });
        last = now;
      }
      await yieldJS();
    }
    await m.closeWriter(id);
    id = undefined;
    const elapsedMs = performance.now() - start;
    report('SAF_STREAM_WRITE', {
      bytes,
      elapsedMs,
      MBps: bytes / 1e6 / (elapsedMs / 1000),
      nativeBaseline: baseline.nativeAllocatedBytes,
      nativePeak,
      rssBaselineKiB: baseline.rssKiB,
      rssPeakKiB,
      capacityUnknownWarning: true,
    });
    await readAll(m, uri, report, 'large-output-readback');
    const digestStart = performance.now();
    const integrity = (await new File(uri).digest('SHA-256')) === zero.sha256;
    report('SAF_STREAM_INTEGRITY', {
      bytes,
      integrity,
      digestElapsedMs: performance.now() - digestStart,
      cacheBytes: Paths.cache.size,
    });
    if (!integrity) throw new SpikeError('INTEGRITY_FAILED');
  } finally {
    chunk.fill(0);
    if (id !== undefined)
      try {
        await m.closeWriter(id);
      } catch {}
    report('SAF_STREAM_OUTPUT_CLEANUP', {
      deleted: await m.deleteOutput(uri),
      bytes,
    });
  }
}
