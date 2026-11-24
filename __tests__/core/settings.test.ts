import {
  createSettingsStore,
  defaultSettings,
  parseSettings,
} from '@/store/settings-store';

test('settings accept only known preferences and ignore secrets/URIs/history', async () => {
  const persisted: string[] = [];
  const store = createSettingsStore({
    read: async () =>
      JSON.stringify({
        theme: 'dark',
        key: 'never-store',
        outputUri: 'private',
        history: ['file'],
        clipboardSeconds: 15,
      }),
    write: async (value) => {
      persisted.push(value);
    },
  });
  await store.getState().hydrate();
  expect(store.getState().settings).toEqual({
    ...defaultSettings,
    theme: 'dark',
  });
  await store.getState().setTheme('light');
  expect(JSON.parse(persisted[0]!)).toEqual({
    ...defaultSettings,
    theme: 'light',
  });
  expect(Object.keys(JSON.parse(persisted[0]!)).sort()).toEqual([
    'clipboardSeconds',
    'keepOriginalName',
    'screenshotBlocking',
    'theme',
  ]);
});

test('unreadable preferences boot safely and prevent an overwrite', async () => {
  expect(parseSettings('{')).toEqual(defaultSettings);
  const write = jest.fn(async () => undefined);
  const store = createSettingsStore({
    read: async () => {
      throw new Error('unavailable');
    },
    write,
  });
  await store.getState().hydrate();
  expect(store.getState().ready).toBe(true);
  await store.getState().setTheme('dark');
  expect(store.getState().settings.theme).toBe('system');
  expect(store.getState().storageError).toBe(true);
  expect(write).not.toHaveBeenCalled();
});

test('retrying preferences merges queued edits into the previously saved values', async () => {
  const saved = {
    theme: 'dark',
    screenshotBlocking: true,
    keepOriginalName: true,
    clipboardSeconds: 30,
  };
  const read = jest
    .fn(async () => JSON.stringify(saved))
    .mockRejectedValueOnce(new Error('unavailable'));
  const write = jest.fn<Promise<void>, [string]>(async () => undefined);
  const store = createSettingsStore({ read, write });

  await store.getState().hydrate();
  expect(store.getState().storageError).toBe(true);

  await Promise.all([
    store.getState().setScreenshotBlocking(false),
    store.getState().setClipboardSeconds(0),
  ]);

  expect(read).toHaveBeenCalledTimes(2);
  expect(JSON.parse(write.mock.calls[0]![0])).toEqual({
    ...saved,
    screenshotBlocking: false,
  });
  expect(store.getState()).toMatchObject({
    settings: { ...saved, screenshotBlocking: false, clipboardSeconds: 0 },
    storageError: false,
  });
  expect(write).toHaveBeenLastCalledWith(
    JSON.stringify(store.getState().settings),
  );
});

test('noble v2 explicit ESM subpaths load in the Node test project', () => {
  // Config smoke only; no crypto vectors or backend implementation in P01.
  const { sha256 } = jest.requireActual<typeof import('@noble/hashes/sha2.js')>(
    '@noble/hashes/sha2.js',
  );
  expect(typeof sha256).toBe('function');
});
