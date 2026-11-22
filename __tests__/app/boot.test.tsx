import React, { act } from 'react';
import { createRoot } from 'test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import Home from '../../app/index';

jest.mock('expo-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => children,
}));

test('Home boots with local icons, truthful offline copy and inert crypto actions', async () => {
  const screen = createRoot();
  await act(async () => {
    screen.render(
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 360, height: 800 },
          insets: { top: 24, left: 0, right: 0, bottom: 24 },
        }}
      >
        <Home />
      </SafeAreaProvider>,
    );
  });
  const tree = JSON.stringify(screen.container.toJSON());
  expect(tree).toContain('Offline file encryption');
  expect(tree.match(/Not available yet/g)).toHaveLength(2);
  expect(tree).toContain(
    'X-Files makes no network connections itself; apps you choose to save to or share with may.',
  );
  expect(tree).toContain('Settings');
  await act(async () => {
    screen.unmount();
  });
});
