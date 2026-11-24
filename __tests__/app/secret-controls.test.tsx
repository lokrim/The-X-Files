import { act } from 'react';
import { createRoot } from 'test-renderer';

import { useSecretReveal } from '@/features/privacy/use-secret-reveal';
import { SecretInput } from '@/ui/controls/secret-input';
import { SecretValue } from '@/ui/controls/secret-value';

jest.mock('@/platform/haptics', () => ({ playHaptic: jest.fn() }));

test('hidden key text is not created and the explicit copy action needs no reveal', async () => {
  const screen = createRoot();
  const format = jest.fn(() => 'PUBLIC-FIXTURE-KEY');
  const copy = jest.fn();
  const noop = () => undefined;
  const tree = () => JSON.stringify(screen.container.toJSON());
  const render = (revealed: boolean) => (
    <SecretValue
      label="Key"
      renderValue={format}
      revealed={revealed}
      secondsLeft={14}
      onToggleReveal={noop}
      onHoldStart={noop}
      onHoldEnd={noop}
      onCopy={copy}
    />
  );
  try {
    await act(async () => screen.render(render(false)));
    expect(format).not.toHaveBeenCalled();
    expect(tree()).not.toContain('PUBLIC-FIXTURE-KEY');
    await act(async () => {
      screen.container
        .queryAll((node) => node.props.accessibilityLabel === 'Copy key')[0]!
        .props.onClick({
          nativeEvent: {},
          target: null,
          currentTarget: null,
          stopPropagation() {},
        });
    });
    expect(copy).toHaveBeenCalledTimes(1);
    expect(format).not.toHaveBeenCalled();
    await act(async () => screen.render(render(true)));
    expect(tree()).toContain('Hides in ');
    const [revealed] = screen.container.queryAll(
      (node) => node.props.importantForAccessibility === 'no-hide-descendants',
    );
    expect(JSON.stringify(revealed)).toContain('PUBLIC-FIXTURE-KEY');
    expect(
      JSON.stringify(
        screen.container.queryAll((node) =>
          String(node.props.accessibilityLabel ?? '').includes(
            'PUBLIC-FIXTURE-KEY',
          ),
        ),
      ),
    ).toBe('[]');
    await act(async () => screen.render(render(false)));
    expect(tree()).not.toContain('PUBLIC-FIXTURE-KEY');
  } finally {
    await act(async () => screen.unmount());
  }
});

test('password entry disables prediction and autofill in both reveal states', async () => {
  const screen = createRoot();
  const noop = () => undefined;
  try {
    for (const revealed of [false, true]) {
      await act(async () =>
        screen.render(
          <SecretInput
            label="Password"
            value="public fixture"
            onChange={noop}
            onToggleReveal={noop}
            revealed={revealed}
          />,
        ),
      );
      const input = screen.container.queryAll(
        (node) => node.props.accessibilityLabel === 'Password',
      )[0]!;
      expect(input.props).toMatchObject({
        autoComplete: 'off',
        autoCorrect: false,
        autoCapitalize: 'none',
        importantForAutofill: 'no',
        secureTextEntry: !revealed,
        contextMenuHidden: revealed,
        spellCheck: false,
        accessible: !revealed,
        importantForAccessibility: revealed ? 'no-hide-descendants' : 'auto',
      });
    }
  } finally {
    await act(async () => screen.unmount());
  }
});

test('revealed values expire after fifteen seconds even if the wall clock moves back', () => {
  jest.useFakeTimers();
  const screen = createRoot();
  const tree = () => JSON.stringify(screen.container.toJSON());
  function Fixture() {
    return (
      <SecretValue
        label="Key"
        renderValue={() => 'PUBLIC-FIXTURE-KEY'}
        onCopy={() => undefined}
        {...useSecretReveal()}
      />
    );
  }
  try {
    act(() => screen.render(<Fixture />));
    act(() => {
      screen.container
        .queryAll((node) => node.props.accessibilityLabel === 'Reveal key')[0]!
        .props.onClick({
          nativeEvent: {},
          target: null,
          currentTarget: null,
          stopPropagation() {},
        });
    });
    expect(tree()).toContain('Hides in 15 seconds');
    jest.setSystemTime(Date.now() - 60_000);
    act(() => jest.advanceTimersByTime(14_999));
    expect(tree()).toContain('Hides in 1 second');
    act(() => jest.advanceTimersByTime(1));
    expect(tree()).toContain('Hidden');
    expect(tree()).not.toContain('PUBLIC-FIXTURE-KEY');
  } finally {
    act(() => screen.unmount());
    jest.useRealTimers();
  }
});
