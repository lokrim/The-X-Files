import { CoreError, type CoreErrorCode } from './crypto/errors';
import {
  encodeUtf8,
  isWellFormedUnicode,
  utf8CodePointBytes,
} from './crypto/utf8';

export const maxNameBytes = 255;

export function truncateName(name: string, byteBudget: number): string {
  let end = 0;
  for (const char of name) {
    byteBudget -= utf8CodePointBytes(char.codePointAt(0)!);
    if (byteBudget < 0) break;
    end += char.length;
  }
  return name.slice(0, end);
}

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
