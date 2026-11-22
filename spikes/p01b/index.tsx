import { registerRootComponent } from 'expo';
import * as DocumentPicker from 'expo-document-picker';
import { Directory, Paths } from 'expo-file-system';
import { useKeepAwake } from 'expo-keep-awake';
import { Button, Column, Host, Text } from '@expo/ui';
import { useEffect, useRef, useState } from 'react';
import {
  crcBenchmark,
  directOutput,
  readSource,
  SpikeError,
  type Report,
} from './saf';

if (!__DEV__) throw new Error('P01b harness is development-only.');
function Harness() {
  useKeepAwake('P01b-foreground-instrumentation');
  const [status, setStatus] = useState('P01b development instrumentation');
  const [busy, setBusy] = useState(false);
  const [beat, setBeat] = useState(0);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    console.log(
      'P01B',
      JSON.stringify({ event: 'HARNESS_READY', development: __DEV__ }),
    );
    const timer = setInterval(() => {
      if (controller.current) setBeat((n) => n + 1);
    }, 100);
    return () => clearInterval(timer);
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
      </Column>
    </Host>
  );
}
registerRootComponent(Harness);
