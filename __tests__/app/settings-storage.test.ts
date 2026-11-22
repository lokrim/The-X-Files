import * as SecureStore from 'expo-secure-store';

import { settingsStorage } from '@/platform/settings-storage';
import { defaultSettings } from '@/store/settings-store';

test('native persistence boundary drops unapproved fields even from internal callers', async () => {
  const write = jest
    .spyOn(SecureStore, 'setItemAsync')
    .mockResolvedValue(undefined);
  await settingsStorage.write(
    JSON.stringify({
      ...defaultSettings,
      theme: 'dark',
      password: 'never-persist',
      outputUri: 'private',
      history: ['private'],
    }),
  );
  expect(write).toHaveBeenCalledWith(
    'xfiles.preferences.v1',
    JSON.stringify({ ...defaultSettings, theme: 'dark' }),
  );
  write.mockRestore();
});
