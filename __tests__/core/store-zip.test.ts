import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32 } from 'node:zlib';
import type { ByteWriter } from '../../src/core/contracts';
import { CoreError } from '../../src/core/crypto/errors';
import {
  containerSize,
  decryptXfile,
  encryptXfile,
  planXfile,
} from '../../src/core/xfile';
import {
  extractStoreZip,
  planStoreZip,
  writeStoreZip,
  type ZipSource,
} from '../../src/core/zip';
import {
  centralHeader,
  endRecords,
  entryLayout,
  localHeader,
  uint32Sentinel,
} from '../../src/core/zip/layout';
import { nodeAead } from '../../test-utils/node-crypto';
import { nodeWriter } from '../../test-utils/node-io';
import { deferred, memoryReader, memoryWriter } from '../../test-utils/p04-io';
import {
  fixtureDate,
  fixtureKey,
  referenceHeader,
  referenceRecord,
  referenceXfile,
} from '../../test-utils/p04-reference';
import { seededRng } from '../../test-utils/seeded-rng';

function zipSource(
  name: string,
  first: Buffer,
  second = first,
  short = Infinity,
) {
  let calls = 0;
  const source: ZipSource = {
    name,
    size: first.length,
    async withReader(use) {
      return use(
        memoryReader(calls++ === 0 ? first : second, { short }).reader,
      );
    },
  };
  return { source, calls: () => calls };
}

const input = [
  { name: 'café.txt', data: Buffer.from('one\n') },
  { name: 'cafe\u0301.txt', data: Buffer.alloc(0) },
  { name: 'café (2).txt', data: Buffer.from([0xff, 0x00, 0x01]) },
  { name: '資料😀.bin', data: Buffer.from('four\n') },
];
const names = ['café.txt', 'café (3).txt', 'café (2).txt', '資料😀.bin'];
let archive: Buffer;
let plan: ReturnType<typeof planStoreZip>;

beforeAll(async () => {
  const sources = input.map(({ name, data }) => zipSource(name, data, data, 2));
  const writer = memoryWriter();
  plan = await writeStoreZip(
    sources.map(({ source }) => source),
    writer.writer,
  );
  archive = writer.bytes();
  expect(sources.map(({ calls }) => calls())).toEqual([2, 2, 2, 2]);
});

function extraction(
  bytes: Uint8Array,
  entryCount = input.length,
  short?: number,
) {
  const outputs = new Map<string, ReturnType<typeof memoryWriter>>();
  const createOutput = jest.fn(async (name: string) => {
    const output = memoryWriter();
    outputs.set(name, output);
    return output.writer;
  });
  const source = memoryReader(bytes, short === undefined ? {} : { short });
  const result = extractStoreZip(
    source.reader,
    { totalSize: bytes.length, entryCount },
    createOutput,
  );
  return { result, outputs, source, createOutput };
}

test('ZIP writer matches classic layouts, independent CRC, exact plan and extraction', async () => {
  expect(plan.entries.map((entry) => entry.name)).toEqual(names);
  expect(archive).toHaveLength(plan.totalSize);
  const container = planXfile({
    name: 'bundle.zip',
    isZip: true,
    totalSize: plan.totalSize,
    entryCount: input.length,
  });
  expect(container.totalSize).toBe(
    containerSize(plan.totalSize, container.metadataBytes),
  );
  expect(container.totalSize - plan.totalSize).toBe(
    48 + container.metadataBytes + 42,
  );
  let directory = plan.directory.offset;
  for (const [index, entry] of plan.entries.entries()) {
    const name = Buffer.from(entry.name);
    const data = input[index]!.data;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const expectedLocal = Buffer.concat([local, name, data]);
    expect(
      archive.subarray(entry.offset, entry.offset + expectedLocal.length),
    ).toEqual(expectedLocal);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50);
    central.writeUInt16LE(0x0314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc32(data), 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(0x81800000, 38);
    central.writeUInt32LE(entry.offset, 42);
    expect(archive.subarray(directory, directory + 46 + name.length)).toEqual(
      Buffer.concat([central, name]),
    );
    directory += 46 + name.length;
  }
  const end = archive.subarray(directory);
  expect(end.length).toBe(22);
  const directoryFields = Buffer.alloc(8);
  directoryFields.writeUInt32LE(plan.directory.size, 0);
  directoryFields.writeUInt32LE(plan.directory.offset, 4);
  expect(end.toString('hex')).toBe(
    '504b05060000000004000400' + directoryFields.toString('hex') + '0000',
  );
  const extracted = extraction(archive, input.length, 1);
  await extracted.result;
  for (const [index, name] of names.entries()) {
    expect(extracted.outputs.get(name)?.closed).toBe(true);
    expect(extracted.outputs.get(name)?.bytes()).toEqual(input[index]!.data);
  }
});

test('unzip and Python zipfile independently read the generated Unicode, empty and binary entries', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'xfiles-p04-'));
  try {
    const path = join(directory, 'bundle.zip');
    await writeFile(path, archive);
    const testOutput = execFileSync('unzip', ['-t', path], {
      encoding: 'utf8',
    });
    expect(testOutput).toMatch(/No errors detected/i);
    // Match each name through the reader. Info-ZIP's listing can filter
    // terminal characters in a displayed UTF-8 name.
    for (const [index, name] of names.entries())
      expect(execFileSync('unzip', ['-p', path, name])).toEqual(
        input[index]!.data,
      );
    const python = [
      'import json, sys, zipfile',
      'with zipfile.ZipFile(sys.argv[1]) as z:',
      '    assert z.testzip() is None',
      '    print(json.dumps([[i.filename, i.file_size, i.CRC, i.flag_bits, z.read(i).hex()] for i in z.infolist()]))',
    ].join('\n');
    const reports: unknown = JSON.parse(
      execFileSync('python3', ['-c', python, path], { encoding: 'utf8' }),
    );
    expect(reports).toEqual(
      input.map(({ data }, i) => [
        names[i],
        data.length,
        crc32(data),
        0x800,
        data.toString('hex'),
      ]),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('name planning skips occupied suffixes and truncates at code-point boundaries', () => {
  const multibyte = '😀'.repeat(62) + '猫.txt';
  expect(Buffer.byteLength(multibyte)).toBe(255);
  const extension = 'é.' + 'a'.repeat(252);
  const inputs = [
    multibyte,
    multibyte,
    extension,
    extension,
    '.env',
    '.env',
    'end.',
    'end.',
  ];
  const actual = planStoreZip(
    inputs.map((name) => ({ name, size: 0 })),
  ).entries.map(({ name }) => name);
  expect(actual).toEqual([
    multibyte,
    '😀'.repeat(61) + ' (2).txt',
    extension,
    'é (2).' + 'a'.repeat(248),
    '.env',
    '.env (2)',
    'end.',
    'end. (2)',
  ]);
  expect(actual.every((name) => Buffer.byteLength(name) <= 255)).toBe(true);
});

test.each([
  '',
  '.',
  '..',
  '../x',
  'a/b',
  '/a',
  'a\\b',
  '\\\\host\\file',
  'C:foo',
  'nul\0name',
  '\ud800',
  'é'.repeat(128),
])('writer rejects an unsafe or overlong name %#', (name) => {
  expect(() =>
    planStoreZip([
      { name, size: 0 },
      { name: 'other', size: 0 },
    ]),
  ).toThrow(new CoreError('UNSUPPORTED_ARCHIVE'));
});

test('creation and extraction enforce entry count and archive byte caps before work', async () => {
  expect(() => planStoreZip([{ name: 'original.zip', size: 0 }])).toThrow(
    new CoreError('UNSUPPORTED_ARCHIVE'),
  );
  const tenThousand = Array.from({ length: 10_000 }, (_, index) => ({
    name: `${index}`,
    size: 0,
  }));
  expect(planStoreZip(tenThousand).entries).toHaveLength(10_000);
  expect(() =>
    planStoreZip([...tenThousand, { name: 'more', size: 0 }]),
  ).toThrow(new CoreError('RESOURCE_LIMIT'));
  expect(() =>
    planStoreZip([
      { name: 'a', size: 2 ** 40 },
      { name: 'b', size: 0 },
    ]),
  ).toThrow(new CoreError('RESOURCE_LIMIT'));
  const exact = planStoreZip([
    { name: 'a', size: 2 ** 40 - 306 },
    { name: 'b', size: 0 },
  ]);
  expect(exact.totalSize).toBe(2 ** 40);
  expect(() =>
    planStoreZip([
      { name: 'a', size: 2 ** 40 - 305 },
      { name: 'b', size: 0 },
    ]),
  ).toThrow(new CoreError('RESOURCE_LIMIT'));
  expect(exact.directory.zip64Entry).toBe(true);
  const source = memoryReader(archive);
  const createOutput = jest.fn();
  for (const metadata of [
    { totalSize: archive.length, entryCount: 20_001 },
    { totalSize: 2 ** 40 + 1, entryCount: 2 },
  ])
    await expect(
      extractStoreZip(source.reader, metadata, createOutput),
    ).rejects.toMatchObject({ code: 'RESOURCE_LIMIT' });
  expect(source.requests).toHaveLength(0);
  expect(createOutput).not.toHaveBeenCalled();
});

test.each([0xffff_fffe, 0xffff_ffff, 0x1_0000_0000])(
  'ZIP64 size and offset sentinel fields at %i',
  (value) => {
    const name = Buffer.from('z');
    const large = value >= 0xffff_ffff;
    expect(entryLayout(value, 0)).toMatchObject({
      largeSize: large,
      localExtra: large ? 20 : 0,
      centralExtra: large ? 20 : 0,
    });
    expect(entryLayout(0, value)).toMatchObject({
      largeOffset: large,
      localExtra: 0,
      centralExtra: large ? 12 : 0,
    });
    const facts = { name, size: value, offset: value, crc: 0x12345678 };
    const local = Buffer.from(localHeader(facts));
    const central = Buffer.from(centralHeader(facts));
    expect(local.readUInt16LE(4)).toBe(large ? 45 : 20);
    expect(local.readUInt32LE(18)).toBe(Math.min(value, uint32Sentinel));
    expect(local.readUInt32LE(22)).toBe(Math.min(value, uint32Sentinel));
    expect(central.readUInt16LE(4)).toBe(large ? 0x032d : 0x0314);
    for (const offset of [20, 24, 42])
      expect(central.readUInt32LE(offset)).toBe(
        Math.min(value, uint32Sentinel),
      );
    if (large) {
      expect(local.subarray(31, 35)).toEqual(Buffer.from([1, 0, 16, 0]));
      expect(central.subarray(47, 51)).toEqual(Buffer.from([1, 0, 24, 0]));
      for (const offset of [35, 43])
        expect(local.readBigUInt64LE(offset)).toBe(BigInt(value));
      for (const offset of [51, 59, 67])
        expect(central.readBigUInt64LE(offset)).toBe(BigInt(value));
      const offsetOnly = Buffer.from(centralHeader({ ...facts, size: 1 }));
      expect(offsetOnly.subarray(47, 51)).toEqual(Buffer.from([1, 0, 8, 0]));
      expect(offsetOnly.readBigUInt64LE(51)).toBe(BigInt(value));
    } else {
      expect(local.length).toBe(31);
      expect(central.length).toBe(47);
    }
  },
);

test.each([0xfffe, 0xffff, 0x1_0000])(
  'ZIP64 end records serialize count boundary %i',
  (count) => {
    const large = count >= 0xffff;
    const bytes = Buffer.from(
      endRecords({ count, size: 73, offset: 99, zip64Entry: false }),
    );
    expect(bytes.length).toBe(large ? 98 : 22);
    const classic = bytes.subarray(-22);
    expect(classic.readUInt32LE()).toBe(0x06054b50);
    expect(classic.readUInt16LE(8)).toBe(Math.min(count, 0xffff));
    expect(classic.readUInt16LE(10)).toBe(Math.min(count, 0xffff));
    expect(classic.readUInt32LE(12)).toBe(73);
    expect(classic.readUInt32LE(16)).toBe(99);
    expect(classic.readUInt16LE(20)).toBe(0);
    if (large) {
      expect(bytes.readUInt32LE()).toBe(0x06064b50);
      expect(bytes.readBigUInt64LE(4)).toBe(44n);
      expect(bytes.readUInt16LE(12)).toBe(0x032d);
      expect(bytes.readUInt16LE(14)).toBe(45);
      expect(bytes.readBigUInt64LE(24)).toBe(BigInt(count));
      expect(bytes.readBigUInt64LE(32)).toBe(BigInt(count));
      expect(bytes.readBigUInt64LE(40)).toBe(73n);
      expect(bytes.readBigUInt64LE(48)).toBe(99n);
      expect(bytes.readUInt32LE(56)).toBe(0x07064b50);
      expect(bytes.readBigUInt64LE(64)).toBe(172n);
      expect(bytes.readUInt32LE(72)).toBe(1);
    }
  },
);

test('central offset and size independently trigger ZIP64 at equality, with other classic values preserved', () => {
  for (const size of [0xffff_fffe, 0xffff_ffff, 0x1_0000_0000]) {
    for (const offset of [0xffff_fffe, 0xffff_ffff, 0x1_0000_0000]) {
      const bytes = Buffer.from(
        endRecords({ size, offset, count: 2, zip64Entry: false }),
      );
      const large = size >= uint32Sentinel || offset >= uint32Sentinel;
      const classic = bytes.subarray(-22);
      expect(bytes.length).toBe(large ? 98 : 22);
      expect(classic.readUInt16LE(10)).toBe(2);
      expect(classic.readUInt32LE(12)).toBe(Math.min(size, uint32Sentinel));
      expect(classic.readUInt32LE(16)).toBe(Math.min(offset, uint32Sentinel));
      if (large) expect(bytes.readBigUInt64LE(64)).toBe(BigInt(size + offset));
    }
  }
  expect(
    endRecords({ size: 73, offset: 99, count: 2, zip64Entry: true }),
  ).toHaveLength(98);
});

test.each([
  ['deflate', 8, 8],
  ['descriptor', 6, 8],
  ['encryption', 6, 1],
  ['non-UTF8', 7, 8],
  ['time', 10, 1],
  ['extra', 28, 1],
  ['CRCs', 14, 1],
  ['byte CRC', 30 + Buffer.byteLength('café.txt'), 1],
  ['UTF8 bytes', 30, 255],
] as const)('rejects unsupported local %s', async (_, offset, mask) => {
  const bytes = Buffer.from(archive);
  bytes[offset]! ^= mask;
  const attempt = extraction(bytes);
  await expect(attempt.result).rejects.toMatchObject({
    code: 'UNSUPPORTED_ARCHIVE',
  });
  expect([...attempt.outputs.values()].every((out) => out.aborted)).toBe(true);
});

test('giant ZIP size/name bounds reject before output creation and large reads', async () => {
  const bytes = Buffer.from(archive);
  bytes.writeUInt32LE(0xffff_fffe, 18);
  bytes.writeUInt32LE(0xffff_fffe, 22);
  const giant = extraction(bytes);
  await expect(giant.result).rejects.toMatchObject({ code: 'RESOURCE_LIMIT' });
  expect(Math.max(...giant.source.requests)).toBeLessThanOrEqual(26);
  expect(giant.createOutput).not.toHaveBeenCalled();

  const invalidName = Buffer.from(archive);
  invalidName.writeUInt16LE(65535, 26);
  const name = extraction(invalidName);
  await expect(name.result).rejects.toMatchObject({
    code: 'UNSUPPORTED_ARCHIVE',
  });
  expect(name.source.requests).toEqual([4, 26]);
});

test.each([
  ['signature', 0, 1],
  ['made by', 4, 1],
  ['version', 6, 1],
  ['flags', 8, 1],
  ['method', 10, 8],
  ['time', 12, 1],
  ['date', 14, 1],
  ['CRC', 16, 1],
  ['compressed size', 20, 1],
  ['uncompressed size', 24, 1],
  ['name size', 28, 1],
  ['extra size', 30, 1],
  ['comment', 32, 1],
  ['disk', 34, 1],
  ['internal attrs', 36, 1],
  ['symlink', 41, 0x20],
  ['directory', 41, 0xc0],
  ['offset', 42, 1],
  ['name', 46, 1],
] as const)(
  'central %s mismatch aborts every new output',
  async (_, offset, mask) => {
    const bytes = Buffer.from(archive);
    bytes[plan.directory.offset + offset]! ^= mask;
    const attempt = extraction(bytes);
    await expect(attempt.result).rejects.toMatchObject({
      code: 'UNSUPPORTED_ARCHIVE',
    });
    expect(attempt.outputs.size).toBe(input.length);
    expect(
      [...attempt.outputs.values()].every(
        (output) => output.aborted && output.bytes().length === 0,
      ),
    ).toBe(true);
  },
);

test('rejects duplicate path names, self-extracting prefix, reordered central records and late end errors', async () => {
  const duplicate = Buffer.from(archive);
  // Entries two and three have equally long names.
  const duplicateName = Buffer.from(names[1]!);
  expect(duplicateName.length).toBe(Buffer.byteLength(names[2]!));
  duplicateName.copy(duplicate, plan.entries[2]!.offset + 30);
  await expect(extraction(duplicate).result).rejects.toMatchObject({
    code: 'UNSUPPORTED_ARCHIVE',
  });
  const traversal = Buffer.from(archive);
  Buffer.from('../').copy(traversal, 30);
  await expect(extraction(traversal).result).rejects.toMatchObject({
    code: 'UNSUPPORTED_ARCHIVE',
  });
  const first = plan.directory.offset;
  const split = first + 46 + Buffer.byteLength(names[0]!);
  const next = split + 46 + Buffer.byteLength(names[1]!);
  const reordered = Buffer.concat([
    archive.subarray(0, first),
    archive.subarray(split, next),
    archive.subarray(first, split),
    archive.subarray(next),
  ]);
  for (const bytes of [
    reordered,
    archive.subarray(0, -1),
    Buffer.concat([archive, Buffer.of(0)]),
    Buffer.concat([Buffer.of(0), archive]),
  ]) {
    const attempt = extraction(bytes);
    await expect(attempt.result).rejects.toMatchObject({
      code: 'UNSUPPORTED_ARCHIVE',
    });
    expect([...attempt.outputs.values()].every((out) => out.aborted)).toBe(
      true,
    );
  }
  for (const offset of [4, 6, 8, 10, 12, 16, 20]) {
    const bytes = Buffer.from(archive);
    bytes[archive.length - 22 + offset]! ^= 1;
    await expect(extraction(bytes).result).rejects.toMatchObject({
      code: 'UNSUPPORTED_ARCHIVE',
    });
  }
  for (const count of [input.length - 1, input.length + 1]) {
    const attempt = extraction(archive, count);
    await expect(attempt.result).rejects.toMatchObject({
      code: 'UNSUPPORTED_ARCHIVE',
    });
    expect([...attempt.outputs.values()].every((out) => out.aborted)).toBe(
      true,
    );
  }
});

test.each([Buffer.from('bbbb'), Buffer.from('a'), Buffer.from('aaaaa')])(
  'second source pass catches CRC or size change %#',
  async (changed) => {
    const source = zipSource('a', Buffer.from('aaaa'), changed);
    const other = zipSource('b', Buffer.alloc(0));
    const output = memoryWriter();
    await expect(
      writeStoreZip([source.source, other.source], output.writer),
    ).rejects.toMatchObject({ code: 'SOURCE_CHANGED' });
    expect(source.calls()).toBe(2);
    expect(output.aborted).toBe(true);
    expect(output.bytes()).toHaveLength(0);
  },
);

test('an exclusive-create conflict preserves pre-existing bytes and deletes the earlier new entry', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'xfiles-p04-conflict-'));
  try {
    const collision = join(directory, names[1]!);
    await writeFile(collision, 'existing');
    await expect(
      extractStoreZip(
        memoryReader(archive).reader,
        {
          totalSize: archive.length,
          entryCount: input.length,
        },
        (name) => nodeWriter(join(directory, name)),
      ),
    ).rejects.toMatchObject({ code: 'IO_ERROR' });
    expect(await readFile(collision, 'utf8')).toBe('existing');
    await expect(readFile(join(directory, names[0]!))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('disk and cancellation failures abort all outputs even when one abort fails', async () => {
  for (const cancel of [true, false]) {
    const controller = new AbortController();
    const outputs: ReturnType<typeof memoryWriter>[] = [];
    const aborted: number[] = [];
    await expect(
      extractStoreZip(
        memoryReader(archive).reader,
        {
          totalSize: archive.length,
          entryCount: input.length,
        },
        async () => {
          const index = outputs.length;
          const output = memoryWriter();
          outputs.push(output);
          return {
            ...output.writer,
            async write(bytes) {
              if (index === 2) {
                if (cancel) controller.abort();
                else throw new CoreError('NO_SPACE');
              }
              await output.writer.write(bytes);
            },
            async abort() {
              aborted.push(index);
              if (!cancel && index === 1) throw new Error('private path');
              await output.writer.abort();
            },
          };
        },
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ code: cancel ? 'CANCELLED' : 'IO_ERROR' });
    expect(aborted).toEqual([0, 1, 2]);
    expect(outputs.map((output) => output.aborted)).toEqual([
      true,
      cancel,
      true,
    ]);
  }
});

test('ZIP cancellation while writing awaits consumption before wiping and aborting', async () => {
  const controller = new AbortController();
  const output = memoryWriter();
  const first = zipSource('a', Buffer.from('a'.repeat(100)));
  const second = zipSource('b', Buffer.alloc(0));
  const entered = deferred();
  const resume = deferred();
  let borrowed: Uint8Array | undefined;
  const promise = writeStoreZip(
    [first.source, second.source],
    {
      ...output.writer,
      async write(data) {
        if (output.writes === 1) {
          borrowed = data;
          entered.resolve();
          await resume.ready;
        }
        await output.writer.write(data);
      },
    },
    { signal: controller.signal },
  );
  await entered.ready;
  controller.abort();
  expect(output.aborted).toBe(false);
  expect(borrowed?.[0]).toBe(0x61);
  resume.resolve();
  await expect(promise).rejects.toMatchObject({ code: 'CANCELLED' });
  expect(borrowed?.every((byte) => byte === 0)).toBe(true);
  expect(output.aborted).toBe(true);
});

test('bundle extracts in one authenticated pass or saves opaque bytes', async () => {
  const metadata = {
    name: 'bundle.zip',
    entryCount: input.length,
    totalSize: archive.length,
    isZip: true,
  };
  const sealed = memoryWriter();
  const result = await encryptXfile(
    memoryReader(archive).reader,
    sealed.writer,
    {
      metadata,
      aead: nodeAead,
      protection: { mode: 'raw' },
      rng: seededRng(100),
      createdAtUnixSec: fixtureDate,
    },
  );
  if (result.mode !== 'raw') throw new Error('expected raw mode');
  const credential = { mode: 'raw', fileKey: result.fileKey } as const;
  const writers: ReturnType<typeof memoryWriter>[] = [];
  const createOutput = jest.fn(async () => {
    const writer = memoryWriter();
    writers.push(writer);
    return writer.writer;
  });
  await expect(
    decryptXfile(memoryReader(sealed.bytes()).reader, {
      aead: nodeAead,
      credential,
      destination: { mode: 'extract', createOutput },
    }),
  ).resolves.toMatchObject({
    metadata: { ...metadata, mime: 'application/zip' },
  });
  expect(createOutput.mock.calls).toEqual(
    names.map((name, index) => [name, input[index]!.data.length]),
  );
  expect(writers.map((writer) => writer.bytes())).toEqual(
    input.map(({ data }) => data),
  );

  const damaged = Buffer.from(archive);
  damaged[plan.directory.offset] = 0;
  const bytes = referenceXfile(damaged, {
    header: referenceHeader({ isZip: true }),
    metadata: Buffer.from(
      JSON.stringify({ v: 1, ...metadata, mime: 'application/zip' }),
    ),
  }).bytes;
  const saved = memoryWriter();
  await decryptXfile(memoryReader(bytes).reader, {
    aead: nodeAead,
    credential: { mode: 'raw', fileKey: fixtureKey },
    destination: {
      mode: 'save',
      async createOutput() {
        return saved.writer;
      },
    },
  });
  expect(saved.bytes()).toEqual(damaged);

  const standalone = referenceXfile(archive).bytes;
  const opaqueCreateOutput = jest.fn();
  await expect(
    decryptXfile(memoryReader(standalone).reader, {
      aead: nodeAead,
      credential: { mode: 'raw', fileKey: fixtureKey },
      destination: { mode: 'extract', createOutput: opaqueCreateOutput },
    }),
  ).rejects.toMatchObject({ code: 'UNSUPPORTED_ARCHIVE' });
  expect(opaqueCreateOutput).not.toHaveBeenCalled();
});

test('later AEAD failure rolls back already closed ZIP output and current entry', async () => {
  const sources = [
    zipSource('first', Buffer.from('authenticated')),
    zipSource('next', Buffer.alloc(2 ** 16 + 3, 0x61)),
  ];
  const zip = memoryWriter();
  await writeStoreZip(
    sources.map(({ source }) => source),
    zip.writer,
  );
  const data = zip.bytes();
  const header = referenceHeader({ isZip: true, chunkLog2: 16 });
  const metadata = Buffer.from(
    JSON.stringify({
      v: 1,
      name: 'bundle.zip',
      isZip: true,
      totalSize: data.length,
      entryCount: 2,
      mime: 'application/zip',
    }),
  );
  const { bytes } = referenceXfile(data, { header, metadata });
  bytes[bytes.length - 1]! ^= 1;
  const outputs: ReturnType<typeof memoryWriter>[] = [];
  const createOutput = async (): Promise<ByteWriter> => {
    const output = memoryWriter();
    outputs.push(output);
    return output.writer;
  };
  await expect(
    decryptXfile(memoryReader(bytes).reader, {
      aead: nodeAead,
      credential: { mode: 'raw', fileKey: fixtureKey },
      destination: { mode: 'extract', createOutput },
    }),
  ).rejects.toMatchObject({ code: 'AUTH_FAILED' });
  expect(outputs).toHaveLength(2);
  expect(
    outputs.map((output) => [
      output.writes,
      output.aborted,
      output.bytes().length,
    ]),
  ).toEqual([
    [1, true, 0],
    [1, true, 0],
  ]);
});

test('authenticated ZIP names and split headers survive reuse of the previous record buffer', async () => {
  const first = Buffer.alloc(2 ** 16 - 12 - 35, 0xfe);
  const second = Buffer.from('split header');
  const zip = memoryWriter();
  const layout = await writeStoreZip(
    [zipSource('first', first).source, zipSource('next', second).source],
    zip.writer,
  );
  expect(layout.entries[1]?.offset).toBe(2 ** 16 - 12);
  const metadata = {
    v: 1,
    name: 'bundle.zip',
    isZip: true,
    totalSize: layout.totalSize,
    entryCount: 2,
    mime: 'application/zip',
  };
  const { bytes } = referenceXfile(zip.bytes(), {
    header: referenceHeader({ isZip: true, chunkLog2: 16 }),
    metadata: Buffer.from(JSON.stringify(metadata)),
  });
  const outputs = new Map<string, ReturnType<typeof memoryWriter>>();
  await expect(
    decryptXfile(memoryReader(bytes, { short: 1060 }).reader, {
      aead: nodeAead,
      credential: { mode: 'raw', fileKey: fixtureKey },
      destination: {
        mode: 'extract',
        async createOutput(name) {
          const output = memoryWriter();
          outputs.set(name, output);
          return output.writer;
        },
      },
    }),
  ).resolves.toMatchObject({ metadata });
  expect(outputs.get('first')?.bytes()).toEqual(first);
  expect(outputs.get('next')?.bytes()).toEqual(second);
});

test('rejects a ZIP64 integer outside the safe domain before reading any entry data', async () => {
  const first = Buffer.from(
    localHeader({
      name: Buffer.from('a'),
      size: uint32Sentinel,
      offset: 0,
      crc: 0,
    }),
  );
  first.writeBigUInt64LE(2n ** 53n, 35);
  const attempt = extraction(first, 2);
  await expect(attempt.result).rejects.toMatchObject({
    code: 'RESOURCE_LIMIT',
  });
  expect(attempt.createOutput).not.toHaveBeenCalled();
  expect(attempt.source.requests).toEqual([4, 26, 21]);
});

test('a complete ZIP without authenticated container FINAL aborts all closed outputs', async () => {
  const zip = memoryWriter();
  await writeStoreZip(
    [
      zipSource('a', Buffer.alloc(65_536 - 178)).source,
      zipSource('b', Buffer.alloc(0)).source,
    ],
    zip.writer,
  );
  const data = zip.bytes();
  expect(data).toHaveLength(65_536);
  const metadata = Buffer.from(
    JSON.stringify({
      v: 1,
      name: 'bundle.zip',
      isZip: true,
      totalSize: data.length,
      entryCount: 2,
      mime: 'application/zip',
    }),
  );
  const header = referenceHeader({ chunkLog2: 16, isZip: true });
  const missingFinal = Buffer.concat([
    header,
    referenceRecord(header, 0, metadata, 0),
    referenceRecord(header, 1, data, 0),
  ]);
  const outputs: ReturnType<typeof memoryWriter>[] = [];
  await expect(
    decryptXfile(memoryReader(missingFinal).reader, {
      aead: nodeAead,
      credential: { mode: 'raw', fileKey: fixtureKey },
      destination: {
        mode: 'extract',
        async createOutput() {
          const output = memoryWriter();
          outputs.push(output);
          return output.writer;
        },
      },
    }),
  ).rejects.toMatchObject({ code: 'TRUNCATED' });
  expect(outputs.map((output) => [output.closed, output.aborted])).toEqual([
    [true, true],
    [true, true],
  ]);
});

test('a reader can extract exactly 20,000 zero-length entries', async () => {
  const locals: Uint8Array[] = [];
  const directory: Uint8Array[] = [];
  let offset = 0;
  let directoryBytes = 0;
  for (let index = 0; index < 20_000; index++) {
    const entry = { name: Buffer.from(String(index)), size: 0, offset, crc: 0 };
    const local = localHeader(entry);
    const central = centralHeader(entry);
    locals.push(local);
    directory.push(central);
    offset += local.length;
    directoryBytes += central.length;
  }
  const zip = Buffer.concat([
    ...locals,
    ...directory,
    endRecords({
      count: 20_000,
      offset,
      size: directoryBytes,
      zip64Entry: false,
    }),
  ]);
  let created = 0;
  let closed = 0;
  await extractStoreZip(
    memoryReader(zip).reader,
    { totalSize: zip.length, entryCount: 20_000 },
    async (name, size) => {
      if (name !== String(created++) || size !== 0)
        throw new Error('unexpected empty entry');
      return {
        async close() {
          closed++;
        },
        async write() {
          throw new Error('unexpected write for empty entry');
        },
        async abort() {
          throw new Error('unexpected abort');
        },
      };
    },
    { yieldControl: async () => {} },
  );
  expect([created, closed]).toEqual([20_000, 20_000]);
});
