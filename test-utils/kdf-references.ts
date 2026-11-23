import { scrypt } from 'node:crypto';
import { scryptAsync } from '@noble/hashes/scrypt.js';
import { callbackTestKdf } from './callback-kdf';
import type { ReferenceScryptOptions } from './node-crypto';
import { equalBytes } from '../src/core/crypto/bytes';
import { CoreError } from '../src/core/crypto/errors';
import { fromHex } from './hex';
import vectors from './crypto-kats.json';

export const testNativeMaxmem = 402653184;
export const nodeKdf = callbackTestKdf((password, salt, params, done) => {
  scrypt(
    password,
    salt,
    params.dkLen,
    {
      N: 2 ** params.log2N,
      r: params.r,
      p: params.p,
      maxmem: testNativeMaxmem,
    },
    done,
  );
});

/** Recorded P01b phone answers, not live native execution or performance proof. */
export const recordedNativeKdf = callbackTestKdf(
  (password, salt, params, done) => {
    const vector = vectors.production.find(
      (v) =>
        v.log2N === params.log2N &&
        equalBytes(password, fromHex(v.password)) &&
        equalBytes(salt, fromHex(v.salt)),
    );
    if (!vector) {
      done(new CoreError('IO_ERROR'));
      return;
    }
    done(null, fromHex(vector.expected));
  },
);

/** Independent RFC helper; never reachable through production parameter policy. */
export function nobleScryptReference(
  password: Uint8Array,
  salt: Uint8Array,
  options: ReferenceScryptOptions,
): Promise<Uint8Array> {
  return scryptAsync(password, salt, { ...options, asyncTick: 10 });
}
