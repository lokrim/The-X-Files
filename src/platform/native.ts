import { requireNativeModule } from 'expo';

import { CoreError, operationErrorCodes } from '@/core/crypto/errors';

export type Volume = { id: string; available: number };
export type JobEnd = 'COMPLETED' | 'CANCELLED' | 'SERVICE_TIMEOUT' | 'IO_ERROR';

interface XFilesNative {
  directoryLabel(tree: string): Promise<string>;
  outputLabel(generation: number, writer: number): Promise<string | null>;
  jobNotificationsEnabled(): Promise<boolean>;
  chooseDirectory(): Promise<string | null>;
  shareDocument(uri: string, mime: string): Promise<void>;
  start(): Promise<number>;
  awaitReady(generation: number): Promise<boolean>;
  awaitEnd(generation: number): Promise<JobEnd>;
  awaitCleanup(generation: number): Promise<boolean>;
  yieldRecord(generation: number, delayMs: number): Promise<boolean>;
  progress(generation: number, percent: number): Promise<void>;
  finish(generation: number, commit: boolean): Promise<boolean>;
  sourceSize(uri: string): Promise<number>;
  inspectHeader(uri: string): Promise<Uint8Array>;
  openSource(generation: number, uri: string): Promise<number>;
  openTemp(generation: number, writer: number): Promise<number>;
  readerSize(generation: number, reader: number): Promise<number>;
  read(
    generation: number,
    reader: number,
    maximum: number,
  ): Promise<Uint8Array>;
  closeReader(generation: number, reader: number): Promise<void>;
  createOutput(
    generation: number,
    tree: string | null,
    name: string,
    mime: string,
  ): Promise<{
    id: number;
    uri: string | null;
  }>;
  write(generation: number, writer: number, bytes: Uint8Array): Promise<void>;
  closeWriter(generation: number, writer: number): Promise<void>;
  abortOutput(generation: number, writer: number): Promise<void>;
  volume(tree: string | null): Promise<Volume | null>;
  sweepTemp(): Promise<boolean>;
  copySecret(text: string, seconds: number): Promise<void>;
  expireClipboard(): Promise<void>;
  setScreenSecure(enabled: boolean): Promise<boolean>;
}

export function nativePlatform() {
  return requireNativeModule<XFilesNative>('XFilesPlatform');
}

export async function nativeCall<T>(
  invoke: (native: XFilesNative) => Promise<T>,
) {
  try {
    return await invoke(nativePlatform());
  } catch (error) {
    if (error instanceof CoreError) throw error;
    const code = (error as { code?: unknown } | null)?.code;
    throw new CoreError(
      operationErrorCodes.find((item) => item === code) ?? 'IO_ERROR',
    );
  }
}
