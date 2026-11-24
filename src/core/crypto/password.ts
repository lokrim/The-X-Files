import { equalBytes, zeroize } from './bytes';
import { CoreError } from './errors';
import { encodeUtf8, isWellFormedUnicode, utf8CodePointBytes } from './utf8';

export { isWellFormedUnicode } from './utf8';

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

function utf8Length(input: string): number {
  let bytes = 0;
  for (const char of input) {
    bytes += utf8CodePointBytes(char.codePointAt(0)!);
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
  return encodeUtf8(normalizePassword(input), 1024, 'PASSWORD_TOO_LONG');
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
