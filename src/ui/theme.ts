import { useColorScheme } from 'react-native';
import { useStore } from 'zustand';

import { settingsStore } from '@/platform/composition';
import { palettes } from '@/ui/tokens';
import type { ThemePreference } from '@/store/settings-store';

export function resolveTheme(
  preference: ThemePreference,
  system: string | null | undefined,
) {
  return preference === 'system'
    ? system === 'dark'
      ? 'dark'
      : 'light'
    : preference;
}
export function useTheme() {
  const system = useColorScheme();
  const preference = useStore(settingsStore, (state) => state.settings.theme);
  const scheme = resolveTheme(preference, system);
  return { scheme, colors: palettes[scheme] };
}
