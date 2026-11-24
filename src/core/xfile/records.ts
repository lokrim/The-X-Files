import type { Aead, ByteReader, ByteWriter } from '../contracts';
import { zeroize } from '../crypto/bytes';
import { CoreError, throwIfAborted } from '../crypto/errors';
import { operationError, readExact } from '../io';
import { dataView, writeUint64 } from '../sizes';

const prefixBytes = 5;
const tagBytes = 16;

function recordAuth(hash: Uint8Array, counter: number, flags: number) {
  const nonce = new Uint8Array(12);
  writeUint64(dataView(nonce), 4, counter);
  const aad = new Uint8Array(41);
  aad.set(hash);
  aad.set(nonce.subarray(4), 32);
  aad[40] = flags;
  return { nonce, aad };
}

export async function sealRecord(
  aead: Aead,
  key: Uint8Array,
  hash: Uint8Array,
  counter: number,
  plaintext: Uint8Array,
  final: boolean,
  output: ByteWriter,
  signal?: AbortSignal,
): Promise<void> {
  const prefix = new Uint8Array(prefixBytes);
  const flags = final ? 1 : 0;
  dataView(prefix).setUint32(0, plaintext.length);
  prefix[4] = flags;
  const { nonce, aad } = recordAuth(hash, counter, flags);
  throwIfAborted(signal);
  const { ciphertext, tag } = await aead.seal(key, nonce, aad, plaintext);
  try {
    if (ciphertext.length !== plaintext.length || tag.length !== tagBytes)
      throw new CoreError('IO_ERROR');
    for (const bytes of [prefix, ciphertext, tag]) {
      throwIfAborted(signal);
      await output.write(bytes);
    }
    throwIfAborted(signal);
  } finally {
    zeroize(ciphertext, tag);
  }
}

export async function openRecord(
  aead: Aead,
  key: Uint8Array,
  hash: Uint8Array,
  counter: number,
  input: ByteReader,
  maxLength: number,
  signal?: AbortSignal,
): Promise<{ plaintext: Uint8Array; final: boolean }> {
  const prefix = await readExact(input, prefixBytes, 'TRUNCATED', signal);
  const flags = prefix[4]!;
  const length = dataView(prefix).getUint32(0);
  if (flags > 1) throw new CoreError('BAD_HEADER');
  if (length > maxLength) throw new CoreError('RESOURCE_LIMIT');
  // The reader may reuse scratch on its next read. Keep the authenticated
  // input contiguous and do not read again until open() consumes it.
  const sealed = await readExact(input, length + tagBytes, 'TRUNCATED', signal);
  let plaintext: Uint8Array | undefined;
  let transferred = false;
  try {
    const ciphertext = sealed.subarray(0, length);
    const tag = sealed.subarray(length);
    const { nonce, aad } = recordAuth(hash, counter, flags);
    try {
      plaintext = await aead.open(key, nonce, aad, ciphertext, tag);
    } catch (error) {
      throw operationError(error, 'AUTH_FAILED');
    }
    throwIfAborted(signal);
    if (plaintext.length !== length) throw new CoreError('IO_ERROR');
    // A backend may authenticate in place. Detach before the next read.
    if (plaintext.buffer === sealed.buffer)
      return { plaintext: Uint8Array.from(plaintext), final: flags === 1 };
    transferred = true;
    return { plaintext, final: flags === 1 };
  } finally {
    zeroize(sealed);
    if (!transferred) zeroize(plaintext);
  }
}
