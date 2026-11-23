import { equalBytes, zeroize } from './bytes';
import {
  decodeBase32,
  encodeBase32,
  groupCode,
  stripCodeSeparators,
} from './encoding';
import { CoreError } from './errors';
import { sha256 } from './hash';

export function encodeKey(fileKey: Uint8Array): string {
  if (fileKey.length !== 32) throw new CoreError('BAD_PARAMS');
  const body = new Uint8Array(35);
  let digest: Uint8Array | undefined;
  try {
    body[0] = 1;
    body.set(fileKey, 1);
    digest = sha256(body.subarray(0, 33));
    body.set(digest.subarray(0, 2), 33);
    return 'XFK1-' + groupCode(encodeBase32(body));
  } finally {
    zeroize(body, digest);
  }
}

/** Error order: normalized bound, prefix, length, symbols/padding, checksum, version. */
export function decodeKey(input: string): Uint8Array {
  const text = stripCodeSeparators(input);
  if (text.slice(0, 4).toUpperCase() !== 'XFK1')
    throw new CoreError('BAD_PREFIX');
  const body = decodeBase32(text.slice(4), 35);
  let digest: Uint8Array | undefined;
  try {
    digest = sha256(body.subarray(0, 33));
    if (!equalBytes(body.subarray(33), digest.subarray(0, 2)))
      throw new CoreError('BAD_CHECKSUM');
    if (body[0] !== 1) throw new CoreError('UNSUPPORTED_VERSION');
    return body.slice(1, 33);
  } finally {
    zeroize(body, digest);
  }
}
