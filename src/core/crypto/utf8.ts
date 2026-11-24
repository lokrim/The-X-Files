import { CoreError, type CoreErrorCode } from './errors';

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

export function utf8CodePointBytes(point: number): number {
  return point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
}

/** Callers check well-formed Unicode before encoding. Bound the allocation. */
export function encodeUtf8(
  input: string,
  limit: number,
  error: CoreErrorCode,
): Uint8Array {
  let length = 0;
  for (const char of input) {
    length += utf8CodePointBytes(char.codePointAt(0)!);
    if (length > limit) throw new CoreError(error);
  }
  const output = new Uint8Array(length);
  let offset = 0;
  for (const char of input) {
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

/** Reject overlong sequences, lone continuation bytes, surrogates and out-of-range code points. */
export function decodeUtf8(bytes: Uint8Array, error: CoreErrorCode): string {
  let result = '';
  for (let i = 0; i < bytes.length;) {
    const first = bytes[i++]!;
    if (first < 0x80) {
      result += String.fromCharCode(first);
      continue;
    }
    if (first < 0xc2 || first > 0xf4) throw new CoreError(error);
    const count = first <= 0xdf ? 1 : first <= 0xef ? 2 : 3;
    const minimum = count === 1 ? 0x80 : count === 2 ? 0x800 : 0x10000;
    let point = first & (0x7f >> (count + 1));
    for (let j = 0; j < count; j++) {
      const next = bytes[i++];
      if (next === undefined || (next & 0xc0) !== 0x80)
        throw new CoreError(error);
      point = point * 64 + (next & 63);
    }
    if (
      point < minimum ||
      point > 0x10ffff ||
      (point >= 0xd800 && point <= 0xdfff)
    )
      throw new CoreError(error);
    result += String.fromCodePoint(point);
  }
  return result;
}
