// Node-only references. Never import into src/app or use as production adapters.
import { Buffer } from 'node:buffer';
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scrypt,
} from 'node:crypto';
import type { Aead, Rng } from '../src/core/contracts';
import { CoreError } from '../src/core/crypto/errors';

export const nodeAead: Aead = {
  async seal(key, nonce, aad, plaintext) {
    if (key.length !== 32 || nonce.length !== 12)
      throw new CoreError('BAD_PARAMS');
    const cipher = createCipheriv('aes-256-gcm', key, nonce, {
      authTagLength: 16,
    });
    cipher.setAAD(aad);
    const first = cipher.update(plaintext);
    const last = cipher.final();
    const ciphertext = Buffer.concat([first, last]);
    try {
      return {
        ciphertext: Uint8Array.from(ciphertext),
        tag: Uint8Array.from(cipher.getAuthTag()),
      };
    } finally {
      first.fill(0);
      last.fill(0);
      ciphertext.fill(0);
    }
  },
  async open(key, nonce, aad, ciphertext, tag) {
    let unverified: Uint8Array | undefined;
    let last: Uint8Array | undefined;
    let verified: Uint8Array | undefined;
    try {
      if (key.length !== 32 || nonce.length !== 12 || tag.length !== 16)
        throw new CoreError('AUTH_FAILED');
      const decipher = createDecipheriv('aes-256-gcm', key, nonce, {
        authTagLength: 16,
      });
      decipher.setAAD(aad);
      decipher.setAuthTag(tag);
      unverified = decipher.update(ciphertext);
      last = decipher.final(); // No plaintext leaves the adapter before this succeeds.
      verified = Buffer.concat([unverified, last]);
      return Uint8Array.from(verified);
    } catch {
      throw new CoreError('AUTH_FAILED');
    } finally {
      unverified?.fill(0);
      last?.fill(0);
      verified?.fill(0);
    }
  },
};

export const nodeRng: Rng = {
  bytes(length) {
    const native = randomBytes(length);
    try {
      return Uint8Array.from(native);
    } finally {
      native.fill(0);
    }
  },
};
export type ReferenceScryptOptions = {
  N: number;
  r: number;
  p: number;
  dkLen: number;
  maxmem: number;
};
/** RFC small costs are allowed here only, not through the application Kdf policy. */
export function nodeScryptReference(
  password: Uint8Array,
  salt: Uint8Array,
  options: ReferenceScryptOptions,
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      options.dkLen,
      { N: options.N, r: options.r, p: options.p, maxmem: options.maxmem },
      (error, key) => {
        if (error) {
          reject(new CoreError('IO_ERROR'));
          return;
        }
        try {
          resolve(Uint8Array.from(key));
        } finally {
          key.fill(0);
        }
      },
    );
  });
}
