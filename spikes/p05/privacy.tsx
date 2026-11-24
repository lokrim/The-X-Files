import { getStringAsync } from 'expo-clipboard';
import { useState } from 'react';
import { Button, Text, TextInput, View } from 'react-native';

import {
  clipboardExpiryDisclosure,
  copySecret,
} from '../../src/platform/clipboard';
import { shareSecret } from '../../src/platform/file-io';
import {
  ScreenPrivacy,
  SensitiveContent,
} from '../../src/platform/screen-privacy';

const fixture = 'P05 public clipboard fixture';
const replacement = 'P05 clipboard replacement';

export function PrivacyProbe() {
  const [note, setNote] = useState('');
  const [input, setInput] = useState('');
  const [show, setShow] = useState(false);

  return (
    <ScreenPrivacy blocking>
      <Text>Privacy probe · public fixtures only</Text>
      <Text>{clipboardExpiryDisclosure}</Text>
      <Text>{note}</Text>
      {([0, 30, 60] as const).map((seconds) => (
        <Button
          key={seconds}
          title={
            seconds === 0 ? 'Copy fixture · off' : `Copy fixture · ${seconds}s`
          }
          onPress={() =>
            void copySecret(fixture, seconds).then(setNote, () =>
              setNote('IO_ERROR'),
            )
          }
        />
      ))}
      <Button
        title="Check clipboard state"
        onPress={() => {
          void getStringAsync().then(
            (value) => {
              if (value === fixture) setNote('CLIPBOARD_FIXTURE_PRESENT');
              else if (value === replacement)
                setNote('CLIPBOARD_REPLACEMENT_PRESENT');
              else
                setNote(value ? 'CLIPBOARD_OTHER_PRESENT' : 'CLIPBOARD_EMPTY');
            },
            () => setNote('IO_ERROR'),
          );
        }}
      />
      <Button
        title="Share public text fixture"
        onPress={() => {
          void shareSecret(fixture).catch(() => setNote('IO_ERROR'));
        }}
      />
      <Button
        title={show ? 'Close privacy fixture' : 'Open privacy fixture'}
        onPress={() => {
          if (show) setInput('');
          setShow(!show);
        }}
      />
      {show && (
        <SensitiveContent
          render={() => (
            <View style={{ gap: 8 }}>
              <Text>PUBLIC PROTECTED FIXTURE</Text>
              <TextInput
                accessibilityLabel="Protected test input"
                value={input}
                onChangeText={setInput}
                secureTextEntry
                autoCorrect={false}
                autoComplete="off"
                importantForAutofill="no"
                style={{ borderWidth: 1, padding: 8 }}
              />
              <Text>{input ? 'Test input retained' : 'Test input empty'}</Text>
            </View>
          )}
        />
      )}
    </ScreenPrivacy>
  );
}
