import type { Rng } from '../contracts';
import { equalBytes, zeroize } from '../crypto/bytes';
import { CoreError } from '../crypto/errors';
import { createRequiredRng } from '../crypto/rng';
import { divide, inverse, multiply } from './gf256';
import {
  fileKeyLength,
  setIdLength,
  shareSetKey,
  shareVersion,
  validateShare,
  validateThreshold,
  type Share,
} from './share';

/** The caller retains fileKey and owns the returned shares' mutable bytes. */
export function split(
  fileKey: Uint8Array,
  total: number,
  threshold: number,
  rng: Rng,
): Share[] {
  validateThreshold(total, threshold);
  if (!(fileKey instanceof Uint8Array) || fileKey.length !== fileKeyLength)
    throw new CoreError('BAD_PARAMS');

  const requiredRng = createRequiredRng(rng);
  const shares: Share[] = [];
  let setId: Uint8Array | undefined;
  let coefficients: Uint8Array | undefined;
  let succeeded = false;
  try {
    setId = requiredRng.bytes(setIdLength);
    const randomTerms = threshold - 1;
    coefficients = requiredRng.bytes(fileKeyLength * randomTerms);
    for (let x = 1; x <= total; x++) {
      const y = new Uint8Array(fileKeyLength);
      shares.push({
        version: shareVersion,
        threshold,
        total,
        x,
        setId: setId.slice(),
        y,
      });
      for (let byte = 0; byte < fileKeyLength; byte++) {
        const start = byte * randomTerms;
        let value = 0;
        for (let term = start + randomTerms - 1; term >= start; term--)
          value = multiply(value, x) ^ coefficients[term]!;
        y[byte] = multiply(value, x) ^ fileKey[byte]!;
      }
    }
    succeeded = true;
    return shares;
  } finally {
    zeroize(setId, coefficients);
    if (!succeeded) for (const share of shares) zeroize(share.y);
  }
}

/** The caller retains its shares and owns the returned file key. */
export function combine(shares: Iterable<Share>): Uint8Array {
  const sorted: Share[] = [];
  const indices = new Set<number>();
  let setKey: string | undefined;
  for (const share of shares) {
    validateShare(share);
    const currentSet = shareSetKey(share);
    setKey ??= currentSet;
    if (setKey !== currentSet) throw new CoreError('MIXED_SET');
    if (indices.has(share.x)) throw new CoreError('DUPLICATE_INDEX');
    indices.add(share.x);
    sorted.push(share);
  }
  const first = sorted[0];
  if (!first || sorted.length < first.threshold)
    throw new CoreError('INSUFFICIENT');

  sorted.sort((a, b) => a.x - b.x);
  const basis = sorted.slice(0, first.threshold);
  const inverseDenominators = Uint8Array.from(basis, (share) => {
    let denominator = 1;
    for (const other of basis) {
      if (other.x !== share.x)
        denominator = multiply(denominator, share.x ^ other.x);
    }
    return inverse(denominator);
  });

  const fileKey = new Uint8Array(fileKeyLength);
  const evaluated = new Uint8Array(fileKeyLength);
  let succeeded = false;
  try {
    evaluate(basis, inverseDenominators, 0, fileKey);
    let mismatch = 0;
    for (const extra of sorted.slice(first.threshold)) {
      evaluate(basis, inverseDenominators, extra.x, evaluated);
      mismatch |= Number(!equalBytes(evaluated, extra.y));
    }
    if (mismatch !== 0) throw new CoreError('INCONSISTENT');
    succeeded = true;
    return fileKey;
  } finally {
    zeroize(evaluated);
    if (!succeeded) zeroize(fileKey);
  }
}

/** Lagrange evaluation at an x outside the basis using public weights. */
function evaluate(
  basis: readonly Share[],
  inverseDenominators: Uint8Array,
  x: number,
  output: Uint8Array,
): void {
  let numerator = 1;
  for (const share of basis) numerator = multiply(numerator, x ^ share.x);

  output.fill(0);
  for (const [index, share] of basis.entries()) {
    const weight = multiply(
      divide(numerator, x ^ share.x),
      inverseDenominators[index]!,
    );
    for (let byte = 0; byte < fileKeyLength; byte++)
      output[byte] = output[byte]! ^ multiply(weight, share.y[byte]!);
  }
}
