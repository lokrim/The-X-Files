// Public synthetic-data reference only. Never loaded by the application/Metro.
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
const total = 2_000_000_003;
const chunkBytes = 1_048_576;
const buffer = Buffer.alloc(chunkBytes);
for (let i = 0; i < buffer.length; i++) buffer[i] = i % 251;
const hash = createHash('sha256');
let bytes = 0;
let record = 0;
while (bytes < total) {
  buffer.writeUInt32LE(record, 0);
  const length = Math.min(chunkBytes, total - bytes);
  hash.update(buffer.subarray(0, length));
  bytes += length;
  record++;
}
writeFileSync(
  new URL('./write-reference.json', import.meta.url),
  JSON.stringify({ bytes: total, chunkBytes, sha256: hash.digest('hex') }) +
    '\n',
);
buffer.fill(0);
