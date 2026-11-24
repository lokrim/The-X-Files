import { act } from 'react';
import { AppState, Text, type AppStateStatus } from 'react-native';
import { createRoot } from 'test-renderer';

import { nativePlatform } from '@/platform/native';
import { ScreenPrivacy } from '@/platform/screen-privacy';
import { SensitiveScreen } from '@/ui/controls/sensitive-screen';

jest.mock('@/platform/native', () => ({
  nativePlatform: jest.fn(),
  nativeCall: (invoke: (native: unknown) => unknown) =>
    invoke(jest.requireMock('@/platform/native').nativePlatform()),
}));

test('waits for FLAG_SECURE and hides sensitive content on inactivity without clearing the flow', async () => {
  const handlers = new Map<string, (state: AppStateStatus) => void>();
  const subscription = jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((event, callback) => {
      handlers.set(event, callback);
      return {
        remove: () => {
          handlers.delete(event);
        },
      };
    });
  const confirmations: ((focused: boolean) => void)[] = [];
  const setScreenSecure = jest.fn(
    () => new Promise<boolean>((resolve) => confirmations.push(resolve)),
  );
  const expireClipboard = jest.fn(() => Promise.resolve());
  jest.mocked(nativePlatform).mockReturnValue({
    setScreenSecure,
    expireClipboard,
  } as unknown as ReturnType<typeof nativePlatform>);
  const render = jest.fn(() => <Text>volatile fixture</Text>);
  const screen = createRoot();
  const tree = () => JSON.stringify(screen.container.toJSON());
  try {
    await act(async () => {
      screen.render(
        <ScreenPrivacy blocking>
          <SensitiveScreen focused render={render} />
        </ScreenPrivacy>,
      );
    });
    await act(async () => {
      handlers.get('change')?.('active');
    });
    expect(render).not.toHaveBeenCalled();
    await act(async () => {
      confirmations[0]!(false);
    });
    expect(render).not.toHaveBeenCalled();
    await act(async () => {
      handlers.get('focus')?.('active');
      // The new foreground attempt is confirmed after this event.
    });
    await act(async () => {
      confirmations[1]!(true);
    });
    expect(tree()).toContain('volatile fixture');
    await act(async () => {
      handlers.get('change')?.('inactive');
    });
    expect(tree()).not.toContain('volatile fixture');
    await act(async () => {
      handlers.get('change')?.('active');
    });
    expect(tree()).not.toContain('volatile fixture');
    await act(async () => {
      confirmations[2]!(true);
    });
    expect(tree()).toContain('volatile fixture');
    // Android can blur and focus within one JS flush. A fresh native check is
    // still required even if the intermediate hidden render was coalesced.
    await act(async () => {
      handlers.get('blur')?.('active');
      handlers.get('focus')?.('active');
    });
    expect(tree()).not.toContain('volatile fixture');
    await act(async () => {
      handlers.get('change')?.('background');
      confirmations[3]!(true);
    });
    expect(tree()).not.toContain('volatile fixture');
    await act(async () => {
      screen.render(
        <ScreenPrivacy blocking={false}>
          <SensitiveScreen focused={false} render={render} />
        </ScreenPrivacy>,
      );
      handlers.get('change')?.('active');
    });
    expect(tree()).not.toContain('volatile fixture');
    expect(setScreenSecure).toHaveBeenLastCalledWith(false);
    await act(async () => confirmations[4]!(true));
    expect(tree()).not.toContain('volatile fixture');
    expect(expireClipboard).toHaveBeenCalled();
  } finally {
    await act(async () => {
      screen.unmount();
    });
    subscription.mockRestore();
  }
});
