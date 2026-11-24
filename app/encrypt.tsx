import { useState } from 'react';
import { useIsFocused, usePreventRemove, useRouter } from 'expo-router';
import { Stack } from 'expo-router/stack';

import { EncryptResultScreen } from '@/features/encrypt/encrypt-result';
import {
  FilesStep,
  ProtectionStep,
  ReviewStep,
  TerminalStep,
  WorkStep,
} from '@/features/encrypt/encrypt-steps';
import { useEncryptFlow } from '@/features/encrypt/use-encrypt-flow';
import {
  passwordExitWarning,
  recoveryWarning,
} from '@/features/encrypt/workflow';
import { Dialog } from '@/ui/controls/dialog';
import { ScreenContainer } from '@/ui/controls/screen-container';

type Prompt = { kind: 'leave'; repeat?: () => void } | { kind: 'cancel' };

export default function Encrypt() {
  const flow = useEncryptFlow();
  const router = useRouter();
  const focused = useIsFocused();
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const { phase, activity } = flow;
  const working =
    phase === 'preparing' || phase === 'deriving' || phase === 'running';

  const disablePrevention = usePreventRemove(
    phase !== 'left' && (phase !== 'files' || activity !== null),
    ({ repeat }) => {
      if (phase === 'done' && !activity) setPrompt({ kind: 'leave', repeat });
      else if (working && !flow.cancelling && !flow.askUnknown)
        setPrompt({ kind: 'cancel' });
      else if (!activity) flow.back();
    },
  );

  function confirm() {
    setPrompt(null);
    if (prompt?.kind === 'cancel') flow.cancel();
    else if (prompt?.kind === 'leave' && flow.leaveResult()) {
      if (prompt.repeat) prompt.repeat();
      else {
        disablePrevention();
        if (router.canGoBack()) router.back();
        else router.replace('/');
      }
    }
  }

  function screen() {
    if (phase === 'files') return <FilesStep {...flow} />;
    if (phase === 'done')
      return (
        <EncryptResultScreen
          flow={flow}
          focused={focused}
          onDone={() => setPrompt({ kind: 'leave' })}
        />
      );
    if (phase === 'left') return null;
    return (
      <ScreenContainer key={working ? 'work' : phase}>
        {phase === 'protection' && (
          <ProtectionStep
            focused={focused}
            choice={flow.protection}
            passwordFields={flow}
            changeMode={flow.changeMode}
            setTotal={flow.setTotal}
            setThreshold={flow.setThreshold}
            forward={flow.forward}
          />
        )}
        {phase === 'review' && <ReviewStep flow={flow} />}
        {working && <WorkStep flow={flow} />}
        {(phase === 'error' || phase === 'cancelled') && (
          <TerminalStep flow={flow} />
        )}
      </ScreenContainer>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{ title: phase === 'done' ? 'Encrypted file' : 'Encrypt' }}
      />
      {screen()}
      <Dialog
        open={flow.askUnknown}
        title="Free space is unknown"
        message="Android could not verify available space. If the provider runs out of space, X-Files will try to delete the partial file."
        confirmLabel="Continue"
        onConfirm={() => flow.resolveUnknown(true)}
        onCancel={flow.cancel}
      />
      <Dialog
        open={prompt !== null}
        title={
          prompt?.kind === 'cancel'
            ? 'Cancel encryption?'
            : 'Leave this screen?'
        }
        message={
          prompt?.kind === 'cancel'
            ? 'X-Files will stop the operation and try to delete temporary and partial files.'
            : flow.result?.recovery.mode === 'password'
              ? passwordExitWarning
              : recoveryWarning
        }
        confirmLabel={prompt?.kind === 'cancel' ? 'Cancel encryption' : 'Leave'}
        cancelLabel={prompt?.kind === 'cancel' ? 'Keep encrypting' : 'Stay'}
        onConfirm={confirm}
        onCancel={() => setPrompt(null)}
      />
    </>
  );
}
