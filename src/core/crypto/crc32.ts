const table = new Uint32Array(256);
for (let i = 0; i < table.length; i++) {
  let word = i;
  for (let bit = 0; bit < 8; bit++)
    word = (word >>> 1) ^ (word & 1 ? 0xedb88320 : 0);
  table[i] = word >>> 0;
}

/** CRC-32/ISO-HDLC, usable across bounded chunks; digest does not reset it. */
export class Crc32 {
  private word = 0xffffffff;
  update(bytes: Uint8Array): this {
    for (const byte of bytes)
      this.word = table[(this.word ^ byte) & 0xff]! ^ (this.word >>> 8);
    return this;
  }
  digest(): number {
    return (this.word ^ 0xffffffff) >>> 0;
  }
}

export function crc32(bytes: Uint8Array): number {
  return new Crc32().update(bytes).digest();
}
