import { Host, Switch as NativeSwitch } from '@expo/ui';
import { View } from 'react-native';

import { useTheme } from '../theme';
import { spacing } from '../tokens';
import { UiText } from './text';

export function Switch({
  label,
  description,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  description?: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  const { scheme, colors } = useTheme();
  return (
    <View style={{ gap: spacing.xs }}>
      <Host
        colorScheme={scheme}
        seedColor={colors.primary}
        matchContents={{ vertical: true }}
      >
        <NativeSwitch
          label={label}
          value={value}
          onValueChange={onChange}
          disabled={disabled}
        />
      </Host>
      {description && (
        <UiText variant="caption" tone="muted">
          {description}
        </UiText>
      )}
    </View>
  );
}
