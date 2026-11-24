import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { AppState, View } from 'react-native';

import { nativeCall } from './native';

const ScreenReady = createContext(false);

export function ScreenPrivacy({
  blocking,
  children,
}: {
  blocking: boolean;
  children: ReactNode;
}) {
  const [focusAttempt, setFocusAttempt] = useState<number | null>(null);
  const configuration = useMemo(
    () => ({ blocking, focusAttempt }),
    [blocking, focusAttempt],
  );
  const [confirmed, setConfirmed] = useState<typeof configuration | null>(null);

  useEffect(() => {
    let active = AppState.currentState === 'active';
    const hide = () => {
      setFocusAttempt(null);
      setConfirmed(null);
    };
    const show = () => {
      if (!active) return;
      setFocusAttempt((previous) => (previous ?? 0) + 1);
      void nativeCall((native) => native.expireClipboard()).catch(
        () => undefined,
      );
    };
    const state = AppState.addEventListener('change', (next) => {
      active = next === 'active';
      if (active) show();
      else hide();
    });
    const blur = AppState.addEventListener('blur', hide);
    const focus = AppState.addEventListener('focus', show);
    show();
    return () => {
      state.remove();
      blur.remove();
      focus.remove();
    };
  }, []);

  useEffect(() => {
    if (configuration.focusAttempt === null) return;
    let mounted = true;
    void nativeCall((native) => native.setScreenSecure(configuration.blocking))
      .then((focused) => {
        if (mounted) setConfirmed(focused ? configuration : null);
      })
      .catch(() => {
        if (mounted) setConfirmed(null);
      });
    return () => {
      mounted = false;
    };
  }, [configuration]);

  return (
    <ScreenReady.Provider value={confirmed === configuration}>
      {children}
    </ScreenReady.Provider>
  );
}

/** Keep input/result state with the flow owner. Hiding this subtree does not wipe it. */
export function SensitiveContent({ render }: { render: () => ReactNode }) {
  const ready = useContext(ScreenReady);
  return ready ? (
    render()
  ) : (
    <View accessible={false} importantForAccessibility="no-hide-descendants" />
  );
}
