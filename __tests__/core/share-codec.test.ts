import { createHash } from 'node:crypto';
import {
  crockfordAlphabet,
  decodeBase32,
  encodeBase32,
  stripCodeSeparators,
} from '@/core/crypto/encoding';
import { CoreError } from '@/core/crypto/errors';
import {
  decodeShare,
  describeShare,
  encodeShare,
  groupShares,
  splitKey,
} from '@/core/shamir';
import { fromHex } from '../../test-utils/hex';
import { seededRng } from '../../test-utils/seeded-rng';
import fixture from '../../test-utils/shamir-regression.json';

const first = fixture.shares[0]!;
const canonical = stripCodeSeparators(first.text);

test('the seeded split matches independent share bytes and canonical text', () => {
  // Python reference: polynomial long reduction, hashlib and MSB-first bit strings.
  const texts = splitKey(
    fromHex(fixture.fileKey),
    fixture.total,
    fixture.threshold,
    seededRng(fixture.seed),
  );
  expect(texts).toEqual(fixture.shares.map(({ text }) => text));
  for (const [index, vector] of fixture.shares.entries()) {
    const text = stripCodeSeparators(vector.text);
    const payload = text.slice(4);
    const bytes = fromHex(vector.binary);
    expect(payload).toHaveLength(68);
    expect(decodeBase32(payload, 42)).toEqual(bytes);
    const share = decodeShare(vector.text);
    expect(share).toEqual({
      version: 1,
      threshold: fixture.threshold,
      total: fixture.total,
      x: index + 1,
      setId: bytes.slice(4, 8),
      y: bytes.slice(8, 40),
    });
    expect(encodeShare(share)).toBe(vector.text);
  }
});

test('prefix case and ASCII separators are independent from payload aliases', () => {
  const payload = canonical.slice(4).toLowerCase().replaceAll('0', 'o');
  const aliased = Array.from(payload, (symbol, index) =>
    symbol === '1' ? (index % 2 ? 'I' : 'l') : symbol,
  ).join(' \r\n-');
  expect(aliased).toMatch(/[Il]/);
  expect(aliased).toContain('o');
  expect(encodeShare(decodeShare(`x-F s\r\n1-${aliased}`))).toBe(first.text);
  expect(decodeShare('-'.repeat(10000) + first.text)).toEqual(
    decodeShare(first.text),
  );
  for (const prefix of ['XFSI', 'XFSl', 'XFK1', '']) {
    expect(() => decodeShare(prefix + payload)).toThrow(
      new CoreError('BAD_PREFIX'),
    );
  }
});

test('the stripped bound counts the prefix before prefix or symbol validation', () => {
  expect(() => decodeShare('XXXX-' + '0 '.repeat(196))).toThrow(
    new CoreError('BAD_PREFIX'),
  );
  expect(() => decodeShare('XXXX-' + '0 '.repeat(197))).toThrow(
    new CoreError('BAD_LENGTH'),
  );
  for (const invalid of [canonical.slice(0, -1), canonical + '0']) {
    expect(() => decodeShare(invalid)).toThrow(new CoreError('BAD_LENGTH'));
  }
  for (const symbol of ['U', '\t', 'ſ', '–', '=', '\u00a0']) {
    expect(() =>
      decodeShare(canonical.slice(0, 5) + symbol + canonical.slice(6)),
    ).toThrow(new CoreError('BAD_SYMBOL'));
  }
});

test('any nonzero low padding bits are rejected before checksum validation', () => {
  const last = crockfordAlphabet.indexOf(canonical.at(-1)!);
  expect([0, 16]).toContain(last);
  for (let padding = 1; padding < 16; padding++) {
    expect(() =>
      decodeShare(canonical.slice(0, -1) + crockfordAlphabet[last + padding]),
    ).toThrow(new CoreError('BAD_PADDING'));
  }
});

test('checksum, version and share parameters have deterministic error order', () => {
  const bytes = fromHex(first.binary);
  bytes[0] = 2;
  bytes[1] = 1;
  const text = () => 'XFS1-' + encodeBase32(bytes);
  const checksum = () => {
    const digest = createHash('sha256').update(bytes.subarray(0, 40)).digest();
    bytes.set(digest.subarray(0, 2), 40);
  };
  expect(() => decodeShare(text())).toThrow(new CoreError('BAD_CHECKSUM'));
  checksum();
  expect(() => decodeShare(text())).toThrow(
    new CoreError('UNSUPPORTED_VERSION'),
  );
  bytes[0] = 1;
  checksum();
  expect(() => decodeShare(text())).toThrow(new CoreError('BAD_PARAMS'));

  bytes[1] = 3;
  for (const header of [
    [6, 5, 1],
    [2, 1, 1],
    [3, 5, 0],
    [3, 5, 6],
  ]) {
    bytes.set(header, 1);
    checksum();
    expect(() => describeShare(text())).toThrow(new CoreError('BAD_PARAMS'));
  }
});

test('describing and grouping return only public fields and validate every code', () => {
  const second = fixture.shares[1]!;
  const share = decodeShare(first.text);
  const setId = Uint8Array.of(0, 1, 2, 3);
  const otherSet = encodeShare({ ...share, setId });
  const otherThreshold = encodeShare({ ...share, threshold: 2 });
  const otherTotal = encodeShare({ ...share, total: 6 });
  const summary = {
    version: share.version,
    threshold: share.threshold,
    total: share.total,
    x: share.x,
    setId: share.setId,
  };
  expect(describeShare(first.text)).toStrictEqual(summary);
  expect(
    groupShares([
      second.text,
      otherSet,
      otherThreshold,
      otherTotal,
      first.text,
      first.text,
    ]),
  ).toStrictEqual([
    [{ ...summary, x: 2 }, summary, summary],
    [{ ...summary, setId }],
    [{ ...summary, threshold: 2 }],
    [{ ...summary, total: 6 }],
  ]);
  expect(() => groupShares([first.text, canonical.slice(0, -1)])).toThrow(
    new CoreError('BAD_LENGTH'),
  );
  expect(() => encodeShare({ ...share, y: new Uint8Array(31) })).toThrow(
    new CoreError('BAD_PARAMS'),
  );
});
