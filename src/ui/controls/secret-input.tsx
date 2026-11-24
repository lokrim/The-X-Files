import { StyleSheet, TextInput, View } from 'react-native';

import { useTheme } from '../theme';
import { metrics, radius, spacing, typography } from '../tokens';
import { Button } from './button';
import { UiText } from './text';

/** Mount inside SensitiveScreen. The caller owns the draft and reveal state. */
export function SecretInput({
  label,
  value,
  onChange,
  onToggleReveal,
  revealed,
}: {
  label: string;
  value: string;
  onChange: (text: string) => void;
  onToggleReveal: () => void;
  revealed: boolean;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.field}>
      <UiText>{label}</UiText>
      <View style={styles.row}>
        <TextInput
          accessibilityLabel={label}
          accessible={!revealed}
          importantForAccessibility={revealed ? 'no-hide-descendants' : 'auto'}
          allowFontScaling
          autoComplete="off"
          autoCorrect={false}
          autoCapitalize="none"
          contextMenuHidden={revealed}
          disableFullscreenUI
          importantForAutofill="no"
          secureTextEntry={!revealed}
          spellCheck={false}
          textContentType="none"
          value={value}
          onChangeText={onChange}
          selectionColor={colors.primary}
          style={[
            typography.body,
            styles.input,
            { color: colors.text, borderColor: colors.controlBorder },
          ]}
        />
        <Button
          label={`${revealed ? 'Hide' : 'Show'} ${label.toLowerCase()}`}
          icon={revealed ? 'visibility-off' : 'visibility'}
          iconOnly
          variant="outlined"
          onPress={onToggleReveal}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  input: {
    flex: 1,
    minWidth: metrics.target,
    minHeight: metrics.target,
    borderWidth: metrics.stroke,
    borderRadius: radius.card,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
});
