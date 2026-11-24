import { Checkbox, Host } from '@expo/ui';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useSecretCopy } from '@/features/privacy/use-secret-copy';
import { useSecretReveal } from '@/features/privacy/use-secret-reveal';
import { offlineDisclosure } from '@/features/settings/about-copy';
import { clipboardExpiryDisclosure } from '@/platform/clipboard';
import { Button } from '@/ui/controls/button';
import { Card } from '@/ui/controls/card';
import { Chip } from '@/ui/controls/chip';
import { ScreenContainer } from '@/ui/controls/screen-container';
import { SecretValue } from '@/ui/controls/secret-value';
import { SensitiveScreen } from '@/ui/controls/sensitive-screen';
import { UiText } from '@/ui/controls/text';
import { Toast } from '@/ui/controls/toast';
import { useTheme } from '@/ui/theme';
import { layout, metrics, spacing } from '@/ui/tokens';
import { useState } from 'react';

import { CleanupStatus, Notice, WorkProgress } from './encrypt-steps';
import type { RecoveryCard } from './recovery';
import type { EncryptFlow } from './use-encrypt-flow';
import { acknowledgements, formatBytes, keepOpenMessage } from './workflow';

function SecretCard({
  card,
  busy,
  share,
}: {
  card: RecoveryCard;
  busy: boolean;
  share: EncryptFlow['share'];
}) {
  const reveal = useSecretReveal();
  const copy = useSecretCopy();
  const [feedback, setFeedback] = useState<string | null>(null);
  async function copyValue() {
    const text = card.read();
    if (text) setFeedback(await copy(text));
  }
  return (
    <View style={styles.group}>
      <SecretValue
        label={card.label}
        renderValue={() => card.read() ?? ''}
        onCopy={copyValue}
        onShare={() => void share(card.read)}
        disabled={busy}
        {...reveal}
      />
      {feedback && <Toast message={feedback} />}
    </View>
  );
}

export function EncryptResultScreen({
  flow,
  focused,
  onDone,
}: {
  flow: EncryptFlow;
  focused: boolean;
  onDone: () => void;
}) {
  const { colors, scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const result = flow.result;
  if (!result) return null;
  const { recovery, savedTo, fileName, byteSize } = result;
  const busy = flow.activity !== null;

  return (
    <View style={styles.screen}>
      <ScreenContainer>
        <Card>
          <UiText accessibilityRole="header" variant="title">
            Saved to {savedTo}
          </UiText>
          <UiText>
            {fileName ?? 'Encrypted file'} · {formatBytes(byteSize)}
          </UiText>
          <View style={styles.actions}>
            <Button
              label="Share file"
              icon="share"
              onPress={() => void flow.share()}
              disabled={busy}
            />
            <Button
              label="Save a copy"
              icon="content-copy"
              variant="outlined"
              onPress={flow.copy}
              disabled={busy}
            />
          </View>
          {flow.activity === 'copy' && flow.startedAt > 0 && (
            <>
              <WorkProgress
                label={
                  flow.cancelling
                    ? 'Cancelling and cleaning up...'
                    : 'Saving a copy...'
                }
                startedAt={flow.startedAt}
                progress={flow.progress}
              />
              <Button
                label="Cancel copy"
                variant="text"
                onPress={flow.cancel}
                disabled={flow.cancelling}
              />
            </>
          )}
          {flow.message && <Notice message={flow.message} />}
          <CleanupStatus failed={flow.cleanupFailed} />
        </Card>

        {recovery.mode === 'password' ? (
          <UiText>Your password cannot be recovered.</UiText>
        ) : (
          <>
            {recovery.setId && (
              <View style={styles.group}>
                <Chip label={`Share set ${recovery.setId}`} />
                <UiText variant="caption" tone="mutedOnPage">
                  Use the set ID to group shares. Different sets can have the
                  same ID.
                </UiText>
              </View>
            )}
            <SensitiveScreen
              focused={focused}
              render={() => (
                <View style={styles.cards}>
                  {recovery.cards.map((card) => (
                    <SecretCard
                      key={card.label}
                      card={card}
                      busy={busy}
                      share={flow.share}
                    />
                  ))}
                </View>
              )}
            />
            <UiText variant="caption" tone="mutedOnPage">
              {clipboardExpiryDisclosure}
            </UiText>
          </>
        )}
        <UiText variant="caption" tone="mutedOnPage">
          {offlineDisclosure}
        </UiText>
      </ScreenContainer>
      <View
        style={[
          styles.footer,
          { backgroundColor: colors.surface, borderColor: colors.border },
        ]}
      >
        <View
          style={[
            styles.footerContent,
            {
              paddingBottom: insets.bottom + spacing.md,
              paddingLeft: insets.left + spacing.lg,
              paddingRight: insets.right + spacing.lg,
            },
          ]}
        >
          <UiText>{keepOpenMessage}</UiText>
          <Host
            matchContents={{ vertical: true }}
            colorScheme={scheme}
            seedColor={colors.primary}
          >
            <Checkbox
              label={acknowledgements[recovery.mode]}
              value={flow.acknowledged}
              onValueChange={flow.setAcknowledged}
            />
          </Host>
          <Button
            label="Done"
            onPress={onDone}
            disabled={!flow.acknowledged || busy}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  group: { alignItems: 'flex-start', gap: spacing.sm },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  cards: { gap: spacing.lg },
  footer: { borderTopWidth: metrics.stroke },
  footerContent: {
    width: '100%',
    maxWidth: layout.contentWidth,
    alignSelf: 'center',
    paddingTop: spacing.md,
    gap: spacing.xs,
  },
});
