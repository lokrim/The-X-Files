import Animated, { FadeInDown, ReduceMotion } from 'react-native-reanimated';

import { useTheme } from '../theme';
import { metrics, radius, spacing } from '../tokens';
import { UiText } from './text';

const enter = FadeInDown.duration(metrics.motionMs).reduceMotion(
  ReduceMotion.System,
);

/** Transient public feedback. The caller owns visibility and timing. */
export function Toast({ message }: { message: string }) {
  const { colors } = useTheme();
  return (
    <Animated.View
      entering={enter}
      style={{
        backgroundColor: colors.text,
        paddingVertical: spacing.sm,
        paddingHorizontal: spacing.lg,
        borderRadius: radius.card,
      }}
    >
      <UiText tone="bg" accessibilityLiveRegion="polite">
        {message}
      </UiText>
    </Animated.View>
  );
}
