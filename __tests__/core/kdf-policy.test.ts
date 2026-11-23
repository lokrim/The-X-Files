import type { Kdf, ScryptParams } from '@/core/contracts';
import {
  createPolicyKdf,
  allowedScryptCosts,
  validateScryptParams,
  writerScryptParams,
} from '@/core/crypto/kdf-policy';
import { CoreError } from '@/core/crypto/errors';

const password = new Uint8Array(8).fill(1);
const salt = new Uint8Array(16);

test('only the frozen costs reach a backend, copied/frozen before dispatch', async () => {
  const derive = jest.fn<ReturnType<Kdf['derive']>, Parameters<Kdf['derive']>>(
    async () => new Uint8Array(32),
  );
  const policy = createPolicyKdf({ derive });
  for (const log2N of allowedScryptCosts) {
    const params = { ...writerScryptParams, log2N };
    await expect(policy.derive(password, salt, params)).resolves.toHaveLength(
      32,
    );
    const checked = derive.mock.calls.at(-1)![2];
    expect(checked).not.toBe(params);
    expect(Object.isFrozen(checked)).toBe(true);
  }
  expect(writerScryptParams).toEqual({ log2N: 17, r: 8, p: 1, dkLen: 32 });
});

test('bad costs/salt reject before work, including the RFC test-only parameters', async () => {
  const derive = jest.fn<ReturnType<Kdf['derive']>, Parameters<Kdf['derive']>>(
    async () => new Uint8Array(32),
  );
  const policy = createPolicyKdf({ derive });
  const invalid: unknown[] = [
    null,
    [],
    {},
    ...[4, 14, 19, 17.5, NaN, Infinity].map((log2N) => ({
      ...writerScryptParams,
      log2N,
    })),
    { ...writerScryptParams, r: 1 },
    { ...writerScryptParams, p: 16 },
    { ...writerScryptParams, dkLen: 64 },
    { ...writerScryptParams, N: 16 },
  ];
  for (const params of invalid)
    await expect(
      policy.derive(password, salt, params as ScryptParams),
    ).rejects.toMatchObject({ code: 'RESOURCE_LIMIT' });
  for (const size of [0, 15, 17])
    expect(() =>
      validateScryptParams(writerScryptParams, new Uint8Array(size)),
    ).toThrow(new CoreError('RESOURCE_LIMIT'));
  expect(derive).not.toHaveBeenCalled();
});

test('pre-abort and password-byte limits do no work; resource policy takes precedence', async () => {
  const derive = jest.fn<ReturnType<Kdf['derive']>, Parameters<Kdf['derive']>>(
    async () => new Uint8Array(32),
  );
  const policy = createPolicyKdf({ derive });
  const abort = new AbortController();
  abort.abort();
  await expect(
    policy.derive(password, salt, writerScryptParams, abort.signal),
  ).rejects.toMatchObject({ code: 'CANCELLED' });
  await expect(
    policy.derive(new Uint8Array(), salt, writerScryptParams),
  ).rejects.toMatchObject({ code: 'EMPTY_PASSWORD' });
  await expect(
    policy.derive(new Uint8Array(1025), salt, writerScryptParams),
  ).rejects.toMatchObject({ code: 'PASSWORD_TOO_LONG' });
  await expect(
    policy.derive(password, new Uint8Array(), writerScryptParams, abort.signal),
  ).rejects.toMatchObject({ code: 'RESOURCE_LIMIT' });
  expect(derive).not.toHaveBeenCalled();
});

test('malformed backend output and late abort cannot release a key', async () => {
  const short = new Uint8Array(31).fill(7);
  await expect(
    createPolicyKdf({ derive: async () => short }).derive(
      password,
      salt,
      writerScryptParams,
    ),
  ).rejects.toMatchObject({ code: 'IO_ERROR' });
  expect(short.every((n) => n === 0)).toBe(true);
  const abort = new AbortController();
  const late = new Uint8Array(32).fill(9);
  const derive = createPolicyKdf({
    derive: async () => {
      abort.abort();
      return late;
    },
  });
  await expect(
    derive.derive(password, salt, writerScryptParams, abort.signal),
  ).rejects.toMatchObject({ code: 'CANCELLED' });
  expect(late.every((n) => n === 0)).toBe(true);
  await expect(
    createPolicyKdf({
      derive: async () => {
        throw new Error('private native detail');
      },
    }).derive(password, salt, writerScryptParams),
  ).rejects.toThrow(new CoreError('IO_ERROR'));
});
