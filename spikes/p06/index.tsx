import { registerRootComponent } from 'expo';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { useSecretCopy } from '@/features/privacy/use-secret-copy';
import { useSecretReveal } from '@/features/privacy/use-secret-reveal';
import { playHaptic } from '@/platform/haptics';
import { ScreenPrivacy } from '@/platform/screen-privacy';
import type { ThemePreference } from '@/store/settings-store';
import { Button } from '@/ui/controls/button';
import { Card } from '@/ui/controls/card';
import { Chip } from '@/ui/controls/chip';
import { Dialog } from '@/ui/controls/dialog';
import { Progress } from '@/ui/controls/progress';
import { ScreenContainer } from '@/ui/controls/screen-container';
import { SecretInput } from '@/ui/controls/secret-input';
import { SecretValue } from '@/ui/controls/secret-value';
import { Segmented } from '@/ui/controls/segmented';
import { SensitiveScreen } from '@/ui/controls/sensitive-screen';
import { StepIndicator } from '@/ui/controls/step-indicator';
import { Stepper } from '@/ui/controls/stepper';
import { Switch } from '@/ui/controls/switch';
import { UiText } from '@/ui/controls/text';
import { Toast } from '@/ui/controls/toast';
import { ThemeProvider, useTheme } from '@/ui/theme';
import { spacing } from '@/ui/tokens';

const modes = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
] as const;

const publicFixture = 'PUBLIC-P06-FIXTURE-ONLY';

function PrivacyFixture({
  draft,
  setDraft,
}: {
  draft: string;
  setDraft: (value: string) => void;
}) {
  const reveal = useSecretReveal();
  const copy = useSecretCopy();
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [feedback, setFeedback] = useState('');

  return (
    <View style={{ gap: spacing.md }}>
      <SecretInput
        label="Example password"
        value={draft}
        onChange={setDraft}
        revealed={passwordVisible}
        onToggleReveal={() => {
          if (!passwordVisible) playHaptic('reveal');
          setPasswordVisible(!passwordVisible);
        }}
      />
      <SecretValue
        label="Example key"
        renderValue={() => publicFixture}
        {...reveal}
        onCopy={() => void copy(publicFixture).then(setFeedback)}
      />
      {!!feedback && <Toast message={feedback} />}
    </View>
  );
}

function Gallery({
  preference,
  setPreference,
}: {
  preference: ThemePreference;
  setPreference: (value: ThemePreference) => void;
}) {
  const { scheme, colors } = useTheme();
  const [dialog, setDialog] = useState(false);
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState('');
  const [blocking, setBlocking] = useState(true);
  const [notice, setNotice] = useState(false);
  return (
    <SafeAreaView
      edges={['top']}
      style={{ flex: 1, backgroundColor: colors.bg }}
    >
      <StatusBar style={scheme === 'light' ? 'dark' : 'light'} />
      <ScreenPrivacy blocking={blocking}>
        <ScreenContainer>
          <UiText accessibilityRole="header" variant="display">
            P06 component gallery
          </UiText>
          <Segmented
            label="Theme"
            options={modes}
            value={preference}
            onChange={setPreference}
          />
          <Card>
            <Chip label="Local QA fixture" icon="shield" />
            <StepIndicator
              steps={['Files', 'Protection', 'Review']}
              current={step}
            />
            <Stepper
              label="Example step"
              min={1}
              max={3}
              value={step + 1}
              onChange={(next) => setStep(next - 1)}
            />
            <Progress label="Example progress" value={(step + 1) / 3} />
            <Button label="Open confirmation" onPress={() => setDialog(true)} />
          </Card>
          {notice && <Toast message="Confirmation complete" />}
          <Switch
            label="Block screenshots"
            value={blocking}
            onChange={setBlocking}
          />
          <SensitiveScreen
            focused
            render={() => <PrivacyFixture draft={draft} setDraft={setDraft} />}
          />
        </ScreenContainer>
        <Dialog
          open={dialog}
          title="Complete example?"
          message="Confirm to test the dialog and feedback."
          confirmLabel="Confirm"
          onCancel={() => setDialog(false)}
          onConfirm={() => {
            setDialog(false);
            setNotice(true);
            playHaptic('success');
          }}
        />
      </ScreenPrivacy>
    </SafeAreaView>
  );
}

function App() {
  const [preference, setPreference] = useState<ThemePreference>('system');
  return (
    <SafeAreaProvider>
      <ThemeProvider preference={preference}>
        <Gallery preference={preference} setPreference={setPreference} />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

registerRootComponent(App);
