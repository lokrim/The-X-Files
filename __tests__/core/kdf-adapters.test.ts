import type { ScryptParams } from '@/core/contracts';
import { writerScryptParams } from '@/core/crypto/kdf-policy';
import {
  callbackTestKdf,
  type TestKdfInvoke,
} from '../../test-utils/callback-kdf';
import {
  nodeKdf,
  nobleScryptReference,
  testNativeMaxmem,
  recordedNativeKdf,
} from '../../test-utils/kdf-references';
import { nodeScryptReference } from '../../test-utils/node-crypto';
import { fromHex, toHex } from '../../test-utils/hex';
import vectors from '../../test-utils/crypto-kats.json';

test.each(vectors.rfc)(
  'RFC7914 Node and noble answers agree at N=$N/r=$r/p=$p',
  async (v) => {
    const options = {
      N: v.N,
      r: v.r,
      p: v.p,
      dkLen: 64,
      maxmem: testNativeMaxmem,
    };
    for (const reference of [nodeScryptReference, nobleScryptReference]) {
      const key = await reference(
        fromHex(v.password),
        fromHex(v.salt),
        options,
      );
      expect(toHex(key)).toBe(v.expected);
      key.fill(0);
    }
  },
);

test('production cost17 Node contract matches retained phone/independent reference', async () => {
  const v = vectors.production.find((entry) => entry.log2N === 17)!;
  const key = await nodeKdf.derive(
    fromHex(v.password),
    fromHex(v.salt),
    writerScryptParams,
  );
  expect(toHex(key)).toBe(v.expected);
  expect(
    await recordedNativeKdf.derive(
      fromHex(v.password),
      fromHex(v.salt),
      writerScryptParams,
    ),
  ).toEqual(key);
  key.fill(0);
}, 15000);

function deferredNative() {
  let callback!: Parameters<TestKdfInvoke>[3];
  let ownedPassword!: Uint8Array;
  let ownedSalt!: Uint8Array;
  const invoke = jest.fn(
    (
      password: Uint8Array,
      salt: Uint8Array,
      _params: ScryptParams,
      done: Parameters<TestKdfInvoke>[3],
    ) => {
      ownedPassword = password;
      ownedSalt = salt;
      callback = done;
    },
  );
  return {
    invoke,
    kdf: callbackTestKdf(invoke),
    complete: (error: Error | null, key?: Uint8Array) => callback(error, key),
    password: () => ownedPassword,
    salt: () => ownedSalt,
  };
}

test('pre-start cancellation never dispatches a native operation', async () => {
  const native = deferredNative();
  const abort = new AbortController();
  abort.abort();
  await expect(
    native.kdf.derive(
      new Uint8Array(8).fill(1),
      new Uint8Array(16),
      writerScryptParams,
      abort.signal,
    ),
  ).rejects.toMatchObject({ code: 'CANCELLED' });
  expect(native.invoke).not.toHaveBeenCalled();
});

test('cancel stops waiting but keeps native-owned input until return', async () => {
  const native = deferredNative();
  const abort = new AbortController();
  const callerPassword = new Uint8Array(8).fill(3);
  let continued = false;
  const result = native.kdf
    .derive(
      callerPassword,
      new Uint8Array(16).fill(4),
      writerScryptParams,
      abort.signal,
    )
    .then(() => {
      continued = true;
    });
  abort.abort();
  await expect(result).rejects.toMatchObject({ code: 'CANCELLED' });
  expect(native.password().every((n) => n === 3)).toBe(true); // Native call not finished yet.
  const lateKey = new Uint8Array(32).fill(7);
  native.complete(null, lateKey);
  await Promise.resolve();
  expect(continued).toBe(false);
  expect(lateKey.every((n) => n === 0)).toBe(true);
  expect(native.password().every((n) => n === 0)).toBe(true);
  expect(native.salt().every((n) => n === 0)).toBe(true);
  expect(callerPassword.every((n) => n === 3)).toBe(true); // Caller retains its input ownership.
});

test('completion followed by abort in the same turn cannot release a key', async () => {
  const native = deferredNative();
  const abort = new AbortController();
  const result = native.kdf.derive(
    new Uint8Array(8).fill(1),
    new Uint8Array(16),
    writerScryptParams,
    abort.signal,
  );
  const key = new Uint8Array(32).fill(8);
  native.complete(null, key);
  abort.abort(); // Promise callbacks have not resumed the caller yet.
  await expect(result).rejects.toMatchObject({ code: 'CANCELLED' });
  expect(key.every((n) => n === 0)).toBe(true);
});

test('an error callback after abort preserves cancellation and wipes any returned key', async () => {
  const native = deferredNative();
  const abort = new AbortController();
  const result = native.kdf.derive(
    new Uint8Array(8).fill(1),
    new Uint8Array(16),
    writerScryptParams,
    abort.signal,
  );
  abort.abort();
  const late = new Uint8Array(32).fill(5);
  native.complete(new Error('private late detail'), late);
  await expect(result).rejects.toMatchObject({ code: 'CANCELLED' });
  expect(late.every((n) => n === 0)).toBe(true);
  expect(native.password().every((n) => n === 0)).toBe(true);
});

test('successful callback copies the caller key, wipes native buffers and ignores duplicate callbacks', async () => {
  const native = deferredNative();
  const abort = new AbortController();
  const result = native.kdf.derive(
    new Uint8Array(8).fill(2),
    new Uint8Array(16),
    writerScryptParams,
    abort.signal,
  );
  const nativeKey = new Uint8Array(32).fill(9);
  native.complete(null, nativeKey);
  const key = await result;
  abort.abort();
  expect(key.every((n) => n === 9)).toBe(true);
  expect(nativeKey.every((n) => n === 0)).toBe(true);
  expect(native.password().every((n) => n === 0)).toBe(true);
  const duplicate = new Uint8Array(32).fill(5);
  native.complete(null, duplicate);
  expect(duplicate.every((n) => n === 0)).toBe(true);
  expect(key.every((n) => n === 9)).toBe(true);
  key.fill(0);
});

test('cancel inside completion progress wins; native errors/malformed results still wipe', async () => {
  const native = deferredNative();
  const abort = new AbortController();
  const result = native.kdf.derive(
    new Uint8Array(8).fill(2),
    new Uint8Array(16),
    writerScryptParams,
    abort.signal,
    () => abort.abort(),
  );
  const key = new Uint8Array(32).fill(4);
  native.complete(null, key);
  await expect(result).rejects.toMatchObject({ code: 'CANCELLED' });
  expect(key.every((n) => n === 0)).toBe(true);
  for (const error of [new Error('private callback detail'), null]) {
    const failed = deferredNative();
    const promise = failed.kdf.derive(
      new Uint8Array(8).fill(2),
      new Uint8Array(16),
      writerScryptParams,
    );
    const malformed = new Uint8Array(error ? 32 : 31).fill(6);
    failed.complete(error, malformed);
    await expect(promise).rejects.toMatchObject({
      code: 'IO_ERROR',
      message: 'IO_ERROR',
    });
    expect(malformed.every((n) => n === 0)).toBe(true);
    expect(failed.password().every((n) => n === 0)).toBe(true);
  }
});

test('a synchronous dispatch error wipes owned password bytes', async () => {
  let owned!: Uint8Array;
  const kdf = callbackTestKdf((password) => {
    owned = password;
    throw new Error('private dispatch detail');
  });
  await expect(
    kdf.derive(
      new Uint8Array(8).fill(1),
      new Uint8Array(16),
      writerScryptParams,
    ),
  ).rejects.toMatchObject({ code: 'IO_ERROR' });
  expect(owned.every((n) => n === 0)).toBe(true);
});
