import { createContext, useContext, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';

import type { ThemePreference } from '@/store/settings-store';
import { palettes } from './tokens';

const ThemePreferenceContext = createContext<ThemePreference>('system');

export function ThemeProvider({
  preference,
  children,
}: {
  preference: ThemePreference;
  children: ReactNode;
}) {
  return (
    <ThemePreferenceContext.Provider value={preference}>
      {children}
    </ThemePreferenceContext.Provider>
  );
}

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
  const preference = useContext(ThemePreferenceContext);
  const scheme = resolveTheme(preference, system);
  return { scheme, colors: palettes[scheme] };
}
