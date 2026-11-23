import { CoreError } from './errors';

export const crockfordAlphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const maxNormalizedTextLength = 200;

/** Ignore exactly the separators in the format, without a large intermediate. */
export function stripCodeSeparators(input: string): string {
  let output = '';
  for (let i = 0; i < input.length; i++) {
    const char = input[i]!;
    if (char === '-' || char === ' ' || char === '\r' || char === '\n')
      continue;
    if (output.length === maxNormalizedTextLength)
      throw new CoreError('BAD_LENGTH');
    output += char;
  }
  return output;
}

export function encodeBase32(bytes: Uint8Array): string {
  if (bytes.length > 125) throw new CoreError('BAD_LENGTH');
  let output = '';
  let accumulator = 0;
  let bits = 0;
  for (const byte of bytes) {
    accumulator = accumulator * 256 + byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      output += crockfordAlphabet[Math.floor(accumulator / 2 ** bits) % 32];
    }
    accumulator %= 2 ** bits;
  }
  if (bits) output += crockfordAlphabet[accumulator * 2 ** (5 - bits)];
  return output;
}

/** MSB first. Aliases apply to the payload only; prefixes are parsed elsewhere. */
export function decodeBase32(payload: string, byteLength: number): Uint8Array {
  if (
    !Number.isSafeInteger(byteLength) ||
    byteLength < 0 ||
    byteLength > 125 ||
    payload.length !== Math.ceil((byteLength * 8) / 5)
  )
    throw new CoreError('BAD_LENGTH');
  const output = new Uint8Array(byteLength);
  let accumulator = 0;
  let bits = 0;
  let offset = 0;
  let succeeded = false;
  try {
    for (const symbol of payload) {
      if (!/^[0-9A-Za-z]$/.test(symbol)) throw new CoreError('BAD_SYMBOL');
      let char = symbol.toUpperCase();
      if (char === 'O') char = '0';
      if (char === 'I' || char === 'L') char = '1';
      const value = char.length === 1 ? crockfordAlphabet.indexOf(char) : -1;
      if (value < 0) throw new CoreError('BAD_SYMBOL');
      accumulator = accumulator * 32 + value;
      bits += 5;
      if (bits >= 8) {
        bits -= 8;
        output[offset++] = Math.floor(accumulator / 2 ** bits);
        accumulator %= 2 ** bits;
      }
    }
    if (offset !== byteLength) throw new CoreError('BAD_LENGTH');
    if (accumulator !== 0) throw new CoreError('BAD_PADDING');
    succeeded = true;
    return output;
  } finally {
    if (!succeeded) output.fill(0);
  }
}

export function groupCode(payload: string): string {
  const blocks: string[] = [];
  for (let offset = 0; offset < payload.length; offset += 5)
    blocks.push(payload.slice(offset, offset + 5));
  return blocks.join('-');
}
