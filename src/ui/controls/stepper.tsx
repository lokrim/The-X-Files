import { StyleSheet, View } from 'react-native';

import { spacing } from '../tokens';
import { Button } from './button';
import { UiText } from './text';

export function Stepper({
  label,
  value,
  min,
  max,
  onChange,
  disabled = false,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.container}>
      <UiText variant="title" style={styles.label}>
        {label}
      </UiText>
      <View style={styles.controls}>
        <Button
          label={`Decrease ${label}`}
          icon="remove"
          iconOnly
          variant="outlined"
          disabled={disabled || value <= min}
          onPress={() => onChange(value - 1)}
        />
        <UiText
          accessibilityLabel={`${label}, ${value}`}
          accessibilityLiveRegion="polite"
        >
          {value}
        </UiText>
        <Button
          label={`Increase ${label}`}
          icon="add"
          iconOnly
          variant="outlined"
          disabled={disabled || value >= max}
          onPress={() => onChange(value + 1)}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.md,
  },
  label: { flexGrow: 1, flexShrink: 1 },
  controls: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
});
