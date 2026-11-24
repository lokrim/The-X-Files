import { createHash } from 'node:crypto';
import * as fc from 'fast-check';
import * as bytes from '@/core/crypto/bytes';
import {
  decodeBase32,
  encodeBase32,
  stripCodeSeparators,
} from '@/core/crypto/encoding';
import { CoreError } from '@/core/crypto/errors';
import {
  combine,
  combineShares,
  decodeShare,
  groupShares,
  split,
  splitKey,
  type Share,
} from '@/core/shamir';
import * as shareCodec from '@/core/shamir/share-codec';
import { fromHex } from '../../test-utils/hex';
import { nodeAead } from '../../test-utils/node-crypto';
import { seededRng } from '../../test-utils/seeded-rng';
import fixture from '../../test-utils/shamir-regression.json';

const fileKey = fromHex(fixture.fileKey);
const fixtureTexts = fixture.shares.map(({ text }) => text);

function* subsets(
  shares: readonly Share[],
  count: number,
  start = 0,
): Iterable<Share[]> {
  if (count === 0) {
    yield [];
    return;
  }
  for (let index = start; index <= shares.length - count; index++) {
    for (const rest of subsets(shares, count - 1, index + 1))
      yield [shares[index]!, ...rest];
  }
}

test('every threshold subset for totals 2 through 7 recovers the key', () => {
  const rng = seededRng(3281);
  for (let total = 2; total <= 7; total++) {
    for (let threshold = 2; threshold <= total; threshold++) {
      const shares = split(fileKey, total, threshold, rng);
      for (const subset of subsets(shares, threshold))
        expect(combine(subset.reverse())).toEqual(fileKey);
    }
  }
});

test('sampled subset and all-share recovery for every UI threshold and total', () => {
  const rng = seededRng(10771);
  for (let total = 2; total <= 16; total++) {
    for (let threshold = 2; threshold <= total; threshold++) {
      const key = rng.bytes(32);
      const shares = split(key, total, threshold, rng);
      const reversed = [...shares].reverse();
      expect(combine(reversed.slice(0, threshold))).toEqual(key);
      expect(combine(reversed)).toEqual(key);
      expect(reversed[0]!.x).toBe(total);
    }
  }
});

test('sampled recovery for larger totals with varying keys and share positions', () => {
  const counts = fc
    .integer({ min: 17, max: 255 })
    .chain((total) =>
      fc.tuple(fc.constant(total), fc.integer({ min: 2, max: total })),
    );
  fc.assert(
    fc.property(
      counts,
      fc.uint8Array({ minLength: 32, maxLength: 32 }),
      fc.integer(),
      ([total, threshold], key, seed) => {
        const rng = seededRng(seed);
        const shares = split(key, total, threshold, rng);
        const priorities = rng.bytes(total);
        shares.sort((a, b) => priorities[a.x - 1]! - priorities[b.x - 1]!);
        expect(combine(shares.slice(0, threshold))).toEqual(key);
        expect(combine(shares)).toEqual(key);
      },
    ),
    { seed: 20261124, numRuns: 50 },
  );
});

test('the core and codec support a total, an index, and a threshold of 255', () => {
  const rng = seededRng(99431);
  const twoOf255 = splitKey(fileKey, 255, 2, rng);
  expect(twoOf255).toHaveLength(255);
  expect(decodeShare(twoOf255[254]!)).toMatchObject({ x: 255, total: 255 });
  expect(combineShares(twoOf255)).toEqual(fileKey);
  expect(combineShares([twoOf255[254]!, twoOf255[0]!])).toEqual(fileKey);

  const all = splitKey(fileKey, 255, 255, rng).reverse();
  expect(decodeShare(all[0]!)).toMatchObject({ x: 255, threshold: 255 });
  expect(combineShares(all)).toEqual(fileKey);
  expect(() => combineShares(all.slice(1))).toThrow(
    new CoreError('INSUFFICIENT'),
  );
  expect(() => combineShares([...all, all[0]!])).toThrow(
    new CoreError('DUPLICATE_INDEX'),
  );
});

test('split requests one independent four-byte ID and allows every coefficient to be zero', () => {
  const buffers: Uint8Array[] = [];
  const rng = {
    bytes(length: number) {
      const buffer = new Uint8Array(length);
      if (length === 4) buffer.fill(buffers.length + 5);
      buffers.push(buffer);
      return buffer;
    },
  };
  const first = split(fileKey, 5, 3, rng);
  const second = split(fileKey, 5, 3, rng);
  expect(buffers.map(({ length }) => length)).toEqual([4, 64, 4, 64]);
  expect(buffers.every((buffer) => buffer.every((byte) => byte === 0))).toBe(
    true,
  );
  for (const [index, shares] of [first, second].entries()) {
    for (const share of shares) {
      expect(share.setId).toEqual(new Uint8Array(4).fill(index * 2 + 5));
      expect(share.y).toEqual(fileKey);
      expect(share.y).not.toBe(fileKey);
    }
  }
  first[0]!.setId.fill(0);
  expect(first[1]!.setId).toEqual(new Uint8Array(4).fill(5));
});

test('split rejects invalid input before RNG and fails closed on malformed randomness', () => {
  const rng = { bytes: jest.fn((length: number) => new Uint8Array(length)) };
  for (const [total, threshold] of [
    [1, 1],
    [5, 1],
    [5, 6],
    [256, 2],
    [3.5, 2],
    [4, 2.5],
    [Infinity, 2],
    [4, NaN],
  ] as const) {
    expect(() => split(fileKey, total, threshold, rng)).toThrow(
      new CoreError('BAD_PARAMS'),
    );
  }
  expect(() => split(new Uint8Array(33), 5, 3, rng)).toThrow(
    new CoreError('BAD_PARAMS'),
  );
  expect(rng.bytes).not.toHaveBeenCalled();

  const id = Uint8Array.of(1, 2, 3, 4);
  const short = new Uint8Array(63).fill(7);
  rng.bytes.mockReturnValueOnce(id).mockReturnValueOnce(short);
  expect(() => split(fileKey, 5, 3, rng)).toThrow(
    new CoreError('RNG_UNAVAILABLE'),
  );
  expect(id).toEqual(new Uint8Array(4));
  expect(short).toEqual(new Uint8Array(63));
});

test('combine rejects insufficient, duplicate, mixed, and malformed inputs before interpolation', () => {
  const [first, second, third, , last] = fixtureTexts.map(decodeShare);
  const basis = [first!, second!, third!];
  const extra = last!;
  for (const inputs of [[], basis.slice(0, 1), basis.slice(0, 2)]) {
    expect(() => combine(inputs)).toThrow(new CoreError('INSUFFICIENT'));
  }
  expect(() => combine([first!, first!])).toThrow(
    new CoreError('DUPLICATE_INDEX'),
  );
  expect(() => combine([...basis, third!])).toThrow(
    new CoreError('DUPLICATE_INDEX'),
  );
  for (const change of [
    { threshold: 2 },
    { total: 6 },
    { setId: Uint8Array.of(0, 0, 0, 0) },
  ]) {
    expect(() => combine([...basis, { ...extra, ...change }])).toThrow(
      new CoreError('MIXED_SET'),
    );
  }
  expect(() => combine([...basis, { ...extra, version: 2 }])).toThrow(
    new CoreError('UNSUPPORTED_VERSION'),
  );
  for (const change of [
    { threshold: 1 },
    { total: 256 },
    { x: 0 },
    { x: 5.5 },
    { x: 6 },
    { setId: new Uint8Array(3) },
    { y: new Uint8Array(31) },
    { y: new Uint8Array(33) },
  ]) {
    expect(() => combine([...basis, { ...extra, ...change }])).toThrow(
      new CoreError('BAD_PARAMS'),
    );
  }
});

test('every byte of every extra share is checked even with a recomputed checksum', () => {
  const texts = splitKey(fileKey, 7, 3, seededRng(66231)).reverse();
  expect(combineShares(texts)).toEqual(fileKey);
  for (let extra = 0; extra < 4; extra++) {
    const valid = decodeBase32(stripCodeSeparators(texts[extra]!).slice(4), 42);
    for (let byte = 8; byte < 40; byte++) {
      const changed = valid.slice();
      changed[byte] = changed[byte]! ^ 1;
      const digest = createHash('sha256')
        .update(changed.subarray(0, 40))
        .digest();
      changed.set(digest.subarray(0, 2), 40);
      const inputs = [...texts];
      inputs[extra] = 'XFS1-' + encodeBase32(changed);
      expect(decodeShare(inputs[extra]!).y[byte - 8]).toBe(changed[byte]);
      expect(() => combineShares(inputs)).toThrow(
        new CoreError('INCONSISTENT'),
      );
    }
  }
});

test('the lowest indices form the basis and all remaining shares are checked after a mismatch', () => {
  const inputs = fixtureTexts.map(decodeShare);
  inputs[3]!.y[0] = inputs[3]!.y[0]! ^ 1;
  const comparison = jest.spyOn(bytes, 'equalBytes');
  try {
    expect(() => combine([...inputs].reverse())).toThrow(
      new CoreError('INCONSISTENT'),
    );
    const checked = comparison.mock.calls.map(([, y]) => y);
    expect(checked).toHaveLength(2);
    expect(checked[0]).toBe(inputs[3]!.y);
    expect(checked[1]).toBe(inputs[4]!.y);
    const scratch = comparison.mock.calls[0]![0];
    expect(scratch).toEqual(new Uint8Array(32));
  } finally {
    comparison.mockRestore();
  }
});

test('independent splits with an intentional setId collision group together and AEAD catches a wrong key', async () => {
  const sharedId = Uint8Array.of(5, 27, 180, 42);
  const collisionRng = (seed: number) => {
    const rng = seededRng(seed);
    return {
      bytes: (length: number) =>
        length === 4 ? sharedId.slice() : rng.bytes(length),
    };
  };
  const otherKey = new Uint8Array(32).fill(82);
  const first = splitKey(fileKey, 5, 3, collisionRng(781));
  const other = splitKey(otherKey, 5, 3, collisionRng(39));
  expect(combineShares(first)).toEqual(fileKey);
  expect(combineShares(other)).toEqual(otherKey);
  const mixed = [first[0]!, first[1]!, other[2]!];
  expect(groupShares(mixed)).toHaveLength(1);
  const wrongKey = combineShares(mixed);
  expect(wrongKey).not.toEqual(fileKey);
  expect(() => combineShares([...mixed, first[3]!])).toThrow(
    new CoreError('INCONSISTENT'),
  );

  const nonce = new Uint8Array(12);
  const aad = Uint8Array.of(3, 4);
  const plaintext = Uint8Array.of(15, 62, 101);
  const { ciphertext, tag } = await nodeAead.seal(
    fileKey,
    nonce,
    aad,
    plaintext,
  );
  await expect(
    nodeAead.open(wrongKey, nonce, aad, ciphertext, tag),
  ).rejects.toMatchObject({
    code: 'AUTH_FAILED',
  });
});

test('high-level helpers wipe their temporary share bytes on success and parse failure', () => {
  const encoded = jest.spyOn(shareCodec, 'encodeShare');
  const decoded = jest.spyOn(shareCodec, 'decodeShare');
  try {
    const inputKey = fileKey.slice();
    const texts = splitKey(inputKey, 5, 3, seededRng(fixture.seed));
    expect(inputKey).toEqual(fileKey);
    expect(encoded).toHaveBeenCalledTimes(5);
    for (const [share] of encoded.mock.calls)
      expect(share.y).toEqual(new Uint8Array(32));

    const recovered = combineShares(texts);
    expect(recovered).toEqual(inputKey);
    expect(recovered).not.toBe(inputKey);
    expect(() => combineShares([texts[0]!, texts[1]!, 'XFS1-'])).toThrow(
      new CoreError('BAD_LENGTH'),
    );
    const decodedShares = decoded.mock.results.filter(
      (result) => result.type === 'return',
    );
    expect(decodedShares).toHaveLength(7);
    for (const result of decodedShares)
      expect(result.value.y).toEqual(new Uint8Array(32));
  } finally {
    encoded.mockRestore();
    decoded.mockRestore();
  }
});
