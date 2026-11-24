import type { ReactNode } from 'react';
import {
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '../theme';
import { layout, spacing } from '../tokens';

export function ScreenContainer({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { colors } = useTheme();
  const gutter = width < 380 ? spacing.lg : spacing.xl;

  return (
    <ScrollView
      style={{ backgroundColor: colors.bg }}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{
        paddingTop: spacing.xl,
        paddingBottom: spacing.xxl + insets.bottom,
        paddingLeft: gutter + insets.left,
        paddingRight: gutter + insets.right,
      }}
    >
      <View style={styles.content}>{children}</View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    width: '100%',
    maxWidth: layout.contentWidth,
    alignSelf: 'center',
    gap: spacing.xl,
  },
});
