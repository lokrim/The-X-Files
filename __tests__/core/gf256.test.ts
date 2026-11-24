import { divide, inverse, multiply } from '@/core/shamir/gf256';

/** Independent polynomial multiplication followed by long reduction. */
function referenceMultiply(a: number, b: number): number {
  let product = 0;
  for (let bit = 0; bit < 8; bit++) if (b & (1 << bit)) product ^= a << bit;
  for (let bit = 14; bit >= 8; bit--)
    if (product & (1 << bit)) product ^= 0x11b << (bit - 8);
  return product;
}

test('all 65,536 GF(256) products match polynomial reduction', () => {
  for (let a = 0; a < 256; a++) {
    for (let b = 0; b < 256; b++) {
      const product = referenceMultiply(a, b);
      if (multiply(a, b) !== product)
        throw new Error(`GF(256) product differs for ${a} × ${b}`);
      if (b !== 0 && divide(product, b) !== a)
        throw new Error(`GF(256) quotient differs for ${product} ÷ ${b}`);
    }
  }
});

test('every nonzero element has an inverse and 3 generates the field', () => {
  const powers = new Set<number>();
  let power = 1;
  for (let element = 1; element < 256; element++) {
    expect(referenceMultiply(element, inverse(element))).toBe(1);
    expect(divide(1, element)).toBe(inverse(element));
    powers.add(power);
    power = multiply(power, 3);
  }
  expect(powers.size).toBe(255);
  expect(power).toBe(1);
});

test('zero is a valid numerator, with no inverse or use as divisor', () => {
  expect(divide(0, 17)).toBe(0);
  expect(() => divide(17, 0)).toThrow(RangeError);
  expect(() => divide(0, 0)).toThrow(RangeError);
  expect(() => inverse(0)).toThrow(RangeError);
});
