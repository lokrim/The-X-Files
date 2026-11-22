// Small RFC costs belong only in this test adapter, never the application policy.
import references from './crypto-references.json';
export type TestScrypt = (
  password: Uint8Array,
  salt: Uint8Array,
  options: { N: number; r: number; p: number; dkLen: number; maxmem: number },
) => Promise<Uint8Array>;
export function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++)
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}
export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}
export async function rfcAnswers(derive: TestScrypt): Promise<number> {
  let count = 0;
  for (const v of references.rfc) {
    const password = fromHex(v.password);
    const salt = fromHex(v.salt);
    const expected = fromHex(v.expected);
    let result: Uint8Array | undefined;
    try {
      result = await derive(password, salt, {
        N: v.N,
        r: v.r,
        p: v.p,
        dkLen: 64,
        maxmem: references.maxmem,
      });
      if (!equalBytes(result, expected)) throw new Error('RFC_PARITY_FAILED');
      count++;
    } finally {
      password.fill(0);
      salt.fill(0);
      expected.fill(0);
      result?.fill(0);
    }
  }
  return count;
}
export async function invalidResourceRace(
  invoke: (
    password: Uint8Array,
    salt: Uint8Array,
    callback: (error: Error | null, key?: Uint8Array) => void,
  ) => void,
  abortFirst: boolean,
) {
  const password = new Uint8Array(16);
  const salt = new Uint8Array(16);
  const signal = new AbortController();
  let callbacks = 0;
  let continued = false;
  let rejected = false;
  let lateWiped = true;
  if (abortFirst) signal.abort();
  await new Promise<void>((resolve) =>
    invoke(password, salt, (error, key) => {
      callbacks++;
      rejected = error !== null;
      if (!error && !signal.signal.aborted) continued = true;
      if (key) {
        key.fill(0);
        lateWiped = key.every((b) => b === 0);
      }
      password.fill(0);
      salt.fill(0);
      resolve();
    }),
  );
  if (!abortFirst) signal.abort();
  return {
    callbacks,
    rejected,
    continued,
    passwordWiped: password.every((b) => b === 0),
    lateWiped,
    abortFirst,
  };
}
