import { CoreError } from './crypto/errors';

export const maxPayloadBytes = 2 ** 40;
export const maxChunkBytes = 2 ** 20;

export function checkedSize(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new CoreError('RESOURCE_LIMIT');
  return value;
}

export function addSize(left: number, right: number): number {
  return checkedSize(checkedSize(left) + checkedSize(right));
}

export function multiplySize(left: number, right: number): number {
  return checkedSize(checkedSize(left) * checkedSize(right));
}

const uint32Range = 2 ** 32;
const maxSafeHighWord = Math.floor(Number.MAX_SAFE_INTEGER / uint32Range);

export function readUint64(
  view: DataView,
  offset: number,
  littleEndian = false,
): number {
  const high = view.getUint32(offset + (littleEndian ? 4 : 0), littleEndian);
  const low = view.getUint32(offset + (littleEndian ? 0 : 4), littleEndian);
  if (high > maxSafeHighWord) throw new CoreError('RESOURCE_LIMIT');
  return high * uint32Range + low;
}

export function writeUint64(
  view: DataView,
  offset: number,
  value: number,
  littleEndian = false,
): void {
  checkedSize(value);
  const high = Math.floor(value / uint32Range);
  const low = value % uint32Range;
  view.setUint32(offset + (littleEndian ? 4 : 0), high, littleEndian);
  view.setUint32(offset + (littleEndian ? 0 : 4), low, littleEndian);
}

export function dataView(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** Apply once to the sum of simultaneous allocations on each volume. */
export function withCapacityHeadroom(required: number): number {
  return addSize(required, Math.max(Math.ceil(required / 20), 64 * 2 ** 20));
}
