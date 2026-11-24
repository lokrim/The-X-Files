import { scrypt } from 'react-native-quick-crypto';

import {
  aead,
  createQuickScrypt,
  cryptoAdapters,
} from '../../src/platform/crypto';
import { CoreError } from '../../src/core/crypto/errors';
import {
  equalBytes,
  fromHex,
  rfcAnswers,
} from '../../test-utils/p01b/rfc-adapter';
import nist from '../../test-utils/p01b/nist-gcm.json';
import refs from '../../test-utils/p01b/crypto-references.json';

export type Report = (
  reason: string,
  metrics: Record<string, number | boolean>,
) => void;
const writer = { log2N: 17, r: 8, p: 1, dkLen: 32 } as const;

function assert(value: boolean) {
  if (!value) throw new CoreError('IO_ERROR');
}
async function verifyGcm(vector: {
  key: Uint8Array;
  nonce: Uint8Array;
  aad: Uint8Array;
  plain: Uint8Array;
  expected: Uint8Array;
  tag: Uint8Array;
}) {
  const { key, nonce, aad, plain, expected, tag } = vector;
  const packet = await aead.seal(key, nonce, aad, plain);
  assert(
    equalBytes(packet.ciphertext, expected) && equalBytes(packet.tag, tag),
  );
  assert(equalBytes(await aead.open(key, nonce, aad, expected, tag), plain));
  for (const field of [tag, aad, expected].filter(
    (bytes) => bytes.length > 0,
  )) {
    field[0] = field[0]! ^ 1;
    try {
      await aead.open(key, nonce, aad, expected, tag);
      throw new CoreError('IO_ERROR');
    } catch (error) {
      if (!(error instanceof CoreError) || error.code !== 'AUTH_FAILED')
        throw error;
    } finally {
      field[0] = field[0]! ^ 1;
    }
  }
}

export async function runAeadVectors(report: Report) {
  for (const v of nist)
    await verifyGcm({
      key: fromHex(v.Key),
      nonce: fromHex(v.IV),
      aad: fromHex(v.AAD),
      plain: fromHex(v.PT),
      expected: fromHex(v.CT),
      tag: fromHex(v.Tag),
    });
  for (const v of refs.aead)
    await verifyGcm({
      key: fromHex(v.key),
      nonce: fromHex(v.nonce),
      aad: fromHex(v.aad),
      plain: Uint8Array.from({ length: v.length }, (_, i) => i % 251),
      expected: fromHex(v.ciphertext),
      tag: fromHex(v.tag),
    });
  const key = cryptoAdapters.rng.bytes(32);
  const data = new Uint8Array(2 ** 20);
  const nonce = new Uint8Array(12);
  const aad = new Uint8Array(41);
  let sealMs = 0;
  let openMs = 0;
  for (let i = 0; i < 64; i++) {
    nonce[11] = i;
    const start = performance.now();
    const packet = await aead.seal(key, nonce, aad, data);
    const sealed = performance.now();
    const bytes = await aead.open(
      key,
      nonce,
      aad,
      packet.ciphertext,
      packet.tag,
    );
    sealMs += sealed - start;
    openMs += performance.now() - sealed;
    assert(equalBytes(bytes, data));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  key.fill(0);
  const sealMBps = (64 * data.length) / 1000 / sealMs;
  const openMBps = (64 * data.length) / 1000 / openMs;
  report('AEAD_RATE', {
    nist: nist.length,
    node: refs.aead.length,
    sealMBps,
    openMBps,
  });
  assert(sealMBps >= 15 && openMBps >= 15);
}

export async function runKdfVectors(report: Report) {
  const rfc = await rfcAnswers(
    (password, salt, { dkLen, ...options }) =>
      new Promise((resolve, reject) =>
        scrypt(password, salt, dkLen, options, (error, key) => {
          if (error || !key) reject(new CoreError('IO_ERROR'));
          else resolve(key);
        }),
      ),
  );
  report('RFC_PASS', { rfc });
  for (const v of refs.production) {
    const start = performance.now();
    const key = await cryptoAdapters.kdf.derive(
      fromHex(v.password),
      fromHex(v.salt),
      {
        ...writer,
        log2N: v.log2N === 18 ? 18 : 17,
      },
    );
    const ms = performance.now() - start;
    try {
      assert(equalBytes(key, fromHex(v.expected)));
      report('KDF_PARITY_PASS', { log2N: v.log2N, ms });
      if (v.log2N === 17 && ms > 8000) throw new CoreError('IO_ERROR');
    } finally {
      key.fill(0);
    }
  }
}

function fixture(log2N: 17 | 18) {
  const v = refs.production.find((sample) => sample.log2N === log2N);
  if (!v) throw new CoreError('IO_ERROR');
  return {
    password: fromHex(v.password),
    salt: fromHex(v.salt),
    expected: fromHex(v.expected),
  };
}

async function deriveFixture(log2N: 17 | 18) {
  const { password, salt, expected } = fixture(log2N);
  const start = performance.now();
  const key = await cryptoAdapters.kdf.derive(password, salt, {
    ...writer,
    log2N,
  });
  try {
    assert(equalBytes(key, expected));
    return performance.now() - start;
  } finally {
    key.fill(0);
    password.fill(0);
  }
}

export async function runKdfMemory(log2N: 17 | 18, report: Report) {
  report('KDF_MEMORY_START', { log2N });
  let maxMs = 0;
  for (let trial = 0; trial < 12; trial++) {
    maxMs = Math.max(maxMs, await deriveFixture(log2N));
  }
  report('KDF_MEMORY_END', { log2N, trials: 12, maxMs });
}

export async function runKdfCancellation(report: Report) {
  const neverStart = createQuickScrypt(() => {
    throw new Error('UNEXPECTED_NATIVE_DISPATCH');
  });
  const preStart = new AbortController();
  preStart.abort();
  try {
    const { password, salt } = fixture(17);
    await neverStart.derive(password, salt, writer, preStart.signal);
    throw new CoreError('IO_ERROR');
  } catch (error) {
    if (!(error instanceof CoreError) || error.code !== 'CANCELLED')
      throw error;
  }
  report('KDF_CANCEL_PRESTART_PASS', {});
  for (const [stage, fraction] of [0, 0.35, 0.75].entries()) {
    const log2N = stage === 2 ? 18 : 17;
    let estimate = await deriveFixture(log2N);
    for (let attempt = 0; attempt < 2; attempt++) {
      const { password, salt } = fixture(log2N);
      const cancel = new AbortController();
      let abortAt: number | undefined;
      let nativeAt = 0;
      let wiped = false;
      let resolveNative!: () => void;
      const nativeDone = new Promise<void>((resolve) => {
        resolveNative = resolve;
      });
      const kdf = createQuickScrypt(
        (ownedPassword, ownedSalt, length, options, done) => {
          scrypt(ownedPassword, ownedSalt, length, options, (error, key) => {
            nativeAt = performance.now();
            done(error, key);
            wiped =
              !error &&
              !!key &&
              key.every((byte) => byte === 0) &&
              ownedPassword.every((byte) => byte === 0) &&
              ownedSalt.every((byte) => byte === 0);
            resolveNative();
          });
        },
      );
      const started = performance.now();
      const work = kdf.derive(
        password,
        salt,
        { ...writer, log2N },
        cancel.signal,
      );
      const requestCancel = () => {
        abortAt = performance.now();
        cancel.abort();
      };
      const delayMs = Math.floor(estimate * fraction);
      const timer =
        delayMs > 0 ? setTimeout(requestCancel, delayMs) : undefined;
      if (timer === undefined) requestCancel();
      let callerMs: number | undefined;
      try {
        // Callback beat the timer. Record the miss instead of calling it a cancel.
        (await work).fill(0);
      } catch (error) {
        if (
          !(error instanceof CoreError) ||
          error.code !== 'CANCELLED' ||
          abortAt === undefined
        )
          throw error;
        callerMs = performance.now() - abortAt;
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        password.fill(0);
      }
      await nativeDone;
      assert(wiped);
      if (
        callerMs !== undefined &&
        abortAt !== undefined &&
        nativeAt >= abortAt
      ) {
        report('KDF_CANCEL_TRIAL_PASS', {
          stage,
          log2N,
          delayMs,
          actualAbortAfterStartMs: abortAt - started,
          callerMs,
          cpuStopUpperBoundMs: nativeAt - abortAt,
          wiped,
        });
        break;
      }
      report('KDF_CANCEL_MISSED', { stage, log2N, delayMs });
      if (attempt === 1) throw new CoreError('IO_ERROR');
      estimate = (nativeAt - started) / 2;
    }
  }
}
