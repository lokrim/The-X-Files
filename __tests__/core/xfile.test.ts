import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Aead, Kdf } from '../../src/core/contracts';
import {
  CoreError,
  genericDecryptMessage,
  operationErrorCategory,
} from '../../src/core/crypto/errors';
import {
  containerSize,
  decryptXfile,
  encryptXfile,
  inspectHeader,
  payloadRecordCount,
  planXfile,
  withCapacityHeadroom,
} from '../../src/core/xfile';
import { checkedSize, readUint64, writeUint64 } from '../../src/core/sizes';
import { nodeAead, nodeScryptReference } from '../../test-utils/node-crypto';
import { seededRng } from '../../test-utils/seeded-rng';
import { deferred, memoryReader, memoryWriter } from '../../test-utils/p04-io';
import {
  fixtureDate,
  fixtureKey,
  fixtureMetadata,
  fixturePayload,
  fixtureSalt,
  referenceHeader,
  referenceRecord,
  referenceXfile,
  setReferenceHeaderCrc,
} from '../../test-utils/p04-reference';

const chunk = 2 ** 20;
const readerChunk = 2 ** 16;
const empty = Buffer.alloc(0);
const raw = { mode: 'raw' } as const;
const credential = { ...raw, fileKey: fixtureKey };

function decrypt(bytes: Uint8Array, short?: number) {
  const source = memoryReader(bytes, short === undefined ? {} : { short });
  const output = memoryWriter();
  const createOutput = jest.fn(async () => output.writer);
  const result = decryptXfile(source.reader, {
    aead: nodeAead,
    credential,
    destination: { mode: 'save', createOutput },
  });
  return { result, output, createOutput, source };
}

function encrypt(
  bytes: Uint8Array,
  overrides: Partial<Parameters<typeof encryptXfile>[2]> = {},
) {
  const output = memoryWriter();
  const options = {
    aead: nodeAead,
    rng: {
      bytes: (length: number) =>
        Uint8Array.from(length === 16 ? fixtureSalt : fixtureKey),
    },
    protection: raw,
    metadata: { ...fixtureMetadata, totalSize: bytes.length },
    createdAtUnixSec: fixtureDate,
    ...overrides,
  };
  const result = encryptXfile(
    memoryReader(bytes).reader,
    output.writer,
    options,
  );
  return { output, options, result };
}

test('independent Python struct/zlib/hashlib and OpenSSL EVP fixture matches both directions', async () => {
  const bytes = readFileSync(
    resolve(__dirname, '../vectors/p04-opaque-zip.xfile'),
  );
  const expectedHeader =
    '58464c310101001400000000000000006553f10000000000a0a1a2a3a4a5a6a7a8a9aaabacadaeaf000000007eb26c3e';
  expect(bytes.subarray(0, 48).toString('hex')).toBe(expectedHeader);
  expect(createHash('sha256').update(bytes.subarray(0, 48)).digest('hex')).toBe(
    'a91bee29f84f5afa96d975428a57acad4ed3d777b86a3c0797715b56c1bfe467',
  );
  expect(bytes.readUInt32BE(48)).toBe(94);
  expect(bytes[52]).toBe(0);
  expect(bytes.subarray(147, 163).toString('hex')).toBe(
    '7ffb21a2324efaea41143b58ad152add',
  );
  expect(bytes.readUInt32BE(163)).toBe(6);
  expect(bytes[167]).toBe(1);
  expect(bytes.subarray(-16).toString('hex')).toBe(
    '511b5b434e2c92505126b0458027562d',
  );
  expect(referenceXfile(fixturePayload).bytes).toEqual(bytes);
  const written = encrypt(fixturePayload);
  await expect(written.result).resolves.toEqual({
    ...raw,
    fileKey: fixtureKey,
  });
  expect(written.output.bytes()).toEqual(bytes);
  const inspected = await inspectHeader(
    memoryReader(bytes, { short: 1 }).reader,
  );
  expect(inspected).toEqual({
    ...raw,
    verified: false,
    createdAtUnixSec: fixtureDate,
    isZip: false,
    chunkSizeLog2: 20,
  });
  const opened = decrypt(bytes, 1);
  await expect(opened.result).resolves.toEqual({
    metadata: fixtureMetadata,
    header: { ...inspected, verified: true },
  });
  expect(opened.output.bytes()).toEqual(fixturePayload);
});

test.each([0, 1, chunk - 1, chunk, chunk + 1, 5 * chunk + 7])(
  'writer matches independent record answers for %i payload bytes',
  async (size) => {
    const payload = Buffer.alloc(size, 0x7e);
    const expected = referenceXfile(payload);
    const written = encrypt(payload);
    await written.result;
    expect(written.output.bytes().equals(expected.bytes)).toBe(true);
    expect(expected.records).toHaveLength(1 + Math.ceil(size / chunk));
    expect(expected.records.map((record) => record[4])).toEqual(
      expected.records.map((_, i) => Number(i === expected.records.length - 1)),
    );
    expect(planXfile(written.options.metadata).totalSize).toBe(
      expected.bytes.length,
    );
  },
);

test.each([
  [0, 0, 'BAD_HEADER'],
  [4, 2, 'UNSUPPORTED_VERSION'],
  [5, 3, 'BAD_HEADER'],
  [6, 2, 'BAD_HEADER'],
  [7, 15, 'BAD_HEADER'],
  [7, 21, 'BAD_HEADER'],
  [8, 1, 'BAD_HEADER'],
  [11, 1, 'BAD_HEADER'],
  [20, 1, 'BAD_HEADER'],
  [23, 1, 'BAD_HEADER'],
  [40, 1, 'BAD_HEADER'],
  [41, 17, 'BAD_HEADER'],
  [42, 8, 'BAD_HEADER'],
  [43, 1, 'BAD_HEADER'],
  [12, 0x80, 'RESOURCE_LIMIT'],
] as const)(
  'rejects invalid header offset %i value %i even with recalculated CRC',
  async (offset, value, code) => {
    const header = referenceHeader();
    header[offset] = value;
    setReferenceHeaderCrc(header);
    await expect(
      inspectHeader(memoryReader(header).reader),
    ).rejects.toMatchObject({ code });
  },
);

test('rejects CRC corruption and requires record 0 even after a plausible forged header', async () => {
  const original = referenceXfile(fixturePayload).bytes;
  const bytes = Buffer.from(original);
  bytes[19] = 1;
  await expect(inspectHeader(memoryReader(bytes).reader)).rejects.toMatchObject(
    { code: 'BAD_HEADER' },
  );
  setReferenceHeaderCrc(bytes);
  await expect(
    inspectHeader(memoryReader(bytes).reader),
  ).resolves.toMatchObject({ verified: false });
  const forged = decrypt(bytes);
  await expect(forged.result).rejects.toMatchObject({ code: 'AUTH_FAILED' });
  expect(forged.createOutput).not.toHaveBeenCalled();
  const wrong = await decryptXfile(memoryReader(original).reader, {
    aead: nodeAead,
    credential: { ...raw, fileKey: new Uint8Array(32) },
    destination: { mode: 'save', createOutput: forged.createOutput },
  }).catch((error: unknown) => error);
  expect(wrong).toMatchObject({ code: 'AUTH_FAILED' });
  for (const code of ['AUTH_FAILED', 'BAD_HEADER', 'TRUNCATED'] as const)
    expect(operationErrorCategory[code]).toBe('integrity');
  expect(genericDecryptMessage).toBe(
    "Couldn't decrypt. Check your key or password, or the file may be damaged.",
  );
});

test.each([
  [40, 0, 'BAD_HEADER'],
  [41, 14, 'RESOURCE_LIMIT'],
  [41, 19, 'RESOURCE_LIMIT'],
  [42, 3, 'RESOURCE_LIMIT'],
  [43, 2, 'RESOURCE_LIMIT'],
] as const)(
  'rejects password field at %i before backend invocation',
  async (offset, value, code) => {
    const header = referenceHeader({ password: true });
    header[offset] = value;
    setReferenceHeaderCrc(header);
    const derive = jest.fn();
    await expect(
      decryptXfile(memoryReader(header).reader, {
        aead: nodeAead,
        credential: {
          mode: 'password',
          password: 'example password',
          kdf: { derive },
        },
        destination: { mode: 'save', createOutput: jest.fn() },
      }),
    ).rejects.toMatchObject({ code });
    expect(derive).not.toHaveBeenCalled();
  },
);

test('accepts only the four authorized reader costs and the five reader chunk sizes', async () => {
  for (const cost of [15, 16, 17, 18]) {
    for (const chunkLog2 of [16, 17, 18, 19, 20]) {
      const header = referenceHeader({ password: true, chunkLog2 });
      header[41] = cost;
      setReferenceHeaderCrc(header);
      await expect(
        inspectHeader(memoryReader(header).reader),
      ).resolves.toMatchObject({
        mode: 'password',
        chunkSizeLog2: chunkLog2,
        verified: false,
      });
    }
  }
});

test.each([0, 1])(
  'bounds giant record length before any ciphertext read at counter %i',
  async (counter) => {
    const header = referenceHeader();
    const valid = referenceXfile(fixturePayload, { header });
    const prefix = Buffer.from('ffffffff01', 'hex');
    const bytes = Buffer.concat([
      header,
      ...valid.records.slice(0, counter),
      prefix,
    ]);
    const attempt = decrypt(bytes);
    await expect(attempt.result).rejects.toMatchObject({
      code: 'RESOURCE_LIMIT',
    });
    expect(attempt.source.requests.at(-1)).toBe(5);
    expect(Math.max(...attempt.source.requests)).toBeLessThanOrEqual(65_536);
    expect(attempt.output.aborted).toBe(counter === 1);
  },
);

test('every record rejects short prefix, ciphertext or tag, tamper, flag changes, reorder and trailing bytes', async () => {
  const header = referenceHeader({ chunkLog2: 16 });
  const { records, bytes } = referenceXfile(
    Buffer.alloc(2 * readerChunk + 7, 0x39),
    { header },
  );
  for (const cut of [0, 1, 4, 47])
    await expect(decrypt(bytes.subarray(0, cut)).result).rejects.toMatchObject({
      code: 'TRUNCATED',
    });
  let start = 48;
  for (const [index, record] of records.entries()) {
    for (const cut of [0, 2, 5, 6, record.length - 16, record.length - 1]) {
      const attempt = decrypt(bytes.subarray(0, start + cut));
      await expect(attempt.result).rejects.toMatchObject({ code: 'TRUNCATED' });
      expect(attempt.output.aborted).toBe(index !== 0);
    }
    for (const [offset, mask, code] of [
      [4, 1, 'AUTH_FAILED'],
      [4, 2, 'BAD_HEADER'],
      [5, 1, 'AUTH_FAILED'],
      [record.length - 1, 1, 'AUTH_FAILED'],
    ] as const) {
      const mutation = Buffer.from(bytes);
      mutation[start + offset]! ^= mask;
      const attempt = decrypt(mutation);
      await expect(attempt.result).rejects.toMatchObject({ code });
      expect(attempt.output.writes).toBe(Math.max(0, index - 1));
      expect(attempt.output.bytes()).toHaveLength(0);
    }
    start += record.length;
  }
  const reordered = Buffer.concat([
    header,
    records[0]!,
    records[2]!,
    records[1]!,
    records[3]!,
  ]);
  await expect(decrypt(reordered).result).rejects.toMatchObject({
    code: 'AUTH_FAILED',
  });
  const trailing = decrypt(Buffer.concat([bytes, Buffer.of(0)]));
  await expect(trailing.result).rejects.toMatchObject({ code: 'AUTH_FAILED' });
  expect(trailing.output.writes).toBe(2);
  expect(trailing.output.aborted).toBe(true);
});

test.each([
  [
    'duplicate key',
    Buffer.from(
      JSON.stringify(fixtureMetadata).replace('"v":1', '"v":1,"\\u0076":1'),
    ),
    'BAD_HEADER',
  ],
  [
    'extra field',
    Buffer.from(JSON.stringify({ ...fixtureMetadata, list: [] })),
    'BAD_HEADER',
  ],
  [
    'missing field',
    Buffer.from(JSON.stringify({ ...fixtureMetadata, mime: undefined })),
    'BAD_HEADER',
  ],
  [
    'trailing JSON',
    Buffer.from(JSON.stringify(fixtureMetadata) + '{}'),
    'BAD_HEADER',
  ],
  ['UTF-8 surrogate', Buffer.from([0xed, 0xa0, 0x80]), 'BAD_HEADER'],
  ['UTF-8 overlong', Buffer.from([0xc0, 0xaf]), 'BAD_HEADER'],
  ['UTF-8 truncated', Buffer.from([0xf0, 0x90, 0x80]), 'BAD_HEADER'],
  ['UTF-8 out of range', Buffer.from([0xf4, 0x90, 0x80, 0x80]), 'BAD_HEADER'],
  ['UTF-8 continuation', Buffer.from([0x80]), 'BAD_HEADER'],
  [
    'ZIP disagreement',
    Buffer.from(JSON.stringify({ ...fixtureMetadata, isZip: true })),
    'BAD_HEADER',
  ],
  [
    'unsafe name',
    Buffer.from(JSON.stringify({ ...fixtureMetadata, name: '../file' })),
    'BAD_HEADER',
  ],
  [
    'non-NFC name',
    Buffer.from(JSON.stringify({ ...fixtureMetadata, name: 'cafe\u0301.zip' })),
    'BAD_HEADER',
  ],
  [
    'fraction',
    Buffer.from(JSON.stringify({ ...fixtureMetadata, totalSize: 1.5 })),
    'BAD_HEADER',
  ],
  [
    'unsafe number',
    Buffer.from(JSON.stringify({ ...fixtureMetadata, totalSize: 2 ** 53 })),
    'RESOURCE_LIMIT',
  ],
  ['giant metadata', Buffer.alloc(65_537), 'RESOURCE_LIMIT'],
] as const)(
  'rejects authenticated metadata with %s',
  async (_, metadata, code) => {
    const attempt = decrypt(referenceXfile(fixturePayload, { metadata }).bytes);
    await expect(attempt.result).rejects.toMatchObject({ code });
    expect(attempt.createOutput).not.toHaveBeenCalled();
  },
);

test('exact metadata limit, punctuation inside values, metadata and payload FINAL shape', async () => {
  const describe = (totalSize: number, mime = 'a:"b\\c') =>
    Buffer.from(JSON.stringify({ ...fixtureMetadata, totalSize, mime }));
  const mime = 'z'.repeat(65_536 - describe(0, '').length);
  const atLimit = encrypt(empty, {
    metadata: { ...fixtureMetadata, totalSize: 0, mime },
  });
  await atLimit.result;
  expect(atLimit.output.bytes().readUInt32BE(48)).toBe(65_536);
  await expect(decrypt(atLimit.output.bytes()).result).resolves.toMatchObject({
    metadata: { mime },
  });
  expect(() =>
    planXfile({ ...fixtureMetadata, totalSize: 0, mime: mime + 'z' }),
  ).toThrow(new CoreError('RESOURCE_LIMIT'));

  const header = referenceHeader({ chunkLog2: 16 });
  const cases = [
    [describe(1), 1, [], 'TRUNCATED'],
    [describe(0), 0, [], 'TRUNCATED'],
    [
      describe(2),
      0,
      [referenceRecord(header, 1, Buffer.of(1), 1)],
      'TRUNCATED',
    ],
    [
      describe(1),
      0,
      [referenceRecord(header, 1, Buffer.of(1, 2), 1)],
      'AUTH_FAILED',
    ],
    [describe(1), 0, [referenceRecord(header, 1, empty, 1)], 'BAD_HEADER'],
    [
      describe(1),
      0,
      [referenceRecord(header, 1, Buffer.of(1), 0)],
      'BAD_HEADER',
    ],
    [describe(readerChunk * 2 ** 20 + 1), 0, [], 'RESOURCE_LIMIT'],
  ] as const;
  for (const [metadata, flag, records, code] of cases) {
    const attempt = decrypt(
      Buffer.concat([
        header,
        referenceRecord(header, 0, metadata, flag),
        ...records,
      ]),
    );
    await expect(attempt.result).rejects.toMatchObject({ code });
  }
});

test('capacity and uint64 checks reach exact 1 TiB and reader record budgets', () => {
  const size = 2 ** 40;
  expect(payloadRecordCount(size, 20)).toBe(1_048_576);
  expect(containerSize(size, 65_536)).toBe(48 + 65_536 + size + 21 * 1_048_577);
  expect(() => containerSize(size + 1, 10)).toThrow(
    new CoreError('RESOURCE_LIMIT'),
  );
  for (const chunkLog2 of [16, 17, 18, 19]) {
    expect(payloadRecordCount(2 ** (20 + chunkLog2), chunkLog2)).toBe(2 ** 20);
    expect(() =>
      payloadRecordCount(2 ** (20 + chunkLog2) + 1, chunkLog2),
    ).toThrow(new CoreError('RESOURCE_LIMIT'));
  }
  const bytes = new DataView(new ArrayBuffer(8));
  for (const order of [false, true]) {
    writeUint64(bytes, 0, Number.MAX_SAFE_INTEGER, order);
    expect(readUint64(bytes, 0, order)).toBe(Number.MAX_SAFE_INTEGER);
    bytes.setBigUint64(0, 2n ** 53n, order);
    expect(() => readUint64(bytes, 0, order)).toThrow(
      new CoreError('RESOURCE_LIMIT'),
    );
  }
  expect(() => checkedSize(-1)).toThrow(new CoreError('RESOURCE_LIMIT'));
  expect(() => writeUint64(bytes, 0, 2 ** 53)).toThrow(
    new CoreError('RESOURCE_LIMIT'),
  );
  expect(withCapacityHeadroom(10)).toBe(10 + 64 * 2 ** 20);
  expect(withCapacityHeadroom(size)).toBe(size + Math.ceil(size / 20));
  expect(() => withCapacityHeadroom(Number.MAX_SAFE_INTEGER)).toThrow(
    new CoreError('RESOURCE_LIMIT'),
  );
});

test.each([
  [() => 6, 5],
  [() => 6, 7],
  [() => 5, 6],
  [
    (() => {
      let calls = 0;
      return () => (++calls === 1 ? 6 : 5);
    })(),
    6,
  ],
])(
  'source stat or bytes that disagree with the plan abort encryption',
  async (size, actual) => {
    const source = memoryReader(Buffer.alloc(actual), { size });
    const output = memoryWriter();
    await expect(
      encryptXfile(source.reader, output.writer, {
        aead: nodeAead,
        rng: seededRng(37),
        protection: raw,
        metadata: fixtureMetadata,
        createdAtUnixSec: fixtureDate,
      }),
    ).rejects.toMatchObject({ code: 'SOURCE_CHANGED' });
    expect(output.aborted).toBe(true);
  },
);

test('retry after a failed write starts with new raw key and salt at the same nonce counters', async () => {
  const rng = seededRng(123);
  const seen: { key: string; nonce: string }[] = [];
  const aead: Aead = {
    ...nodeAead,
    async seal(key, nonce, aad, bytes) {
      seen.push({
        key: Buffer.from(key).toString('hex'),
        nonce: Buffer.from(nonce).toString('hex'),
      });
      return nodeAead.seal(key, nonce, aad, bytes);
    },
  };
  const options = {
    aead,
    rng,
    protection: raw,
    metadata: fixtureMetadata,
    createdAtUnixSec: fixtureDate,
  };
  const first = memoryWriter();
  const firstHeader: Uint8Array[] = [];
  await expect(
    encryptXfile(
      memoryReader(fixturePayload).reader,
      {
        ...first.writer,
        async write(bytes) {
          if (first.writes === 4) throw new CoreError('NO_SPACE');
          if (first.writes === 0) firstHeader.push(Uint8Array.from(bytes));
          await first.writer.write(bytes);
        },
      },
      options,
    ),
  ).rejects.toMatchObject({ code: 'NO_SPACE' });
  expect(first.aborted).toBe(true);
  const retry = encrypt(fixturePayload, options);
  await retry.result;
  expect(seen.map((value) => value.nonce)).toEqual([
    '000000000000000000000000',
    '000000000000000000000001',
    '000000000000000000000000',
    '000000000000000000000001',
  ]);
  expect(seen[0]!.key).not.toBe(seen[2]!.key);
  expect(retry.output.bytes().subarray(24, 40)).not.toEqual(
    Buffer.from(firstHeader[0]!.subarray(24, 40)),
  );
});

test('password writer uses production scrypt and fresh salt across attempts', async () => {
  const rng = seededRng(218);
  const keys: Uint8Array[] = [];
  const derive: Kdf['derive'] = async (password, salt, params) => {
    expect(params).toEqual({ log2N: 17, r: 8, p: 1, dkLen: 32 });
    const key = await nodeScryptReference(password, salt, {
      N: 131_072,
      r: 8,
      p: 1,
      dkLen: 32,
      maxmem: 384 * 2 ** 20,
    });
    keys.push(Uint8Array.from(key));
    return key;
  };
  const kdf = { derive };
  const protection = {
    mode: 'password',
    password: 'ＡＢＣＤ１２３４',
    kdf,
  } as const;
  const first = encrypt(fixturePayload, { rng, protection });
  await expect(first.result).resolves.toEqual({ mode: 'password' });
  const second = encrypt(fixturePayload, { rng, protection });
  await expect(second.result).resolves.toEqual({ mode: 'password' });
  const a = first.output.bytes();
  const b = second.output.bytes();
  expect(a.subarray(40, 44)).toEqual(Buffer.of(1, 17, 8, 1));
  expect(a.subarray(24, 40)).not.toEqual(b.subarray(24, 40));
  expect(keys[0]).not.toEqual(keys[1]);
  const independentlySealed = referenceRecord(
    a.subarray(0, 48),
    0,
    Buffer.from(JSON.stringify(fixtureMetadata)),
    0,
    keys[0],
  );
  expect(a.subarray(48, 48 + independentlySealed.length)).toEqual(
    independentlySealed,
  );
  const output = memoryWriter();
  await expect(
    decryptXfile(memoryReader(b).reader, {
      aead: nodeAead,
      credential: { ...protection, password: 'ABCD1234' },
      destination: {
        mode: 'save',
        async createOutput() {
          return output.writer;
        },
      },
    }),
  ).resolves.toMatchObject({ metadata: fixtureMetadata });
  expect(output.bytes()).toEqual(fixturePayload);
  const invalid = encrypt(empty, {
    rng,
    protection: { ...protection, password: '' },
  });
  await expect(invalid.result).rejects.toMatchObject({
    code: 'EMPTY_PASSWORD',
  });
  expect(invalid.output.aborted).toBe(true);
});

test('releases the caller password bytes before waiting for output rollback', async () => {
  const rollback = deferred();
  const release = deferred();
  const output = memoryWriter();
  let borrowed: Uint8Array | undefined;
  const result = encryptXfile(
    memoryReader(empty).reader,
    {
      ...output.writer,
      async abort() {
        rollback.resolve();
        await release.ready;
      },
    },
    {
      aead: nodeAead,
      rng: seededRng(27),
      protection: {
        mode: 'password',
        takePassword: () => 'public fixture',
        kdf: {
          async derive(password) {
            borrowed = password;
            throw new CoreError('CANCELLED');
          },
        },
      },
      createdAtUnixSec: fixtureDate,
      metadata: { ...fixtureMetadata, totalSize: 0 },
    },
  );
  const cancelled = expect(result).rejects.toMatchObject({ code: 'CANCELLED' });
  await rollback.ready;
  try {
    expect(borrowed).toEqual(new Uint8Array('public fixture'.length));
  } finally {
    release.resolve();
    await cancelled;
  }
});

test('awaits slow output, wipes consumed plaintext, and cancels without reading ahead', async () => {
  const controller = new AbortController();
  const { bytes } = referenceXfile(Buffer.alloc(readerChunk * 2 + 1, 0x21), {
    header: referenceHeader({ chunkLog2: 16 }),
  });
  const source = memoryReader(bytes);
  const output = memoryWriter();
  const entered = deferred();
  const resume = deferred();
  let borrowed: Uint8Array | undefined;
  const promise = decryptXfile(source.reader, {
    aead: nodeAead,
    credential,
    signal: controller.signal,
    destination: {
      mode: 'save',
      async createOutput() {
        return {
          ...output.writer,
          async write(plaintext) {
            borrowed = plaintext;
            entered.resolve();
            await resume.ready;
            expect(plaintext[0]).toBe(0x21);
            await output.writer.write(plaintext);
          },
        };
      },
    },
  });
  await entered.ready;
  const reads = source.requests.length;
  await new Promise((done) => setTimeout(done, 5));
  expect(source.requests).toHaveLength(reads);
  controller.abort();
  resume.resolve();
  await expect(promise).rejects.toMatchObject({ code: 'CANCELLED' });
  expect(output.aborted).toBe(true);
  expect(output.writes).toBe(1);
  expect(borrowed?.every((byte) => byte === 0)).toBe(true);
  expect(source.requests).toHaveLength(reads);
});

test('throttles monotonic progress and yields for an event-loop turn between records', async () => {
  let now = 100;
  const clock = jest.spyOn(performance, 'now').mockImplementation(() => now);
  const updates: number[] = [];
  let ticks = 0;
  const timer = setInterval(() => ticks++, 0);
  try {
    const payload = Buffer.alloc(readerChunk * 9 + 6);
    const { bytes } = referenceXfile(payload, {
      header: referenceHeader({ chunkLog2: 16 }),
    });
    const output = memoryWriter();
    await decryptXfile(memoryReader(bytes).reader, {
      aead: nodeAead,
      credential,
      onProgress(processed, total) {
        expect(total).toBe(payload.length);
        expect(processed).toBeLessThanOrEqual(total);
        updates.push(now);
      },
      destination: {
        mode: 'save',
        async createOutput() {
          return {
            ...output.writer,
            async write(data) {
              now += 40;
              await output.writer.write(data);
            },
          };
        },
      },
    });
    expect(ticks).toBeGreaterThan(2);
    expect(updates).toEqual([100, 220, 340, 460]);
  } finally {
    clearInterval(timer);
    clock.mockRestore();
  }
});

test.each([false, true])(
  'close errors are reported and abort is attempted (failed abort = %s)',
  async (failedAbort) => {
    const output = memoryWriter();
    const abort = jest.fn(async () => {
      if (failedAbort) throw new Error('private internal path');
      await output.writer.abort();
    });
    await expect(
      decryptXfile(memoryReader(referenceXfile(fixturePayload).bytes).reader, {
        aead: nodeAead,
        credential,
        destination: {
          mode: 'save',
          async createOutput() {
            return {
              ...output.writer,
              async close() {
                throw new Error('private internal path');
              },
              abort,
            };
          },
        },
      }),
    ).rejects.toMatchObject({ code: 'IO_ERROR', message: 'IO_ERROR' });
    expect(abort).toHaveBeenCalledTimes(1);
    expect(output.aborted).toBe(!failedAbort);
  },
);

test('metadata validates numeric literals without rounding tiny fractions to integers', async () => {
  const schema = JSON.stringify(fixtureMetadata);
  for (const literal of ['6.0000000000000001', '0.00000000000000001e-999']) {
    const metadata = Buffer.from(
      schema.replace('"totalSize":6', '"totalSize":' + literal),
    );
    await expect(
      decrypt(referenceXfile(fixturePayload, { metadata }).bytes).result,
    ).rejects.toMatchObject({ code: 'BAD_HEADER' });
  }
  const metadata = Buffer.from(
    schema.replace('"totalSize":6', '"totalSize":0.006e3'),
  );
  await expect(
    decrypt(referenceXfile(fixturePayload, { metadata }).bytes).result,
  ).resolves.toMatchObject({ metadata: fixtureMetadata });
});

test('reused reader scratch and in-place AEAD results preserve complete authenticated records', async () => {
  const data = Buffer.alloc(chunk + 10, 0x6b);
  const { bytes } = referenceXfile(data);
  const scratch = new Uint8Array(chunk);
  let position = 0;
  const output = memoryWriter();
  await decryptXfile(
    {
      async size() {
        return bytes.length;
      },
      async read(max) {
        expect(max).toBeLessThanOrEqual(chunk);
        scratch.fill(0xff);
        if (position === bytes.length) return null;
        const next = bytes.subarray(position, position + max);
        scratch.set(next);
        position += next.length;
        return scratch.subarray(0, next.length);
      },
    },
    {
      aead: {
        ...nodeAead,
        async open(key, nonce, aad, ciphertext, tag) {
          const opened = await nodeAead.open(key, nonce, aad, ciphertext, tag);
          ciphertext.set(opened);
          return ciphertext;
        },
      },
      credential,
      destination: {
        mode: 'save',
        async createOutput() {
          return output.writer;
        },
      },
    },
  );
  expect(output.bytes().equals(data)).toBe(true);
});

test('a supplied event-loop yield is awaited and can cancel before reading the next record', async () => {
  const source = memoryReader(referenceXfile(fixturePayload).bytes);
  const controller = new AbortController();
  const createOutput = jest.fn();
  const yieldControl = jest.fn(async () => controller.abort());
  await expect(
    decryptXfile(source.reader, {
      aead: nodeAead,
      credential,
      yieldControl,
      signal: controller.signal,
      destination: { mode: 'save', createOutput },
    }),
  ).rejects.toMatchObject({ code: 'CANCELLED' });
  expect(yieldControl).toHaveBeenCalledTimes(1);
  expect(source.requests).toHaveLength(3);
  expect(createOutput).not.toHaveBeenCalled();
});
