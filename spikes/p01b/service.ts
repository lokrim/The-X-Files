import { AppRegistry } from 'react-native';
import { measurement } from './native';
import { SpikeError, type Report } from './saf';
import {
  isServiceTask,
  runServiceLoop,
  type Scheduler,
  type ServiceTask,
} from './service-loop';
let report: Report | undefined;
const pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
export function setServiceReporter(value: Report) {
  report = value;
}
async function progressLoop(task: ServiceTask) {
  const native = measurement();
  if (!native) throw new SpikeError('NATIVE_MODULE_MISSING');
  // No console/Metro events are emitted until this actual JS/I/O loop exits.
  const result = await runServiceLoop(native, task, pause);
  if (result.failed)
    report?.('SERVICE_JS_FAILED', {
      generation: task.generation,
      reason: 'IO_ERROR',
    });
  const state = native.serviceState();
  const stale = state.generation !== task.generation;
  report?.('SERVICE_JS_EXIT', {
    generation: task.generation,
    scheduler: task.scheduler,
    sequence: result.sequence,
    stale,
    reason: stale ? 'STALE_GENERATION' : state.reason,
    cleanupComplete: !stale && state.cleanupComplete,
  });
}
AppRegistry.registerHeadlessTask(
  'P01bForeground',
  () => async (data: unknown) => {
    if (!isServiceTask(data)) throw new SpikeError('BAD_SERVICE_TASK');
    await progressLoop(data);
  },
);
export async function startService(
  headless = true,
  disabled = false,
  scheduler: Scheduler = 'native-paced',
) {
  const native = measurement();
  if (!native) throw new SpikeError('NATIVE_MODULE_MISSING');
  if (native.serviceState().diagnosticsVersion !== 2)
    throw new SpikeError('REBUILD_SPIKE_CLIENT');
  const generation = native.startService(headless, disabled, scheduler);
  if (!(await native.awaitServiceReady(generation))) {
    native.stopGeneration(generation);
    throw new SpikeError('SERVICE_START_FAILED');
  }
  if (!headless) await progressLoop({ generation, scheduler });
}
export function serviceStatus(report: Report) {
  const native = measurement();
  if (!native) throw new SpikeError('NATIVE_MODULE_MISSING');
  report('SERVICE_STATE', { ...native.serviceState() });
}
export async function stopService(report: Report) {
  const native = measurement();
  if (!native) throw new SpikeError('NATIVE_MODULE_MISSING');
  const generation = native.serviceState().generation;
  native.stopGeneration(generation);
  await native.awaitCleanup(generation);
  serviceStatus(report);
}
