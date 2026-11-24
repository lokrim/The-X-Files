import { CoreError } from '../crypto/errors';

export const shareVersion = 1;
export const fileKeyLength = 32;
export const setIdLength = 4;
export const maxShares = 255;

export type ShareDescription = Readonly<{
  version: number;
  threshold: number;
  total: number;
  x: number;
  setId: Uint8Array;
}>;

export type Share = ShareDescription & Readonly<{ y: Uint8Array }>;

export function validateThreshold(total: number, threshold: number): void {
  if (
    !Number.isInteger(total) ||
    !Number.isInteger(threshold) ||
    threshold < 2 ||
    threshold > total ||
    total > maxShares
  )
    throw new CoreError('BAD_PARAMS');
}

export function validateShareDescription(share: ShareDescription): void {
  if (share === null || typeof share !== 'object')
    throw new CoreError('BAD_PARAMS');
  if (share.version !== shareVersion)
    throw new CoreError('UNSUPPORTED_VERSION');
  validateThreshold(share.total, share.threshold);
  if (
    !Number.isInteger(share.x) ||
    share.x < 1 ||
    share.x > share.total ||
    !(share.setId instanceof Uint8Array) ||
    share.setId.length !== setIdLength
  )
    throw new CoreError('BAD_PARAMS');
}

export function validateShare(share: Share): void {
  validateShareDescription(share);
  if (!(share.y instanceof Uint8Array) || share.y.length !== fileKeyLength)
    throw new CoreError('BAD_PARAMS');
}

/** Only public metadata participates in grouping. Distinct splits can collide. */
export function shareSetKey(share: ShareDescription): string {
  return `${share.version}/${share.threshold}/${share.total}/${share.setId.join('.')}`;
}
