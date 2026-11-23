export function fromHex(input: string): Uint8Array {
  if (!/^(?:[0-9a-fA-F]{2})*$/.test(input)) throw new Error('INVALID_TEST_HEX');
  return Uint8Array.from(input.match(/../g) ?? [], (byte) =>
    Number.parseInt(byte, 16),
  );
}
export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  );
}
