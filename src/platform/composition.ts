import { copySecret } from './clipboard';
import { settingsStorage } from '@/platform/settings-storage';
import { createSettingsStore } from '@/store/settings-store';

export { cryptoAdapters } from './crypto';
export {
  chooseDestination,
  inspectPickedHeader,
  pickSources,
  shareFile,
  shareSecret,
  SourceCountLimitError,
} from './file-io';
export {
  decryptToDestination,
  encryptToDestination,
  encryptWithRecovery,
  saveCopy,
} from './file-jobs';
export { inspectCapacity } from './capacity';
export { JobError, requestJobNotifications, sweepStartupTemp } from './job';

export const settingsStore = createSettingsStore(settingsStorage);

export function copySecretToClipboard(text: string) {
  return copySecret(text, settingsStore.getState().settings.clipboardSeconds);
}
