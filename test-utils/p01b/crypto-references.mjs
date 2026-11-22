// Public KAT/synthetic fixtures only. Never import this Node generator into Metro.
import { createCipheriv, scryptSync } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
process.on('uncaughtException', () => {
  process.stderr.write('REFERENCE_GENERATION_FAILED\n');
  process.exit(1);
});
const nist = JSON.parse(
  readFileSync(new URL('./nist-gcm.json', import.meta.url)),
);
const asBuffer = (s) => Buffer.from(s, 'hex');
for (const v of nist) {
  const c = createCipheriv('aes-256-gcm', asBuffer(v.Key), asBuffer(v.IV));
  c.setAAD(asBuffer(v.AAD));
  const ct = Buffer.concat([c.update(asBuffer(v.PT)), c.final()]);
  if (ct.toString('hex') !== v.CT || c.getAuthTag().toString('hex') !== v.Tag)
    throw new Error('NIST_REFERENCE_FAILED');
}
const key = Buffer.from(Array.from({ length: 32 }, (_, i) => i));
const aead = [0, 64, 65536, 1048576].map((length, index) => {
  const p = Buffer.from(Array.from({ length }, (_, i) => i % 251));
  const nonce = Buffer.alloc(12);
  nonce.writeUInt32BE(index, 8);
  const aad = Buffer.from(Array.from({ length: 41 }, (_, i) => i));
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(p), cipher.final()]);
  return {
    length,
    key: key.toString('hex'),
    nonce: nonce.toString('hex'),
    aad: aad.toString('hex'),
    ciphertext: ciphertext.toString('hex'),
    tag: cipher.getAuthTag().toString('hex'),
  };
});
const maxmem = 384 * 1024 * 1024;
const password = Buffer.from('public-p01b-fixture');
const salt = Buffer.from(Array.from({ length: 16 }, (_, i) => 32 + i));
const production = [17, 18].map((log2N) => {
  const derived = scryptSync(password, salt, 32, {
    N: 2 ** log2N,
    r: 8,
    p: 1,
    maxmem,
  });
  const value = {
    log2N,
    password: password.toString('hex'),
    salt: salt.toString('hex'),
    expected: derived.toString('hex'),
  };
  derived.fill(0);
  return value;
});
const rfc = [
  {
    password: '',
    salt: '',
    N: 16,
    r: 1,
    p: 1,
    expected:
      '77d6576238657b203b19ca42c18a0497f16b4844e3074ae8dfdffa3fede21442fcd0069ded0948f8326a753a0fc81f17e8d3e0fb2e0d3628cf35e20c38d18906',
  },
  {
    password: '70617373776f7264',
    salt: '4e61436c',
    N: 1024,
    r: 8,
    p: 16,
    expected:
      'fdbabe1c9d3472007856e7190d01e9fe7c6ad7cbc8237830e77376634b3731622eaf30d92e22a3886ff109279d9830dac727afb94a83ee6d8360cbdfa2cc0640',
  },
];
for (const v of rfc) {
  const derived = scryptSync(asBuffer(v.password), asBuffer(v.salt), 64, {
    N: v.N,
    r: v.r,
    p: v.p,
    maxmem,
  });
  if (derived.toString('hex') !== v.expected)
    throw new Error('RFC_REFERENCE_FAILED');
  derived.fill(0);
}
writeFileSync(
  new URL('./crypto-references.json', import.meta.url),
  JSON.stringify({ aead, production, rfc, maxmem }) + '\n',
);
password.fill(0);
salt.fill(0);
key.fill(0);
process.stdout.write(
  'Independent Node/NIST/RFC references verified; no vector bytes logged.\n',
);
