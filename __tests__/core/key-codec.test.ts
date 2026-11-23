import { createHash } from 'node:crypto';
import * as fc from 'fast-check';
import { encodeKey, decodeKey } from '@/core/crypto/key-codec';
import {
  encodeBase32,
  decodeBase32,
  stripCodeSeparators,
} from '@/core/crypto/encoding';
import { CoreError } from '@/core/crypto/errors';
import { fromHex } from '../../test-utils/hex';
import reference from '../../test-utils/crypto-kats.json';

test('canonical raw-key bytes/text match independent Python reference', () => {
  const key = fromHex(reference.keyCodec.key);
  expect(encodeKey(key)).toBe(reference.keyCodec.text);
  expect(decodeKey(reference.keyCodec.text)).toEqual(key);
  expect(stripCodeSeparators(reference.keyCodec.text)).toHaveLength(60);
});

test('key codec round trips arbitrary 32-byte keys and allowed separators/case', () => {
  fc.assert(
    fc.property(fc.uint8Array({ minLength: 32, maxLength: 32 }), (key) => {
      const text = encodeKey(key);
      expect(decodeKey(text.toLowerCase().replaceAll('-', ' \r\n-'))).toEqual(
        key,
      );
      const alias =
        'xFk1-' +
        stripCodeSeparators(text)
          .slice(4)
          .replaceAll('0', 'o')
          .replaceAll('1', 'l');
      expect(decodeKey(alias)).toEqual(key);
    }),
  );
});

test('prefix aliases are forbidden and invalid text has deterministic typed errors', () => {
  const text = stripCodeSeparators(reference.keyCodec.text);
  expect(() => decodeKey('XFKI' + text.slice(4))).toThrow(
    new CoreError('BAD_PREFIX'),
  );
  expect(() => decodeKey('XFS1' + text.slice(4))).toThrow(
    new CoreError('BAD_PREFIX'),
  );
  expect(() => decodeKey(text.slice(0, -1))).toThrow(
    new CoreError('BAD_LENGTH'),
  );
  for (const symbol of ['U', '\t', 'ſ', '😀']) {
    const invalid = text.slice(0, 5) + symbol + text.slice(6);
    expect(() => decodeKey(invalid)).toThrow(
      new CoreError(symbol.length === 1 ? 'BAD_SYMBOL' : 'BAD_LENGTH'),
    );
  }
  expect(() => decodeKey('XFK1' + '0'.repeat(197))).toThrow(
    new CoreError('BAD_LENGTH'),
  );
  expect(stripCodeSeparators('-'.repeat(10000) + text)).toBe(text);
  expect(() => encodeKey(new Uint8Array(31))).toThrow(
    new CoreError('BAD_PARAMS'),
  );
});

test('checksum and supported version are independently enforced', () => {
  const body = new Uint8Array(35);
  body[0] = 2;
  body.set(
    createHash('sha256').update(body.subarray(0, 33)).digest().subarray(0, 2),
    33,
  );
  expect(() => decodeKey('XFK1-' + encodeBase32(body))).toThrow(
    new CoreError('UNSUPPORTED_VERSION'),
  );
  body[34] = body[34]! ^ 1;
  expect(() => decodeKey('XFK1-' + encodeBase32(body))).toThrow(
    new CoreError('BAD_CHECKSUM'),
  );
});

test('MSB-first payload encoding rejects nonzero padding rather than truncating it', () => {
  expect(encodeBase32(Uint8Array.from([102]))).toBe('CR');
  expect(encodeBase32(Uint8Array.from([102, 111, 111]))).toBe('CSQPY');
  expect(decodeBase32('cr', 1)).toEqual(Uint8Array.from([102]));
  expect(() => decodeBase32('CS', 1)).toThrow(new CoreError('BAD_PADDING'));
  expect(() => decodeBase32('CR0', 1)).toThrow(new CoreError('BAD_LENGTH'));
  expect(() => decodeBase32('', Number.MAX_SAFE_INTEGER)).toThrow(
    new CoreError('BAD_LENGTH'),
  );
});
