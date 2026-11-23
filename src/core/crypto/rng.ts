import type { Rng } from '../contracts';
import { CoreError } from './errors';

/** No default or global source: platform composition must provide a CSPRNG. */
export function createRequiredRng(provider?: Rng): Rng {
  return {
    bytes(length) {
      if (!Number.isSafeInteger(length) || length < 0)
        throw new CoreError('RESOURCE_LIMIT');
      if (!provider) throw new CoreError('RNG_UNAVAILABLE');
      try {
        const result = provider.bytes(length);
        if (!(result instanceof Uint8Array) || result.length !== length) {
          if (result instanceof Uint8Array) result.fill(0);
          throw new CoreError('RNG_UNAVAILABLE');
        }
        try {
          return Uint8Array.from(result);
        } finally {
          result.fill(0);
        }
      } catch {
        throw new CoreError('RNG_UNAVAILABLE');
      }
    },
  };
}
