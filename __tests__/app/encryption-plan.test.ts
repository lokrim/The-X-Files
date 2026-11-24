import { zeroize } from '@/core/crypto/bytes';
import { decodeKey } from '@/core/crypto/key-codec';
import { combineShares, describeShare } from '@/core/shamir';
import { maxPayloadBytes } from '@/core/sizes';
import { maxCreateEntries } from '@/core/zip';
import { createRecovery } from '@/features/encrypt/recovery';
import {
  checkPassword,
  checkSelection,
  outputName,
} from '@/features/encrypt/workflow';
import { seededRng } from '../../test-utils/seeded-rng';

const source = (name: string, size = 0, mime = 'application/octet-stream') => ({
  name,
  size,
  mime,
  uri: 'content://fixture',
});

test('zero-length ZIP input is opaque; multiple inputs plan exactly one ZIP with NFC collision names', () => {
  const direct = checkSelection([
    source('opaque.zip', 0, 'application/zip'),
  ]).plan!;
  expect(direct).toMatchObject({
    payloadBytes: 0,
    payloadRecords: 0,
    metadata: { isZip: false, entryCount: 1 },
  });
  expect(direct.zip).toBeUndefined();

  const bundle = checkSelection([
    source('e\u0301.txt'),
    source('é.txt', 1),
    source('é (2).txt', 2),
  ]).plan!;
  expect(bundle.metadata).toMatchObject({
    isZip: true,
    totalSize: bundle.zip!.totalSize,
    entryCount: 3,
  });
  expect(bundle.zip!.entries.map(({ name }) => name)).toEqual([
    'é.txt',
    'é (3).txt',
    'é (2).txt',
  ]);
  expect(bundle.payloadBytes).toBe(
    bundle.totalSize - bundle.metadataBytes - 48 - 2 * 21,
  );
  expect(bundle.payloadBytes).toBeGreaterThan(3);
});

test('enforces creation count, flat names, UTF-8 bytes, and the ZIP-inclusive payload budget', () => {
  expect(
    checkSelection(Array(maxCreateEntries + 1).fill(source('empty'))).error,
  ).toMatch(/10,000/);
  expect(checkSelection([source('folder/file')]).error).toMatch(/flat/);
  expect(checkSelection([source('é'.repeat(128))]).error).toMatch(/255/);
  expect(checkSelection([source('é'.repeat(127) + 'x')]).error).toBeNull();
  expect(
    checkSelection([source('large', maxPayloadBytes)]).plan?.payloadRecords,
  ).toBe(2 ** 20);
  expect(
    checkSelection([source('large', maxPayloadBytes), source('empty')]).error,
  ).toMatch(/1 TiB/);
  const date = new Date(2026, 10, 25, 9, 5);
  expect(outputName([source('e\u0301.zip')], false, date)).toBe(
    'encrypted-20261125-0905.xfile',
  );
  expect(outputName([source('e\u0301.zip')], true, date)).toBe('é.zip.xfile');
  expect(outputName([source('é'.repeat(127) + 'x')], true, date)).toBe(
    'é'.repeat(124) + '.xfile',
  );
});

test('password validation preserves spaces and checks normalized code-point and byte boundaries', () => {
  expect(checkPassword('a'.repeat(7), 'a'.repeat(7)).valid).toBe(false);
  expect(checkPassword('password', 'password')).toMatchObject({
    valid: true,
    strength: 'weak',
  });
  expect(checkPassword('Ａbcdef  ', 'Abcdef  ').valid).toBe(true);
  expect(checkPassword('Ａbcdef  ', 'Abcdef ').valid).toBe(false);
  expect(checkPassword('Password', 'password').valid).toBe(false);
  expect(checkPassword('😀'.repeat(256), '😀'.repeat(256)).valid).toBe(true);
  expect(checkPassword('😀'.repeat(257), '😀'.repeat(257)).error).toMatch(
    /1024/,
  );
  expect(checkPassword('12345678\uD800', '12345678').error).toMatch(/Unicode/);
});

test('Shares keeps only five share cards and its public setId and immediately wipes the raw key', () => {
  const fileKey = new Uint8Array(32).fill(13);
  const recovery = createRecovery(
    { mode: 'shares', total: 5, threshold: 3 },
    { mode: 'raw', fileKey },
    seededRng(43),
  );
  expect(fileKey).toEqual(new Uint8Array(32));
  expect(recovery.cards).toHaveLength(5);
  const codes = recovery.cards.map(({ read }) => read()!);
  const recombined = combineShares([codes[0]!, codes[2]!, codes[4]!]);
  expect(recombined).toEqual(new Uint8Array(32).fill(13));
  const { setId } = describeShare(codes[0]!);
  expect(recovery.setId).toBe(Buffer.from(setId).toString('hex').toUpperCase());
  recovery.wipe();
  expect(recovery.cards.every(({ read }) => read() === null)).toBe(true);
  zeroize(recombined);
});

test('Key has one lazy code while Password supplies no recovery value', () => {
  const fileKey = new Uint8Array(32).fill(6);
  const recovery = createRecovery(
    { mode: 'key' },
    { mode: 'raw', fileKey },
    seededRng(12),
  );
  expect(recovery.setId).toBeUndefined();
  expect(recovery.cards).toHaveLength(1);
  expect(decodeKey(recovery.cards[0]!.read()!)).toEqual(fileKey);
  recovery.wipe();
  expect(fileKey).toEqual(new Uint8Array(32));
  expect(recovery.cards[0]!.read()).toBeNull();
  expect(
    createRecovery({ mode: 'password' }, { mode: 'password' }, seededRng(12))
      .cards,
  ).toEqual([]);
});
