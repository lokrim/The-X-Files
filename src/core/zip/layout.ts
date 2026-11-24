import { CoreError } from '../crypto/errors';
import {
  addSize,
  checkedSize,
  dataView,
  readUint64,
  writeUint64,
} from '../sizes';

export const localSignature = 0x04034b50;
export const centralSignature = 0x02014b50;
export const localHeaderBytes = 30;
export const centralHeaderBytes = 46;
export const zip64EndBytes = 56;
export const locatorBytes = 20;
export const classicEndBytes = 22;
export const uint32Sentinel = 0xffff_ffff;
const uint16Sentinel = 0xffff;
const utf8Flag = 0x0800;
const dosDate = 0x0021;
const regularFile = 0x8180_0000;

export type EntryFacts = {
  name: Uint8Array;
  size: number;
  offset: number;
  crc: number;
};

export function entryLayout(size: number, offset: number) {
  const largeSize = checkedSize(size) >= uint32Sentinel;
  const largeOffset = checkedSize(offset) >= uint32Sentinel;
  const zip64 = largeSize || largeOffset;
  return {
    largeSize,
    largeOffset,
    zip64,
    version: zip64 ? 45 : 20,
    localExtra: largeSize ? 20 : 0,
    centralExtra: zip64 ? 4 + (largeSize ? 16 : 0) + (largeOffset ? 8 : 0) : 0,
  };
}

export type DirectoryFacts = {
  count: number;
  size: number;
  offset: number;
  zip64Entry: boolean;
};

export function needsZip64End({
  count,
  size,
  offset,
  zip64Entry,
}: DirectoryFacts): boolean {
  const largeCount = checkedSize(count) >= uint16Sentinel;
  const largeSize = checkedSize(size) >= uint32Sentinel;
  const largeOffset = checkedSize(offset) >= uint32Sentinel;
  return largeCount || largeSize || largeOffset || zip64Entry;
}

export function endSize(directory: DirectoryFacts): number {
  return (
    classicEndBytes +
    (needsZip64End(directory) ? zip64EndBytes + locatorBytes : 0)
  );
}

function writeExtra(
  view: DataView,
  position: number,
  sizes: readonly number[],
): void {
  view.setUint16(position, 1, true);
  view.setUint16(position + 2, sizes.length * 8, true);
  for (let i = 0; i < sizes.length; i++)
    writeUint64(view, position + 4 + i * 8, sizes[i]!, true);
}

export function reconstructSize(view: DataView, offset: number): number {
  const compressed = view.getUint32(offset, true);
  const uncompressed = view.getUint32(offset + 4, true);
  if (compressed !== uncompressed) throw new CoreError('UNSUPPORTED_ARCHIVE');
  return uncompressed;
}

export function localHeader(entry: EntryFacts): Uint8Array {
  const { name, size, offset, crc } = entry;
  const layout = entryLayout(size, offset);
  const bytes = new Uint8Array(
    localHeaderBytes + name.length + layout.localExtra,
  );
  const view = dataView(bytes);
  const size32 = layout.largeSize ? uint32Sentinel : size;
  view.setUint32(0, localSignature, true);
  view.setUint16(4, layout.version, true);
  view.setUint16(6, utf8Flag, true);
  view.setUint16(12, dosDate, true);
  view.setUint32(14, crc, true);
  view.setUint32(18, size32, true);
  view.setUint32(22, size32, true);
  view.setUint16(26, name.length, true);
  view.setUint16(28, layout.localExtra, true);
  bytes.set(name, localHeaderBytes);
  if (layout.largeSize)
    writeExtra(view, localHeaderBytes + name.length, [size, size]);
  return bytes;
}

export function centralHeader(entry: EntryFacts): Uint8Array {
  const { name, size, offset, crc } = entry;
  const layout = entryLayout(size, offset);
  const bytes = new Uint8Array(
    centralHeaderBytes + name.length + layout.centralExtra,
  );
  const view = dataView(bytes);
  const size32 = layout.largeSize ? uint32Sentinel : size;
  view.setUint32(0, centralSignature, true);
  view.setUint16(4, 0x0300 + layout.version, true);
  view.setUint16(6, layout.version, true);
  view.setUint16(8, utf8Flag, true);
  view.setUint16(14, dosDate, true);
  view.setUint32(16, crc, true);
  view.setUint32(20, size32, true);
  view.setUint32(24, size32, true);
  view.setUint16(28, name.length, true);
  view.setUint16(30, layout.centralExtra, true);
  view.setUint32(38, regularFile, true);
  view.setUint32(42, layout.largeOffset ? uint32Sentinel : offset, true);
  bytes.set(name, centralHeaderBytes);
  if (layout.zip64) {
    const extra: number[] = [];
    if (layout.largeSize) extra.push(size, size);
    if (layout.largeOffset) extra.push(offset);
    writeExtra(view, centralHeaderBytes + name.length, extra);
  }
  return bytes;
}

export function validateStoreFields(
  view: DataView,
  versionOffset: number,
): void {
  const version = view.getUint16(versionOffset, true);
  if (
    (version !== 20 && version !== 45) ||
    view.getUint16(versionOffset + 2, true) !== utf8Flag ||
    view.getUint16(versionOffset + 4, true) !== 0 ||
    view.getUint16(versionOffset + 6, true) !== 0 ||
    view.getUint16(versionOffset + 8, true) !== dosDate
  )
    throw new CoreError('UNSUPPORTED_ARCHIVE');
}

export function readExtra(bytes: Uint8Array, valueCount: number): number[] {
  if (valueCount === 0 && bytes.length === 0) return [];
  if (!valueCount || bytes.length !== 4 + valueCount * 8)
    throw new CoreError('UNSUPPORTED_ARCHIVE');
  const view = dataView(bytes);
  if (
    view.getUint16(0, true) !== 1 ||
    view.getUint16(2, true) !== valueCount * 8
  )
    throw new CoreError('UNSUPPORTED_ARCHIVE');
  return Array.from({ length: valueCount }, (_, i) =>
    readUint64(view, 4 + i * 8, true),
  );
}

export function endRecords(directory: DirectoryFacts): Uint8Array {
  const { count, size, offset } = directory;
  const bytes = new Uint8Array(endSize(directory));
  const view = dataView(bytes);
  const classic = bytes.length - classicEndBytes;
  if (classic) {
    view.setUint32(0, 0x06064b50, true);
    writeUint64(view, 4, 44, true);
    view.setUint16(12, 0x032d, true);
    view.setUint16(14, 45, true);
    writeUint64(view, 24, count, true);
    writeUint64(view, 32, count, true);
    writeUint64(view, 40, size, true);
    writeUint64(view, 48, offset, true);
    view.setUint32(56, 0x07064b50, true);
    writeUint64(view, 64, addSize(offset, size), true);
    view.setUint32(72, 1, true);
  }
  view.setUint32(classic, 0x06054b50, true);
  view.setUint16(classic + 8, Math.min(count, uint16Sentinel), true);
  view.setUint16(classic + 10, Math.min(count, uint16Sentinel), true);
  view.setUint32(classic + 12, Math.min(size, uint32Sentinel), true);
  view.setUint32(classic + 16, Math.min(offset, uint32Sentinel), true);
  return bytes;
}
