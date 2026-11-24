import type { Rng } from '@/core/contracts';
import { zeroize } from '@/core/crypto/bytes';
import { CoreError } from '@/core/crypto/errors';
import { encodeKey } from '@/core/crypto/key-codec';
import { encodeShare, split } from '@/core/shamir';
import type { EncryptResult } from '@/core/xfile';
import type { ProtectionChoice } from './workflow';

export type RecoveryCard = {
  label: string;
  read: () => string | null;
};

export type Recovery = {
  mode: ProtectionChoice['mode'];
  cards: readonly RecoveryCard[];
  setId?: string;
  wipe: () => void;
};

export function createRecovery(
  choice: ProtectionChoice,
  result: EncryptResult,
  rng: Rng,
): Recovery {
  if (result.mode === 'password') {
    if (choice.mode !== 'password') throw new CoreError('IO_ERROR');
    return { mode: 'password', cards: [], wipe() {} };
  }

  if (choice.mode === 'key') {
    let key: Uint8Array | undefined = result.fileKey;
    return {
      mode: 'key',
      cards: [{ label: 'Key', read: () => (key ? encodeKey(key) : null) }],
      wipe() {
        zeroize(key);
        key = undefined;
      },
    };
  }

  try {
    if (choice.mode !== 'shares') throw new CoreError('IO_ERROR');
    const shares = split(result.fileKey, choice.total, choice.threshold, rng);
    const setId = Array.from(shares[0]!.setId, (byte) =>
      byte.toString(16).padStart(2, '0').toUpperCase(),
    ).join('');
    let available = true;
    return {
      mode: 'shares',
      setId,
      cards: shares.map((share) => ({
        label: `Share ${share.x} of ${share.total}`,
        read: () => (available ? encodeShare(share) : null),
      })),
      wipe() {
        available = false;
        for (const share of shares) zeroize(share.y);
      },
    };
  } finally {
    zeroize(result.fileKey);
  }
}
