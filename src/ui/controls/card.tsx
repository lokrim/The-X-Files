import { useState, type ReactNode } from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '../theme';
import { lightShadow, metrics, radius, spacing } from '../tokens';

type CardProps = {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
} & (
  | { label: string; disabled?: boolean; onPress?: () => void }
  | { label?: never; disabled?: never; onPress?: never }
);

export function Card({
  children,
  style,
  label,
  disabled = false,
  onPress,
}: CardProps) {
  const { colors, scheme } = useTheme();
  const [focused, setFocused] = useState(false);
  const surface: ViewStyle = {
    backgroundColor: colors.surface,
    borderColor: focused ? colors.primary : colors.border,
    borderWidth: metrics.stroke,
    borderRadius: radius.card,
    boxShadow: scheme === 'light' ? lightShadow : undefined,
    padding: spacing.lg,
    gap: spacing.md,
  };

  if (!label) return <View style={[surface, style]}>{children}</View>;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={({ pressed }) => [
        surface,
        style,
        { minHeight: metrics.target, minWidth: metrics.target },
        pressed && { backgroundColor: colors.accentSurface },
      ]}
    >
      {children}
    </Pressable>
  );
}
