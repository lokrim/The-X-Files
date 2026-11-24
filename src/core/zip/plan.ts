import { CoreError } from '../crypto/errors';
import { utf8CodePointBytes } from '../crypto/utf8';
import { encodeFlatName, maxNameBytes } from '../file-names';
import { addSize, checkedSize, maxPayloadBytes } from '../sizes';
import {
  centralHeaderBytes,
  endSize,
  entryLayout,
  localHeaderBytes,
} from './layout';
import { maxCreateEntries } from './limits';

export type ZipInput = Readonly<{ name: string; size: number }>;

function truncateName(name: string, byteBudget: number): string {
  let end = 0;
  for (const char of name) {
    byteBudget -= utf8CodePointBytes(char.codePointAt(0)!);
    if (byteBudget < 0) break;
    end += char.length;
  }
  return name.slice(0, end);
}

function suffixedName(name: string, number: number): string {
  const dot = name.lastIndexOf('.');
  const hasExtension = dot > 0 && dot < name.length - 1;
  const stem = hasExtension ? name.slice(0, dot) : name;
  const suffix = ` (${number})`;
  const stemMinimum = utf8CodePointBytes(stem.codePointAt(0)!);
  const extension = hasExtension
    ? truncateName(name.slice(dot), maxNameBytes - suffix.length - stemMinimum)
    : '';
  const extensionBytes = extension
    ? encodeFlatName(extension, 'UNSUPPORTED_ARCHIVE').length
    : 0;
  return (
    truncateName(stem, maxNameBytes - suffix.length - extensionBytes) +
    suffix +
    extension
  ).normalize('NFC');
}

export function planStoreZip(inputs: readonly ZipInput[]) {
  if (inputs.length < 2) throw new CoreError('UNSUPPORTED_ARCHIVE');
  if (inputs.length > maxCreateEntries) throw new CoreError('RESOURCE_LIMIT');
  const names = inputs.map(({ name }) => {
    const normalized = name.normalize('NFC');
    encodeFlatName(normalized, 'UNSUPPORTED_ARCHIVE');
    return normalized;
  });
  const reserved = new Set(names);
  const nextSuffix = new Map<string, number>();
  let offset = 0;
  let centralSize = 0;
  let dataSize = 0;
  let zip64Entry = false;
  const entries = names.map((originalName, index) => {
    let name = originalName;
    let suffix = nextSuffix.get(originalName);
    if (suffix !== undefined) {
      do {
        name = suffixedName(originalName, suffix++);
      } while (reserved.has(name));
      reserved.add(name);
    }
    nextSuffix.set(originalName, suffix ?? 2);

    const nameBytes = encodeFlatName(name, 'UNSUPPORTED_ARCHIVE').length;
    const size = checkedSize(inputs[index]!.size);
    const entry = { name, size, offset };
    const layout = entryLayout(size, offset);
    const localSize = addSize(
      addSize(localHeaderBytes, nameBytes),
      layout.localExtra,
    );
    const centralEntrySize = addSize(
      addSize(centralHeaderBytes, nameBytes),
      layout.centralExtra,
    );
    dataSize = addSize(dataSize, size);
    offset = addSize(offset, addSize(localSize, size));
    centralSize = addSize(centralSize, centralEntrySize);
    zip64Entry ||= layout.zip64;
    return entry;
  });
  const directory = {
    count: entries.length,
    size: centralSize,
    offset,
    zip64Entry,
  };
  const totalSize = addSize(addSize(offset, centralSize), endSize(directory));
  if (totalSize > maxPayloadBytes) throw new CoreError('RESOURCE_LIMIT');
  return { totalSize, dataSize, entries, directory };
}
