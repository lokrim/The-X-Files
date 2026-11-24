import { StyleSheet, View } from 'react-native';

import { spacing } from '../tokens';
import { Button } from './button';
import { Card } from './card';
import { UiText } from './text';

/** Mount inside SensitiveScreen. Only the revealed branch calls the formatter. */
export function SecretValue({
  label,
  renderValue,
  revealed,
  secondsLeft,
  onToggleReveal,
  onHoldStart,
  onHoldEnd,
  onCopy,
  onShare,
  disabled = false,
}: {
  label: string;
  renderValue: () => string;
  revealed: boolean;
  secondsLeft: number | null;
  onToggleReveal: () => void;
  onHoldStart: () => void;
  onHoldEnd: () => void;
  onCopy: () => void;
  onShare?: () => void;
  disabled?: boolean;
}) {
  return (
    <Card>
      <UiText variant="title" accessibilityRole="header">
        {label}
      </UiText>
      {revealed ? (
        <View
          accessible={false}
          importantForAccessibility="no-hide-descendants"
        >
          <UiText variant="mono" selectable={false}>
            {renderValue()}
          </UiText>
        </View>
      ) : (
        <UiText tone="muted">Hidden</UiText>
      )}
      {revealed && (
        <UiText variant="caption" tone="muted" accessibilityLiveRegion="polite">
          {secondsLeft === null
            ? 'Revealed while held'
            : `Hides in ${secondsLeft} ${secondsLeft === 1 ? 'second' : 'seconds'}`}
        </UiText>
      )}
      <View style={styles.actions}>
        <Button
          label={`${revealed ? 'Hide' : 'Reveal'} ${label.toLowerCase()}`}
          icon={revealed ? 'visibility-off' : 'visibility'}
          variant="outlined"
          disabled={disabled}
          onPress={onToggleReveal}
        />
        <Button
          label={`Hold to reveal ${label.toLowerCase()}`}
          variant="text"
          disabled={disabled}
          onPressIn={onHoldStart}
          onPressOut={onHoldEnd}
        />
        <Button
          label={`Copy ${label.toLowerCase()}`}
          icon="content-copy"
          disabled={disabled}
          onPress={onCopy}
        />
        {onShare && (
          <Button
            label={`Share ${label.toLowerCase()}`}
            icon="share"
            variant="outlined"
            disabled={disabled}
            onPress={onShare}
          />
        )}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
