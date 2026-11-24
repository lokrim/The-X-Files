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

export function useScreenContainerInsets() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const gutter = width < 380 ? spacing.lg : spacing.xl;
  return {
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxl + insets.bottom,
    paddingLeft: gutter + insets.left,
    paddingRight: gutter + insets.right,
  };
}

export function ScreenContainer({ children }: { children: ReactNode }) {
  const insets = useScreenContainerInsets();
  const { colors } = useTheme();

  return (
    <ScrollView
      style={{ backgroundColor: colors.bg }}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={insets}
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
