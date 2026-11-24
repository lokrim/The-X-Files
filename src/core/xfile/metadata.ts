import { CoreError } from '../crypto/errors';
import { decodeUtf8, encodeUtf8, isWellFormedUnicode } from '../crypto/utf8';
import { encodeFlatName } from '../file-names';
import { maxCreateEntries, maxExtractEntries } from '../zip/limits';
import { maxMetadataBytes, payloadRecordCount } from './plan';
export type XfileMetadata = Readonly<{
  v: 1;
  name: string;
  isZip: boolean;
  totalSize: number;
  entryCount: number;
  mime: string;
}>;
export type XfileMetadataInput = Omit<XfileMetadata, 'v' | 'mime'> & {
  mime?: string;
};

function validateMetadata(
  value: unknown,
  isZip: boolean,
  chunkLog2: number,
  maxEntries: number,
): XfileMetadata {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new CoreError('BAD_HEADER');
  const {
    v,
    name,
    isZip: bundle,
    totalSize,
    entryCount,
    mime,
  } = value as Record<string, unknown>;
  if (
    Object.keys(value).length !== 6 ||
    v !== 1 ||
    typeof name !== 'string' ||
    bundle !== isZip ||
    typeof totalSize !== 'number' ||
    typeof entryCount !== 'number' ||
    typeof mime !== 'string' ||
    !isWellFormedUnicode(mime) ||
    (isZip && mime !== 'application/zip')
  )
    throw new CoreError('BAD_HEADER');
  if (
    Math.abs(totalSize) > Number.MAX_SAFE_INTEGER ||
    Math.abs(entryCount) > Number.MAX_SAFE_INTEGER
  )
    throw new CoreError('RESOURCE_LIMIT');
  if (
    !Number.isInteger(totalSize) ||
    totalSize < 0 ||
    !Number.isInteger(entryCount) ||
    (isZip ? entryCount < 2 : entryCount !== 1)
  )
    throw new CoreError('BAD_HEADER');
  if (entryCount > maxEntries) throw new CoreError('RESOURCE_LIMIT');
  encodeFlatName(name, 'BAD_HEADER');
  payloadRecordCount(totalSize, chunkLog2);
  return Object.freeze({ v, name, isZip, totalSize, entryCount, mime });
}

export function encodeMetadata(
  input: XfileMetadataInput,
  chunkLog2: number,
): Uint8Array {
  const value = validateMetadata(
    {
      v: 1,
      name: input.name.normalize('NFC'),
      isZip: input.isZip,
      totalSize: input.totalSize,
      entryCount: input.entryCount,
      mime: input.isZip
        ? 'application/zip'
        : input.mime || 'application/octet-stream',
    },
    input.isZip,
    chunkLog2,
    maxCreateEntries,
  );
  // Each UTF-16 code unit occupies at least one UTF-8 byte in well-formed input.
  if (value.mime.length > maxMetadataBytes)
    throw new CoreError('RESOURCE_LIMIT');
  return encodeUtf8(JSON.stringify(value), maxMetadataBytes, 'RESOURCE_LIMIT');
}

/** JSON.parse can round a fractional literal to an integer. Validate the
 * significand and exponent before accepting that parsed value. */
function isIntegralLiteral(literal: string): boolean {
  const [decimal, exponent = '0'] = literal.split(/[eE]/);
  const [whole, fraction = ''] = decimal!.split('.');
  const significand = whole!.replace('-', '') + fraction;
  let end = significand.length;
  while (end > 0 && significand[end - 1] === '0') end--;
  return (
    end === 0 || Number(exponent) + significand.length - end >= fraction.length
  );
}

/** After JSON.parse validates syntax, count colons outside strings to catch
 * duplicate keys (including escaped spellings) and check numeric literals. */
function validateJsonTokens(json: string): void {
  let inString = false;
  let count = 0;
  for (let i = 0; i < json.length; i++) {
    const char = json[i]!;
    if (inString && char === '\\') i++;
    else if (char === '"') inString = !inString;
    else if (!inString && char === ':') count++;
    else if (!inString && (char === '-' || (char >= '0' && char <= '9'))) {
      const start = i++;
      while (i < json.length && /[0-9eE.+-]/.test(json[i]!)) i++;
      if (!isIntegralLiteral(json.slice(start, i)))
        throw new CoreError('BAD_HEADER');
      i--;
    }
  }
  if (count !== 6) throw new CoreError('BAD_HEADER');
}

export function decodeMetadata(
  bytes: Uint8Array,
  isZip: boolean,
  chunkLog2: number,
): XfileMetadata {
  if (bytes.length > maxMetadataBytes) throw new CoreError('RESOURCE_LIMIT');
  const json = decodeUtf8(bytes, 'BAD_HEADER');
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new CoreError('BAD_HEADER');
  }
  validateJsonTokens(json);
  return validateMetadata(value, isZip, chunkLog2, maxExtractEntries);
}
