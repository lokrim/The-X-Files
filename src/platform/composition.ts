import { settingsStorage } from '@/platform/settings-storage';
import { createSettingsStore } from '@/store/settings-store';

// Explicit composition. AEAD/RNG/KDF backends stay unselected until P01b/P05.
export const settingsStore = createSettingsStore(settingsStorage);
