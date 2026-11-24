// AES polynomial x^8 + x^4 + x^3 + x + 1. Generator 3 is primitive.
const polynomial = 0x11b;
const order = 255;
const log = new Uint8Array(order + 1);
const exp = new Uint8Array(2 * order);
let power = 1;
for (let i = 0; i < order; i++) {
  log[power] = i;
  exp[i] = power;
  exp[i + order] = power;
  const doubled = power << 1;
  power ^= doubled >= 256 ? doubled ^ polynomial : doubled;
}

// Operands are bytes. The zero branches and table lookups can depend on secret
// data. This implementation does not provide constant-time field arithmetic.
export function multiply(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return exp[log[a]! + log[b]!]!;
}

export function divide(a: number, b: number): number {
  if (b === 0) throw new RangeError('GF(256) division by zero');
  if (a === 0) return 0;
  return exp[order + log[a]! - log[b]!]!;
}

export function inverse(a: number): number {
  if (a === 0) throw new RangeError('GF(256) inverse of zero');
  return exp[order - log[a]!]!;
}
