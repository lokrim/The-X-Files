import { useEffect, useState } from 'react';

import { playHaptic } from '@/platform/haptics';

const revealSeconds = 15;

/** This hook belongs inside the protected subtree. Unmount resets only visibility. */
export function useSecretReveal() {
  const [holding, setHolding] = useState(false);
  const [deadline, setDeadline] = useState<number | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);

  useEffect(() => {
    if (deadline === null) return;
    const tick = setInterval(() => {
      const seconds = Math.max(
        0,
        Math.ceil((deadline - performance.now()) / 1000),
      );
      setSecondsLeft(seconds);
      if (seconds === 0) setDeadline(null);
    }, 250);
    return () => clearInterval(tick);
  }, [deadline]);

  return {
    revealed: holding || deadline !== null,
    secondsLeft: deadline === null ? null : secondsLeft,
    onToggleReveal() {
      if (holding || deadline !== null) {
        setHolding(false);
        setDeadline(null);
        return;
      }
      playHaptic('reveal');
      setSecondsLeft(revealSeconds);
      setDeadline(performance.now() + revealSeconds * 1000);
    },
    onHoldStart() {
      setDeadline(null);
      setHolding(true);
      playHaptic('reveal');
    },
    onHoldEnd() {
      setHolding(false);
    },
  };
}
