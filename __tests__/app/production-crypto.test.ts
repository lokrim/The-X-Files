import { createQuickScrypt, aead } from '@/platform/crypto';
import { writerScryptParams } from '@/core/crypto/kdf-policy';
import nist from '../../test-utils/p01b/nist-gcm.json';
import { fromHex } from '../../test-utils/p01b/rfc-adapter';

test.each(nist)(
  'production AEAD wrapper checks NIST answers with the host backend',
  async (v) => {
    const key = fromHex(v.Key);
    const iv = fromHex(v.IV);
    const aad = fromHex(v.AAD);
    const plaintext = fromHex(v.PT);
    const packet = await aead.seal(key, iv, aad, plaintext);
    expect(packet.ciphertext).toEqual(fromHex(v.CT));
    expect(packet.tag).toEqual(fromHex(v.Tag));
    expect(
      await aead.open(key, iv, aad, packet.ciphertext, packet.tag),
    ).toEqual(plaintext);
    packet.tag[15] = packet.tag[15]! ^ 1;
    await expect(
      aead.open(key, iv, aad, packet.ciphertext, packet.tag),
    ).rejects.toMatchObject({ code: 'AUTH_FAILED' });
    await expect(
      aead.open(key, iv, aad, packet.ciphertext, packet.tag.subarray(0, 15)),
    ).rejects.toMatchObject({ code: 'AUTH_FAILED' });
  },
);

test('cancelled native derivation retains ownership until callback and then wipes both buffers', async () => {
  const password = Uint8Array.of(6);
  const salt = new Uint8Array(16);
  const lateKey = new Uint8Array(32).fill(7);
  let finish: (() => void) | undefined;
  const start = jest.fn<
    void,
    Parameters<NonNullable<Parameters<typeof createQuickScrypt>[0]>>
  >((ownedPassword, _, keyLength, options, callback) => {
    expect(ownedPassword).not.toBe(password);
    expect(ownedPassword[0]).toBe(6);
    expect(keyLength).toBe(32);
    expect(options).toEqual({
      N: 2 ** 17,
      r: 8,
      p: 1,
      maxmem: 384 * 2 ** 20,
    });
    finish = () => {
      callback(null, lateKey);
      expect(ownedPassword[0]).toBe(0);
    };
  });
  const kdf = createQuickScrypt(start);
  const cancel = new AbortController();
  const work = kdf.derive(password, salt, writerScryptParams, cancel.signal);
  cancel.abort();
  await expect(work).rejects.toMatchObject({ code: 'CANCELLED' });
  await expect(
    kdf.derive(password, salt, writerScryptParams),
  ).rejects.toMatchObject({ code: 'IO_ERROR' });
  expect(lateKey[0]).toBe(7);
  finish!();
  expect(lateKey).toEqual(new Uint8Array(32));
  expect(password[0]).toBe(6);
  expect(start).toHaveBeenCalledTimes(1);
});
