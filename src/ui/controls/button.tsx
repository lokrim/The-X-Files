import { Pressable, StyleSheet, type PressableProps } from 'react-native';
import { useState } from 'react';

import { useTheme } from '../theme';
import { metrics, radius, spacing } from '../tokens';
import { Icon, type IconName } from './icon';
import { UiText } from './text';

export function Button({
  label,
  icon,
  iconOnly = false,
  variant = 'filled',
  disabled = false,
  expanded,
  onPress,
  onPressIn,
  onPressOut,
  testID,
}: {
  label: string;
  icon?: IconName;
  iconOnly?: boolean;
  variant?: 'filled' | 'outlined' | 'text';
  disabled?: boolean;
  expanded?: boolean;
  onPress?: PressableProps['onPress'];
  onPressIn?: PressableProps['onPressIn'];
  onPressOut?: PressableProps['onPressOut'];
  testID?: string;
}) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  const filled = variant === 'filled';
  const tone = disabled ? 'muted' : filled ? 'primaryText' : 'primary';

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={
        expanded === undefined ? { disabled } : { disabled, expanded }
      }
      disabled={disabled}
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={({ pressed }) => [
        styles.target,
        {
          paddingHorizontal: iconOnly ? spacing.sm : spacing.lg,
          backgroundColor: filled
            ? disabled
              ? colors.border
              : colors.primary
            : pressed || focused
              ? colors.accentSurface
              : 'transparent',
          borderColor: focused
            ? colors.text
            : variant === 'outlined'
              ? colors.controlBorder
              : 'transparent',
          opacity: filled && pressed ? metrics.pressedOpacity : 1,
        },
      ]}
    >
      {icon && <Icon name={icon} color={colors[tone]} />}
      {!iconOnly && (
        <UiText tone={tone} style={styles.label}>
          {label}
        </UiText>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  target: {
    minWidth: metrics.target,
    minHeight: metrics.target,
    borderRadius: radius.pill,
    borderWidth: metrics.stroke,
    paddingVertical: spacing.xs,
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { flexShrink: 1, fontWeight: '600', textAlign: 'center' },
});
