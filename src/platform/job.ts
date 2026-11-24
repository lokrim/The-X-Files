import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { AppRegistry, PermissionsAndroid, Platform } from 'react-native';

import { CoreError, throwIfAborted } from '@/core/crypto/errors';
import { operationError, type StreamOptions } from '@/core/io';
import { nativeCall } from './native';

export type JobControls = Pick<StreamOptions, 'signal' | 'onProgress'> & {
  onCleanupFailure: () => void;
};
type RunningJob = Required<
  Pick<StreamOptions, 'signal' | 'onProgress' | 'yieldControl'>
> & {
  generation: number;
};
export class JobError extends CoreError {
  readonly userMessage: string | undefined;

  constructor(
    error: CoreError,
    readonly cleanupFailed: boolean,
  ) {
    super(error.code);
    this.userMessage =
      error.code === 'SERVICE_TIMEOUT'
        ? 'Android stopped this long-running job. Partial-output cleanup may be incomplete.'
        : undefined;
  }
}

let initialized: Promise<boolean> | undefined;
export function sweepStartupTemp() {
  initialized ??= nativeCall((native) => native.sweepTemp()).catch(() => false);
  return initialized;
}

let registered = false;
export async function requestJobNotifications() {
  if (Number(Platform.Version) >= 33) {
    const permission = PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS;
    if (!(await PermissionsAndroid.check(permission))) {
      const outcome = await PermissionsAndroid.request(permission);
      if (outcome !== PermissionsAndroid.RESULTS.GRANTED) return false;
    }
  }
  return nativeCall((native) => native.jobNotificationsEnabled());
}

// The native bridge exposes one current generation. Keep ownership through
// the bounded cleanup wait before another caller can replace that generation.
let activeJob = false;
export async function runFileJob<T>(
  controls: JobControls,
  work: (job: RunningJob) => Promise<T>,
  discard?: (result: T) => void,
) {
  if (activeJob) throw new CoreError('IO_ERROR');
  activeJob = true;
  try {
    return await runOwnedJob(controls, work, discard);
  } finally {
    activeJob = false;
  }
}

async function runOwnedJob<T>(
  controls: JobControls,
  work: (job: RunningJob) => Promise<T>,
  discard?: (result: T) => void,
) {
  if (!registered) {
    AppRegistry.registerHeadlessTask(
      'XFilesFileJob',
      () =>
        async ({ generation }: { generation: number }) => {
          await nativeCall((native) => native.awaitEnd(generation)).catch(
            () => undefined,
          );
        },
    );
    registered = true;
  }

  if (!(await sweepStartupTemp())) controls.onCleanupFailure();
  throwIfAborted(controls.signal);
  const generation = await nativeCall((native) => native.start());
  const tag = `xfiles-job-${generation}`;
  const controller = new AbortController();
  let terminal: CoreError | undefined;
  const stop = () => nativeCall((native) => native.finish(generation, false));
  const cancel = () => {
    controller.abort();
    void stop().catch(() => undefined);
  };
  controls.signal?.addEventListener('abort', cancel, { once: true });
  if (controls.signal?.aborted) cancel();

  const ended = nativeCall((native) => native.awaitEnd(generation)).then(
    (reason) => {
      if (reason === 'COMPLETED') return;
      terminal = new CoreError(reason);
      controller.abort();
      throw terminal;
    },
  );
  // Observe the rejection even if start/keep-awake fails before the race.
  void ended.catch(() => undefined);

  let result: T | undefined;
  let cleanupReported = false;
  try {
    const ready = await nativeCall((native) => native.awaitReady(generation));
    if (!ready) throw terminal ?? new CoreError('IO_ERROR');
    throwIfAborted(controller.signal);
    await activateKeepAwakeAsync(tag);
    throwIfAborted(controller.signal);
    let lastProgress = -Infinity;
    const running = work({
      signal: controller.signal,
      generation,
      onProgress(processed, total) {
        const now = performance.now();
        if (controller.signal.aborted || now - lastProgress < 100) return;
        lastProgress = now;
        controls.onProgress?.(processed, total);
        const percent = total === 0 ? 0 : Math.floor((processed / total) * 100);
        void nativeCall((native) => native.progress(generation, percent)).catch(
          () => undefined,
        );
      },
      async yieldControl() {
        if (!(await nativeCall((native) => native.yieldRecord(generation, 0))))
          throw terminal ?? new CoreError('CANCELLED');
      },
    }).then((value) => {
      if (cleanupReported) discard?.(value);
      else result = value;
      if (controller.signal.aborted) {
        throw terminal ?? new CoreError('CANCELLED');
      }
      return value;
    });
    await Promise.race([running, ended]);
    throwIfAborted(controller.signal);
    const committed = await nativeCall((native) =>
      native.finish(generation, true),
    );
    if (!committed) throw terminal ?? new CoreError('IO_ERROR');
    return await running;
  } catch (error) {
    const primary = error instanceof CoreError ? error : operationError(error);
    controller.abort();
    const stopped = await stop().then(
      () => true,
      () => false,
    );
    // A checkpoint can observe native stop before the terminal promise's JS
    // continuation. Recover the recorded reason after a successful stop call.
    const reason = stopped
      ? await nativeCall((native) => native.awaitEnd(generation)).catch(
          () => undefined,
        )
      : undefined;
    if (reason === 'SERVICE_TIMEOUT') terminal = new CoreError(reason);
    const cleaned = await nativeCall((native) =>
      native.awaitCleanup(generation),
    ).catch(() => false);
    if (!cleaned) controls.onCleanupFailure();
    cleanupReported = true;
    if (result !== undefined) discard?.(result);
    throw new JobError(
      controls.signal?.aborted && terminal?.code !== 'SERVICE_TIMEOUT'
        ? new CoreError('CANCELLED')
        : terminal?.code === 'SERVICE_TIMEOUT'
          ? terminal
          : primary,
      !cleaned,
    );
  } finally {
    controls.signal?.removeEventListener('abort', cancel);
    await deactivateKeepAwake(tag).catch(() => undefined);
  }
}
