import { zeroize } from '@/core/crypto/bytes';
import { CoreError } from '@/core/crypto/errors';
import { normalizePassword, passwordStrength } from '@/core/crypto/password';
import { encodeFlatName, maxNameBytes, truncateName } from '@/core/file-names';
import { maxCreateEntries } from '@/core/zip';
import { planEncryption } from '@/platform/encryption-plan';
import type { PickedSource } from '@/platform/file-io';

export const protectionOptions = [
  { value: 'shares', label: 'Shares' },
  { value: 'key', label: 'Key' },
  { value: 'password', label: 'Password' },
] as const;

export type ProtectionMode = (typeof protectionOptions)[number]['value'];
export type ProtectionChoice =
  | { mode: 'shares'; total: number; threshold: number }
  | { mode: 'key' }
  | { mode: 'password' };

export const acknowledgements: Record<ProtectionMode, string> = {
  shares: 'I have given out my shares safely',
  key: 'I have saved my key',
  password: 'I will remember my password',
};
export const recoveryWarning =
  "Leaving discards this screen's key/shares permanently; they cannot be shown again. Continue?";
export const passwordExitWarning =
  'Make sure you remember your password. X-Files cannot recover it. Leave this screen?';
export const keepOpenMessage =
  'Keep this screen open until your key/shares are saved.';
export const passwordPolicy =
  'At least 8 characters; up to 1024 normalized UTF-8 bytes. Spaces are kept. Visually different strings can normalize identically.';

const passwordErrors: Record<string, string> = {
  EMPTY_PASSWORD: 'Enter a password.',
  MALFORMED_UNICODE: 'The password contains an invalid Unicode character.',
  PASSWORD_TOO_SHORT: 'Use at least 8 normalized characters.',
  PASSWORD_TOO_LONG: 'Use at most 1024 normalized UTF-8 bytes.',
  PASSWORD_MISMATCH: 'The normalized passwords do not match.',
};

export function checkPassword(password: string, confirmation: string) {
  try {
    const normalized = normalizePassword(password);
    const strength = passwordStrength(password);
    try {
      if (normalized !== normalizePassword(confirmation))
        throw new CoreError('PASSWORD_MISMATCH');
      return { valid: true, strength, error: null };
    } catch (error) {
      return {
        valid: false,
        strength,
        error: confirmation
          ? (passwordErrors[(error as CoreError).code] ??
            'Invalid confirmation.')
          : 'Confirm your password.',
      };
    }
  } catch (error) {
    return {
      valid: false,
      strength: null,
      error: password
        ? (passwordErrors[(error as CoreError).code] ?? 'Invalid password.')
        : null,
    };
  }
}

export const bundleName = 'bundle.zip';
export const countError = 'Select at most 10,000 files.';
const nameError = 'Use flat file names of at most 255 UTF-8 bytes.';
const payloadError =
  'The encrypted payload, including any ZIP overhead, must fit within 1 TiB and 1,048,576 payload records.';

export function checkSelection(sources: readonly PickedSource[]) {
  if (sources.length === 0) return { plan: null, error: null };
  if (sources.length > maxCreateEntries)
    return { plan: null, error: countError };
  try {
    for (const { name } of sources)
      zeroize(encodeFlatName(name.normalize('NFC'), 'UNSUPPORTED_ARCHIVE'));
    return { plan: planEncryption(sources, bundleName), error: null };
  } catch (error) {
    const code = error instanceof CoreError ? error.code : undefined;
    return {
      plan: null,
      error:
        code === 'UNSUPPORTED_ARCHIVE'
          ? nameError
          : code === 'RESOURCE_LIMIT'
            ? payloadError
            : 'A selected file could not be used. Try selecting it again.',
    };
  }
}

export function outputName(
  sources: readonly PickedSource[],
  original: boolean,
  date: Date,
) {
  const ext = '.xfile';
  if (original && sources.length === 1)
    return (
      truncateName(
        sources[0]!.name.normalize('NFC'),
        maxNameBytes - ext.length,
      ) + ext
    );

  const pad = (value: number) => String(value).padStart(2, '0');
  return `encrypted-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${ext}`;
}

export function operationMessage(error: unknown) {
  switch (error instanceof CoreError ? error.code : undefined) {
    case 'CANCELLED':
      return 'Operation cancelled.';
    case 'SOURCE_CHANGED':
      return 'The source changed. Select it again and retry.';
    case 'NO_SPACE':
      return 'There is not enough free space, including the required storage reserve.';
    case 'SERVICE_TIMEOUT':
      return 'Android stopped this long-running job. Partial-output cleanup may be incomplete.';
    case 'UNSUPPORTED_PROVIDER':
      return 'This provider could not open the location or determine a file size. Choose a different file or folder.';
    case 'RESOURCE_LIMIT':
      return payloadError;
    case 'RNG_UNAVAILABLE':
      return 'Secure randomness is unavailable. Try again.';
    default:
      return 'The file operation could not finish. Check that the files and destination are still accessible.';
  }
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const rank = Math.min(4, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** rank).toFixed(1)} ${['B', 'KiB', 'MiB', 'GiB', 'TiB'][rank]}`;
}
