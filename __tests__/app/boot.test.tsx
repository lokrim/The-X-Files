import { act, type ReactNode } from 'react';
import * as ReactNative from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { createRoot } from 'test-renderer';

import Home from '../../app/index';
import { ThemeProvider } from '@/ui/theme';
import { palettes } from '@/ui/tokens';

const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('expo-router/stack', () => ({
  Stack: {
    Screen: ({ options }: { options: { headerRight: () => ReactNode } }) =>
      options.headerRight(),
  },
}));

test.each([
  { width: 360, fontScale: 1, scheme: 'light', actionDirection: 'column' },
  { width: 720, fontScale: 1, scheme: 'dark', actionDirection: 'row' },
  { width: 720, fontScale: 2, scheme: 'dark', actionDirection: 'column' },
] as const)(
  'Home preserves navigation and adapts at $width dp, font scale $fontScale, $scheme',
  async ({ width, fontScale, scheme, actionDirection }) => {
    const dimensions = jest
      .spyOn(
        jest.requireActual<typeof ReactNative>('react-native'),
        'useWindowDimensions',
      )
      .mockReturnValue({
        width,
        height: 800,
        scale: 1,
        fontScale,
      });
    const screen = createRoot();
    try {
      await act(async () => {
        screen.render(
          <SafeAreaProvider
            initialMetrics={{
              frame: { x: 0, y: 0, width, height: 800 },
              insets: { top: 24, left: 0, right: 0, bottom: 24 },
            }}
          >
            <ThemeProvider preference={scheme}>
              <Home />
            </ThemeProvider>
          </SafeAreaProvider>,
        );
      });
      const tree = JSON.stringify(screen.container.toJSON());
      expect(tree).toContain(palettes[scheme].bg);
      expect(tree).toContain('Offline file encryption');
      expect(tree).toContain(
        'X-Files makes no network connections itself; apps you choose to save to or share with may.',
      );
      const buttons = screen.container.queryAll(
        (node) => node.props.accessibilityRole === 'button',
      );
      const actionCards = buttons.filter((button) =>
        /^(Encrypt|Decrypt),/.test(button.props.accessibilityLabel),
      );
      expect(actionCards).toHaveLength(2);
      expect(actionCards.map((card) => card.props.accessibilityLabel)).toEqual([
        expect.stringMatching(/^Encrypt, Protect/),
        expect.stringMatching(/^Decrypt,.*Not available yet\.$/),
      ]);
      expect(
        actionCards.map((card) => card.props.accessibilityState.disabled),
      ).toEqual([false, true]);
      await act(async () => {
        actionCards[0]!.props.onClick({
          nativeEvent: {},
          target: null,
          currentTarget: null,
          stopPropagation() {},
        });
      });
      expect(mockPush).toHaveBeenLastCalledWith('/encrypt');
      expect(
        actionCards.map(
          (card) => ReactNative.StyleSheet.flatten(card.props.style)?.flex,
        ),
      ).toEqual(actionDirection === 'row' ? [1, 1] : [undefined, undefined]);

      const settings = buttons.find(
        (button) => button.props.accessibilityLabel === 'Settings',
      )!;
      expect(
        ReactNative.StyleSheet.flatten(settings.props.style),
      ).toMatchObject({
        minHeight: 48,
        minWidth: 48,
      });
      await act(async () => {
        settings.props.onClick({
          nativeEvent: {},
          target: null,
          currentTarget: null,
          stopPropagation() {},
        });
      });
      expect(mockPush).toHaveBeenLastCalledWith('/settings');
    } finally {
      await act(async () => screen.unmount());
      dimensions.mockRestore();
    }
  },
);
