import { useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { aboutDisclosures } from '@/features/settings/about-copy';
import localNotices from '@/features/settings/local-notices.json';
import { useSettings } from '@/features/settings/use-settings';
import { clipboardExpiryDisclosure } from '@/platform/clipboard';
import { Button } from '@/ui/controls/button';
import { Card } from '@/ui/controls/card';
import { ScreenContainer } from '@/ui/controls/screen-container';
import { Segmented } from '@/ui/controls/segmented';
import { Switch } from '@/ui/controls/switch';
import { UiText } from '@/ui/controls/text';
import { useTheme } from '@/ui/theme';
import { metrics, spacing } from '@/ui/tokens';

const clipboardOptions = [
  { value: 0, label: 'Off' },
  { value: 30, label: '30 sec', accessibilityLabel: '30 seconds' },
  { value: 60, label: '60 sec', accessibilityLabel: '60 seconds' },
] as const;

const themeOptions = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
] as const;

function SettingsGroup({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.group}>
      <UiText accessibilityRole="header" variant="title">
        {title}
      </UiText>
      <Card>{children}</Card>
    </View>
  );
}

export default function Settings() {
  const { colors } = useTheme();
  const [showLicenses, setShowLicenses] = useState(false);
  const {
    settings,
    ready,
    storageError,
    setTheme,
    setClipboardSeconds,
    setScreenshotBlocking,
    setKeepOriginalName,
  } = useSettings();

  return (
    <ScreenContainer>
      {storageError && (
        <UiText accessibilityRole="alert" accessibilityLiveRegion="polite">
          Could not save or load preferences. Try selecting the preference
          again.
        </UiText>
      )}
      <SettingsGroup title="Appearance">
        <UiText>Theme</UiText>
        <Segmented
          label="Theme"
          options={themeOptions}
          value={settings.theme}
          onChange={setTheme}
          disabled={!ready}
        />
      </SettingsGroup>

      <SettingsGroup title="Privacy">
        <Switch
          label="Block screenshots"
          description="Protects sensitive screens from screenshots, recordings, and app previews."
          value={settings.screenshotBlocking}
          onChange={setScreenshotBlocking}
          disabled={!ready}
        />
        <View style={[styles.divided, { borderColor: colors.border }]}>
          <UiText>Clear copied secrets</UiText>
          <Segmented
            label="Clear copied secrets"
            options={clipboardOptions}
            value={settings.clipboardSeconds}
            onChange={setClipboardSeconds}
            disabled={!ready}
          />
          <UiText variant="caption" tone="muted">
            {clipboardExpiryDisclosure}
          </UiText>
        </View>
      </SettingsGroup>

      <SettingsGroup title="File names">
        <Switch
          label="Keep original file name"
          description="Uses the original name for single-file encrypted outputs."
          value={settings.keepOriginalName}
          onChange={setKeepOriginalName}
          disabled={!ready}
        />
      </SettingsGroup>

      <View style={styles.about}>
        <UiText accessibilityRole="header" variant="title">
          About X-Files
        </UiText>
        {aboutDisclosures.map(({ title, text }) => (
          <View key={title} style={styles.disclosure}>
            <UiText accessibilityRole="header" style={styles.subheading}>
              {title}
            </UiText>
            <UiText tone="mutedOnPage">{text}</UiText>
          </View>
        ))}
        <View style={styles.licenseButton}>
          <Button
            label={
              showLicenses
                ? 'Hide open-source licenses'
                : 'Open-source licenses'
            }
            icon={showLicenses ? 'expand-less' : 'expand-more'}
            variant="outlined"
            expanded={showLicenses}
            onPress={() => setShowLicenses((value) => !value)}
          />
        </View>
        {showLicenses &&
          localNotices.map(({ name, license }) => (
            <View key={name} style={styles.disclosure}>
              <UiText accessibilityRole="header" style={styles.subheading}>
                {name}
              </UiText>
              <UiText variant="caption" tone="mutedOnPage">
                {license}
              </UiText>
            </View>
          ))}
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  group: { gap: spacing.sm },
  divided: {
    borderTopWidth: metrics.stroke,
    paddingTop: spacing.md,
    gap: spacing.sm,
  },
  about: { gap: spacing.lg, paddingHorizontal: spacing.xs },
  disclosure: { gap: spacing.xs },
  subheading: { fontWeight: '600' },
  licenseButton: { alignItems: 'flex-start' },
});
