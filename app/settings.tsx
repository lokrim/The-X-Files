import { Button, Column, Host } from '@expo/ui';
import { ScrollView, Text } from 'react-native';
import { useStore } from 'zustand';

import { settingsStore } from '@/platform/composition';
import { useTheme } from '@/ui/theme';
import { spacing, typography } from '@/ui/tokens';

export default function Settings() {
  const { colors, scheme } = useTheme();
  const { settings, ready, storageError, setTheme } = useStore(settingsStore);
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: spacing.xl, gap: spacing.lg }}
    >
      <Text style={{ ...typography.title, color: colors.text }}>Theme</Text>
      <Host matchContents colorScheme={scheme}>
        <Column>
          {(['system', 'light', 'dark'] as const).map((theme) => (
            <Button
              key={theme}
              disabled={!ready}
              onPress={() => {
                void setTheme(theme);
              }}
            >{`${settings.theme === theme ? '✓ ' : ''}${theme.charAt(0).toUpperCase()}${theme.slice(1)}`}</Button>
          ))}
        </Column>
      </Host>
      {storageError && (
        <Text
          selectable
          accessibilityRole="alert"
          style={{ ...typography.body, color: colors.danger }}
        >
          Could not save or load preferences. Try selecting a theme again.
        </Text>
      )}
      <Text style={{ ...typography.body, color: colors.muted }}>
        Only non-secret preferences are saved. Files, keys, passwords and output
        locations are never stored as preferences.
      </Text>
      <Text style={{ ...typography.caption, color: colors.muted }}>
        X-Files makes no network connections itself; apps you choose to save to
        or share with may.
      </Text>
    </ScrollView>
  );
}
