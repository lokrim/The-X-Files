import { useEffect } from 'react';
import { Stack } from 'expo-router/stack';
import { StatusBar } from 'expo-status-bar';

import { useSettings } from '@/features/settings/use-settings';
import { settingsStore, sweepStartupTemp } from '@/platform/composition';
import { ScreenPrivacy } from '@/platform/screen-privacy';
import { ThemeProvider, useTheme } from '@/ui/theme';

function AppStack() {
  const { colors, scheme } = useTheme();
  return (
    <>
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
        <Stack.Screen name="encrypt" options={{ title: 'Encrypt' }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  const { settings } = useSettings();
  useEffect(() => {
    void settingsStore.getState().hydrate();
    void sweepStartupTemp();
  }, []);
  return (
    <ThemeProvider preference={settings.theme}>
      <ScreenPrivacy blocking={settings.screenshotBlocking}>
        <AppStack />
      </ScreenPrivacy>
    </ThemeProvider>
  );
}
