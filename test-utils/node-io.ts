import { open, unlink } from 'node:fs/promises';
import type { ByteReader, ByteWriter } from '../src/core/contracts';
import { CoreError } from '../src/core/crypto/errors';

function readBound(max: number) {
  if (!Number.isSafeInteger(max) || max < 1 || max > 1048576)
    throw new CoreError('RESOURCE_LIMIT');
}

export async function nodeReader(
  path: string,
): Promise<ByteReader & { close(): Promise<void> }> {
  const handle = await open(path, 'r');
  return {
    async size() {
      const { size } = await handle.stat();
      if (!Number.isSafeInteger(size) || size < 0)
        throw new CoreError('RESOURCE_LIMIT');
      return size;
    },
    async read(max) {
      readBound(max);
      const buffer = new Uint8Array(max);
      const { bytesRead } = await handle.read(buffer, 0, max, null);
      return bytesRead ? buffer.subarray(0, bytesRead) : null;
    },
    close: () => handle.close(),
  };
}

/** Exclusive create: failure to create never grants ownership of an existing path. */
export async function nodeWriter(path: string): Promise<ByteWriter> {
  const handle = await open(path, 'wx');
  let closed = false;
  let deleted = false;
  async function close() {
    if (!closed) {
      await handle.close();
      closed = true;
    }
  }
  return {
    async write(bytes) {
      if (closed) throw new CoreError('IO_ERROR');
      let offset = 0;
      while (offset < bytes.length) {
        const { bytesWritten } = await handle.write(
          bytes,
          offset,
          bytes.length - offset,
          null,
        );
        if (!bytesWritten) throw new CoreError('IO_ERROR');
        offset += bytesWritten;
      }
    },
    close,
    async abort() {
      let failed = false;
      try {
        await close();
      } catch {
        failed = true;
      }
      if (!deleted) {
        try {
          await unlink(path);
          deleted = true;
        } catch {
          failed = true;
        }
      }
      if (failed) throw new CoreError('IO_ERROR');
    },
  };
}
