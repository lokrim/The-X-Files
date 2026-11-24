import { StyleSheet, View } from 'react-native';

import { useTheme } from '../theme';
import { radius, spacing } from '../tokens';
import { UiText } from './text';

export function Progress({
  label,
  value,
}: {
  label: string;
  value?: number | undefined;
}) {
  const { colors } = useTheme();
  const percent =
    value === undefined || !Number.isFinite(value)
      ? undefined
      : Math.round(Math.max(0, Math.min(1, value)) * 100);

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={
        percent === undefined
          ? { text: 'In progress' }
          : { min: 0, max: 100, now: percent }
      }
      style={styles.group}
    >
      <View style={styles.row}>
        <UiText style={styles.label}>{label}</UiText>
        {percent !== undefined && <UiText>{percent}%</UiText>}
      </View>
      <View style={[styles.track, { backgroundColor: colors.border }]}>
        <View
          style={[
            styles.track,
            {
              backgroundColor: colors.primary,
              width: percent === undefined ? '25%' : `${percent}%`,
            },
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: spacing.sm },
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  label: { flexShrink: 1 },
  track: { height: spacing.sm, borderRadius: radius.pill },
});
