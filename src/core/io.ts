import type { ByteReader, ByteWriter, OnProgress } from './contracts';
import { zeroize } from './crypto/bytes';
import {
  CoreError,
  operationErrorCodes,
  passwordErrorCodes,
  throwIfAborted,
  type OperationErrorCode,
} from './crypto/errors';
import { checkedSize, maxChunkBytes } from './sizes';

export type StreamOptions = {
  signal?: AbortSignal;
  onProgress?: OnProgress;
  /** Let the host supply an event-loop yield that works during foreground jobs. */
  yieldControl?: () => Promise<void>;
};

export function operationError(
  error: unknown,
  fallback: OperationErrorCode = 'IO_ERROR',
): CoreError {
  return error instanceof CoreError &&
    operationErrorCodes.some((code) => code === error.code)
    ? error
    : new CoreError(fallback);
}

export async function readChunk(
  reader: ByteReader,
  max: number,
  signal?: AbortSignal,
): Promise<Uint8Array | null> {
  throwIfAborted(signal);
  const bytes = await reader.read(max);
  if (signal?.aborted || (bytes && bytes.length > max)) {
    zeroize(bytes ?? undefined);
    throwIfAborted(signal);
    throw new CoreError('IO_ERROR');
  }
  return bytes?.length ? bytes : null;
}

export async function readExact(
  reader: ByteReader,
  length: number,
  shortRead: OperationErrorCode,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  if (length === 0) return new Uint8Array(0);
  const first = await readChunk(
    reader,
    Math.min(length, maxChunkBytes),
    signal,
  );
  if (!first) throw new CoreError(shortRead);
  if (first.length === length) return first;
  const bytes = new Uint8Array(length);
  bytes.set(first);
  let offset = first.length;
  zeroize(first);
  try {
    while (offset < length) {
      const part = await readChunk(
        reader,
        Math.min(length - offset, maxChunkBytes),
        signal,
      );
      if (!part) throw new CoreError(shortRead);
      bytes.set(part, offset);
      offset += part.length;
      zeroize(part);
    }
    return bytes;
  } catch (error) {
    zeroize(bytes);
    throw error;
  }
}

export async function expectEof(
  reader: ByteReader,
  extraByte: OperationErrorCode,
  signal?: AbortSignal,
): Promise<void> {
  const extra = await readChunk(reader, 1, signal);
  if (extra) {
    zeroize(extra);
    throw new CoreError(extraByte);
  }
}

export async function checkSourceSize(
  reader: ByteReader,
  size: number,
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  const actual = checkedSize(await reader.size());
  throwIfAborted(signal);
  if (actual !== size) throw new CoreError('SOURCE_CHANGED');
}

export async function abortOutputs(
  outputs: readonly ByteWriter[],
  reason: unknown,
): Promise<never> {
  let cleanupFailed = false;
  for (const output of outputs) {
    try {
      await output.abort();
    } catch {
      cleanupFailed = true;
    }
  }
  if (cleanupFailed) throw new CoreError('IO_ERROR');
  if (
    reason instanceof CoreError &&
    passwordErrorCodes.some((code) => code === reason.code)
  )
    throw reason;
  throw operationError(reason);
}

export async function yieldToEventLoop({
  signal,
  yieldControl,
}: StreamOptions): Promise<void> {
  throwIfAborted(signal);
  if (yieldControl) await yieldControl();
  else await new Promise<void>((resolve) => setTimeout(resolve, 0));
  throwIfAborted(signal);
}

export function streamProgress(total: number, options: StreamOptions) {
  const { signal, onProgress } = options;
  let lastUpdate: number | undefined;
  return async (processed: number): Promise<void> => {
    throwIfAborted(signal);
    if (onProgress) {
      const now = performance.now();
      if (lastUpdate === undefined || now - lastUpdate >= 100) {
        lastUpdate = now;
        onProgress(processed, total);
      }
    }
    await yieldToEventLoop(options);
  };
}
