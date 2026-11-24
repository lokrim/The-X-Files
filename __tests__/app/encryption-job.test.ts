import { CoreError } from '@/core/crypto/errors';
import { inspectHeader } from '@/core/xfile';
import { encryptToDestination, saveCopy } from '@/platform/file-jobs';
import { nativePlatform } from '@/platform/native';
import { memoryReader } from '../../test-utils/p04-io';

jest.mock('@/platform/native', () => ({
  nativePlatform: jest.fn(),
  nativeCall: async (invoke: (native: unknown) => unknown) =>
    invoke(jest.requireMock('@/platform/native').nativePlatform()),
}));
jest.mock('expo-keep-awake', () => ({
  activateKeepAwakeAsync: jest.fn(async () => {}),
  deactivateKeepAwake: jest.fn(async () => {}),
}));
jest.mock('expo-crypto', () => ({
  getRandomValues: (bytes: Uint8Array) =>
    jest
      .requireActual<typeof import('node:crypto')>('node:crypto')
      .randomFillSync(bytes),
}));

const fixture = Uint8Array.of(2, 4, 8);
const source = {
  uri: 'content://files/source',
  name: 'video.zip',
  size: fixture.length,
  mime: 'application/zip',
};
const empty = {
  uri: 'content://files/empty',
  name: 'empty.txt',
  size: 0,
  mime: 'text/plain',
};
const destination = { tree: 'content://files/target', label: 'Test folder' };
const old = 'content://files/already-there';

function bridge({
  fault,
  cleanup = true,
  unknown = false,
  signal,
}: {
  fault?: 'NO_SPACE' | 'SOURCE_CHANGED';
  cleanup?: boolean;
  unknown?: boolean;
  signal?: AbortController;
} = {}) {
  let end!: (value: string) => void;
  let ended: Promise<string>;
  const events: string[] = [];
  let last = 0;
  const preexisting = Buffer.of(9);
  const content = new Map([
    [source.uri, Buffer.from(fixture)],
    [empty.uri, Buffer.alloc(0)],
    [old, preexisting],
  ]);
  const writers = new Map<
    number,
    { chunks: Uint8Array[]; uri: string | null }
  >();
  const readers = new Map<number, ReturnType<typeof memoryReader>['reader']>();
  const deleted: (string | null)[] = [];
  const abortOutput = async (id: number) => {
    const output = writers.get(id);
    if (!output) return;
    if (!cleanup) throw new CoreError('IO_ERROR');
    writers.delete(id);
    if (output.uri) content.delete(output.uri);
    deleted.push(output.uri);
  };
  const start = jest.fn(async () => {
    ended = new Promise<string>((resolve) => {
      end = resolve;
    });
    events.push('start');
    return 1;
  });
  const volume = jest.fn(async (tree: string | null) => {
    events.push(tree ? 'destination capacity' : 'cache capacity');
    return unknown && tree
      ? null
      : { id: tree ? 'destination' : 'cache', available: 1024 ** 3 };
  });
  const createOutput = jest.fn(async (_gen: number, tree: string | null) => {
    events.push(tree ? 'new destination' : 'new private ZIP');
    const id = ++last;
    const uri = tree ? `content://files/created-${id}` : null;
    writers.set(id, { chunks: [], uri });
    if (uri) content.set(uri, Buffer.alloc(0));
    return { id, uri };
  });
  jest.mocked(nativePlatform).mockReturnValue({
    sweepTemp: async () => true,
    start,
    awaitReady: async () => true,
    awaitEnd: () => ended,
    awaitCleanup: async () => cleanup,
    volume,
    createOutput,
    async openSource(_gen: number, uri: string) {
      const id = ++last;
      events.push('open source');
      const bytes = content.get(uri)!;
      readers.set(
        id,
        memoryReader(bytes, {
          size: () =>
            fault === 'SOURCE_CHANGED' ? bytes.length + 1 : bytes.length,
        }).reader,
      );
      return id;
    },
    async openTemp(_gen: number, id: number) {
      events.push('open private ZIP');
      const handle = ++last;
      readers.set(
        handle,
        memoryReader(Buffer.concat(writers.get(id)!.chunks)).reader,
      );
      return handle;
    },
    sourceSize: async (uri: string) => content.get(uri)!.length,
    readerSize: async (_gen: number, id: number) => readers.get(id)!.size(),
    read: async (_gen: number, id: number, maximum: number) =>
      (await readers.get(id)!.read(maximum)) ?? new Uint8Array(),
    closeReader: async (_gen: number, id: number) => {
      readers.delete(id);
    },
    async write(_gen: number, id: number, bytes: Uint8Array) {
      const output = writers.get(id)!;
      if (output.uri) {
        if (fault === 'NO_SPACE') throw new CoreError('NO_SPACE');
        signal?.abort();
      }
      output.chunks.push(Uint8Array.from(bytes));
    },
    async closeWriter(_gen: number, id: number) {
      const output = writers.get(id)!;
      if (output.uri) content.set(output.uri, Buffer.concat(output.chunks));
    },
    abortOutput: (_gen: number, id: number) => abortOutput(id),
    outputLabel: async () => 'encrypted (1).xfile',
    yieldRecord: async () => true,
    progress: async () => undefined,
    async finish(_gen: number, commit: boolean) {
      end(commit ? 'COMPLETED' : 'CANCELLED');
      if (!commit)
        for (const id of writers.keys())
          await abortOutput(id).catch(() => undefined);
      return commit;
    },
  } as unknown as ReturnType<typeof nativePlatform>);
  return { events, start, createOutput, content, deleted };
}

const job = (sources = [source], signal?: AbortSignal) => ({
  sources,
  destination,
  protection: { mode: 'raw' } as const,
  outputName: 'encrypted.xfile',
  bundleName: 'bundle.zip',
  createdAtUnixSec: 1,
  onUnknownCapacity: jest.fn(),
  controls: { onCleanupFailure: jest.fn(), ...(signal ? { signal } : {}) },
});

test('preflights the chosen location, writes a single ZIP input directly, and saves the provider collision name', async () => {
  const mock = bridge({ unknown: true });
  const options = job();
  options.onUnknownCapacity.mockImplementation(() =>
    expect(mock.start).not.toHaveBeenCalled(),
  );
  const saved = await encryptToDestination(options);
  expect(mock.events).toEqual([
    'destination capacity',
    'start',
    'new destination',
    'open source',
  ]);
  expect(mock.createOutput).toHaveBeenCalledWith(
    1,
    destination.tree,
    'encrypted.xfile',
    'application/octet-stream',
  );
  expect(saved.fileName).toBe('encrypted (1).xfile');
  expect(saved.byteSize).toBe(mock.content.get(saved.file.uri)!.length);
  expect(
    (
      await inspectHeader(
        memoryReader(mock.content.get(saved.file.uri)!).reader,
      )
    ).isZip,
  ).toBe(false);
  expect(mock.content.get(old)).toEqual(Buffer.of(9));

  const before = mock.content.get(saved.file.uri)!;
  const copy = await saveCopy({
    ...options,
    file: saved.file,
    name: 'copy.xfile',
    onUnknownCapacity: () => undefined,
  });
  expect(mock.content.get(copy.file.uri)).toEqual(before);
  expect(copy.file.uri).not.toBe(saved.file.uri);
});

test('bundle opens each source twice, checks size on each volume, and removes the private ZIP before returning', async () => {
  const mock = bridge();
  const onStage = jest.fn();
  const saved = await encryptToDestination({
    ...job([source, empty]),
    onStage,
  });
  expect(mock.events).toEqual([
    'destination capacity',
    'cache capacity',
    'start',
    'new private ZIP',
    'open source',
    'open source',
    'open source',
    'open source',
    'new destination',
    'open private ZIP',
  ]);
  expect(mock.deleted).toEqual([null]);
  expect(onStage.mock.calls.flat()).toEqual(['preparing', 'running']);
  expect(
    (
      await inspectHeader(
        memoryReader(mock.content.get(saved.file.uri)!).reader,
      )
    ).isZip,
  ).toBe(true);
});

test('source mutation rolls back the ZIP and retry creates a fresh random key and salt', async () => {
  const changed = bridge({ fault: 'SOURCE_CHANGED' });
  await expect(
    encryptToDestination(job([source, empty])),
  ).rejects.toMatchObject({ code: 'SOURCE_CHANGED' });
  expect(changed.deleted).toEqual([null]);
  expect(changed.createOutput).toHaveBeenCalledTimes(1);
  const steps = async () => {
    const mock = bridge();
    const { file, recovery } = await encryptToDestination(job());
    if (recovery.mode !== 'raw') throw new Error('Expected key');
    return {
      key: recovery.fileKey,
      salt: mock.content.get(file.uri)!.subarray(24, 40),
    };
  };
  const first = await steps();
  const second = await steps();
  expect(second.key).not.toEqual(first.key);
  expect(second.salt).not.toEqual(first.salt);
});

test('failed deletes are reported; cancellation leaves pre-existing files in place', async () => {
  const blocked = bridge({ fault: 'NO_SPACE', cleanup: false });
  const options = job();
  await expect(encryptToDestination(options)).rejects.toMatchObject({
    cleanupFailed: true,
  });
  expect(options.controls.onCleanupFailure).toHaveBeenCalled();
  expect(blocked.content.has(old)).toBe(true);

  const cancel = new AbortController();
  const mock = bridge({ signal: cancel });
  await expect(
    encryptToDestination(job([source, empty], cancel.signal)),
  ).rejects.toMatchObject({ code: 'CANCELLED' });
  expect(mock.deleted).toEqual(
    expect.arrayContaining([null, expect.stringContaining('created-')]),
  );
  expect(mock.content.has(old)).toBe(true);
});
