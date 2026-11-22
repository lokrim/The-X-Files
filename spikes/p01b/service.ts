import { AppRegistry } from 'react-native';
import { measurement } from './native';
import { SpikeError, type Report } from './saf';
let report: Report | undefined;
const pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
export function setServiceReporter(value: Report) {
  report = value;
}
async function progressLoop() {
  const native = measurement();
  if (!native) throw new SpikeError('NATIVE_MODULE_MISSING');
  let seq = 0;
  const chunk = new Uint8Array(1048576);
  try {
    while (native.serviceState().running) {
      const bytes = await native.workChunk(chunk);
      if (!bytes || !native.serviceState().running) break;
      native.poke(++seq);
      // No console/Metro traffic during background/locked progress measurement.
      await pause(200);
    }
  } catch {
    native.stopService();
    report?.('SERVICE_JS_FAILED', { reason: 'IO_ERROR' });
  } finally {
    chunk.fill(0);
  }
  const state = native.serviceState();
  report?.('SERVICE_JS_EXIT', {
    sequence: seq,
    reason: state.reason,
    cleanupComplete: state.cleanupComplete,
  });
}
AppRegistry.registerHeadlessTask('P01bForeground', () => progressLoop);
export async function startService(headless = true, disabled = false) {
  const native = measurement();
  if (!native) throw new SpikeError('NATIVE_MODULE_MISSING');
  native.startService(headless, disabled);
  if (!headless) {
    await pause(150);
    await progressLoop();
  }
}
export function serviceStatus(report: Report) {
  const native = measurement();
  if (!native) throw new SpikeError('NATIVE_MODULE_MISSING');
  report('SERVICE_STATE', { ...native.serviceState() });
}
export async function stopService(report: Report) {
  const native = measurement();
  if (!native) throw new SpikeError('NATIVE_MODULE_MISSING');
  native.stopService();
  await pause(500);
  serviceStatus(report);
}
