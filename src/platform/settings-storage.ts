import * as SecureStore from 'expo-secure-store';

import type { SettingsStorage } from '@/store/settings-store';
import { parseSettings } from '@/store/settings-store';

const key = 'xfiles.preferences.v1';

// Fixed-key adapter exposes no generic storage API to features/core.
export const settingsStorage: SettingsStorage = {
  read: () => SecureStore.getItemAsync(key),
  // Revalidate even internal callers before crossing the persistence boundary.
  write: (value) =>
    SecureStore.setItemAsync(key, JSON.stringify(parseSettings(value))),
};
