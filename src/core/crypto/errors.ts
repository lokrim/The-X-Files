export const operationErrorCodes = [
  'AUTH_FAILED',
  'TRUNCATED',
  'BAD_HEADER',
  'UNSUPPORTED_VERSION',
  'RESOURCE_LIMIT',
  'UNSUPPORTED_ARCHIVE',
  'SOURCE_CHANGED',
  'CANCELLED',
  'NO_SPACE',
  'IO_ERROR',
  'UNSUPPORTED_PROVIDER',
  'RNG_UNAVAILABLE',
  'SERVICE_TIMEOUT',
] as const;
export type OperationErrorCode = (typeof operationErrorCodes)[number];
export type CodecErrorCode =
  | 'BAD_PREFIX'
  | 'BAD_LENGTH'
  | 'BAD_SYMBOL'
  | 'BAD_PADDING'
  | 'BAD_CHECKSUM'
  | 'BAD_PARAMS'
  | 'UNSUPPORTED_VERSION';
export type ShareErrorCode =
  'INSUFFICIENT' | 'DUPLICATE_INDEX' | 'MIXED_SET' | 'INCONSISTENT';
export const passwordErrorCodes = [
  'EMPTY_PASSWORD',
  'MALFORMED_UNICODE',
  'PASSWORD_TOO_SHORT',
  'PASSWORD_TOO_LONG',
  'PASSWORD_MISMATCH',
] as const;
export type PasswordErrorCode = (typeof passwordErrorCodes)[number];
export type CoreErrorCode =
  OperationErrorCode | CodecErrorCode | ShareErrorCode | PasswordErrorCode;

/** Its message contains only an allowlisted code, never provider/private errors. */
export class CoreError extends Error {
  constructor(readonly code: CoreErrorCode) {
    super(code);
    this.name = 'CoreError';
  }
}

export const genericDecryptMessage =
  "Couldn't decrypt. Check your key or password, or the file may be damaged.";
export const operationErrorCategory = {
  AUTH_FAILED: 'integrity',
  TRUNCATED: 'integrity',
  BAD_HEADER: 'integrity',
  UNSUPPORTED_VERSION: 'unsupported-format',
  RESOURCE_LIMIT: 'resource-limit',
  UNSUPPORTED_ARCHIVE: 'unsupported-archive',
  SOURCE_CHANGED: 'source-changed',
  CANCELLED: 'cancelled',
  NO_SPACE: 'no-space',
  IO_ERROR: 'io',
  UNSUPPORTED_PROVIDER: 'unsupported-provider',
  RNG_UNAVAILABLE: 'rng-unavailable',
  SERVICE_TIMEOUT: 'service-timeout',
} as const satisfies Record<OperationErrorCode, string>;

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new CoreError('CANCELLED');
}
