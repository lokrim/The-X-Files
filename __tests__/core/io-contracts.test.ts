import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nodeReader, nodeWriter } from '../../test-utils/node-io';
import { seededRng } from '../../test-utils/seeded-rng';

test('awaited Node I/O preserves consumed buffers and supports short reads/EOF', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'xfiles-p02-'));
  const path = join(directory, 'new-output');
  try {
    const writer = await nodeWriter(path);
    const chunk = Uint8Array.from([1, 2, 3, 4, 5]);
    await writer.write(chunk);
    chunk.fill(0);
    await writer.close();
    await writer.close();
    const reader = await nodeReader(path);
    try {
      expect(await reader.size()).toBe(5);
      expect(await reader.read(3)).toEqual(Uint8Array.from([1, 2, 3]));
      expect(await reader.read(3)).toEqual(Uint8Array.from([4, 5]));
      expect(await reader.read(3)).toBeNull();
      await expect(reader.read(Number.MAX_SAFE_INTEGER)).rejects.toMatchObject({
        code: 'RESOURCE_LIMIT',
      });
    } finally {
      await reader.close();
    }
    await expect(writer.write(chunk)).rejects.toMatchObject({
      code: 'IO_ERROR',
    });
    await writer.abort();
    await writer.abort();
    await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('exclusive new-output creation cannot overwrite or delete an existing file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'xfiles-p02-'));
  const path = join(directory, 'existing');
  try {
    await writeFile(path, Uint8Array.from([7, 8, 9]));
    await expect(nodeWriter(path)).rejects.toMatchObject({ code: 'EEXIST' });
    expect(new Uint8Array(await readFile(path))).toEqual(
      Uint8Array.from([7, 8, 9]),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('seeded RNG exists solely as a reproducible test adapter', () => {
  const a = seededRng(42),
    b = seededRng(42);
  expect(a.bytes(32)).toEqual(b.bytes(32));
  expect(a.bytes(16)).toEqual(b.bytes(16));
});
