import type { ByteReader, ByteWriter } from '../src/core/contracts';
import { CoreError } from '../src/core/crypto/errors';

export function memoryReader(
  bytes: Uint8Array,
  {
    short = Infinity,
    size = () => bytes.length,
  }: { short?: number; size?: () => number } = {},
) {
  let position = 0;
  const requests: number[] = [];
  const reader: ByteReader = {
    async size() {
      return size();
    },
    async read(max) {
      requests.push(max);
      if (position === bytes.length) return null;
      const end = Math.min(position + max, position + short, bytes.length);
      const output = Uint8Array.from(bytes.subarray(position, end));
      position = end;
      return output;
    },
  };
  return { reader, requests };
}

export function memoryWriter() {
  let data: Uint8Array[] = [];
  let closed = false;
  let aborted = false;
  let writes = 0;
  const writer: ByteWriter = {
    async write(bytes) {
      if (closed) throw new CoreError('IO_ERROR');
      data.push(Uint8Array.from(bytes));
      writes++;
    },
    async close() {
      closed = true;
    },
    async abort() {
      closed = true;
      aborted = true;
      data = [];
    },
  };
  return {
    writer,
    get closed() {
      return closed;
    },
    get aborted() {
      return aborted;
    },
    get writes() {
      return writes;
    },
    bytes: () => Buffer.concat(data),
  };
}

export function deferred() {
  let resolve!: () => void;
  const ready = new Promise<void>((done) => {
    resolve = done;
  });
  return { ready, resolve };
}
