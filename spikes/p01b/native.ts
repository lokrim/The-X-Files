import { requireOptionalNativeModule } from 'expo';
export type ServiceState = {
  running: boolean;
  sequence: number;
  elapsedMs: number;
  lastTickAgeMs: number;
  maxGapMs: number;
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
  startService(headless: boolean, disabled: boolean): boolean;
  stopService(): boolean;
  notificationPermission(): boolean;
  uriGrant(uri: string): { read: boolean; write: boolean };
  deleteTestChannels(): void;
  cleanupTestFiles(): { before: number; remaining: number };
  poke(sequence: number): void;
  workChunk(bytes: Uint8Array): Promise<number>;
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
