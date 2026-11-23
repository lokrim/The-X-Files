import { Buffer } from 'node:buffer';
import { CoreError } from '@/core/crypto/errors';
import {
  confirmedPasswordBytes,
  isWellFormedUnicode,
  normalizePassword,
  passwordStrength,
  passwordToBytes,
} from '@/core/crypto/password';

test('well-formed Unicode is checked before normalization, without repair', () => {
  for (const malformed of [
    'abcdefgh\ud800',
    '\udc00abcdefgh',
    'abcdefgh\ud800x',
    'abcdefgh\ud800\ud800',
  ]) {
    expect(isWellFormedUnicode(malformed)).toBe(false);
    expect(() => passwordToBytes(malformed)).toThrow(
      new CoreError('MALFORMED_UNICODE'),
    );
  }
  expect(isWellFormedUnicode('😀'.repeat(8))).toBe(true);
  expect(() => passwordToBytes('😀'.repeat(7))).toThrow(
    new CoreError('PASSWORD_TOO_SHORT'),
  );
});

test('NFKC/code-point rules and normalized confirmation match Node UTF-8', () => {
  for (const input of [
    'ＡＢＣＤＥＦＧＨ',
    'ﬃﬃﬃ',
    'cafe\u0301-abcd',
    '😀'.repeat(8),
    '  Abc123!  ',
    '\u0000abcdefg',
  ]) {
    expect(passwordToBytes(input)).toEqual(
      Uint8Array.from(Buffer.from(input.normalize('NFKC'), 'utf8')),
    );
  }
  expect(confirmedPasswordBytes('ＡＢＣＤＥＦＧＨ', 'ABCDEFGH')).toEqual(
    passwordToBytes('ABCDEFGH'),
  );
  expect(confirmedPasswordBytes('ﬃﬃﬃ', 'ffiffiffi')).toEqual(
    passwordToBytes('ffiffiffi'),
  );
  expect(confirmedPasswordBytes('caféabcd', 'cafe\u0301abcd')).toEqual(
    passwordToBytes('caféabcd'),
  );
  expect(() => confirmedPasswordBytes('Password1', 'password1')).toThrow(
    new CoreError('PASSWORD_MISMATCH'),
  );
  expect(() => confirmedPasswordBytes('Password1 ', 'Password1')).toThrow(
    new CoreError('PASSWORD_MISMATCH'),
  );
  expect(normalizePassword(' Password1 ')).toBe(' Password1 ');
});

test('empty/minimum/UTF-8 byte boundaries are enforced after normalization', () => {
  expect(() => passwordToBytes('')).toThrow(new CoreError('EMPTY_PASSWORD'));
  expect(() => passwordToBytes('abcdefg')).toThrow(
    new CoreError('PASSWORD_TOO_SHORT'),
  );
  expect(passwordToBytes('abcdefgh')).toHaveLength(8);
  for (const input of ['a'.repeat(1024), 'é'.repeat(512), '😀'.repeat(256)])
    expect(passwordToBytes(input)).toHaveLength(1024);
  for (const input of ['a'.repeat(1025), 'é'.repeat(513), '😀'.repeat(257)])
    expect(() => passwordToBytes(input)).toThrow(
      new CoreError('PASSWORD_TOO_LONG'),
    );
});

test('strength is only a local hint; weak valid passwords remain accepted', () => {
  expect(passwordStrength('password')).toBe('weak');
  expect(passwordToBytes('password')).toHaveLength(8);
  expect(passwordStrength('aaaaaaaaaaaaaaaaaaaa')).toBe('weak');
  expect(passwordStrength('Example12345!')).toBe('fair');
  expect(passwordStrength('correct horse battery staple')).toBe('strong');
});
