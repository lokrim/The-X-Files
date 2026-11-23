import { registerRootComponent } from 'expo';
import * as DocumentPicker from 'expo-document-picker';
import { Directory, Paths } from 'expo-file-system';
import { useKeepAwake } from 'expo-keep-awake';
import { Button, Column, Host, Text } from '@expo/ui';
import { useEffect, useRef, useState } from 'react';
import { aeadChecks, kdfChecks, nativeKdfChecks } from './crypto';
import {
  safFaults,
  revokedProbe,
  streamLarge,
  cancelNativeOutput,
  readPickedNative,
} from './faults';
import {
  setServiceReporter,
  startService,
  stopService,
  serviceStatus,
} from './service';
import { measurement } from './native';
import {
  crcBenchmark,
  directOutput,
  readSource,
  SpikeError,
  type Report,
} from './saf';

if (!__DEV__) throw new Error('P01b harness is development-only.');
declare global {
  var __P01b:
    | Record<
        | 'crypto'
        | 'aead'
        | 'nativeKdf'
        | 'kdf'
        | 'faults'
        | 'revoked'
        | 'large'
        | 'cancelOutput'
        | 'pickNative'
        | 'service'
        | 'plainService'
        | 'disabledService'
        | 'stopService'
        | 'serviceStatus'
        | 'cleanup'
        | 'cancel',
        () => void | Promise<void>
      >
    | undefined;
}
function Harness() {
  useKeepAwake('P01b-foreground-instrumentation');
  const [status, setStatus] = useState('P01b development instrumentation');
  const [busy, setBusy] = useState(false);
  const [beat, setBeat] = useState(0);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    globalThis.__P01b = {
      crypto: () =>
        run(async () => {
          await aeadChecks(report);
          await kdfChecks(report);
        }),
      aead: () => run(async () => aeadChecks(report)),
      nativeKdf: () => run(async () => nativeKdfChecks(report)),
      kdf: () => run(async () => kdfChecks(report)),
      faults: () => run(async () => safFaults(report)),
      revoked: () => run(async () => revokedProbe(report)),
      large: () => run(async (signal) => streamLarge(report, signal)),
      cancelOutput: () => run(async () => cancelNativeOutput(report)),
      pickNative: () =>
        run(async (signal) => {
          report('NATIVE_PICKER_BEFORE', { cacheBytes: Paths.cache.size });
          const picked = await DocumentPicker.getDocumentAsync({
            copyToCacheDirectory: false,
            multiple: false,
          });
          report('NATIVE_PICKER_AFTER', {
            cacheBytes: Paths.cache.size,
            cancelled: picked.canceled,
          });
          if (!picked.canceled) {
            if ((picked.assets[0]!.size ?? 0) < 2000000000)
              throw new SpikeError('LARGE_FILE_REQUIRED');
            await readPickedNative(picked.assets[0]!.uri, signal, report);
          }
        }),
      service: () => run(async () => startService(true)),
      plainService: () => run(async () => startService(false)),
      disabledService: () => run(async () => startService(true, true)),
      stopService: () => stopService(report),
      serviceStatus: () => serviceStatus(report),
      cleanup: () => {
        const m = measurement();
        if (m) {
          report('SERVICE_TEMP_CLEANUP', { ...m.cleanupTestFiles() });
          m.deleteTestChannels();
        }
      },
      cancel: () => {
        controller.current?.abort();
        measurement()?.stopService();
        report('CANCEL_REQUEST', { requested: true });
      },
    };
    setServiceReporter(report);
    console.log(
      'P01B',
      JSON.stringify({ event: 'HARNESS_READY', development: __DEV__ }),
    );
    const timer = setInterval(() => {
      if (controller.current) setBeat((n) => n + 1);
    }, 100);
    return () => {
      clearInterval(timer);
      globalThis.__P01b = undefined;
    };
  }, []);
  const report: Report = (event, fields) => {
    // Development-only, aggregate allowlist. Never stringify caught exceptions,
    // selected assets, URIs, plaintext, digests, keys or other secret material.
    console.log('P01B', JSON.stringify({ event, ...fields }));
    setStatus(
      event +
        (typeof fields.bytes === 'number' ? ` ${fields.bytes} bytes` : ''),
    );
  };
  async function run(action: (signal: AbortSignal) => Promise<void>) {
    if (controller.current) return;
    const current = new AbortController();
    controller.current = current;
    setBusy(true);
    try {
      await action(current.signal);
    } catch (error: unknown) {
      report(error instanceof SpikeError ? error.reason : 'CANDIDATE_ERROR', {
        handled: true,
      });
    } finally {
      controller.current = null;
      setBusy(false);
    }
  }
  return (
    <Host style={{ flex: 1 }}>
      <Column spacing={12} style={{ padding: 24 }}>
        <Text>P01b development only</Text>
        <Text>{status}</Text>
        <Text>{`UI heartbeat ${beat}`}</Text>
        <Button
          label="Run AEAD comparisons"
          disabled={busy}
          onPress={() => void globalThis.__P01b?.aead()}
        />
        <Button
          label="Run native scrypt"
          disabled={busy}
          onPress={() => void globalThis.__P01b?.nativeKdf()}
        />
        <Button
          label="Run SAF faults"
          disabled={busy}
          onPress={() => void globalThis.__P01b?.faults()}
        />
        <Button
          label="Test revoked grant"
          disabled={busy}
          onPress={() => void globalThis.__P01b?.revoked()}
        />
        <Button
          label="Native large files"
          disabled={busy}
          onPress={() => void globalThis.__P01b?.large()}
        />
        <Button
          label="Start plain service"
          disabled={busy}
          onPress={() => void globalThis.__P01b?.plainService()}
        />
        <Button
          label="Start dataSync service"
          disabled={busy}
          onPress={() => void globalThis.__P01b?.service()}
        />
        <Button
          label="Start disabled channel"
          disabled={busy}
          onPress={() => void globalThis.__P01b?.disabledService()}
        />
        <Button
          label="Stop service"
          onPress={() => void globalThis.__P01b?.stopService()}
        />
        {false && (
          <>
            <Button
              label="Pick and read 2 GB"
              disabled={busy}
              onPress={() =>
                void run(async (signal) => {
                  const cacheBefore = Paths.cache.size;
                  report('PICKER_BEFORE', { cacheBytes: cacheBefore });
                  const picked = await DocumentPicker.getDocumentAsync({
                    copyToCacheDirectory: false,
                    multiple: false,
                  });
                  report('PICKER_AFTER', {
                    cacheBytes: Paths.cache.size,
                    cancelled: picked.canceled,
                  });
                  if (!picked.canceled)
                    await readSource(picked.assets[0]!.uri, signal, report);
                })
              }
            />
            <Button
              label="Direct SAF write and verify"
              disabled={busy}
              onPress={() =>
                void run(async (signal) => {
                  await directOutput(
                    await Directory.pickDirectoryAsync(),
                    signal,
                    report,
                  );
                })
              }
            />
            <Button
              label="SAF cancel cleanup"
              disabled={busy}
              onPress={() =>
                void run(async (signal) => {
                  await directOutput(
                    await Directory.pickDirectoryAsync(),
                    signal,
                    report,
                    2,
                  );
                })
              }
            />
            <Button
              label="Hermes CRC32 benchmark"
              disabled={busy}
              onPress={() => void run(async () => crcBenchmark(report))}
            />
            <Button
              label="Cancel"
              onPress={() => {
                controller.current?.abort();
                report('CANCEL_REQUEST', { requested: true });
              }}
            />
          </>
        )}
        <Button
          label="Cancel"
          onPress={() => void globalThis.__P01b?.cancel()}
        />
      </Column>
    </Host>
  );
}
registerRootComponent(Harness);
