import { useEffect } from 'react';
import { Stack } from 'expo-router/stack';
import { StatusBar } from 'expo-status-bar';

import { settingsStore } from '@/platform/composition';
import { useTheme } from '@/ui/theme';

export default function RootLayout() {
  const { colors, scheme } = useTheme();
  useEffect(() => {
    void settingsStore.getState().hydrate();
  }, []);
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
      </Stack>
    </>
  );
}
