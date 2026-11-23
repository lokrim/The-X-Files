import { nodeAead } from '../../test-utils/node-crypto';
import { fromHex, toHex } from '../../test-utils/hex';
import vectors from '../../test-utils/p01b/nist-gcm.json';

test.each(vectors)(
  'NIST AES-256-GCM exact ciphertext/tag and authenticated open: $lengths',
  async (v) => {
    const key = fromHex(v.Key),
      nonce = fromHex(v.IV),
      aad = fromHex(v.AAD),
      plaintext = fromHex(v.PT);
    const sealed = await nodeAead.seal(key, nonce, aad, plaintext);
    expect(toHex(sealed.ciphertext)).toBe(v.CT);
    expect(toHex(sealed.tag)).toBe(v.Tag);
    expect(sealed.tag).toHaveLength(16);
    expect(
      await nodeAead.open(key, nonce, aad, sealed.ciphertext, sealed.tag),
    ).toEqual(plaintext);
    const mutate = (bytes: Uint8Array) => {
      if (!bytes.length) return Uint8Array.from([1]);
      const copy = bytes.slice();
      copy[0] = copy[0]! ^ 1;
      return copy;
    };
    for (const [badAad, badCiphertext, badTag] of [
      [aad, mutate(sealed.ciphertext), sealed.tag],
      [aad, sealed.ciphertext, mutate(sealed.tag)],
      [mutate(aad), sealed.ciphertext, sealed.tag],
      [aad, sealed.ciphertext, sealed.tag.subarray(1)],
    ]) {
      let released: Uint8Array | undefined;
      await expect(
        nodeAead
          .open(key, nonce, badAad!, badCiphertext!, badTag!)
          .then((bytes) => {
            released = bytes;
          }),
      ).rejects.toMatchObject({ code: 'AUTH_FAILED' });
      expect(released).toBeUndefined();
    }
    await expect(
      nodeAead.open(mutate(key), nonce, aad, sealed.ciphertext, sealed.tag),
    ).rejects.toMatchObject({ code: 'AUTH_FAILED' });
  },
);
