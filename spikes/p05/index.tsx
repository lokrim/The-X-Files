import { sha256 } from '@noble/hashes/sha2.js';
import { registerRootComponent } from 'expo';
import { useEffect, useRef, useState } from 'react';
import { Alert, AppState, Button, ScrollView, Text, View } from 'react-native';

import { zeroize } from '../../src/core/crypto/bytes';
import { CoreError, operationErrorCodes } from '../../src/core/crypto/errors';
import { readChunk, streamProgress } from '../../src/core/io';
import {
  chooseDestination,
  createWriter,
  pickSources,
  shareFile,
  withReader,
  type Destination,
  type PickedSource,
  type SavedFile,
} from '../../src/platform/file-io';
import {
  decryptToDestination,
  encryptToDestination,
  saveCopy,
} from '../../src/platform/file-jobs';
import {
  JobError,
  requestJobNotifications,
  runFileJob,
  sweepStartupTemp,
  type JobControls,
} from '../../src/platform/job';
import { aead, cryptoAdapters } from '../../src/platform/crypto';
import { nativeCall } from '../../src/platform/native';
import { equalBytes } from '../../test-utils/p01b/rfc-adapter';
import {
  runAeadVectors,
  runKdfCancellation,
  runKdfMemory,
  runKdfVectors,
  type Report,
} from './vectors';
import { PrivacyProbe } from './privacy';

const chunkBytes = 2 ** 20;
const cipherName = 'p05-synthetic.xfile';
const password = 'P05 public fixture password';
const fixtureAuthority = 'content://com.xfiles.p01bprovider';
const fixtureShareMime = 'application/vnd.xfiles.p05-fixture';
const filePhases = new Set([
  'SOURCE_HASH',
  'ENCRYPT',
  'DECRYPT',
  'EXTRACT',
  'WRONG_CREDENTIAL',
  'VERIFY_HASH',
  'EXPORT',
  'SAF_FAULT',
  'SERVICE',
]);

function confirm(title: string, message: string) {
  return new Promise<boolean>((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Continue', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

function Benchmark() {
  const [sources, setSources] = useState<PickedSource[]>([]);
  const source = sources[0];
  const isBundle = sources.length > 1;
  const [destination, setDestination] = useState<Destination>();
  const [busy, setBusy] = useState(false);
  const [canCancel, setCanCancel] = useState(false);
  const [passwordMode, setPasswordMode] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [alternate, setAlternate] = useState<PickedSource>();
  const [status, setStatus] = useState(
    'Select a synthetic file and an empty test folder.',
  );
  const recovered = useRef<readonly SavedFile[]>([]);
  const encrypted = useRef<SavedFile | undefined>(undefined);
  const sourceDigest = useRef<Uint8Array | undefined>(undefined);
  const key = useRef<Uint8Array | undefined>(undefined);
  const abort = useRef<AbortController | undefined>(undefined);
  const abortedAt = useRef(0);

  useEffect(() => {
    void sweepStartupTemp();
  }, []);

  const report: Report = (reason, metrics) => {
    const summary = JSON.stringify({ reason, ...metrics });
    console.info('XFILES_P05', summary);
    setStatus(summary);
  };

  async function measure(
    phase: string,
    action: (controls: JobControls) => Promise<void>,
  ) {
    if (abort.current) return;
    const controller = new AbortController();
    abort.current = controller;
    abortedAt.current = 0;
    setBusy(true);
    setCanCancel(filePhases.has(phase));
    const started = performance.now();
    let frames = 0;
    let lastFrame: number | undefined;
    let maxFrameMs = 0;
    let frameId: number;
    let lastProgress: number | undefined;
    let minProgressGapMs = Infinity;
    let updates = 0;
    let lastReport = started;
    const frame = (now: number) => {
      if (AppState.currentState === 'active') {
        frames++;
        if (lastFrame !== undefined)
          maxFrameMs = Math.max(maxFrameMs, now - lastFrame);
        lastFrame = now;
      } else lastFrame = undefined;
      frameId = requestAnimationFrame(frame);
    };
    frameId = requestAnimationFrame(frame);
    const lifecycle = AppState.addEventListener('change', () => {
      lastFrame = undefined;
    });
    try {
      const controls: JobControls = {
        signal: controller.signal,
        onProgress(bytes, total) {
          const now = performance.now();
          updates++;
          if (lastProgress !== undefined)
            minProgressGapMs = Math.min(minProgressGapMs, now - lastProgress);
          lastProgress = now;
          if (now - lastReport >= 1000) {
            lastReport = now;
            report(`${phase}_PROGRESS`, {
              bytes,
              total,
              elapsedMs: now - started,
              foreground: AppState.currentState === 'active',
            });
          }
        },
        onCleanupFailure() {
          report('CLEANUP_UNCONFIRMED', {});
        },
      };
      await action(controls);
      report(`${phase}_PASS`, {
        elapsedMs: performance.now() - started,
        frames,
        maxFrameMs,
        updates,
        minProgressGapMs: Number.isFinite(minProgressGapMs)
          ? minProgressGapMs
          : 0,
      });
    } catch (error) {
      const reason =
        error instanceof CoreError &&
        operationErrorCodes.some((item) => item === error.code)
          ? error.code
          : 'IO_ERROR';
      report(reason, {
        elapsedMs: performance.now() - started,
        frames,
        maxFrameMs,
        cleanupFailed: error instanceof JobError && error.cleanupFailed,
        cancelResponseMs: abortedAt.current
          ? performance.now() - abortedAt.current
          : 0,
      });
    } finally {
      lifecycle.remove();
      cancelAnimationFrame(frameId!);
      abort.current = undefined;
      setBusy(false);
      setCanCancel(false);
    }
  }

  const warning = async () => {
    report('CAPACITY_UNKNOWN', {});
    if (
      !(await confirm(
        'Capacity unknown',
        'Continue with this synthetic test output?',
      ))
    )
      throw new CoreError('CANCELLED');
  };
  const hash = (uri: string, total: number, controls: JobControls) =>
    runFileJob(
      controls,
      (job) =>
        withReader(job.generation, uri, async (reader) => {
          const digest = sha256.create();
          let bytes = 0;
          const checkpoint = streamProgress(total, job);
          try {
            for (;;) {
              const data = await readChunk(reader, chunkBytes, job.signal);
              if (!data) break;
              try {
                digest.update(data);
                bytes += data.length;
              } finally {
                zeroize(data);
              }
              await checkpoint(bytes);
            }
            if (bytes !== total) throw new CoreError('SOURCE_CHANGED');
            return digest.digest();
          } finally {
            digest.destroy();
          }
        }),
      zeroize,
    );

  const setPickedSources = (selected: PickedSource[]) => {
    setSources(selected);
    zeroize(key.current, sourceDigest.current);
    key.current = sourceDigest.current = undefined;
    encrypted.current = undefined;
    recovered.current = [];
    setAlternate(undefined);
  };

  const pick = (multiple: boolean) =>
    measure('PICK', async () => {
      const selected = await pickSources(multiple);
      if (selected.length === 0) throw new CoreError('CANCELLED');
      if (multiple && selected.length < 2)
        throw new CoreError('RESOURCE_LIMIT');
      setPickedSources(selected);
    });

  return (
    <ScrollView
      stickyHeaderIndices={[0]}
      contentContainerStyle={{ padding: 20, gap: 12 }}
    >
      <View style={{ backgroundColor: 'white', gap: 8, paddingVertical: 8 }}>
        <Text>P05 device benchmark · synthetic data only</Text>
        <Text selectable>{status}</Text>
        <Button
          title="Cancel file job"
          disabled={!canCancel}
          onPress={() => {
            abortedAt.current = performance.now();
            abort.current?.abort();
          }}
        />
      </View>
      <Button
        title="AEAD · Node/NIST and throughput"
        disabled={busy}
        onPress={() => void measure('AEAD', () => runAeadVectors(report))}
      />
      <Button
        title="KDF · RFC and production parity"
        disabled={busy}
        onPress={() => void measure('KDF', () => runKdfVectors(report))}
      />
      <Button
        title="KDF · measure cancel and late wipe"
        disabled={busy}
        onPress={() =>
          void measure('KDF_CANCEL', () => runKdfCancellation(report))
        }
      />
      <Button
        title="KDF memory · N=2^17"
        disabled={busy}
        onPress={() =>
          void measure('KDF_MEMORY', () => runKdfMemory(17, report))
        }
      />
      <Button
        title="KDF memory · N=2^18"
        disabled={busy}
        onPress={() =>
          void measure('KDF_MEMORY', () => runKdfMemory(18, report))
        }
      />
      <Button
        title="Notification permission"
        disabled={busy}
        onPress={() =>
          void measure('NOTIFICATION', async () => {
            report('NOTIFICATION_PERMISSION', {
              granted: await requestJobNotifications(),
            });
          })
        }
      />
      <Button
        title="Pick synthetic source"
        disabled={busy}
        onPress={() => void pick(false)}
      />
      <Button
        title="Pick synthetic bundle sources"
        disabled={busy}
        onPress={() => void pick(true)}
      />
      <Button
        title="Choose empty test folder"
        disabled={busy}
        onPress={() =>
          void measure('DESTINATION', async () => {
            const folder = await chooseDestination();
            if (folder) setDestination(folder);
            else throw new CoreError('CANCELLED');
          })
        }
      />
      <Button
        title="Hash source"
        disabled={busy || !source || isBundle}
        onPress={() =>
          void measure('SOURCE_HASH', async (controls) => {
            zeroize(sourceDigest.current);
            sourceDigest.current = undefined;
            sourceDigest.current = await hash(
              source!.uri,
              source!.size,
              controls,
            );
          })
        }
      />
      <Button
        title={
          passwordMode
            ? 'Next encryption · password'
            : 'Next encryption · raw key'
        }
        disabled={busy}
        onPress={() => {
          setPasswordMode(!passwordMode);
        }}
      />
      <Button
        title="Encrypt selected files"
        disabled={busy || !source || !destination}
        onPress={() =>
          void measure('ENCRYPT', async (controls) => {
            const start = performance.now();
            const result = await encryptToDestination({
              sources,
              protection: passwordMode
                ? { mode: 'password', password }
                : { mode: 'raw' },
              destination: destination!,
              controls,
              onUnknownCapacity: warning,
              outputName: cipherName,
              bundleName: 'bundle.zip',
              createdAtUnixSec: Math.floor(Date.now() / 1000),
            });
            zeroize(key.current);
            key.current =
              result.recovery.mode === 'raw'
                ? result.recovery.fileKey
                : undefined;
            encrypted.current = result.file;
            recovered.current = [];
            setAlternate(undefined);
            const bytes = sources.reduce((sum, item) => sum + item.size, 0);
            report('ENCRYPT_RATE', {
              bytes,
              MBps: bytes / 1000 / (performance.now() - start),
            });
          })
        }
      />
      <Button
        title="Pick alternate ciphertext for tamper tests"
        disabled={busy || !encrypted.current}
        onPress={() =>
          void measure('PICK_ALTERNATE', async () => {
            const selected = (await pickSources(false))[0];
            if (!selected) throw new CoreError('CANCELLED');
            setAlternate(selected);
          })
        }
      />
      {alternate && (
        <Button
          title="Use original ciphertext"
          disabled={busy}
          onPress={() => setAlternate(undefined)}
        />
      )}
      {([false, true] as const).map((wrong) => (
        <Button
          key={String(wrong)}
          title={
            wrong ? 'Try wrong credential' : 'Decrypt or extract saved file'
          }
          disabled={busy || !encrypted.current || !destination}
          onPress={() =>
            void measure(
              wrong ? 'WRONG_CREDENTIAL' : isBundle ? 'EXTRACT' : 'DECRYPT',
              async (controls) => {
                recovered.current = [];
                const input = encrypted.current!;
                const selected = alternate ?? {
                  ...input,
                  name: cipherName,
                  size: await nativeCall((native) =>
                    native.sourceSize(input.uri),
                  ),
                };
                const originalKey = key.current;
                const wrongKey =
                  wrong && originalKey ? originalKey.slice() : undefined;
                if (wrongKey) wrongKey[0] = wrongKey[0]! ^ 1;
                const start = performance.now();
                try {
                  const result = await decryptToDestination({
                    source: selected,
                    destination: destination!,
                    controls,
                    credential: originalKey
                      ? { mode: 'raw', fileKey: wrongKey ?? originalKey }
                      : {
                          mode: 'password',
                          password: wrong ? `${password}-wrong` : password,
                        },
                    mode: isBundle ? 'extract' : 'save',
                    onUnknownCapacity: warning,
                  });
                  if (wrong) throw new CoreError('IO_ERROR');
                  recovered.current = result.files;
                  const bytes = sources.reduce(
                    (sum, item) => sum + item.size,
                    0,
                  );
                  report(isBundle ? 'EXTRACT_RATE' : 'DECRYPT_RATE', {
                    bytes,
                    files: result.files.length,
                    MBps: bytes / 1000 / (performance.now() - start),
                  });
                } finally {
                  zeroize(wrongKey);
                }
              },
            )
          }
        />
      ))}
      <Button
        title="Verify recovered hashes"
        disabled={
          busy ||
          !recovered.current.length ||
          (!isBundle && !sourceDigest.current)
        }
        onPress={() =>
          void measure('VERIFY_HASH', async (controls) => {
            if (sources.length !== recovered.current.length)
              throw new CoreError('AUTH_FAILED');
            for (const [index, item] of sources.entries()) {
              const expected = isBundle
                ? await hash(item.uri, item.size, controls)
                : sourceDigest.current!;
              let digest: Uint8Array | undefined;
              try {
                digest = await hash(
                  recovered.current[index]!.uri,
                  item.size,
                  controls,
                );
                if (!equalBytes(digest, expected))
                  throw new CoreError('AUTH_FAILED');
              } finally {
                zeroize(digest, isBundle ? expected : undefined);
              }
            }
            report('HASH_PARITY', {
              bytes: sources.reduce((sum, item) => sum + item.size, 0),
              files: sources.length,
              match: true,
            });
          })
        }
      />
      {([false, true] as const).map((plain) => (
        <Button
          key={`share-${plain}`}
          title={plain ? 'Share recovered plaintext' : 'Share ciphertext'}
          disabled={busy || !(plain ? recovered.current[0] : encrypted.current)}
          onPress={() =>
            void measure('SHARE', async () => {
              const file = plain ? recovered.current[0]! : encrypted.current!;
              const approved =
                plain &&
                (await confirm(
                  'Share plaintext?',
                  'Share this recovered synthetic file with a local app?',
                ));
              await shareFile({ ...file, mime: fixtureShareMime }, approved);
            })
          }
        />
      ))}
      {([false, true] as const).map((plain) => (
        <Button
          key={`copy-${plain}`}
          title={
            plain
              ? 'Save a copy of recovered plaintext'
              : 'Save a copy of ciphertext'
          }
          disabled={
            busy ||
            !(plain ? recovered.current[0] : encrypted.current) ||
            !destination
          }
          onPress={() =>
            void measure('EXPORT', async (controls) => {
              const file = plain ? recovered.current[0]! : encrypted.current!;
              const approved =
                plain &&
                (await confirm(
                  'Export plaintext?',
                  'Write an extra copy of this recovered synthetic file?',
                ));
              await saveCopy({
                file,
                name: plain ? 'p05-export-plaintext.bin' : 'p05-export.xfile',
                destination: destination!,
                controls,
                confirmPlaintext: approved,
                onUnknownCapacity: warning,
              });
            })
          }
        />
      ))}
      <Button
        title="Use granted short-read fixture"
        disabled={busy}
        onPress={() =>
          void measure('PICK', async () => {
            const uri = `${fixtureAuthority}/document/short`;
            const size = await nativeCall((native) => native.sourceSize(uri));
            setPickedSources([
              {
                uri,
                name: 'short.bin',
                mime: 'application/octet-stream',
                size,
              },
            ]);
          })
        }
      />
      <Button
        title="Use granted test output folder"
        disabled={busy}
        onPress={() =>
          void measure('DESTINATION', async () => {
            const tree = `${fixtureAuthority}/tree/root`;
            const label = await nativeCall((native) =>
              native.directoryLabel(tree),
            );
            setDestination({ tree, label });
          })
        }
      />
      {(['full', 'closeFault', 'deleteDenied', 'slowWrite'] as const).map(
        (fault) => (
          <Button
            key={fault}
            title={`SAF fault · ${fault}`}
            disabled={busy || !destination}
            onPress={() =>
              void measure('SAF_FAULT', async (controls) => {
                const target = destination!;
                if (!target.tree.startsWith(`${fixtureAuthority}/`))
                  throw new CoreError('UNSUPPORTED_PROVIDER');
                await runFileJob(controls, async (job) => {
                  const writer = await createWriter(
                    job.generation,
                    target.tree,
                    `p05-${fault}.bin`,
                    'application/octet-stream',
                    async () => {},
                  );
                  if (fault === 'deleteDenied') {
                    await writer.write(Uint8Array.of(0));
                    throw new CoreError('IO_ERROR');
                  }
                  for (let record = 0; record < 4; record++) {
                    report('SAF_FAULT_WRITE', { record });
                    await writer.write(new Uint8Array(chunkBytes));
                  }
                  await writer.close();
                });
              })
            }
          />
        ),
      )}
      <Button
        title="Paced foreground-service test"
        disabled={
          busy || !source || source.size < 420 * chunkBytes || !destination
        }
        onPress={() =>
          void measure('SERVICE', (controls) =>
            runFileJob(controls, (job) =>
              withReader(job.generation, source!.uri, async (reader) => {
                const output = await createWriter(
                  job.generation,
                  destination!.tree,
                  'p05-service.partial',
                  'application/octet-stream',
                  async () => {},
                );
                const testKey = cryptoAdapters.rng.bytes(32);
                const nonce = new Uint8Array(12);
                const aad = new Uint8Array(41);
                let bytes = 0;
                try {
                  // Bounded actual SAF/AEAD/JS work, paced by the production native wait.
                  for (let record = 0; record < 420; record++) {
                    const data = await readChunk(
                      reader,
                      chunkBytes,
                      job.signal,
                    );
                    if (!data) throw new CoreError('TRUNCATED');
                    try {
                      new DataView(nonce.buffer).setUint32(8, record);
                      const packet = await aead.seal(testKey, nonce, aad, data);
                      await output.write(packet.ciphertext);
                      bytes += data.length;
                      job.onProgress(bytes, 420 * chunkBytes);
                    } finally {
                      zeroize(data);
                    }
                    if (
                      !(await nativeCall((native) =>
                        native.yieldRecord(job.generation, 1000),
                      ))
                    )
                      throw new CoreError('CANCELLED');
                  }
                  await output.close();
                  await output.abort();
                } finally {
                  zeroize(testKey);
                }
              }),
            ),
          )
        }
      />
      <Button
        title="Wipe benchmark recovery key"
        disabled={busy || !key.current}
        onPress={() => {
          zeroize(key.current);
          key.current = undefined;
          encrypted.current = undefined;
          setStatus('Wiped recovery key.');
        }}
      />
      <Button
        title={showPrivacy ? 'Close privacy probes' : 'Show privacy probes'}
        disabled={busy}
        onPress={() => setShowPrivacy(!showPrivacy)}
      />
      {showPrivacy && <PrivacyProbe />}
    </ScrollView>
  );
}

registerRootComponent(Benchmark);
