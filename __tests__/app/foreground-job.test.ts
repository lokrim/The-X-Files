import { CoreError } from '@/core/crypto/errors';
import { runFileJob } from '@/platform/job';
import { nativePlatform } from '@/platform/native';

jest.mock('@/platform/native', () => ({
  nativePlatform: jest.fn(),
  nativeCall: async (invoke: (native: unknown) => unknown) =>
    invoke(jest.requireMock('@/platform/native').nativePlatform()),
}));
jest.mock('expo-keep-awake', () => ({
  activateKeepAwakeAsync: jest.fn(async () => {}),
  deactivateKeepAwake: jest.fn(async () => {}),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}

function bridge(cleaned: boolean) {
  const end = deferred<string>();
  const finish = jest.fn(async (_generation: number, save: boolean) => {
    end.resolve(save ? 'COMPLETED' : 'CANCELLED');
    return save;
  });
  jest.mocked(nativePlatform).mockReturnValue({
    sweepTemp: async () => true,
    start: async () => 9,
    awaitReady: async () => true,
    awaitEnd: () => end.promise,
    awaitCleanup: async () => cleaned,
    finish,
  } as unknown as ReturnType<typeof nativePlatform>);
  return { end, finish };
}

test('provider errors are preserved after rollback', async () => {
  const { finish } = bridge(true);
  const onCleanupFailure = jest.fn();
  const running = runFileJob({ onCleanupFailure }, async () => {
    throw new CoreError('NO_SPACE');
  });
  await expect(running).rejects.toMatchObject({
    code: 'NO_SPACE',
    cleanupFailed: false,
  });
  expect(finish).toHaveBeenCalledWith(9, false);
  expect(onCleanupFailure).not.toHaveBeenCalled();
});

test('native timeout returns even when work has not resumed and discards late results', async () => {
  const { end, finish } = bridge(false);
  const workStarted = deferred<AbortSignal>();
  const pending = deferred<Uint8Array>();
  const onCleanupFailure = jest.fn();
  const discard = jest.fn((key: Uint8Array) => key.fill(0));
  const running = runFileJob(
    { onCleanupFailure },
    (job) => {
      workStarted.resolve(job.signal);
      return pending.promise;
    },
    discard,
  );
  const signal = await workStarted.promise;
  end.resolve('SERVICE_TIMEOUT');
  await expect(running).rejects.toMatchObject({
    code: 'SERVICE_TIMEOUT',
    cleanupFailed: true,
  });
  expect(signal.aborted).toBe(true);
  expect(finish).not.toHaveBeenCalledWith(9, true);
  expect(onCleanupFailure).toHaveBeenCalledTimes(1);

  const late = Uint8Array.of(3);
  pending.resolve(late);
  await pending.promise;
  expect(discard).toHaveBeenCalledTimes(1);
  expect(late[0]).toBe(0);
});

test('keeps the current native generation until rollback status has returned', async () => {
  const end = deferred<string>();
  const cleanup = deferred<boolean>();
  const awaitingCleanup = deferred<void>();
  const start = jest.fn(async () => 10);
  jest.mocked(nativePlatform).mockReturnValue({
    start,
    awaitReady: async () => true,
    awaitEnd: () => end.promise,
    async finish() {
      end.resolve('CANCELLED');
      return false;
    },
    awaitCleanup: () => {
      awaitingCleanup.resolve();
      return cleanup.promise;
    },
  } as unknown as ReturnType<typeof nativePlatform>);
  const controls = { onCleanupFailure: jest.fn() };
  const first = expect(
    runFileJob(controls, async () => {
      throw new CoreError('NO_SPACE');
    }),
  ).rejects.toMatchObject({ code: 'NO_SPACE' });
  await awaitingCleanup.promise;
  const secondWork = jest.fn(async () => undefined);
  await expect(runFileJob(controls, secondWork)).rejects.toMatchObject({
    code: 'IO_ERROR',
  });
  expect(secondWork).not.toHaveBeenCalled();
  expect(start).toHaveBeenCalledTimes(1);
  cleanup.resolve(true);
  await first;
});
