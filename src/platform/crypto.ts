import { getRandomValues } from 'expo-crypto';
import {
  Buffer,
  createCipheriv,
  createDecipheriv,
  scrypt,
} from 'react-native-quick-crypto';

import type { Aead, Kdf } from '@/core/contracts';
import { zeroize } from '@/core/crypto/bytes';
import { CoreError } from '@/core/crypto/errors';
import { createPolicyKdf } from '@/core/crypto/kdf-policy';
import { createRequiredRng } from '@/core/crypto/rng';

const tagBytes = 16;
const maxmem = 384 * 1024 * 1024;

function validateGcm(key: Uint8Array, nonce: Uint8Array) {
  if (key.length !== 32 || nonce.length !== 12) throw new CoreError('IO_ERROR');
}

function join(first: Uint8Array, last: Uint8Array) {
  const bytes = new Uint8Array(first.length + last.length);
  bytes.set(first);
  bytes.set(last, first.length);
  return bytes;
}

export const aead: Aead = {
  async seal(key, nonce, aad, plaintext) {
    validateGcm(key, nonce);
    const ownedKey = Buffer.from(key);
    let first: Uint8Array | undefined;
    let last: Uint8Array | undefined;
    let tag: Uint8Array | undefined;
    try {
      if (!(plaintext.buffer instanceof ArrayBuffer))
        throw new CoreError('IO_ERROR');
      const cipher = createCipheriv(
        'aes-256-gcm',
        ownedKey,
        Buffer.from(nonce),
        {
          authTagLength: tagBytes,
        },
      );
      if (aad.length) cipher.setAAD(Buffer.from(aad));
      const input = Buffer.from(
        plaintext.buffer,
        plaintext.byteOffset,
        plaintext.byteLength,
      );
      first = input.length ? cipher.update(input) : new Uint8Array();
      last = cipher.final();
      tag = cipher.getAuthTag();
      if (
        !tag ||
        tag.length !== tagBytes ||
        first.length + last.length !== input.length
      )
        throw new CoreError('IO_ERROR');
      return { ciphertext: join(first, last), tag: Uint8Array.from(tag) };
    } catch {
      throw new CoreError('IO_ERROR');
    } finally {
      zeroize(ownedKey, first, last, tag);
    }
  },

  async open(key, nonce, aad, ciphertext, tag) {
    validateGcm(key, nonce);
    if (tag.length !== tagBytes) throw new CoreError('AUTH_FAILED');
    const ownedKey = Buffer.from(key);
    let first: Uint8Array | undefined;
    let last: Uint8Array | undefined;
    try {
      if (!(ciphertext.buffer instanceof ArrayBuffer))
        throw new CoreError('AUTH_FAILED');
      const decipher = createDecipheriv(
        'aes-256-gcm',
        ownedKey,
        Buffer.from(nonce),
        {
          authTagLength: tagBytes,
        },
      );
      if (aad.length) decipher.setAAD(Buffer.from(aad));
      decipher.setAuthTag(Buffer.from(tag));
      const input = Buffer.from(
        ciphertext.buffer,
        ciphertext.byteOffset,
        ciphertext.byteLength,
      );
      first = input.length ? decipher.update(input) : new Uint8Array();
      last = decipher.final();
      if (first.length + last.length !== input.length)
        throw new CoreError('AUTH_FAILED');
      return join(first, last);
    } catch {
      throw new CoreError('AUTH_FAILED');
    } finally {
      zeroize(ownedKey, first, last);
    }
  },
};

// One native scrypt allocation at a time, including a cancelled call still
// computing. Cancel rejects the waiter immediately. The callback owns wiping.
type StartScrypt = (
  password: Uint8Array,
  salt: Uint8Array,
  length: number,
  options: { N: number; r: number; p: number; maxmem: number },
  callback: (error: Error | null, key?: Uint8Array) => void,
) => void;

export function createQuickScrypt(start: StartScrypt = scrypt): Kdf {
  let nativeDeriving = false;
  return createPolicyKdf({
    derive(passwordBytes, salt, { log2N, r, p, dkLen }, signal) {
      if (nativeDeriving) throw new CoreError('IO_ERROR');
      return new Promise((resolve, reject) => {
        if (signal?.aborted) {
          reject(new CoreError('CANCELLED'));
          return;
        }
        const password = Uint8Array.from(passwordBytes);
        const ownedSalt = Uint8Array.from(salt);
        let completed = false;
        const cancel = () => reject(new CoreError('CANCELLED'));
        const finish = (error: unknown, key?: Uint8Array) => {
          try {
            if (completed) return;
            completed = true;
            nativeDeriving = false;
            signal?.removeEventListener('abort', cancel);
            zeroize(password, ownedSalt);
            if (signal?.aborted) cancel();
            else if (error || key?.length !== dkLen)
              reject(new CoreError('IO_ERROR'));
            else resolve(Uint8Array.from(key));
          } finally {
            zeroize(key);
          }
        };
        nativeDeriving = true;
        signal?.addEventListener('abort', cancel, { once: true });
        try {
          start(
            password,
            ownedSalt,
            dkLen,
            { N: 2 ** log2N, r, p, maxmem },
            finish,
          );
        } catch (error: unknown) {
          finish(error);
        }
      });
    },
  });
}

export const cryptoAdapters = {
  aead,
  kdf: createQuickScrypt(),
  rng: createRequiredRng({
    bytes: (length) => getRandomValues(new Uint8Array(length)),
  }),
};
