import type { ComponentPropsWithRef } from 'react';
import { Text } from 'react-native';

import { useTheme } from '../theme';
import { typography } from '../tokens';

export function UiText({
  variant = 'body',
  tone = 'text',
  style,
  ...props
}: ComponentPropsWithRef<typeof Text> & {
  variant?: keyof typeof typography;
  tone?: keyof ReturnType<typeof useTheme>['colors'];
}) {
  const { colors } = useTheme();
  return (
    <Text
      {...props}
      style={[typography[variant], { color: colors[tone] }, style]}
    />
  );
}
