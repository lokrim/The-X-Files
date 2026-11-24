import { createStore } from 'zustand/vanilla';

export type ThemePreference = 'system' | 'light' | 'dark';
export interface Settings {
  theme: ThemePreference;
  screenshotBlocking: boolean;
  clipboardSeconds: 0 | 30 | 60;
  keepOriginalName: boolean;
}
export interface SettingsStorage {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
}
export const defaultSettings: Readonly<Settings> = {
  theme: 'system',
  screenshotBlocking: true,
  clipboardSeconds: 60,
  keepOriginalName: false,
};

export function parseSettings(raw: string | null): Settings {
  if (!raw) return { ...defaultSettings };
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null)
      return { ...defaultSettings };
    const data = value as Record<string, unknown>;
    return {
      theme:
        data.theme === 'light' || data.theme === 'dark' ? data.theme : 'system',
      screenshotBlocking:
        typeof data.screenshotBlocking === 'boolean'
          ? data.screenshotBlocking
          : true,
      clipboardSeconds:
        data.clipboardSeconds === 0 || data.clipboardSeconds === 30
          ? data.clipboardSeconds
          : 60,
      keepOriginalName: data.keepOriginalName === true,
    };
  } catch {
    return { ...defaultSettings };
  }
}

function serializeSettings(value: Settings): string {
  // Select each field explicitly; never serialize a store or caller-supplied object.
  return JSON.stringify({
    theme: value.theme,
    screenshotBlocking: value.screenshotBlocking,
    clipboardSeconds: value.clipboardSeconds,
    keepOriginalName: value.keepOriginalName,
  });
}

export function createSettingsStore(storage: SettingsStorage) {
  return createStore<{
    settings: Settings;
    ready: boolean;
    storageError: boolean;
    hydrate(): Promise<void>;
    setTheme(theme: ThemePreference): Promise<void>;
    setScreenshotBlocking(value: boolean): Promise<void>;
    setKeepOriginalName(value: boolean): Promise<void>;
    setClipboardSeconds(value: Settings['clipboardSeconds']): Promise<void>;
  }>((set, get) => {
    let pending = Promise.resolve();
    let loaded = false;

    async function load() {
      try {
        const settings = parseSettings(await storage.read());
        loaded = true;
        set({ settings, ready: true, storageError: false });
      } catch {
        set({ ready: true, storageError: true });
      }
    }

    function enqueue(operation: () => Promise<void>) {
      pending = pending.then(operation);
      return pending;
    }

    function save(patch: Partial<Settings>) {
      return enqueue(async () => {
        // Defaults are safe to display after a read error, but may differ from
        // the saved values for fields this edit does not change.
        if (!loaded) await load();
        if (!loaded) return;
        const settings = { ...get().settings, ...patch };
        try {
          await storage.write(serializeSettings(settings));
          set({ settings, storageError: false });
        } catch {
          set({ storageError: true });
        }
      });
    }
    return {
      settings: { ...defaultSettings },
      ready: false,
      storageError: false,
      hydrate: () =>
        enqueue(async () => {
          if (!loaded) await load();
        }),
      setTheme: (theme) => save({ theme }),
      setScreenshotBlocking: (screenshotBlocking) =>
        save({ screenshotBlocking }),
      setKeepOriginalName: (keepOriginalName) => save({ keepOriginalName }),
      setClipboardSeconds: (clipboardSeconds) => save({ clipboardSeconds }),
    };
  });
}
