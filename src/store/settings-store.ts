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
  }>((set, get) => ({
    settings: { ...defaultSettings },
    ready: false,
    storageError: false,
    async hydrate() {
      try {
        set({ settings: parseSettings(await storage.read()), ready: true });
      } catch {
        set({ ready: true, storageError: true });
      }
    },
    async setTheme(theme) {
      const settings = { ...get().settings, theme };
      // Save before committing: failed writes leave the current selection intact.
      try {
        await storage.write(serializeSettings(settings));
        set({ settings, storageError: false });
      } catch {
        set({ storageError: true });
      }
    },
  }));
}
