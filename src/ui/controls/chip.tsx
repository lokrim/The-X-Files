import { StyleSheet, View } from 'react-native';

import { useTheme } from '../theme';
import { radius, spacing } from '../tokens';
import { Icon, type IconName } from './icon';
import { UiText } from './text';

/** A status label. Use Button for an action. */
export function Chip({ label, icon }: { label: string; icon?: IconName }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.chip, { backgroundColor: colors.accentSurface }]}>
      {icon && <Icon name={icon} size={16} color={colors.primary} />}
      <UiText variant="caption" style={styles.label}>
        {label}
      </UiText>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
    maxWidth: '100%',
  },
  label: { flexShrink: 1 },
});
