import type { Kdf, ScryptLog2N, ScryptParams } from '../contracts';
import { CoreError, throwIfAborted } from './errors';
import { zeroize } from './bytes';

export const allowedScryptCosts: readonly ScryptLog2N[] = Object.freeze([
  15, 16, 17, 18,
]);
export const writerScryptParams: ScryptParams = Object.freeze({
  log2N: 17,
  r: 8,
  p: 1,
  dkLen: 32,
});

/** Copy checked scalar values before an asynchronous backend can see them. */
export function validateScryptParams(
  value: unknown,
  salt: Uint8Array,
): ScryptParams {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new CoreError('RESOURCE_LIMIT');
  const params = value as Record<string, unknown>;
  const { log2N, r, p, dkLen } = params;
  if (
    salt.length !== 16 ||
    typeof log2N !== 'number' ||
    !allowedScryptCosts.some((cost) => cost === log2N) ||
    r !== 8 ||
    p !== 1 ||
    dkLen !== 32 ||
    Object.keys(params).length !== 4
  )
    throw new CoreError('RESOURCE_LIMIT');
  return Object.freeze({ log2N: log2N as ScryptLog2N, r, p, dkLen });
}

/** Policy/composition only: no concrete scrypt implementation or test-cost path. */
export function createPolicyKdf(backend: Kdf): Kdf {
  return {
    async derive(passwordBytes, salt, params, signal, onProgress) {
      const checked = validateScryptParams(params, salt);
      if (!passwordBytes.length) throw new CoreError('EMPTY_PASSWORD');
      if (passwordBytes.length > 1024) throw new CoreError('PASSWORD_TOO_LONG');
      throwIfAborted(signal);
      let key: Uint8Array;
      try {
        key = await backend.derive(
          passwordBytes,
          salt,
          checked,
          signal,
          onProgress,
        );
      } catch (error: unknown) {
        throw error instanceof CoreError ? error : new CoreError('IO_ERROR');
      }
      if (!(key instanceof Uint8Array)) throw new CoreError('IO_ERROR');
      if (signal?.aborted) {
        zeroize(key);
        throw new CoreError('CANCELLED');
      }
      if (key.length !== 32) {
        zeroize(key);
        throw new CoreError('IO_ERROR');
      }
      // Own the backend result, return a plain byte copy (Buffer.slice is a view).
      try {
        return Uint8Array.from(key);
      } finally {
        zeroize(key);
      }
    },
  };
}
