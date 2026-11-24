import type { Rng } from '../contracts';
import { zeroize } from '../crypto/bytes';
import { decodeShare, encodeShare } from './share-codec';
import { combine, split } from './sharing';
import type { Share } from './share';

export {
  decodeShare,
  describeShare,
  encodeShare,
  groupShares,
} from './share-codec';
export { combine, split } from './sharing';
export type { Share, ShareDescription } from './share';

/** The caller retains fileKey and manages the lifetime of the share strings. */
export function splitKey(
  fileKey: Uint8Array,
  total: number,
  threshold: number,
  rng: Rng,
): string[] {
  const shares = split(fileKey, total, threshold, rng);
  try {
    return shares.map(encodeShare);
  } finally {
    for (const share of shares) zeroize(share.y);
  }
}

/** The caller owns the reconstructed file key and must wipe it after use. */
export function combineShares(inputs: readonly string[]): Uint8Array {
  const decoded: Share[] = [];
  function* readShares(): Iterable<Share> {
    // Validate each decoded share as it is read to bound the owned buffers.
    for (const input of inputs) {
      const share = decodeShare(input);
      decoded.push(share);
      yield share;
    }
  }
  try {
    return combine(readShares());
  } finally {
    for (const share of decoded) zeroize(share.y);
  }
}
