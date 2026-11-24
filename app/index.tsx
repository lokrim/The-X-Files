import { useRouter } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { StyleSheet, View, useWindowDimensions } from 'react-native';

import { Button } from '@/ui/controls/button';
import { Card } from '@/ui/controls/card';
import { Chip } from '@/ui/controls/chip';
import { Icon } from '@/ui/controls/icon';
import { ScreenContainer } from '@/ui/controls/screen-container';
import { UiText } from '@/ui/controls/text';
import { useTheme } from '@/ui/theme';
import { layout, metrics, radius, spacing } from '@/ui/tokens';
import { offlineDisclosure } from '@/features/settings/about-copy';

const actions = [
  {
    title: 'Encrypt',
    description: 'Protect files with a key, shares, or a password.',
    icon: 'lock-outline',
  },
  {
    title: 'Decrypt',
    description: 'Open an encrypted .xfile with its recovery information.',
    icon: 'lock-open',
  },
] as const;

export default function Home() {
  const router = useRouter();
  const { colors } = useTheme();
  const { width, fontScale } = useWindowDimensions();
  const wide = width >= layout.wide && fontScale < layout.largeFont;

  return (
    <ScreenContainer>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Button
              label="Settings"
              icon="settings"
              iconOnly
              variant="text"
              onPress={() => router.push('/settings')}
            />
          ),
        }}
      />
      <View style={styles.intro}>
        <UiText accessibilityRole="header" variant="display">
          Offline file encryption
        </UiText>
        <Chip label="Offline · No accounts · No tracking" icon="shield" />
      </View>
      <View style={[styles.actions, wide && styles.wideActions]}>
        {actions.map(({ title, description, icon }) => (
          <Card
            key={title}
            label={`${title}, ${description} Not available yet.`}
            disabled
            style={wide && styles.wideCard}
          >
            <View style={styles.action}>
              <View
                style={[styles.icon, { backgroundColor: colors.accentSurface }]}
              >
                <Icon name={icon} color={colors.primary} size={metrics.icon} />
              </View>
              <View style={styles.details}>
                <UiText variant="title">{title}</UiText>
                <UiText tone="muted">{description}</UiText>
                <UiText variant="caption" tone="muted">
                  Not available yet
                </UiText>
              </View>
            </View>
          </Card>
        ))}
      </View>
      <View style={[styles.notes, { borderColor: colors.border }]}>
        <UiText>No practical size limit (up to 1 TiB per file).</UiText>
        <UiText variant="caption" tone="mutedOnPage">
          {offlineDisclosure}
        </UiText>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  intro: { alignItems: 'flex-start', gap: spacing.md },
  actions: { gap: spacing.md },
  wideActions: { flexDirection: 'row' },
  wideCard: { flex: 1 },
  action: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  icon: {
    width: metrics.target,
    height: metrics.target,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.card,
  },
  details: { gap: spacing.xs, flex: 1 },
  notes: {
    gap: spacing.sm,
    borderTopWidth: metrics.stroke,
    paddingTop: spacing.lg,
  },
});
