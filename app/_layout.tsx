import { useEffect } from 'react';
import { Stack } from 'expo-router/stack';
import { StatusBar } from 'expo-status-bar';

import { settingsStore, sweepStartupTemp } from '@/platform/composition';
import { ScreenPrivacy } from '@/platform/screen-privacy';
import { useStore } from 'zustand';
import { useTheme } from '@/ui/theme';

export default function RootLayout() {
  const { colors, scheme } = useTheme();
  const blocking = useStore(
    settingsStore,
    (state) => state.settings.screenshotBlocking,
  );
  useEffect(() => {
    void settingsStore.getState().hydrate();
    void sweepStartupTemp();
  }, []);
  return (
    <ScreenPrivacy blocking={blocking}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.text,
          contentStyle: { backgroundColor: colors.bg },
          headerShadowVisible: false,
        }}
      >
        <Stack.Screen name="index" options={{ title: 'X-Files' }} />
        <Stack.Screen name="settings" options={{ title: 'Settings' }} />
      </Stack>
    </ScreenPrivacy>
  );
}
