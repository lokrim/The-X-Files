import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Link } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/ui/theme';
import { lightShadow, metrics, radius, spacing, typography } from '@/ui/tokens';

export default function Home() {
  const { colors, scheme } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{
        padding: spacing.xl,
        paddingBottom: spacing.xl + insets.bottom,
        gap: spacing.xl,
      }}
    >
      <View style={{ gap: spacing.sm }}>
        <Text style={{ ...typography.display, color: colors.text }}>
          Offline file encryption
        </Text>
        <Text style={{ ...typography.caption, color: colors.muted }}>
          Offline · No accounts · No tracking
        </Text>
      </View>
      {(['Encrypt', 'Decrypt'] as const).map((label) => (
        <View
          key={label}
          accessibilityState={{ disabled: true }}
          style={{
            backgroundColor: colors.surface,
            padding: spacing.xl,
            borderRadius: radius.card,
            borderCurve: 'continuous',
            gap: spacing.md,
            borderWidth: metrics.stroke,
            borderColor: colors.border,
            boxShadow: scheme === 'light' ? lightShadow : undefined,
          }}
        >
          <MaterialIcons
            name={label === 'Encrypt' ? 'lock-outline' : 'lock-open'}
            size={metrics.icon}
            color={colors.primary}
          />
          <Text style={{ ...typography.title, color: colors.text }}>
            {label}
          </Text>
          <Text style={{ ...typography.body, color: colors.muted }}>
            Not available yet
          </Text>
        </View>
      ))}
      <Text style={{ ...typography.body, color: colors.text }}>
        No practical size limit (up to 1 TiB per file).
      </Text>
      <Link href="/settings" asChild>
        <Pressable
          accessibilityRole="button"
          style={({ pressed }) => ({
            minHeight: metrics.target,
            justifyContent: 'center',
            opacity: pressed ? metrics.pressedOpacity : 1,
          })}
        >
          <Text style={{ ...typography.body, color: colors.primary }}>
            Settings
          </Text>
        </Pressable>
      </Link>
      <Text style={{ ...typography.caption, color: colors.muted }}>
        X-Files makes no network connections itself; apps you choose to save to
        or share with may.
      </Text>
    </ScrollView>
  );
}
