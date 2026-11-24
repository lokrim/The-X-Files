import type { Settings } from '@/store/settings-store';
import { nativeCall } from './native';

export const clipboardExpiryDisclosure =
  'Auto-clear is best effort. Clipboard contents may outlive the app.';

export async function copySecret(
  text: string,
  seconds: Settings['clipboardSeconds'],
) {
  await nativeCall((native) => native.copySecret(text, seconds));
  return seconds === 0
    ? 'Copied · auto-clear off'
    : `Copied · clears in ${seconds}s`;
}
