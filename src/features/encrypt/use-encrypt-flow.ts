import { useMemo, useRef, useState } from 'react';

import { CoreError } from '@/core/crypto/errors';
import { maxCreateEntries } from '@/core/zip';
import {
  chooseDestination,
  cryptoAdapters,
  encryptWithRecovery,
  inspectCapacity,
  pickSources,
  requestJobNotifications,
  saveCopy,
  shareFile,
  shareSecret,
  SourceCountLimitError,
} from '@/platform/composition';
import type { ScryptCancellation } from '@/platform/crypto';
import type { Destination, PickedSource } from '@/platform/file-io';
import type { EncryptionStage } from '@/platform/file-jobs';
import { playHaptic } from '@/platform/haptics';
import { useSettings } from '@/features/settings/use-settings';
import { createRecovery, type Recovery } from './recovery';
import {
  bundleName,
  checkPassword,
  checkSelection,
  countError,
  operationMessage,
  outputName,
  type ProtectionChoice,
  type ProtectionMode,
} from './workflow';

type Result = Awaited<ReturnType<typeof encryptWithRecovery<Recovery>>> & {
  requestedName: string;
};
type Phase =
  | 'files'
  | 'protection'
  | 'review'
  | EncryptionStage
  | 'done'
  | 'error'
  | 'cancelled'
  | 'left';
type Source = PickedSource & { id: number };
type Activity = 'sources' | 'destination' | 'encrypt' | 'share' | 'copy';

export function useEncryptFlow() {
  const { settings } = useSettings();
  const [phase, setPhase] = useState<Phase>('files');
  const [sources, setSources] = useState<Source[]>([]);
  const nextSourceId = useRef(0);
  const selection = useMemo(() => checkSelection(sources), [sources]);
  const [protection, setProtection] = useState<ProtectionChoice>({
    mode: 'key',
  });
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const passwordStatus = useMemo(
    () => checkPassword(password, confirmation),
    [password, confirmation],
  );
  const [destination, setDestination] = useState<Destination | null>(null);
  const [capacity, setCapacity] = useState<
    'available' | 'unknown' | 'blocked' | null
  >(null);
  const [message, setMessage] = useState<string | null>(null);
  const [cleanupFailed, setCleanupFailed] = useState(false);
  const [notifications, setNotifications] = useState(true);
  const [activity, setActivity] = useState<Activity | null>(null);
  const activityRef = useRef<Activity | null>(null);
  const controller = useRef<AbortController | null>(null);
  const unknownAnswer = useRef<((accept: boolean) => void) | null>(null);
  const [askUnknown, setAskUnknown] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [scrypt, setScrypt] = useState<ScryptCancellation | null>(null);
  const [startedAt, setStartedAt] = useState(0);
  const stageStartedAt = useRef(0);
  const [progress, setProgress] = useState<{
    fraction: number;
    speed: number;
  } | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);

  function clearPassword() {
    setPassword('');
    setConfirmation('');
  }

  function changeMode(mode: ProtectionMode) {
    if (mode === protection.mode) return;
    clearPassword();
    setProtection(
      mode === 'shares' ? { mode, total: 5, threshold: 3 } : { mode },
    );
  }

  function setTotal(total: number) {
    if (protection.mode === 'shares') {
      const bounded = Math.min(16, Math.max(2, total));
      setProtection({
        ...protection,
        total: bounded,
        threshold: Math.min(bounded, protection.threshold),
      });
    }
  }

  function setThreshold(threshold: number) {
    if (protection.mode === 'shares') {
      setProtection({
        ...protection,
        threshold: Math.min(protection.total, Math.max(2, threshold)),
      });
    }
  }

  function begin(next: Activity) {
    if (activityRef.current) return false;
    activityRef.current = next;
    setActivity(next);
    setMessage(null);
    return true;
  }

  function end() {
    activityRef.current = null;
    setActivity(null);
  }

  function resetDestination() {
    setDestination(null);
    setCapacity(null);
  }

  function removeSource(id: number) {
    if (activityRef.current) return;
    setMessage(null);
    resetDestination();
    setSources((current) => current.filter((item) => item.id !== id));
  }

  async function addSources() {
    if (!begin('sources')) return;
    try {
      const picked = await pickSources(true, maxCreateEntries - sources.length);
      if (!picked.length) return;
      const next = [
        ...sources,
        ...picked.map((item) => ({ ...item, id: ++nextSourceId.current })),
      ];
      const { error } = checkSelection(next);
      if (error) {
        setMessage(error);
        return;
      }
      resetDestination();
      setSources(next);
    } catch (error) {
      setMessage(
        error instanceof SourceCountLimitError
          ? countError
          : operationMessage(error),
      );
    } finally {
      end();
    }
  }

  async function selectDestination() {
    const plan = selection.plan;
    if (!plan || !begin('destination')) return;
    try {
      const selected = await chooseDestination();
      if (!selected) return;
      setDestination(selected);
      setCapacity('blocked');
      const { unknown } = await inspectCapacity(
        selected.tree,
        plan.totalSize,
        plan.zip?.totalSize,
      );
      setCapacity(unknown ? 'unknown' : 'available');
    } catch (error) {
      setMessage(operationMessage(error));
    } finally {
      end();
    }
  }

  function forward() {
    if (activityRef.current) return;
    if (phase === 'files' && selection.plan) setPhase('protection');
    if (
      phase === 'protection' &&
      (protection.mode !== 'password' || passwordStatus.valid)
    )
      setPhase('review');
    setMessage(null);
  }

  function back() {
    if (activityRef.current || scrypt?.pending) return;
    setMessage(null);
    if (phase === 'protection') {
      clearPassword();
      setPhase('files');
    } else if (phase === 'review') {
      setPhase('protection');
    } else if (phase === 'error' || phase === 'cancelled') {
      setPhase(protection.mode === 'password' ? 'protection' : 'review');
    }
  }

  function chooseFilesAgain() {
    if (activityRef.current || scrypt?.pending) return;
    resetDestination();
    setSources([]);
    setMessage(null);
    setPhase('files');
  }

  function resolveUnknown(accept: boolean) {
    const resolve = unknownAnswer.current;
    unknownAnswer.current = null;
    setAskUnknown(false);
    resolve?.(accept);
  }

  function startWork() {
    const started = performance.now();
    const abort = new AbortController();
    controller.current = abort;
    setCancelling(false);
    setCleanupFailed(false);
    setStartedAt(started);
    stageStartedAt.current = started;
    setProgress(null);
    return abort;
  }

  function waitForCapacity(signal: AbortSignal) {
    if (signal.aborted) throw new CoreError('CANCELLED');
    return new Promise<void>((resolve, reject) => {
      unknownAnswer.current = (accept) => {
        if (accept) resolve();
        else reject(new CoreError('CANCELLED'));
      };
      setAskUnknown(true);
    });
  }

  function cancel() {
    if (!controller.current) return;
    setCancelling(true);
    controller.current.abort();
    resolveUnknown(false);
  }

  function updateProgress(processed: number, total: number) {
    const seconds = Math.max(
      0.1,
      (performance.now() - stageStartedAt.current) / 1000,
    );
    setProgress({
      fraction: total === 0 ? 0 : processed / total,
      speed: processed / seconds / 1_000_000,
    });
  }

  async function encrypt() {
    if (
      phase !== 'review' ||
      !destination ||
      !selection.plan ||
      capacity === 'blocked' ||
      (protection.mode === 'password' && !passwordStatus.valid) ||
      !begin('encrypt')
    )
      return;

    const now = new Date();
    const name = outputName(sources, settings.keepOriginalName, now);
    const abort = startWork();
    setScrypt(null);
    setPhase('preparing');
    let remainingPassword = protection.mode === 'password' ? password : '';
    // Leave the input tree before work. The one-shot credential is consumed
    // at derivation, or released after cleanup if the job never reaches it.
    clearPassword();
    try {
      const available = await requestJobNotifications().catch(() => false);
      setNotifications(available);
      if (abort.signal.aborted) throw new CoreError('CANCELLED');
      const saved = await encryptWithRecovery(
        {
          destination,
          sources,
          protection:
            protection.mode === 'password'
              ? {
                  mode: 'password',
                  takePassword() {
                    const value = remainingPassword;
                    remainingPassword = '';
                    return value;
                  },
                }
              : { mode: 'raw' },
          outputName: name,
          bundleName,
          createdAtUnixSec: Math.floor(now.getTime() / 1000),
          onUnknownCapacity: () => waitForCapacity(abort.signal),
          controls: {
            signal: abort.signal,
            onCleanupFailure: () => setCleanupFailed(true),
            onProgress: updateProgress,
          },
          onStage(stage) {
            if (abort.signal.aborted) return;
            setPhase(stage);
            stageStartedAt.current = performance.now();
            setProgress(null);
          },
          onScryptCancellation: setScrypt,
        },
        (material) => createRecovery(protection, material, cryptoAdapters.rng),
        (recovery) => recovery.wipe(),
      );
      setAcknowledged(false);
      setResult({ ...saved, requestedName: name });
      setSources([]);
      resetDestination();
      setPhase('done');
      playHaptic('success');
    } catch (error) {
      setMessage(operationMessage(error));
      setPhase(
        error instanceof CoreError && error.code === 'CANCELLED'
          ? 'cancelled'
          : 'error',
      );
    } finally {
      remainingPassword = '';
      controller.current = null;
      setCancelling(false);
      end();
    }
  }

  async function share(read?: () => string | null) {
    if (!result || !begin('share')) return;
    try {
      if (read) {
        const text = read();
        if (text) await shareSecret(text);
      } else {
        await shareFile(result.file);
      }
    } catch {
      setMessage('Could not open sharing. Try again.');
    } finally {
      end();
    }
  }

  async function copy() {
    if (!result || !begin('copy')) return;
    setCleanupFailed(false);
    try {
      const selected = await chooseDestination();
      if (!selected) return;
      const abort = startWork();
      await saveCopy({
        destination: selected,
        file: result.file,
        name: result.requestedName,
        controls: {
          signal: abort.signal,
          onCleanupFailure: () => setCleanupFailed(true),
          onProgress: updateProgress,
        },
        onUnknownCapacity: () => waitForCapacity(abort.signal),
      });
      setMessage(`Copy saved to ${selected.label}`);
    } catch (error) {
      setMessage(operationMessage(error));
    } finally {
      controller.current = null;
      setStartedAt(0);
      setCancelling(false);
      end();
    }
  }

  function leaveResult() {
    if (activityRef.current || !result) return false;
    result.recovery.wipe();
    setResult(null);
    setPhase('left');
    return true;
  }

  return {
    phase,
    sources,
    selection,
    protection,
    password,
    confirmation,
    passwordStatus,
    destination,
    capacity,
    activity,
    message,
    cleanupFailed,
    askUnknown,
    cancelling,
    notifications,
    startedAt,
    progress,
    scrypt,
    result,
    acknowledged,
    resolveUnknown,
    setPassword,
    setConfirmation,
    setTotal,
    setThreshold,
    changeMode,
    removeSource,
    addSources,
    selectDestination,
    forward,
    back,
    chooseFilesAgain,
    encrypt,
    cancel,
    share,
    copy,
    setAcknowledged,
    leaveResult,
  };
}

export type EncryptFlow = ReturnType<typeof useEncryptFlow>;
