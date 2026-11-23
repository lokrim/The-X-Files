import type { Rng } from '../src/core/contracts';

/** Reproducible TEST DATA ONLY. App/compiler/Metro boundaries exclude this file. */
export function seededRng(seed: number): Rng {
  let word = seed >>> 0 || 1;
  return {
    bytes(length) {
      const output = new Uint8Array(length);
      for (let i = 0; i < length; i++) {
        word ^= word << 13;
        word ^= word >>> 17;
        word ^= word << 5;
        output[i] = word & 255;
      }
      return output;
    },
  };
}
