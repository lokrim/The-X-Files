import { useStore } from 'zustand';

import { settingsStore } from '@/platform/composition';

export function useSettings() {
  return useStore(settingsStore);
}
