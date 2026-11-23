// Model of a non-interruptible async platform call, NOT a production backend.
import type { Kdf, ScryptParams } from '../src/core/contracts';
import { CoreError, throwIfAborted } from '../src/core/crypto/errors';
import { createPolicyKdf } from '../src/core/crypto/kdf-policy';
import { zeroize } from '../src/core/crypto/bytes';

export type TestKdfInvoke = (
  password: Uint8Array,
  salt: Uint8Array,
  params: ScryptParams,
  done: (error: Error | null, key?: Uint8Array) => void,
) => void;

export function callbackTestKdf(invoke: TestKdfInvoke): Kdf {
  return createPolicyKdf({
    derive(password, salt, params, signal, onProgress) {
      throwIfAborted(signal);
      const ownedPassword = Uint8Array.from(password);
      const ownedSalt = Uint8Array.from(salt);
      return new Promise<Uint8Array>((resolve, reject) => {
        let settled = false;
        let finished = false;
        const abort = () => {
          if (!settled) {
            settled = true;
            reject(new CoreError('CANCELLED'));
          }
          // Native may still be using ownedPassword. Wipe only at its callback.
        };
        const complete = (error: Error | null, key?: Uint8Array) => {
          if (finished) {
            zeroize(key);
            return;
          }
          finished = true;
          signal?.removeEventListener('abort', abort);
          try {
            if (!settled) {
              if (signal?.aborted) abort();
              else if (error || key?.length !== 32) {
                settled = true;
                reject(new CoreError('IO_ERROR'));
              } else {
                onProgress?.(1);
                // Progress callbacks can cancel too; do not resolve afterwards.
                if (signal?.aborted) abort();
                else {
                  settled = true;
                  resolve(Uint8Array.from(key));
                }
              }
            }
          } catch {
            if (!settled) {
              settled = true;
              reject(new CoreError('IO_ERROR'));
            }
          } finally {
            zeroize(key, ownedPassword, ownedSalt);
          }
        };
        signal?.addEventListener('abort', abort, { once: true });
        try {
          if (signal?.aborted) {
            abort();
            zeroize(ownedPassword, ownedSalt);
            return;
          }
          invoke(ownedPassword, ownedSalt, params, complete);
        } catch {
          complete(new CoreError('IO_ERROR'));
        }
      });
    },
  });
}
