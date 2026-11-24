import { CoreError, type CoreErrorCode } from './crypto/errors';
import { encodeUtf8, isWellFormedUnicode } from './crypto/utf8';

export const maxNameBytes = 255;

export function encodeFlatName(name: string, error: CoreErrorCode): Uint8Array {
  if (
    !name ||
    name === '.' ||
    name === '..' ||
    name.includes('/') ||
    name.includes('\\') ||
    name.includes('\0') ||
    /^[A-Za-z]:/.test(name) ||
    !isWellFormedUnicode(name) ||
    name.normalize('NFC') !== name
  )
    throw new CoreError(error);
  return encodeUtf8(name, maxNameBytes, error);
}
