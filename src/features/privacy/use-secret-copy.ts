import { useStore } from 'zustand';

import { copySecret } from '@/platform/clipboard';
import { settingsStore } from '@/platform/composition';
import { playHaptic } from '@/platform/haptics';

export function useSecretCopy() {
  const expiry = useStore(
    settingsStore,
    (state) => state.settings.clipboardSeconds,
  );
  return async (secret: string) => {
    try {
      const feedback = await copySecret(secret, expiry);
      playHaptic('copy');
      return feedback;
    } catch {
      return 'Could not copy. Try again.';
    }
  };
}
