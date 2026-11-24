import { equalBytes, zeroize } from '../crypto/bytes';
import {
  decodeBase32,
  encodeBase32,
  groupCode,
  stripCodeSeparators,
} from '../crypto/encoding';
import { CoreError } from '../crypto/errors';
import { sha256 } from '../crypto/hash';
import {
  shareSetKey,
  validateShare,
  validateShareDescription,
  type Share,
  type ShareDescription,
} from './share';

const prefix = 'XFS1';
const setIdOffset = 4;
const shareBytesOffset = 8;
const checksumOffset = 40;
const shareLength = 42;

export function encodeShare(share: Share): string {
  validateShare(share);
  const body = new Uint8Array(shareLength);
  let digest: Uint8Array | undefined;
  try {
    body[0] = share.version;
    body[1] = share.threshold;
    body[2] = share.total;
    body[3] = share.x;
    body.set(share.setId, setIdOffset);
    body.set(share.y, shareBytesOffset);
    digest = sha256(body.subarray(0, checksumOffset));
    body.set(digest.subarray(0, 2), checksumOffset);
    return prefix + '-' + groupCode(encodeBase32(body));
  } finally {
    zeroize(body, digest);
  }
}

/** The caller owns the returned mutable share bytes. */
export function decodeShare(input: string): Share {
  return readShare(input, (body, description) => ({
    ...description,
    y: body.slice(shareBytesOffset, checksumOffset),
  }));
}

/** Fully validate the text and return only the public fields. */
export function describeShare(input: string): ShareDescription {
  return readShare(input, (_body, description) => description);
}

/** Groups and their members follow input order, including repeated indices. */
export function groupShares(inputs: readonly string[]): ShareDescription[][] {
  const groups = new Map<string, ShareDescription[]>();
  for (const input of inputs) {
    const description = describeShare(input);
    const key = shareSetKey(description);
    const group = groups.get(key);
    if (group) group.push(description);
    else groups.set(key, [description]);
  }
  return Array.from(groups.values());
}

/** Error order matches XFK1, with share parameters checked after the version. */
function readShare<T>(
  input: string,
  read: (body: Uint8Array, description: ShareDescription) => T,
): T {
  const text = stripCodeSeparators(input);
  if (text.slice(0, 4).toUpperCase() !== prefix)
    throw new CoreError('BAD_PREFIX');
  const body = decodeBase32(text.slice(4), shareLength);
  let digest: Uint8Array | undefined;
  try {
    digest = sha256(body.subarray(0, checksumOffset));
    if (!equalBytes(body.subarray(checksumOffset), digest.subarray(0, 2)))
      throw new CoreError('BAD_CHECKSUM');
    const description = {
      version: body[0]!,
      threshold: body[1]!,
      total: body[2]!,
      x: body[3]!,
      setId: body.slice(setIdOffset, shareBytesOffset),
    };
    validateShareDescription(description);
    return read(body, description);
  } finally {
    zeroize(body, digest);
  }
}
