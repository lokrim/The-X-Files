import { act, type ReactNode } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { createRoot } from 'test-renderer';

import Encrypt from '../../app/encrypt';
import {
  chooseDestination,
  encryptWithRecovery,
  inspectCapacity,
  pickSources,
  requestJobNotifications,
  shareSecret,
} from '@/platform/composition';
import { nativePlatform } from '@/platform/native';
import type { ScryptCancellation } from '@/platform/crypto';
import { ScreenPrivacy } from '@/platform/screen-privacy';
import { CoreError } from '@/core/crypto/errors';
import {
  acknowledgements,
  passwordExitWarning,
  recoveryWarning,
} from '@/features/encrypt/workflow';

const mockBack = jest.fn();
const mockRepeat = jest.fn();
let mockRemove: (() => void) | undefined;
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack, canGoBack: () => true }),
  useIsFocused: () => true,
  usePreventRemove: (
    enabled: boolean,
    onRemove: (event: { repeat: () => void }) => void,
  ) => {
    mockRemove = enabled ? () => onRemove({ repeat: mockRepeat }) : undefined;
    return jest.fn();
  },
}));
jest.mock('expo-router/stack', () => ({ Stack: { Screen: () => null } }));
jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: { View: jest.requireActual('react-native').View },
  FadeInDown: { duration: () => ({ reduceMotion: () => undefined }) },
  ReduceMotion: { System: 'system' },
}));
jest.mock('expo-crypto', () => ({
  getRandomValues: (bytes: Uint8Array) =>
    jest
      .requireActual<typeof import('node:crypto')>('node:crypto')
      .randomFillSync(bytes),
}));
jest.mock('@expo/ui', () => {
  const { Pressable } =
    jest.requireActual<typeof import('react-native')>('react-native');
  return {
    Host: ({ children }: { children: ReactNode }) => children,
    Checkbox: ({
      label,
      value,
      onValueChange,
    }: {
      label: string;
      value: boolean;
      onValueChange: (value: boolean) => void;
    }) => (
      <Pressable
        accessibilityRole="checkbox"
        accessibilityLabel={label}
        accessibilityState={{ checked: value }}
        onPress={() => onValueChange(!value)}
      />
    ),
  };
});
jest.mock('@/platform/haptics', () => ({ playHaptic: jest.fn() }));
jest.mock('@/platform/native', () => ({
  nativePlatform: jest.fn(),
  nativeCall: async (invoke: (native: unknown) => unknown) =>
    invoke(jest.requireMock('@/platform/native').nativePlatform()),
}));
jest.mock('@/platform/composition', () => ({
  ...jest.requireActual('@/platform/composition'),
  pickSources: jest.fn(),
  chooseDestination: jest.fn(),
  inspectCapacity: jest.fn(),
  requestJobNotifications: jest.fn(),
  encryptWithRecovery: jest.fn(),
  shareSecret: jest.fn(),
}));

const fileKey = new Uint8Array(32);
const fixture = {
  uri: 'content://fixture',
  name: 'file.txt',
  size: 0,
  mime: 'text/plain',
};
let ownedClipboard: string | undefined;
let currentClipboard: string | undefined;

beforeEach(() => {
  jest.clearAllMocks();
  mockRemove = undefined;
  ownedClipboard = undefined;
  currentClipboard = undefined;
  fileKey.fill(23);
  jest.mocked(nativePlatform).mockReturnValue({
    setScreenSecure: async () => true,
    copySecret: jest.fn(async (text: string) => {
      ownedClipboard = text;
      currentClipboard = text;
    }),
    expireClipboard: jest.fn(async () => {
      // Model the platform ownership contract on resuming from another app.
      if (ownedClipboard === currentClipboard) currentClipboard = undefined;
      ownedClipboard = undefined;
    }),
  } as unknown as ReturnType<typeof nativePlatform>);
  jest.mocked(pickSources).mockResolvedValue([fixture]);
  jest
    .mocked(chooseDestination)
    .mockResolvedValue({ tree: 'content://target', label: 'Fixture folder' });
  jest.mocked(inspectCapacity).mockResolvedValue({ unknown: false });
  jest.mocked(requestJobNotifications).mockResolvedValue(true);
  jest
    .mocked(encryptWithRecovery)
    .mockImplementation(async ({ protection }, recover) => ({
      recovery: recover(
        protection.mode === 'password'
          ? { mode: 'password' }
          : { mode: 'raw', fileKey },
      ),
      savedTo: 'Fixture folder',
      file: {
        uri: 'content://result',
        mime: 'application/octet-stream',
        kind: 'ciphertext',
      },
      byteSize: 117,
      fileName: 'encrypted.xfile',
    }));
});

async function renderFlow() {
  const screen = createRoot();
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
  await act(async () => {
    screen.render(
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 385, height: 760 },
          insets: { top: 24, bottom: 24, left: 0, right: 0 },
        }}
      >
        <ScreenPrivacy blocking>
          <Encrypt />
        </ScreenPrivacy>
      </SafeAreaProvider>,
    );
  });
  const event = (name: string, state: AppStateStatus) =>
    act(async () => handlers.get(name)?.(state));
  await event('change', 'active');
  const node = (label: string, role?: string) =>
    screen.container.queryAll(
      (item) =>
        item.props.accessibilityLabel === label &&
        (role === undefined || item.props.accessibilityRole === role),
    )[0]!;
  const click = (label: string, role = 'button') =>
    act(async () => {
      node(label, role).props.onClick({
        nativeEvent: {},
        target: null,
        currentTarget: null,
        stopPropagation() {},
      });
    });
  const input = (label: string) =>
    screen.container.queryAll(
      (item) =>
        item.props.accessibilityLabel === label &&
        (typeof item.props.onChangeText === 'function' ||
          typeof item.props.onChange === 'function'),
    )[0]!;
  const type = (label: string, value: string) =>
    act(async () => {
      const props = input(label).props;
      if (props.onChangeText) props.onChangeText(value);
      else props.onChange({ nativeEvent: { text: value, eventCount: 1 } });
    });
  return {
    node,
    click,
    type,
    input,
    passwordValue: () =>
      input('Password').props.value ?? input('Password').props.text,
    event,
    tree: () => JSON.stringify(screen.container.toJSON()),
    async close() {
      await act(async () => screen.unmount());
      subscription.mockRestore();
    },
  };
}

test.each(['shares', 'key', 'password'] as const)(
  '%s result uses the exact acknowledgement and confirms Back and Done',
  async (mode) => {
    const ui = await renderFlow();
    try {
      await ui.click('Add files');
      expect(pickSources).toHaveBeenCalledWith(true, 10_000);
      await ui.click('Next');
      if (mode === 'shares') await ui.click('Shares', 'radio');
      if (mode === 'password') {
        await ui.click('Password', 'radio');
        await ui.type('Password', 'Ａbcdef  ');
        await ui.type('Confirm password', 'Abcdef  ');
      }
      await ui.click('Next');
      expect(
        ui.node('Encrypt', 'button').props.accessibilityState.disabled,
      ).toBe(true);
      expect(encryptWithRecovery).not.toHaveBeenCalled();
      await ui.click('Choose destination');
      expect(inspectCapacity).toHaveBeenCalledWith(
        'content://target',
        expect.any(Number),
        undefined,
      );
      await ui.click('Encrypt');
      expect(ui.tree()).toContain('Saved to ');
      expect(ui.tree()).toContain(
        'Keep this screen open until your key/shares are saved.',
      );
      expect(ui.node('Done', 'button').props.accessibilityState.disabled).toBe(
        true,
      );
      expect(ui.tree()).not.toMatch(/XFK1-|XFS1-/);
      if (mode === 'shares') {
        expect(ui.tree()).toContain('Share set ');
        expect(ui.node('Reveal share 5 of 5')).toBeDefined();
        expect(fileKey).toEqual(new Uint8Array(32));
      } else if (mode === 'key') {
        expect(ui.node('Reveal key')).toBeDefined();
        expect(ui.tree()).not.toContain('Share set ');
      } else {
        expect(ui.tree()).toContain('Your password cannot be recovered.');
      }

      await act(async () => mockRemove?.());
      expect(ui.tree()).toContain(
        mode === 'password' ? passwordExitWarning : recoveryWarning,
      );
      await ui.click('Stay');
      expect(mockRepeat).not.toHaveBeenCalled();
      await ui.click(acknowledgements[mode], 'checkbox');
      expect(ui.node('Done', 'button').props.accessibilityState.disabled).toBe(
        false,
      );
      await ui.click('Done');
      expect(ui.tree()).toContain(
        mode === 'password' ? passwordExitWarning : recoveryWarning,
      );
      await ui.click('Leave');
      expect(mockBack).toHaveBeenCalledTimes(1);
      expect(ui.tree()).not.toContain('Saved to ');
      if (mode === 'key') expect(fileKey).toEqual(new Uint8Array(32));
    } finally {
      await ui.close();
    }
  },
);

test('a Share sheet, app inactivity and a picker cancellation re-hide a key and preserve recovery until confirmed Back', async () => {
  const ui = await renderFlow();
  try {
    await ui.click('Add files');
    await ui.click('Next');
    await ui.click('Next');
    await ui.click('Choose destination');
    await ui.click('Encrypt');
    await ui.click('Reveal key');
    expect(ui.tree()).toContain('XFK1-');
    await ui.click('Share key');
    expect(shareSecret).toHaveBeenCalledWith(expect.stringMatching(/^XFK1-/));
    await ui.event('change', 'background');
    expect(ui.tree()).not.toContain('XFK1-');
    await ui.event('change', 'active');
    expect(ui.tree()).not.toContain('XFK1-');
    await ui.click('Copy key');
    expect(ui.tree()).toContain('Copied · clears in 60s');
    expect(nativePlatform().copySecret).toHaveBeenCalledWith(
      expect.stringMatching(/^XFK1-/),
      60,
    );

    currentClipboard = 'unrelated clipboard';
    jest.mocked(chooseDestination).mockResolvedValueOnce(null);
    await ui.click('Save a copy');
    await ui.event('blur', 'active');
    await ui.event('focus', 'active');
    expect(currentClipboard).toBe('unrelated clipboard');
    expect(ui.tree()).not.toContain('XFK1-');
    await ui.click('Reveal key');
    expect(ui.tree()).toContain('XFK1-');
    await act(async () => mockRemove?.());
    await ui.click('Leave');
    expect(mockRepeat).toHaveBeenCalledTimes(1);
    expect(fileKey).toEqual(new Uint8Array(32));
  } finally {
    await ui.close();
  }
});

test('password fields remount masked after blur, clear after mode switch, and retry after cleanup requires a fresh draft', async () => {
  const ui = await renderFlow();
  try {
    await ui.click('Add files');
    await ui.click('Next');
    await ui.click('Password', 'radio');
    await ui.type('Password', 'public fixture');
    await ui.type('Confirm password', 'public fixture');
    await ui.click('Show password');
    expect(ui.node('Hide password')).toBeDefined();
    await ui.event('blur', 'active');
    expect(ui.tree()).not.toContain('public fixture');
    await ui.event('focus', 'active');
    expect(ui.input('Password').props).toMatchObject({
      secureTextEntry: true,
    });
    expect(ui.passwordValue()).toBe('public fixture');
    await ui.click('Key', 'radio');
    await ui.click('Password', 'radio');
    expect(ui.passwordValue()).toBe('');
    await ui.type('Password', 'public fixture');
    await ui.type('Confirm password', 'public fixture');
    await ui.click('Next');
    await ui.click('Choose destination');
    let scrypt: ((status: ScryptCancellation) => void) | undefined;
    jest.mocked(encryptWithRecovery).mockImplementationOnce(async (options) => {
      scrypt = options.onScryptCancellation;
      scrypt?.({ pending: true });
      options.controls.onCleanupFailure();
      throw new CoreError('CANCELLED');
    });
    await ui.click('Encrypt');
    expect(ui.tree()).toContain('Encryption cancelled');
    expect(ui.tree()).toContain('could not verify deletion');
    expect(ui.tree()).toContain('still finishing the key derivation');
    expect(
      ui.node('Back to protection').props.accessibilityState.disabled,
    ).toBe(true);
    await act(async () => scrypt?.({ pending: false, callbackLatencyMs: 123 }));
    expect(ui.tree()).toContain('returned 123 ms after cancellation');
    await ui.click('Back to protection');
    expect(ui.passwordValue()).toBe('');
    expect(ui.node('Next').props.accessibilityState.disabled).toBe(true);
  } finally {
    await ui.close();
  }
});
