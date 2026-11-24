import { useEffect, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';

import {
  offlineDisclosure,
  partialFileDisclosure,
} from '@/features/settings/about-copy';
import { Button } from '@/ui/controls/button';
import { Card } from '@/ui/controls/card';
import { Icon, type IconName } from '@/ui/controls/icon';
import { Progress } from '@/ui/controls/progress';
import { useScreenContainerInsets } from '@/ui/controls/screen-container';
import { SecretInput } from '@/ui/controls/secret-input';
import { Segmented } from '@/ui/controls/segmented';
import { SensitiveScreen } from '@/ui/controls/sensitive-screen';
import { StepIndicator } from '@/ui/controls/step-indicator';
import { Stepper } from '@/ui/controls/stepper';
import { UiText } from '@/ui/controls/text';
import { useTheme } from '@/ui/theme';
import { layout, spacing } from '@/ui/tokens';
import type { EncryptFlow } from './use-encrypt-flow';
import {
  formatBytes,
  passwordPolicy,
  protectionOptions,
  type ProtectionChoice,
} from './workflow';

const steps = ['Files', 'Protection', 'Review'] as const;
type FilesProps = Pick<
  EncryptFlow,
  | 'sources'
  | 'selection'
  | 'activity'
  | 'message'
  | 'removeSource'
  | 'addSources'
  | 'forward'
>;

function fileIcon(name: string): IconName {
  const ext = name.split('.').at(-1)?.toLowerCase() ?? '';
  if (['mp4', 'webm', 'mkv', 'mov', 'avi'].includes(ext)) return 'movie';
  if (['mp3', 'wav', 'm4a', 'ogg', 'flac'].includes(ext)) return 'audiotrack';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic'].includes(ext))
    return 'image';
  if (['zip', '7z', 'rar', 'tar'].includes(ext)) return 'archive';
  return 'insert-drive-file';
}

export function FilesStep({
  sources,
  selection,
  activity,
  message,
  removeSource,
  addSources,
  forward,
}: FilesProps) {
  const insets = useScreenContainerInsets();
  const { colors } = useTheme();
  const plan = selection.plan;
  return (
    <FlatList
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={[insets, styles.listContent]}
      data={sources}
      keyExtractor={(item) => String(item.id)}
      ListHeaderComponent={
        <View style={styles.group}>
          <StepIndicator steps={steps} current={0} />
          <Button
            label="Add files"
            icon="add"
            onPress={addSources}
            disabled={activity !== null}
          />
          {message && <Notice message={message} />}
        </View>
      }
      ListEmptyComponent={
        <UiText tone="mutedOnPage">Choose one or more files to encrypt.</UiText>
      }
      renderItem={({ item, index }) => {
        const name =
          plan?.zip?.entries[index]?.name ?? item.name.normalize('NFC');
        return (
          <Card style={styles.fileRow}>
            <Icon name={fileIcon(name)} color={colors.primary} />
            <View style={styles.fileDetails}>
              <UiText numberOfLines={2}>{name}</UiText>
              <UiText variant="caption" tone="muted">
                {formatBytes(item.size)}
              </UiText>
            </View>
            <Button
              label={`Remove ${name}`}
              icon="close"
              iconOnly
              variant="text"
              disabled={activity !== null}
              onPress={() => removeSource(item.id)}
            />
          </Card>
        );
      }}
      ListFooterComponent={
        <View style={styles.group}>
          {plan && (
            <>
              <UiText>
                {sources.length} {sources.length === 1 ? 'file' : 'files'} ·{' '}
                {formatBytes(plan.zip?.dataSize ?? plan.payloadBytes)}
              </UiText>
              {plan.zip && (
                <UiText>These files will be bundled into one ZIP.</UiText>
              )}
              <UiText variant="caption" tone="mutedOnPage">
                Free space is checked after you choose a destination.
              </UiText>
            </>
          )}
          <Button
            label="Next"
            onPress={forward}
            disabled={!plan || activity !== null}
          />
        </View>
      }
    />
  );
}

type PasswordProps = Pick<
  EncryptFlow,
  | 'password'
  | 'confirmation'
  | 'passwordStatus'
  | 'setPassword'
  | 'setConfirmation'
>;

function PasswordFields({
  password,
  confirmation,
  passwordStatus,
  setPassword,
  setConfirmation,
}: PasswordProps) {
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const { strength, error } = passwordStatus;
  return (
    <Card>
      <SecretInput
        label="Password"
        value={password}
        onChange={setPassword}
        revealed={showPassword}
        onToggleReveal={() => setShowPassword(!showPassword)}
      />
      <SecretInput
        label="Confirm password"
        value={confirmation}
        onChange={setConfirmation}
        revealed={showConfirmation}
        onToggleReveal={() => setShowConfirmation(!showConfirmation)}
      />
      <UiText variant="caption" tone="muted">
        {passwordPolicy}
      </UiText>
      {strength && (
        <Progress
          label={`Password strength · ${strength}`}
          value={{ weak: 1 / 3, fair: 2 / 3, strong: 1 }[strength]}
        />
      )}
      {strength === 'weak' && (
        <Notice message="This password may be easy to guess. A longer, less predictable password is safer." />
      )}
      {error && <Notice message={error} />}
    </Card>
  );
}

function ShareOptions({
  choice,
  setTotal,
  setThreshold,
}: {
  choice: Extract<ProtectionChoice, { mode: 'shares' }>;
  setTotal: EncryptFlow['setTotal'];
  setThreshold: EncryptFlow['setThreshold'];
}) {
  const { total, threshold } = choice;
  return (
    <Card>
      <Stepper
        label="Total shares"
        value={total}
        min={2}
        max={16}
        onChange={setTotal}
      />
      <Stepper
        label="Shares needed"
        value={threshold}
        min={2}
        max={total}
        onChange={setThreshold}
      />
      <UiText accessibilityLiveRegion="polite">
        Any {threshold} of {total} shares unlock your files. {threshold - 1}{' '}
        {threshold === 2 ? 'share reveals' : 'shares reveal'} nothing about the
        shared key.
      </UiText>
      <UiText variant="caption" tone="muted">
        The full key is never shown.
      </UiText>
      {threshold === total && (
        <Notice message="Every share is required. Losing even one makes the file unrecoverable." />
      )}
      {threshold === 2 && total >= 8 && (
        <Notice message="Any two people with shares can open the file. Consider raising the number needed." />
      )}
    </Card>
  );
}

export function ProtectionStep({
  focused,
  choice,
  passwordFields,
  changeMode,
  setTotal,
  setThreshold,
  forward,
}: {
  focused: boolean;
  choice: ProtectionChoice;
  passwordFields: PasswordProps;
  changeMode: EncryptFlow['changeMode'];
  setTotal: EncryptFlow['setTotal'];
  setThreshold: EncryptFlow['setThreshold'];
  forward: EncryptFlow['forward'];
}) {
  return (
    <>
      <StepIndicator steps={steps} current={1} />
      <Segmented
        label="Protection"
        value={choice.mode}
        options={protectionOptions}
        onChange={changeMode}
      />
      {choice.mode === 'shares' && (
        <ShareOptions
          choice={choice}
          setTotal={setTotal}
          setThreshold={setThreshold}
        />
      )}
      {choice.mode === 'key' && (
        <Card>
          <UiText>
            Anyone with the key can open the encrypted file. Save the key
            somewhere safe.
          </UiText>
        </Card>
      )}
      {choice.mode === 'password' && (
        <SensitiveScreen
          focused={focused}
          render={() => <PasswordFields {...passwordFields} />}
        />
      )}
      <Button
        label="Next"
        onPress={forward}
        disabled={
          choice.mode === 'password' && !passwordFields.passwordStatus.valid
        }
      />
    </>
  );
}

export function ReviewStep({ flow }: { flow: EncryptFlow }) {
  const plan = flow.selection.plan;
  if (!plan) return null;
  const mode = flow.protection;
  return (
    <>
      <StepIndicator steps={steps} current={2} />
      <Card>
        <UiText variant="title">
          {flow.sources.length} {flow.sources.length === 1 ? 'file' : 'files'} ·{' '}
          {formatBytes(plan.payloadBytes)} payload
        </UiText>
        <UiText>Encrypted output · {formatBytes(plan.totalSize)}</UiText>
        <UiText>
          {mode.mode === 'shares'
            ? `Shares · ${mode.threshold} of ${mode.total} required`
            : mode.mode === 'key'
              ? 'Key'
              : 'Password'}
        </UiText>
        {plan.zip && (
          <UiText variant="caption" tone="muted">
            X-Files prepares a private plaintext ZIP (
            {formatBytes(plan.zip.totalSize)}). It deletes the temporary ZIP
            after use. Deletion from flash storage is best effort.
          </UiText>
        )}
      </Card>
      <Card>
        <UiText variant="title">
          {flow.destination?.label ?? 'Destination'}
        </UiText>
        <UiText>
          Choose destination before Encrypt. X-Files creates a new file.
        </UiText>
        <Button
          label={flow.destination ? 'Change destination' : 'Choose destination'}
          onPress={flow.selectDestination}
          variant="outlined"
          disabled={flow.activity !== null}
        />
        {flow.capacity === 'available' && (
          <UiText>
            Free space checked with storage reserve
            {plan.zip ? ' for the ZIP and destination' : ''}.
          </UiText>
        )}
        {flow.capacity === 'unknown' && (
          <Notice message="This provider did not report free space. Encryption may run out of space." />
        )}
        {flow.message && <Notice message={flow.message} />}
      </Card>
      <Button
        label="Encrypt"
        icon="lock-outline"
        onPress={flow.encrypt}
        disabled={
          !flow.destination ||
          flow.capacity === 'blocked' ||
          flow.activity !== null
        }
      />
      <Disclosures />
    </>
  );
}

export function Notice({ message }: { message: string }) {
  return <UiText accessibilityLiveRegion="polite">{message}</UiText>;
}

function Disclosures() {
  return (
    <View style={styles.group}>
      <UiText variant="caption" tone="mutedOnPage">
        {partialFileDisclosure}
      </UiText>
      <UiText variant="caption" tone="mutedOnPage">
        {offlineDisclosure}
      </UiText>
    </View>
  );
}

export function WorkProgress({
  label,
  startedAt,
  progress,
}: {
  label: string;
  startedAt: EncryptFlow['startedAt'];
  progress: EncryptFlow['progress'];
}) {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(performance.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  return (
    <>
      <Progress label={label} value={progress?.fraction} />
      <UiText variant="caption" tone="muted">
        {Math.floor(seconds / 60)} min {seconds % 60} s elapsed
        {progress ? ` · ${progress.speed.toFixed(1)} MB/s` : ''}
      </UiText>
    </>
  );
}

export function CleanupStatus({ failed }: { failed: boolean }) {
  return failed ? (
    <Notice message="X-Files could not verify deletion of every temporary or partial file. If you see a partial file at the destination, delete it yourself." />
  ) : null;
}

export function WorkStep({ flow }: { flow: EncryptFlow }) {
  const stage = flow.phase;
  const label =
    stage === 'deriving'
      ? 'Deriving key...'
      : stage === 'running'
        ? 'Encrypting...'
        : flow.selection.plan?.zip
          ? 'Preparing ZIP'
          : 'Preparing encryption...';
  return (
    <>
      <Card>
        <WorkProgress
          label={flow.cancelling ? 'Cancelling and cleaning up...' : label}
          startedAt={flow.startedAt}
          progress={flow.progress}
        />
        {!flow.notifications && (
          <Notice message="Android job notifications are disabled. Encryption can continue in the background." />
        )}
        <ScryptStatus status={flow.scrypt} />
        <Button
          label="Cancel"
          variant="outlined"
          disabled={flow.cancelling}
          onPress={flow.cancel}
        />
      </Card>
      <Disclosures />
    </>
  );
}

function ScryptStatus({ status }: { status: EncryptFlow['scrypt'] }) {
  if (!status) return null;
  return (
    <Notice
      message={
        status.pending
          ? 'The app stopped waiting for the key. Android is still finishing the key derivation.'
          : `The native derivation returned ${Math.round(status.callbackLatencyMs)} ms after cancellation. The returned buffers have been cleared.`
      }
    />
  );
}

export function TerminalStep({ flow }: { flow: EncryptFlow }) {
  return (
    <>
      <Card>
        <UiText accessibilityRole="header" variant="title">
          {flow.phase === 'cancelled'
            ? 'Encryption cancelled'
            : 'Encryption could not finish'}
        </UiText>
        {flow.message && <Notice message={flow.message} />}
        <CleanupStatus failed={flow.cleanupFailed} />
        <ScryptStatus status={flow.scrypt} />
        <Button
          label={
            flow.protection.mode === 'password'
              ? 'Back to protection'
              : 'Back to review'
          }
          onPress={flow.back}
          disabled={flow.scrypt?.pending === true}
        />
        <Button
          label="Select files again"
          variant="outlined"
          onPress={flow.chooseFilesAgain}
          disabled={flow.scrypt?.pending === true}
        />
      </Card>
      <Disclosures />
    </>
  );
}

const styles = StyleSheet.create({
  listContent: {
    width: '100%',
    maxWidth: layout.contentWidth,
    alignSelf: 'center',
    gap: spacing.md,
  },
  group: { gap: spacing.md },
  fileRow: { flexDirection: 'row', alignItems: 'center' },
  fileDetails: { flex: 1 },
});
