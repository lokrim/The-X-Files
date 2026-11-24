import { useState } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';

import { useTheme } from '../theme';
import { layout, metrics, radius, spacing } from '../tokens';
import { Icon } from './icon';
import { UiText } from './text';

export type Segment<T> = {
  value: T;
  label: string;
  accessibilityLabel?: string;
};

export function Segmented<T extends string | number>({
  label,
  options,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  options: readonly Segment<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  const { fontScale } = useWindowDimensions();
  const [width, setWidth] = useState(0);
  const [focus, setFocus] = useState<T | null>(null);
  const stacked = fontScale >= layout.largeFont || width < options.length * 80;

  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      onLayout={({ nativeEvent }) => setWidth(nativeEvent.layout.width)}
      style={[styles.group, { flexDirection: stacked ? 'column' : 'row' }]}
    >
      {options.map((option) => {
        const checked = option.value === value;
        const tone =
          checked && !disabled ? 'primaryText' : disabled ? 'muted' : 'text';
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityLabel={option.accessibilityLabel ?? option.label}
            accessibilityState={{ checked, disabled }}
            onPress={() => onChange(option.value)}
            disabled={disabled}
            onFocus={() => setFocus(option.value)}
            onBlur={() => setFocus(null)}
            style={({ pressed }) => [
              styles.option,
              !stacked && { flex: 1 },
              {
                backgroundColor: checked
                  ? disabled
                    ? colors.border
                    : colors.primary
                  : pressed
                    ? colors.accentSurface
                    : colors.surface,
                borderColor:
                  focus === option.value
                    ? colors.text
                    : checked && !disabled
                      ? colors.primary
                      : colors.controlBorder,
              },
            ]}
          >
            {checked && <Icon name="check" size={16} color={colors[tone]} />}
            <UiText tone={tone} style={styles.label}>
              {option.label}
            </UiText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: spacing.sm },
  option: {
    minHeight: metrics.target,
    minWidth: metrics.target,
    borderWidth: metrics.stroke,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  label: { flexShrink: 1, textAlign: 'center', fontWeight: '600' },
});
