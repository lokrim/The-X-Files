import { useRef, type ComponentRef } from 'react';
import {
  AccessibilityInfo,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, { FadeInDown, ReduceMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '../theme';
import { metrics, radius, spacing } from '../tokens';
import { Button } from './button';
import { UiText } from './text';

const enter = FadeInDown.duration(metrics.motionMs).reduceMotion(
  ReduceMotion.System,
);

/** Confirmation with public copy. The caller owns the action and visibility. */
export function Dialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const heading = useRef<ComponentRef<typeof Text>>(null);
  if (!open) return null;

  return (
    <Modal
      transparent
      animationType="none"
      onRequestClose={onCancel}
      onShow={() => {
        if (heading.current)
          AccessibilityInfo.sendAccessibilityEvent(heading.current, 'focus');
      }}
    >
      <ScrollView
        style={{ backgroundColor: colors.scrim }}
        contentContainerStyle={[
          styles.overlay,
          {
            paddingTop: insets.top + spacing.xl,
            paddingBottom: insets.bottom + spacing.xl,
          },
        ]}
      >
        <Animated.View
          entering={enter}
          accessibilityViewIsModal
          style={[styles.panel, { backgroundColor: colors.surface }]}
        >
          <UiText
            ref={heading}
            accessible
            accessibilityRole="header"
            variant="title"
          >
            {title}
          </UiText>
          <UiText>{message}</UiText>
          <View style={styles.actions}>
            <Button label={cancelLabel} variant="text" onPress={onCancel} />
            <Button label={confirmLabel} onPress={onConfirm} />
          </View>
        </Animated.View>
      </ScrollView>
    </Modal>
  );
}
const styles = StyleSheet.create({
  overlay: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
  },
  panel: {
    width: '100%',
    maxWidth: 440,
    borderRadius: radius.sheet,
    padding: spacing.xl,
    gap: spacing.lg,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: spacing.sm,
  },
});
