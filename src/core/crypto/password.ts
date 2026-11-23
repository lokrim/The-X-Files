import { equalBytes, zeroize } from './bytes';
import { CoreError } from './errors';

// Public local strength hints, not password fixtures or a KDF transformation.
const commonPasswords = new Set([
  'password',
  'password1',
  'password123',
  '12345678',
  '123456789',
  '1234567890',
  'qwerty123',
  'iloveyou',
  'welcome123',
  'admin123',
  'abcdefgh',
]);
export type PasswordStrength = 'weak' | 'fair' | 'strong';

export function isWellFormedUnicode(input: string): boolean {
  for (let i = 0; i < input.length; i++) {
    const unit = input.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = input.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
  }
  return true;
}

function utf8Length(input: string): number {
  let bytes = 0;
  for (const char of input) {
    const point = char.codePointAt(0)!;
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
    if (bytes > 1024) throw new CoreError('PASSWORD_TOO_LONG');
  }
  return bytes;
}

export function normalizePassword(input: string): string {
  if (!isWellFormedUnicode(input)) throw new CoreError('MALFORMED_UNICODE');
  const normalized = input.normalize('NFKC');
  if (!normalized.length) throw new CoreError('EMPTY_PASSWORD');
  let points = 0;
  for (const char of normalized) {
    if (char) points++;
  }
  if (points < 8) throw new CoreError('PASSWORD_TOO_SHORT');
  utf8Length(normalized);
  return normalized;
}

/** Pure UTF-8 avoids relying on a platform TextEncoder shim in the core. */
export function passwordToBytes(input: string): Uint8Array {
  const normalized = normalizePassword(input);
  const output = new Uint8Array(utf8Length(normalized));
  let offset = 0;
  for (const char of normalized) {
    const n = char.codePointAt(0)!;
    if (n <= 0x7f) output[offset++] = n;
    else if (n <= 0x7ff) {
      output[offset++] = 0xc0 | (n >>> 6);
      output[offset++] = 0x80 | (n & 63);
    } else if (n <= 0xffff) {
      output[offset++] = 0xe0 | (n >>> 12);
      output[offset++] = 0x80 | ((n >>> 6) & 63);
      output[offset++] = 0x80 | (n & 63);
    } else {
      output[offset++] = 0xf0 | (n >>> 18);
      output[offset++] = 0x80 | ((n >>> 12) & 63);
      output[offset++] = 0x80 | ((n >>> 6) & 63);
      output[offset++] = 0x80 | (n & 63);
    }
  }
  return output;
}

export function confirmedPasswordBytes(
  password: string,
  confirmation: string,
): Uint8Array {
  const bytes = passwordToBytes(password);
  let confirmed: Uint8Array | undefined;
  let succeeded = false;
  try {
    confirmed = passwordToBytes(confirmation);
    if (!equalBytes(bytes, confirmed)) throw new CoreError('PASSWORD_MISMATCH');
    succeeded = true;
    return bytes;
  } finally {
    zeroize(confirmed);
    if (!succeeded) zeroize(bytes);
  }
}

/** A local hint, not an entropy estimate; a weak valid password remains allowed. */
export function passwordStrength(input: string): PasswordStrength {
  const normalized = normalizePassword(input);
  const length = Array.from(normalized).length;
  if (
    commonPasswords.has(normalized.toLowerCase()) ||
    /^(.)\1+$/u.test(normalized)
  )
    return 'weak';
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter(
    (pattern) => pattern.test(normalized),
  ).length;
  if (length >= 20 || (length >= 16 && classes >= 2)) return 'strong';
  return length >= 12 && classes >= 2 ? 'fair' : 'weak';
}
