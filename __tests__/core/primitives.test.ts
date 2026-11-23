import { createHash } from 'node:crypto';
import * as fc from 'fast-check';
import { equalBytes, zeroize } from '@/core/crypto/bytes';
import { Crc32, crc32 } from '@/core/crypto/crc32';
import { sha256 } from '@/core/crypto/hash';
import { createRequiredRng } from '@/core/crypto/rng';
import {
  genericDecryptMessage,
  operationErrorCategory,
  operationErrorCodes,
  CoreError,
} from '@/core/crypto/errors';
import { nodeRng } from '../../test-utils/node-crypto';
import { toHex } from '../../test-utils/hex';

test('SHA-256 known answers and Node agreement', () => {
  expect(toHex(sha256(new Uint8Array()))).toBe(
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  );
  expect(toHex(sha256(Uint8Array.from([97, 98, 99])))).toBe(
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
  fc.assert(
    fc.property(fc.uint8Array({ maxLength: 2048 }), (bytes) => {
      expect(toHex(sha256(bytes))).toBe(
        createHash('sha256').update(bytes).digest('hex'),
      );
    }),
  );
});

test('CRC-32/ISO-HDLC check value, empty input and incremental digest', () => {
  expect(crc32(new Uint8Array())).toBe(0);
  const bytes = Uint8Array.from([49, 50, 51, 52, 53, 54, 55, 56, 57]);
  const crc = new Crc32().update(bytes.subarray(0, 4));
  crc.digest(); // A mid-stream observation cannot finalize/reset the state.
  crc.update(bytes.subarray(4));
  expect(crc.digest()).toBe(0xcbf43926);
  expect(crc32(bytes)).toBe(0xcbf43926);
  fc.assert(
    fc.property(
      fc.uint8Array({ maxLength: 4096 }),
      fc.integer({ min: 1, max: 100 }),
      (input, chunk) => {
        const incremental = new Crc32();
        for (let offset = 0; offset < input.length; offset += chunk)
          incremental.update(input.subarray(offset, offset + chunk));
        expect(incremental.digest()).toBe(crc32(input));
      },
    ),
  );
});

test('comparison checks every position and wipe covers whole mutable views', () => {
  const bytes = Uint8Array.from([1, 2, 3, 4]);
  expect(equalBytes(bytes, bytes.slice())).toBe(true);
  for (let i = 0; i < bytes.length; i++) {
    const changed = bytes.slice();
    changed[i] = changed[i]! ^ 1;
    expect(equalBytes(bytes, changed)).toBe(false);
  }
  expect(equalBytes(bytes, bytes.subarray(1))).toBe(false);
  zeroize(bytes, undefined);
  expect(Array.from(bytes)).toEqual([0, 0, 0, 0]);
});

test('RNG fails closed without a provider, on provider failure or malformed output', () => {
  expect(() => createRequiredRng().bytes(32)).toThrow(
    new CoreError('RNG_UNAVAILABLE'),
  );
  expect(() =>
    createRequiredRng({
      bytes() {
        throw new Error('private provider detail');
      },
    }).bytes(32),
  ).toThrow(new CoreError('RNG_UNAVAILABLE'));
  const malformed = new Uint8Array(31).fill(7);
  expect(() => createRequiredRng({ bytes: () => malformed }).bytes(32)).toThrow(
    new CoreError('RNG_UNAVAILABLE'),
  );
  expect(malformed.every((n) => n === 0)).toBe(true);
  for (const invalid of [-1, 1.5, Infinity, NaN])
    expect(() => createRequiredRng(nodeRng).bytes(invalid)).toThrow(
      new CoreError('RESOURCE_LIMIT'),
    );
  expect(createRequiredRng(nodeRng).bytes(32)).toHaveLength(32);
});

test('error mapping is exhaustive and integrity failures share exact UI text', () => {
  expect(Object.keys(operationErrorCategory).sort()).toEqual(
    [...operationErrorCodes].sort(),
  );
  for (const code of ['AUTH_FAILED', 'TRUNCATED', 'BAD_HEADER'] as const) {
    expect(operationErrorCategory[code]).toBe('integrity');
    expect(new CoreError(code).message).toBe(code);
  }
  expect(genericDecryptMessage).toBe(
    "Couldn't decrypt. Check your key or password, or the file may be damaged.",
  );
  expect(operationErrorCategory.CANCELLED).toBe('cancelled');
  expect(operationErrorCategory.RESOURCE_LIMIT).not.toBe('integrity');
  expect(operationErrorCategory.UNSUPPORTED_VERSION).not.toBe('integrity');
});

test('RNG output is isolated from a provider retaining its byte reference', () => {
  const providerBytes = new Uint8Array(32).fill(7);
  const key = createRequiredRng({ bytes: () => providerBytes }).bytes(32);
  expect(key).not.toBe(providerBytes);
  expect(providerBytes.every((byte) => byte === 0)).toBe(true);
  providerBytes.fill(9);
  expect(key.every((byte) => byte === 7)).toBe(true);
  key.fill(0);
});
