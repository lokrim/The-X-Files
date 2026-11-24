import { StyleSheet, View } from 'react-native';

import { useTheme } from '../theme';
import { metrics, radius, spacing } from '../tokens';
import { UiText } from './text';

export function StepIndicator({
  steps,
  current,
}: {
  steps: readonly string[];
  /** Zero-based index of the active step. */
  current: number;
}) {
  const { colors } = useTheme();
  const title = steps[current];
  if (!title) return null;

  return (
    <View
      accessible
      accessibilityRole="header"
      accessibilityLiveRegion="polite"
      accessibilityLabel={`Step ${current + 1} of ${steps.length}, ${title}`}
      style={styles.container}
    >
      <UiText variant="caption" tone="muted">
        Step {current + 1} of {steps.length}
      </UiText>
      <UiText variant="title">{title}</UiText>
      <View style={styles.track}>
        {steps.map((step, index) => (
          <View
            key={step}
            style={[
              styles.segment,
              {
                backgroundColor:
                  index <= current ? colors.primary : colors.border,
                height: index === current ? spacing.sm : spacing.xs,
                borderWidth: index < current ? metrics.stroke : 0,
                borderColor: colors.primary,
              },
            ]}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.xs },
  track: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  segment: { flex: 1, borderRadius: radius.pill },
});
