import type { SwitchProps } from '@expo/ui';
import * as SecureStore from 'expo-secure-store';
import { act } from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { createRoot } from 'test-renderer';

import Settings from '../../app/settings';
import { settingsStorage } from '@/platform/settings-storage';
import { settingsStore } from '@/platform/composition';
import { createSettingsStore, defaultSettings } from '@/store/settings-store';

jest.mock('@expo/ui', () => {
  const { Text, View } =
    jest.requireActual<typeof import('react-native')>('react-native');
  return {
    Host: View,
    Switch: ({ label, value, onValueChange, disabled }: SwitchProps) => (
      <Text
        accessibilityLabel={label}
        accessibilityRole="switch"
        accessibilityState={{ checked: value, disabled }}
        onPress={() => onValueChange(!value)}
      >
        {label}
      </Text>
    ),
  };
});

test('Settings exposes all four preferences, reports failed writes and reloads saved selections', async () => {
  let saved: string | null = null;
  const read = jest
    .spyOn(SecureStore, 'getItemAsync')
    .mockImplementation(async () => saved);
  const write = jest
    .spyOn(SecureStore, 'setItemAsync')
    .mockRejectedValueOnce(new Error('Storage unavailable'))
    .mockImplementation(async (_key, value) => {
      saved = value;
    });
  const screen = createRoot();
  const radios = () =>
    screen.container.queryAll(
      (node) => node.props.accessibilityRole === 'radio',
    );
  const selected = () =>
    radios()
      .filter((radio) => radio.props.accessibilityState.checked)
      .map((radio) => radio.props.accessibilityLabel);
  const switches = () =>
    screen.container.queryAll(
      (node) => node.props.accessibilityRole === 'switch',
    );
  const tree = () => JSON.stringify(screen.container.toJSON());
  const select = async (label: string) => {
    await act(async () => {
      radios()
        .find((radio) => radio.props.accessibilityLabel === label)!
        .props.onClick({
          nativeEvent: {},
          target: null,
          currentTarget: null,
          stopPropagation() {},
        });
    });
  };

  try {
    await act(async () => {
      await settingsStore.getState().hydrate();
      screen.render(
        <SafeAreaProvider
          initialMetrics={{
            frame: { x: 0, y: 0, width: 360, height: 800 },
            insets: { top: 0, left: 0, right: 0, bottom: 0 },
          }}
        >
          <Settings />
        </SafeAreaProvider>,
      );
    });
    expect(selected()).toEqual(['System', '60 seconds']);
    expect(tree()).toContain('"60 sec"');
    expect(
      switches().map((node) => node.props.accessibilityState.checked),
    ).toEqual([true, false]);
    expect(
      radios().every(
        (radio) => StyleSheet.flatten(radio.props.style)?.minHeight === 48,
      ),
    ).toBe(true);
    expect(tree()).toContain(
      'Verified parts of a file can be visible before the whole operation finishes. If X-Files is killed, a partial file may be left; delete it yourself.',
    );
    expect(tree()).not.toContain('Apache License');

    await select('Dark');
    expect(selected()).toEqual(['System', '60 seconds']);
    expect(tree()).toContain('Could not save or load preferences.');

    await select('Dark');
    await select('Off');
    await select('30 seconds');
    expect(selected()).toEqual(['Dark', '30 seconds']);
    await act(async () => {
      switches()[0]!.props.onPress();
      switches()[1]!.props.onPress();
    });
    expect(
      switches().map((node) => node.props.accessibilityState.checked),
    ).toEqual([false, true]);
    const coldStore = createSettingsStore(settingsStorage);
    expect(coldStore.getState().settings).toEqual(defaultSettings);
    await coldStore.getState().hydrate();
    expect(coldStore.getState().settings).toEqual({
      theme: 'dark',
      clipboardSeconds: 30,
      screenshotBlocking: false,
      keepOriginalName: true,
    });
    expect(tree()).not.toContain('Could not save or load preferences.');
    const licenses = screen.container.queryAll(
      (node) => node.props.accessibilityLabel === 'Open-source licenses',
    )[0]!;
    await act(async () => {
      licenses.props.onClick({
        nativeEvent: {},
        target: null,
        currentTarget: null,
        stopPropagation() {},
      });
    });
    expect(tree()).toContain('Apache License');
  } finally {
    await act(async () => screen.unmount());
    read.mockRestore();
    write.mockRestore();
  }
});
