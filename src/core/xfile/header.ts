import type { ByteReader, ScryptParams } from '../contracts';
import { equalBytes, zeroize } from '../crypto/bytes';
import { crc32 } from '../crypto/crc32';
import { CoreError } from '../crypto/errors';
import { sha256 } from '../crypto/hash';
import { validateScryptParams, writerScryptParams } from '../crypto/kdf-policy';
import { operationError, readExact } from '../io';
import { dataView, readUint64, writeUint64 } from '../sizes';

export const headerBytes = 48;
export const writerChunkLog2 = 20;
const magic = Uint8Array.of(0x58, 0x46, 0x4c, 0x31);

export type XfileMode = 'raw' | 'password';
export type HeaderFacts = Readonly<{
  mode: XfileMode;
  isZip: boolean;
  chunkSizeLog2: number;
  createdAtUnixSec: number;
}>;
export type HeaderHints = HeaderFacts & { readonly verified: false };

export type ParsedHeader = {
  facts: HeaderFacts;
  salt: Uint8Array;
  kdf: ScryptParams | null;
  hash: Uint8Array;
};

export function encodeHeader(
  mode: XfileMode,
  isZip: boolean,
  createdAtUnixSec: number,
  salt: Uint8Array,
): Uint8Array {
  const bytes = new Uint8Array(headerBytes);
  const view = dataView(bytes);
  bytes.set(magic);
  bytes[4] = 1;
  bytes[5] = mode === 'raw' ? 1 : 2;
  bytes[6] = isZip ? 1 : 0;
  bytes[7] = writerChunkLog2;
  writeUint64(view, 12, createdAtUnixSec);
  bytes.set(salt, 24);
  if (mode === 'password') {
    const { log2N, r, p } = writerScryptParams;
    bytes.set([1, log2N, r, p], 40);
  }
  view.setUint32(44, crc32(bytes.subarray(0, 44)));
  return bytes;
}

function parseHeader(bytes: Uint8Array): ParsedHeader {
  if (!equalBytes(bytes.subarray(0, 4), magic))
    throw new CoreError('BAD_HEADER');
  if (bytes[4] !== 1) throw new CoreError('UNSUPPORTED_VERSION');
  const view = dataView(bytes);
  const [mode, flags, chunkSizeLog2] = [bytes[5]!, bytes[6]!, bytes[7]!];
  const [id, log2N, r, p] = [bytes[40]!, bytes[41]!, bytes[42]!, bytes[43]!];
  if (
    (mode !== 1 && mode !== 2) ||
    flags > 1 ||
    chunkSizeLog2 < 16 ||
    chunkSizeLog2 > writerChunkLog2 ||
    view.getUint32(8) !== 0 ||
    view.getUint32(20) !== 0 ||
    view.getUint32(44) !== crc32(bytes.subarray(0, 44)) ||
    (mode === 1 ? id !== 0 || log2N !== 0 || r !== 0 || p !== 0 : id !== 1)
  )
    throw new CoreError('BAD_HEADER');
  const salt = Uint8Array.from(bytes.subarray(24, 40));
  return {
    facts: Object.freeze({
      mode: mode === 1 ? 'raw' : 'password',
      isZip: flags === 1,
      chunkSizeLog2,
      createdAtUnixSec: readUint64(view, 12),
    }),
    salt,
    kdf:
      mode === 2
        ? validateScryptParams({ log2N, r, p, dkLen: 32 }, salt)
        : null,
    hash: sha256(bytes),
  };
}

export async function readHeader(
  reader: ByteReader,
  signal?: AbortSignal,
): Promise<ParsedHeader> {
  const bytes = await readExact(reader, headerBytes, 'TRUNCATED', signal);
  try {
    return parseHeader(bytes);
  } finally {
    zeroize(bytes);
  }
}

/** Consumes only the header. Use a fresh reader for decryption. */
export async function inspectHeader(
  reader: ByteReader,
  signal?: AbortSignal,
): Promise<HeaderHints> {
  try {
    const { facts } = await readHeader(reader, signal);
    return { ...facts, verified: false };
  } catch (error) {
    throw operationError(error);
  }
}
