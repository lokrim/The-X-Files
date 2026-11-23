import { requireOptionalNativeModule } from 'expo';
import type { Scheduler } from './service-loop';
export type ServiceState = {
  diagnosticsVersion: 2;
  generation: number;
  processStartedElapsedMs: number;
  scheduler: Scheduler;
  running: boolean;
  sequence: number;
  workBytes: number;
  elapsedMs: number;
  lastTickAgeMs: number;
  maxGapMs: number;
  uptimeMs: number;
  suspendEstimateMs: number;
  nativeTicks: number;
  nativeLastTickAgeMs: number;
  nativeMaxGapMs: number;
  nativeWaitCalls: number;
  nativeWaitReturns: number;
  hostResumes: number;
  hostPauses: number;
  reactLifecycle: string;
  headlessTaskActive: boolean;
  interactive: boolean;
  deviceIdle: boolean;
  powerSave: boolean;
  keyguardLocked: boolean;
  headless: boolean;
  reason: string;
  timeoutCount: number;
  timeoutStopMs: number;
  cleanupAttempted: boolean;
  cleanupComplete: boolean;
  notificationPermission: boolean;
  channelImportance: number;
  notificationsEnabled: boolean;
  activeNotifications: number;
  visibility: number;
  genericText: boolean;
  ongoing: boolean;
};
export type NativeMetrics = {
  nativeAllocatedBytes: number;
  totalPssKiB: number;
  rssKiB: number;
  rssHighWaterKiB: number;
};
export interface Measurement {
  metrics(): NativeMetrics;
  serviceState(): ServiceState;
  startService(
    headless: boolean,
    disabled: boolean,
    scheduler: Scheduler,
  ): number;
  awaitServiceReady(generation: number): Promise<boolean>;
  waitForRecord(generation: number, milliseconds: number): Promise<boolean>;
  awaitCleanup(generation: number): Promise<boolean>;
  stopGeneration(generation: number): boolean;
  stopService(): boolean;
  notificationPermission(): boolean;
  uriGrant(uri: string): { read: boolean; write: boolean };
  deleteTestChannels(): void;
  cleanupTestFiles(): { before: number; remaining: number };
  poke(generation: number, sequence: number): boolean;
  workChunk(generation: number, bytes: Uint8Array): Promise<number>;
  openReader(uri: string): Promise<{ id: number; size: number }>;
  read(id: number, maximum: number): Promise<Uint8Array>;
  closeReader(id: number): Promise<void>;
  createOutput(parent: string, scenario: string): Promise<string>;
  openWriter(uri: string): Promise<number>;
  write(id: number, bytes: Uint8Array): Promise<void>;
  closeWriter(id: number): Promise<void>;
  deleteOutput(uri: string): Promise<boolean>;
}
export function measurement(): Measurement | null {
  return requireOptionalNativeModule<Measurement>('P01bMeasurement');
}
