import type { ButtonProps } from '@expo/ui';
import * as SecureStore from 'expo-secure-store';
import { act } from 'react';
import { createRoot } from 'test-renderer';

import Settings from '../../app/settings';
import { settingsStore } from '@/platform/composition';

jest.mock('@expo/ui', () => {
  const { Text, View } =
    jest.requireActual<typeof import('react-native')>('react-native');
  return {
    Host: View,
    Column: View,
    // Render the label Android turns into native text.
    Button: ({ label, disabled, onPress }: ButtonProps) => (
      <Text accessibilityRole="button" onPress={disabled ? undefined : onPress}>
        {label}
      </Text>
    ),
  };
});

test('Settings supplies visible theme labels and marks the saved selection', async () => {
  const read = jest.spyOn(SecureStore, 'getItemAsync').mockResolvedValue(null);
  const write = jest
    .spyOn(SecureStore, 'setItemAsync')
    .mockRejectedValueOnce(new Error('Storage unavailable'))
    .mockResolvedValue(undefined);
  const screen = createRoot();
  const buttons = () =>
    screen.container.queryAll(
      (node) => node.props.accessibilityRole === 'button',
    );

  try {
    await act(async () => {
      await settingsStore.getState().hydrate();
      screen.render(<Settings />);
    });
    expect(buttons().map((button) => button.children)).toEqual([
      ['✓ System'],
      ['Light'],
      ['Dark'],
      ['Off'],
      ['30 seconds'],
      ['✓ 60 seconds'],
    ]);

    await act(async () => {
      buttons()[2]!.props.onPress();
    });
    expect(buttons()[0]!.children).toEqual(['✓ System']);
    expect(JSON.stringify(screen.container.toJSON())).toContain(
      'Could not save or load preferences.',
    );

    await act(async () => {
      buttons()[2]!.props.onPress();
    });
    expect(buttons().map((button) => button.children)).toEqual([
      ['System'],
      ['Light'],
      ['✓ Dark'],
      ['Off'],
      ['30 seconds'],
      ['✓ 60 seconds'],
    ]);
    await act(async () => {
      buttons()[4]!.props.onPress();
    });
    expect(buttons()[4]!.children).toEqual(['✓ 30 seconds']);
    expect(JSON.stringify(screen.container.toJSON())).not.toContain(
      'Could not save or load preferences.',
    );
  } finally {
    await act(async () => {
      screen.unmount();
    });
    read.mockRestore();
    write.mockRestore();
  }
});
