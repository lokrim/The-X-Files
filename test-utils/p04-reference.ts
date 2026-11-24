// Independent host reference. No production parser, byte writer or crypto helper is used here.
import { createCipheriv, createHash } from 'node:crypto';
import { crc32 } from 'node:zlib';

export const fixtureKey = Uint8Array.from({ length: 32 }, (_, i) => i);
export const fixtureSalt = Uint8Array.from({ length: 16 }, (_, i) => 0xa0 + i);
export const fixtureDate = 1_700_000_000;
export const fixturePayload = Buffer.from('504b030400ff', 'hex');
export const fixtureMetadata = {
  v: 1,
  name: 'café.zip',
  isZip: false,
  totalSize: 6,
  entryCount: 1,
  mime: 'application/zip',
};

export function setReferenceHeaderCrc(header: Buffer): void {
  header.writeUInt32BE(crc32(header.subarray(0, 44)), 44);
}

export function referenceHeader({
  chunkLog2 = 20,
  isZip = false,
  password = false,
} = {}) {
  const header = Buffer.alloc(48);
  header.write('XFL1');
  header.set([1, password ? 2 : 1, isZip ? 1 : 0, chunkLog2], 4);
  header.writeBigUInt64BE(BigInt(fixtureDate), 12);
  header.set(fixtureSalt, 24);
  if (password) header.set([1, 17, 8, 1], 40);
  setReferenceHeaderCrc(header);
  return header;
}

export function referenceRecord(
  header: Buffer,
  counter: number,
  data: Uint8Array,
  flags: number,
  key: Uint8Array = fixtureKey,
) {
  const counterBytes = Buffer.alloc(8);
  counterBytes.writeBigUInt64BE(BigInt(counter));
  const cipher = createCipheriv(
    'aes-256-gcm',
    key,
    Buffer.concat([Buffer.alloc(4), counterBytes]),
  );
  const hash = createHash('sha256').update(header).digest();
  cipher.setAAD(Buffer.concat([hash, counterBytes, Buffer.of(flags)]));
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const prefix = Buffer.alloc(5);
  prefix.writeUInt32BE(data.length);
  prefix[4] = flags;
  return Buffer.concat([prefix, encrypted, cipher.getAuthTag()]);
}

export function referenceXfile(
  payload: Uint8Array,
  {
    header = referenceHeader(),
    metadata = Buffer.from(
      JSON.stringify({ ...fixtureMetadata, totalSize: payload.length }),
    ),
  } = {},
) {
  const records = [
    referenceRecord(header, 0, metadata, payload.length ? 0 : 1),
  ];
  const chunk = 2 ** header[7]!;
  for (let start = 0; start < payload.length; start += chunk) {
    const end = start + chunk;
    records.push(
      referenceRecord(
        header,
        records.length,
        payload.subarray(start, end),
        end >= payload.length ? 1 : 0,
      ),
    );
  }
  return { records, bytes: Buffer.concat([header, ...records]) };
}
