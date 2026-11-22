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

test('corrupt or unavailable preferences boot safely; failed saves retain selection', async () => {
  expect(parseSettings('{')).toEqual(defaultSettings);
  const store = createSettingsStore({
    read: async () => {
      throw new Error('unavailable');
    },
    write: async () => {
      throw new Error('unavailable');
    },
  });
  await store.getState().hydrate();
  expect(store.getState().ready).toBe(true);
  await store.getState().setTheme('dark');
  expect(store.getState().settings.theme).toBe('system');
  expect(store.getState().storageError).toBe(true);
});

test('noble v2 explicit ESM subpaths load in the Node test project', () => {
  // Config smoke only; no crypto vectors or backend implementation in P01.
  const { sha256 } = jest.requireActual<typeof import('@noble/hashes/sha2.js')>(
    '@noble/hashes/sha2.js',
  );
  expect(typeof sha256).toBe('function');
});
