// Development-only comparisons. No global crypto/Buffer shims or core imports.
import {
  AESEncryptionKey,
  AESSealedData,
  aesEncryptAsync,
  aesDecryptAsync,
} from 'expo-crypto';
import { Buffer as QuickBuffer } from '@craftzdog/react-native-buffer';
import { scryptAsync } from '@noble/hashes/scrypt.js';
import references from '../../test-utils/p01b/crypto-references.json';
import nist from '../../test-utils/p01b/nist-gcm.json';
import {
  equalBytes,
  fromHex,
  rfcAnswers,
  invalidResourceRace,
  type TestScrypt,
} from '../../test-utils/p01b/rfc-adapter';
import { CHUNK, SpikeError, yieldJS, type Report } from './saf';
import { measurement } from './native';

type Packet = { ciphertext: Uint8Array; tag: Uint8Array };
type Aead = {
  seal(
    key: Uint8Array,
    nonce: Uint8Array,
    aad: Uint8Array,
    p: Uint8Array,
  ): Promise<Packet>;
  open(
    key: Uint8Array,
    nonce: Uint8Array,
    aad: Uint8Array,
    c: Uint8Array,
    tag: Uint8Array,
  ): Promise<Uint8Array>;
};
const quick = async () => {
  // A guarded CommonJS load avoids Metro development async-bundle reloads.
  const module =
    require('react-native-quick-crypto') as typeof import('react-native-quick-crypto');
  return module.default ?? module;
};
const wipePacket = (p: Packet) => {
  p.ciphertext.fill(0);
  p.tag.fill(0);
};
function concat(a: Uint8Array, b: Uint8Array) {
  const r = new Uint8Array(a.length + b.length);
  r.set(a);
  r.set(b, a.length);
  return r;
}
const quickAead: Aead = {
  async seal(key, nonce, aad, p) {
    if (!(p.buffer instanceof ArrayBuffer))
      throw new SpikeError('UNSUPPORTED_BUFFER');
    const q = await quick();
    const k = QuickBuffer.from(key);
    const iv = QuickBuffer.from(nonce);
    const ad = QuickBuffer.from(aad);
    // Borrow the caller's bounded view; do not copy a MiB in a JS byte loop.
    const plain = QuickBuffer.from(p.buffer, p.byteOffset, p.byteLength);
    try {
      const c = q.createCipheriv('aes-256-gcm', k, iv, { authTagLength: 16 });
      if (ad.length) c.setAAD(ad);
      const first = plain.length ? c.update(plain) : new Uint8Array(0);
      const last = c.final();
      const nativeTag = c.getAuthTag();
      const result = {
        ciphertext: concat(first, last),
        tag: new Uint8Array(nativeTag),
      };
      first.fill(0);
      last.fill(0);
      nativeTag.fill(0);
      return result;
    } finally {
      k.fill(0);
      iv.fill(0);
      ad.fill(0);
      // plain aliases caller input, which the caller wipes after ownership ends.
    }
  },
  async open(key, nonce, aad, ciphertext, tag) {
    if (!(ciphertext.buffer instanceof ArrayBuffer))
      throw new SpikeError('UNSUPPORTED_BUFFER');
    const q = await quick();
    const k = QuickBuffer.from(key);
    const iv = QuickBuffer.from(nonce);
    const ad = QuickBuffer.from(aad);
    const ct = QuickBuffer.from(
      ciphertext.buffer,
      ciphertext.byteOffset,
      ciphertext.byteLength,
    );
    const t = QuickBuffer.from(tag);
    let unverified: Uint8Array | undefined;
    try {
      const c = q.createDecipheriv('aes-256-gcm', k, iv, { authTagLength: 16 });
      if (ad.length) c.setAAD(ad);
      c.setAuthTag(t);
      unverified = ct.length ? c.update(ct) : new Uint8Array(0);
      const last = c.final(); // No plaintext escapes until verification succeeds.
      const result = concat(unverified, last);
      last.fill(0);
      return result;
    } finally {
      unverified?.fill(0);
      k.fill(0);
      iv.fill(0);
      ad.fill(0);
      // ct is borrowed ciphertext; do not mutate the caller's packet.
      t.fill(0);
    }
  },
};
const expoAead: Aead = {
  async seal(key, nonce, aad, plaintext) {
    const k = await AESEncryptionKey.import(key);
    const sealed = await aesEncryptAsync(plaintext, k, {
      nonce: { bytes: nonce },
      additionalData: aad,
      tagLength: 16,
    });
    return { ciphertext: await sealed.ciphertext(), tag: await sealed.tag() };
  },
  async open(key, nonce, aad, ciphertext, tag) {
    const k = await AESEncryptionKey.import(key);
    return aesDecryptAsync(AESSealedData.fromParts(nonce, ciphertext, tag), k, {
      additionalData: aad,
    });
  },
};
async function probe(action: () => Promise<void>, memorySampleMs = 250) {
  const bridge = measurement();
  const baseline = bridge?.metrics();
  let nativePeak = baseline?.nativeAllocatedBytes ?? null;
  let rssPeakKiB = baseline?.rssKiB ?? null;
  let rssHighWaterKiB = baseline?.rssHighWaterKiB ?? null;
  const hermes = (
    globalThis as typeof globalThis & {
      HermesInternal?: { getInstrumentedStats?: () => Record<string, unknown> };
    }
  ).HermesInternal;
  const initialHeap = hermes?.getInstrumentedStats?.().js_heapSize;
  const heapBaseline = typeof initialHeap === 'number' ? initialHeap : null;
  let heapPeak = heapBaseline;
  let last = performance.now();
  let maxGapMs = 0;
  let ticks = 0;
  let frames = 0;
  let maxFrameGapMs = 0;
  let lastFrame = last;
  let running = true;
  const timer = setInterval(() => {
    const now = performance.now();
    maxGapMs = Math.max(maxGapMs, now - last);
    last = now;
    ticks++;
  }, 16);
  const sample = () => {
    const memory = bridge?.metrics();
    if (memory) {
      nativePeak = Math.max(nativePeak ?? 0, memory.nativeAllocatedBytes);
      rssPeakKiB = Math.max(rssPeakKiB ?? 0, memory.rssKiB);
      rssHighWaterKiB = memory.rssHighWaterKiB;
    }
    const heap = hermes?.getInstrumentedStats?.().js_heapSize;
    if (typeof heap === 'number') heapPeak = Math.max(heapPeak ?? 0, heap);
  };
  const memoryTimer = setInterval(sample, memorySampleMs);
  const frame = () => {
    if (!running) return;
    const now = performance.now();
    maxFrameGapMs = Math.max(maxFrameGapMs, now - lastFrame);
    lastFrame = now;
    frames++;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  const start = performance.now();
  try {
    await action();
  } finally {
    running = false;
    clearInterval(timer);
    clearInterval(memoryTimer);
    sample();
    maxGapMs = Math.max(maxGapMs, performance.now() - last);
  }
  return {
    elapsedMs: performance.now() - start,
    ticks,
    maxGapMs,
    frames,
    maxFrameGapMs,
    nativeBaseline: baseline?.nativeAllocatedBytes ?? null,
    nativePeak,
    rssBaselineKiB: baseline?.rssKiB ?? null,
    rssPeakKiB,
    rssHighWaterKiB,
    heapBaseline,
    heapPeak,
    memorySampleMs,
  };
}
function payload(length: number) {
  const b = new Uint8Array(length);
  for (let i = 0; i < length; i++) b[i] = i % 251;
  return b;
}
function equalHex(bytes: Uint8Array, hex: string) {
  if (hex.length !== bytes.length * 2) return false;
  const nibble = (code: number) => (code <= 57 ? code - 48 : code - 87);
  let diff = 0;
  for (let i = 0; i < bytes.length; i++)
    diff |=
      bytes[i]! ^
      (nibble(hex.charCodeAt(2 * i)) * 16 + nibble(hex.charCodeAt(2 * i + 1)));
  return diff === 0;
}
export async function aeadChecks(report: Report) {
  for (const [backend, adapter] of [
    ['quick', quickAead],
    ['expo', expoAead],
  ] as const) {
    report('AEAD_BEGIN', { backend });
    let stage = 'vector';
    let vectorBytes = 0;
    try {
      let cases = 0;
      let rejections = 0;
      const vectors = [
        ...nist.map((v) => ({
          key: v.Key,
          nonce: v.IV,
          aad: v.AAD,
          p: fromHex(v.PT),
          ciphertext: v.CT,
          tag: v.Tag,
        })),
        ...references.aead.map((v) => ({ ...v, p: payload(v.length) })),
      ];
      for (const v of vectors) {
        const k = fromHex(v.key);
        const n = fromHex(v.nonce);
        const a = fromHex(v.aad);
        vectorBytes = v.p.length;
        stage = 'seal';
        const tag = fromHex(v.tag);
        const packet = await adapter.seal(k, n, a, v.p);
        if (
          !equalHex(packet.ciphertext, v.ciphertext) ||
          !equalBytes(packet.tag, tag) ||
          packet.tag.length !== 16
        )
          throw new SpikeError('AEAD_PARITY_FAILED');
        stage = 'open';
        const opened = await adapter.open(
          k,
          n,
          a,
          packet.ciphertext,
          packet.tag,
        );
        if (!equalBytes(opened, v.p)) throw new SpikeError('AEAD_OPEN_FAILED');
        opened.fill(0);
        for (const target of ['ciphertext', 'tag', 'aad'] as const) {
          if (target === 'ciphertext' && !packet.ciphertext.length) continue;
          if (target === 'aad' && !a.length) continue;
          const badC = packet.ciphertext.slice();
          const badT = packet.tag.slice();
          const badA = a.slice();
          const bad =
            target === 'ciphertext' ? badC : target === 'tag' ? badT : badA;
          bad[0] = bad[0]! ^ 1;
          let returned = false;
          try {
            const leak = await adapter.open(k, n, badA, badC, badT);
            returned = true;
            leak.fill(0);
          } catch {
            rejections++;
          } finally {
            badC.fill(0);
            badT.fill(0);
            badA.fill(0);
          }
          if (returned) throw new SpikeError('AEAD_ACCEPTED_TAMPER');
        }
        cases++;
        k.fill(0);
        n.fill(0);
        a.fill(0);
        v.p.fill(0);
        tag.fill(0);
        wipePacket(packet);
        await yieldJS();
      }
      report('AEAD_CORRECT', {
        backend,
        cases,
        nistCases: nist.length,
        rejections,
      });
      const key = fromHex(references.aead[0]!.key);
      const plain = payload(CHUNK);
      const aad = new Uint8Array(41);
      const nonce = new Uint8Array(12);
      const recordMs: number[] = [];
      for (const operation of ['seal', 'open'] as const) {
        const metrics = await probe(async () => {
          for (let i = 0; i < 32; i++) {
            new DataView(nonce.buffer).setUint32(8, 100 + i, false);
            const packet =
              operation === 'open'
                ? await adapter.seal(key, nonce, aad, plain)
                : undefined;
            const start = performance.now();
            if (operation === 'seal') {
              const r = await adapter.seal(key, nonce, aad, plain);
              wipePacket(r);
            } else {
              const r = await adapter.open(
                key,
                nonce,
                aad,
                packet!.ciphertext,
                packet!.tag,
              );
              r.fill(0);
              wipePacket(packet!);
            }
            recordMs.push(performance.now() - start);
            await yieldJS();
          }
        });
        // open elapsed includes preparing a valid ciphertext per record; raw record
        // durations are reported independently to avoid mislabeling that wall time.
        const cpuMs = recordMs.splice(0).reduce((a, b) => a + b, 0);
        report('AEAD_PERFORMANCE', {
          backend,
          operation,
          bytes: 32 * CHUNK,
          records: 32,
          recordApiMs: cpuMs,
          MBps: (32 * CHUNK) / 1e6 / (cpuMs / 1000),
          ...metrics,
        });
      }
      const abort = new AbortController();
      let written = 0;
      let requestedAt = 0;
      let settledAt = 0;
      const timer = setTimeout(() => {
        requestedAt = performance.now();
        abort.abort();
      }, 10);
      try {
        for (let i = 0; i < 64; i++) {
          if (abort.signal.aborted) break;
          new DataView(nonce.buffer).setUint32(8, 1000 + i, false);
          const r = await adapter.seal(key, nonce, aad, plain);
          if (!abort.signal.aborted) written++;
          wipePacket(r);
          if (abort.signal.aborted) break;
          await yieldJS();
        }
        settledAt = performance.now();
      } finally {
        clearTimeout(timer);
        key.fill(0);
        plain.fill(0);
        aad.fill(0);
        nonce.fill(0);
      }
      report('AEAD_CANCEL', {
        backend,
        requested: abort.signal.aborted,
        responseMs: requestedAt ? settledAt - requestedAt : null,
        completedBeforeCancel: written,
        lateWrite: false,
      });
    } catch (error: unknown) {
      report('AEAD_FAILED', {
        backend,
        reason: error instanceof SpikeError ? error.reason : 'NATIVE_API_ERROR',
        stage,
        vectorBytes,
        errorType: error instanceof Error ? error.name : 'UNKNOWN',
      });
    }
  }
}
const nativeScrypt: TestScrypt = async (password, salt, options) => {
  const q = await quick();
  return new Promise<Uint8Array>((resolve, reject) =>
    q.scrypt(
      password,
      salt,
      options.dkLen,
      { N: options.N, r: options.r, p: options.p, maxmem: options.maxmem },
      (err, key) => {
        if (err || !key) reject(new SpikeError('NATIVE_SCRYPT_ERROR'));
        else resolve(key);
      },
    ),
  );
};
function production(log2N: number) {
  if (![15, 16, 17, 18].includes(log2N)) throw new SpikeError('RESOURCE_LIMIT');
  const v = references.production.find((v) => v.log2N === log2N);
  if (!v) throw new SpikeError('REFERENCE_MISSING');
  return {
    password: fromHex(v.password),
    salt: fromHex(v.salt),
    expected: fromHex(v.expected),
  };
}
async function nativeAttempt(
  log2N: number,
  abortMs: number | null,
  scenario: string,
  report: Report,
) {
  const v = production(log2N);
  const signal = new AbortController();
  let abortAt = 0;
  let callerAt = 0;
  let stoppedAt = 0;
  let continued = false;
  let continuedAt = 0;
  let passwordWiped = false;
  let lateWiped = false;
  let failure = false;
  let finishCaller: () => void = () => {};
  let finishCpu: () => void = () => {};
  const caller = new Promise<void>((r) => {
    finishCaller = r;
  });
  const cpu = new Promise<void>((r) => {
    finishCpu = r;
  });
  const onAbort = () => {
    abortAt = performance.now();
    finishCaller();
    report('KDF_CALLER_CANCELED', {
      log2N,
      scenario,
      cleanupPending: true,
    });
  };
  signal.signal.addEventListener('abort', onAbort, { once: true });
  const start = performance.now();
  if (abortMs === -1) signal.abort();
  if (signal.signal.aborted) {
    v.password.fill(0);
    v.salt.fill(0);
    v.expected.fill(0);
    report('KDF_CANCEL', {
      backend: 'native',
      log2N,
      scenario,
      started: false,
      responseMs: 0,
      cpuStopAfterAbortMs: 0,
      passwordWiped: true,
      lateWiped: true,
      continuedAfterAbort: false,
    });
    return 0;
  }
  const q = await quick();
  q.scrypt(
    v.password,
    v.salt,
    32,
    { N: 2 ** log2N, r: 8, p: 1, maxmem: references.maxmem },
    (err, key) => {
      stoppedAt = performance.now(); // Upper bound: work finished before callback delivery.
      if (err || !key) failure = true;
      else {
        if (!signal.signal.aborted) {
          continued = true;
          continuedAt = performance.now();
          if (!equalBytes(key, v.expected)) failure = true;
        }
        key.fill(0);
        lateWiped = key.every((b) => b === 0);
      }
      v.password.fill(0);
      passwordWiped = v.password.every((b) => b === 0);
      v.salt.fill(0);
      v.expected.fill(0);
      if (!signal.signal.aborted) {
        finishCaller();
      }
      finishCpu();
    },
  );
  const timer =
    abortMs === null ? undefined : setTimeout(() => signal.abort(), abortMs);
  await caller;
  // Measure when the waiting caller actually resumes, not two timestamps
  // inside the abort handler. CPU work can still be running at this point.
  callerAt = performance.now();
  if (abortAt > 0)
    report('KDF_CALLER_CANCEL_RESPONSE', {
      log2N,
      scenario,
      responseMs: callerAt - abortAt,
      cleanupPending: stoppedAt === 0,
    });
  await cpu;
  if (timer !== undefined) clearTimeout(timer);
  signal.signal.removeEventListener('abort', onAbort);
  if (scenario === 'after-completion' && !signal.signal.aborted) signal.abort();
  report(abortMs === null ? 'KDF_NATIVE_COMPLETE' : 'KDF_CANCEL', {
    backend: 'native',
    log2N,
    scenario,
    maxmem: references.maxmem,
    started: true,
    elapsedMs: stoppedAt - start,
    responseMs: abortAt ? callerAt - abortAt : null,
    cpuStopAfterAbortMs: abortAt ? stoppedAt - abortAt : 0,
    cpuStopIsCallbackUpperBound: true,
    passwordWiped,
    lateWiped,
    continuedAfterAbort: abortAt > 0 && continued && continuedAt > abortAt,
    abortAfterCompletion: scenario === 'after-completion',
    parity: !failure,
    aborted: signal.signal.aborted,
  });
  if (failure) throw new SpikeError('NATIVE_SCRYPT_PARITY_FAILED');
  return stoppedAt - start;
}
export async function kdfChecks(report: Report) {
  report('KDF_NOBLE_BEGIN', { log2N: 17, maxmem: references.maxmem });
  let nobleFailed = false;
  try {
    const kats = await rfcAnswers((p, s, o) =>
      scryptAsync(p, s, { ...o, asyncTick: 10 }),
    );
    report('KDF_KAT', { backend: 'noble', kats, parity: true });
    const v = production(17);
    let parity = false;
    const metrics = await probe(async () => {
      let key: Uint8Array | undefined;
      try {
        key = await scryptAsync(v.password, v.salt, {
          N: 2 ** 17,
          r: 8,
          p: 1,
          dkLen: 32,
          maxmem: references.maxmem,
          asyncTick: 10,
        });
        parity = equalBytes(key, v.expected);
      } finally {
        key?.fill(0);
        v.password.fill(0);
        v.salt.fill(0);
        v.expected.fill(0);
      }
    });
    nobleFailed =
      !parity ||
      metrics.elapsedMs > 8000 ||
      metrics.ticks === 0 ||
      metrics.frames === 0;
    report('KDF_NOBLE_COMPLETE', {
      log2N: 17,
      parity,
      timingPass: metrics.elapsedMs <= 8000,
      ...metrics,
    });
    const c = new AbortController();
    const p = production(17);
    let requestAt = 0;
    let canceled = false;
    const timer = setTimeout(() => {
      requestAt = performance.now();
      c.abort();
    }, 100);
    try {
      const key = await scryptAsync(p.password, p.salt, {
        N: 2 ** 17,
        r: 8,
        p: 1,
        dkLen: 32,
        maxmem: references.maxmem,
        asyncTick: 10,
        onProgress: () => {
          if (c.signal.aborted) throw new SpikeError('CANCELLED');
        },
      });
      key.fill(0);
    } catch {
      canceled = c.signal.aborted;
    } finally {
      clearTimeout(timer);
      p.password.fill(0);
      p.salt.fill(0);
      p.expected.fill(0);
    }
    report('KDF_NOBLE_CANCEL', {
      canceled,
      responseMs: requestAt ? performance.now() - requestAt : null,
      passwordWiped: p.password.every((b) => b === 0),
    });
    nobleFailed ||= !canceled;
  } catch {
    nobleFailed = true;
    report('KDF_NOBLE_FAILED', { reason: 'NOBLE_API_OR_PARITY_ERROR' });
  }
  await nativeKdfChecks(report, nobleFailed);
}
export async function nativeKdfChecks(
  report: Report,
  mandatoryFallback = true,
) {
  report('KDF_NATIVE_BEGIN', { mandatoryFallback });
  try {
    const kats = await rfcAnswers(nativeScrypt);
    report('KDF_KAT', { backend: 'native', kats, parity: true });
    for (const log2N of [17, 18]) {
      let elapsed = 0;
      const metrics = await probe(async () => {
        elapsed = await nativeAttempt(log2N, null, 'complete', report);
      }, 16);
      report('KDF_NATIVE_UI', {
        log2N,
        ...metrics,
        timingPass: log2N === 18 || elapsed <= 8000,
      });
      const warm = Math.min(
        await nativeAttempt(log2N, null, 'calibration-1', report),
        await nativeAttempt(log2N, null, 'calibration-2', report),
      );
      const ui = await probe(async () => {
        await nativeAttempt(log2N, null, 'timing-with-light-sampling', report);
      });
      report('KDF_NATIVE_LIGHT_UI', { log2N, ...ui });
      for (const [scenario, abortMs] of [
        ['pre', -1],
        ['early', 1],
        ['mid', Math.max(1, warm * 0.5)],
        ['late', Math.max(1, warm * 0.8)],
        ['race-before', warm * 0.95],
        ['race-after', warm * 1.05],
        ['after-completion', warm * 1.2],
      ] as const)
        await nativeAttempt(log2N, abortMs, scenario, report);
    }
    const q = await quick();
    for (const abortFirst of [false, true]) {
      const race = await invalidResourceRace(
        (p, s, callback) =>
          q.scrypt(p, s, 32, { N: 2 ** 17, r: 8, p: 1, maxmem: 1 }, callback),
        abortFirst,
      );
      report('KDF_ERROR_RACE', { ...race, validationBeforeCpuWork: true });
    }
  } catch {
    report('KDF_NATIVE_FAILED', {
      reason: 'NATIVE_UNAVAILABLE_OR_PARITY_FAILED',
    });
  }
}
