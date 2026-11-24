import type { ByteReader, ByteWriter } from '../contracts';
import { equalBytes, zeroize } from '../crypto/bytes';
import { Crc32 } from '../crypto/crc32';
import { CoreError, throwIfAborted } from '../crypto/errors';
import { decodeUtf8 } from '../crypto/utf8';
import { encodeFlatName, maxNameBytes } from '../file-names';
import {
  abortOutputs,
  expectEof,
  readChunk,
  readExact,
  streamProgress,
  type StreamOptions,
} from '../io';
import {
  addSize,
  checkedSize,
  dataView,
  maxChunkBytes,
  maxPayloadBytes,
  readUint64,
} from '../sizes';
import {
  centralHeader,
  centralHeaderBytes,
  classicEndBytes,
  centralSignature,
  endRecords,
  entryLayout,
  localHeader,
  localHeaderBytes,
  localSignature,
  readExtra,
  reconstructSize,
  uint32Sentinel,
  validateStoreFields,
  type DirectoryFacts,
  type EntryFacts,
} from './layout';
import { maxExtractEntries } from './limits';

type ArchiveMetadata = Readonly<{ totalSize: number; entryCount: number }>;
/** Exclusively create a new file, or fail without taking ownership of existing data. */
export type CreateZipOutput = (
  name: string,
  size: number,
) => Promise<ByteWriter>;

class ArchiveReader {
  position = 0;

  constructor(
    private source: ByteReader,
    private total: number,
    private signal?: AbortSignal,
  ) {}

  get remaining(): number {
    return this.total - this.position;
  }

  async header(length: number): Promise<Uint8Array> {
    if (length > this.remaining) throw new CoreError('UNSUPPORTED_ARCHIVE');
    const bytes = await readExact(
      this.source,
      length,
      'UNSUPPORTED_ARCHIVE',
      this.signal,
    );
    try {
      this.position = addSize(this.position, bytes.length);
      // ZIP headers can straddle records, and local names must survive until
      // the central directory. The authenticated reader may recycle its chunk.
      return Uint8Array.from(bytes);
    } finally {
      zeroize(bytes);
    }
  }

  async content(length: number): Promise<Uint8Array> {
    const bytes = await readChunk(
      this.source,
      Math.min(length, maxChunkBytes),
      this.signal,
    );
    if (!bytes) throw new CoreError('UNSUPPORTED_ARCHIVE');
    this.position = addSize(this.position, bytes.length);
    return bytes;
  }

  async finish(): Promise<void> {
    await expectEof(this.source, 'UNSUPPORTED_ARCHIVE', this.signal);
    if (this.remaining !== 0) throw new CoreError('UNSUPPORTED_ARCHIVE');
  }
}

function checkVariableLengths(
  nameLength: number,
  extraLength: number,
  maxExtra: number,
): void {
  if (nameLength < 1 || nameLength > maxNameBytes || extraLength > maxExtra)
    throw new CoreError('UNSUPPORTED_ARCHIVE');
}

async function readLocal(archive: ArchiveReader, offset: number) {
  const fixed = await archive.header(localHeaderBytes - 4);
  const view = dataView(fixed);
  validateStoreFields(view, 0);
  const size32 = reconstructSize(view, 14);
  const nameLength = view.getUint16(22, true);
  const extraLength = view.getUint16(24, true);
  checkVariableLengths(nameLength, extraLength, 20);
  const variable = await archive.header(nameLength + extraLength);
  const name = variable.subarray(0, nameLength);
  const filename = decodeUtf8(name, 'UNSUPPORTED_ARCHIVE');
  encodeFlatName(filename, 'UNSUPPORTED_ARCHIVE');
  const limits = readExtra(
    variable.subarray(nameLength),
    size32 === uint32Sentinel ? 2 : 0,
  );
  const size = limits[0] ?? size32;
  const entry = { name, size, offset, crc: view.getUint32(10, true) };
  const canonical = localHeader(entry);
  if (
    !equalBytes(canonical.subarray(4, localHeaderBytes), fixed) ||
    !equalBytes(canonical.subarray(localHeaderBytes), variable)
  )
    throw new CoreError('UNSUPPORTED_ARCHIVE');
  if (size > archive.remaining) throw new CoreError('RESOURCE_LIMIT');
  return { filename, entry };
}

async function checkCentral(
  archive: ArchiveReader,
  signature: number,
  entry: EntryFacts,
): Promise<void> {
  if (signature !== centralSignature)
    throw new CoreError('UNSUPPORTED_ARCHIVE');
  const fixed = await archive.header(centralHeaderBytes - 4);
  const view = dataView(fixed);
  validateStoreFields(view, 2);
  const nameLength = view.getUint16(24, true);
  const extraLength = view.getUint16(26, true);
  const size32 = reconstructSize(view, 16);
  const offset32 = view.getUint32(38, true);
  checkVariableLengths(nameLength, extraLength, 28);
  const variable = await archive.header(nameLength + extraLength);
  const sizes = readExtra(
    variable.subarray(nameLength),
    (size32 === uint32Sentinel ? 2 : 0) + (offset32 === uint32Sentinel ? 1 : 0),
  );
  if (sizes.some((size) => size > maxPayloadBytes))
    throw new CoreError('RESOURCE_LIMIT');
  // Match every central field, including order, offsets, Unix attributes and extra bytes.
  const canonical = centralHeader(entry);
  if (
    !equalBytes(canonical.subarray(4, centralHeaderBytes), fixed) ||
    !equalBytes(canonical.subarray(centralHeaderBytes), variable)
  )
    throw new CoreError('UNSUPPORTED_ARCHIVE');
}

async function checkDirectoryEnd(
  archive: ArchiveReader,
  signature: Uint8Array,
  directory: DirectoryFacts,
): Promise<void> {
  const canonical = endRecords(directory);
  if (!equalBytes(signature, canonical.subarray(0, 4)))
    throw new CoreError('UNSUPPORTED_ARCHIVE');
  const rest = await archive.header(canonical.length - 4);
  const view = dataView(rest);
  const classic = rest.length - classicEndBytes;
  if (classic > 0) {
    // Fields with a uint64 representation must stay in the application's safe domain.
    readUint64(view, 0, true);
    for (const offset of [20, 28])
      if (readUint64(view, offset, true) > maxExtractEntries)
        throw new CoreError('RESOURCE_LIMIT');
    for (const offset of [36, 44, 60])
      if (readUint64(view, offset, true) > maxPayloadBytes)
        throw new CoreError('RESOURCE_LIMIT');
  }
  for (const offset of [8, 10]) {
    const count = view.getUint16(classic + offset, true);
    if (count > maxExtractEntries) throw new CoreError('RESOURCE_LIMIT');
  }
  if (!equalBytes(rest, canonical.subarray(4)))
    throw new CoreError('UNSUPPORTED_ARCHIVE');
}

async function extractEntry(
  archive: ArchiveReader,
  entry: EntryFacts,
  writer: ByteWriter,
  checkpoint: (position: number) => Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  const crc = new Crc32();
  let remaining = entry.size;
  while (remaining > 0) {
    const bytes = await archive.content(remaining);
    try {
      crc.update(bytes);
      await writer.write(bytes);
      remaining -= bytes.length;
    } finally {
      zeroize(bytes);
    }
    await checkpoint(archive.position);
  }
  if (crc.digest() !== entry.crc) throw new CoreError('UNSUPPORTED_ARCHIVE');
  throwIfAborted(signal);
  await writer.close();
  throwIfAborted(signal);
}

/** Supply only authenticated bundle bytes and metadata. EOF is part of the transaction. */
export async function extractStoreZip(
  source: ByteReader,
  metadata: ArchiveMetadata,
  createOutput: CreateZipOutput,
  options: StreamOptions = {},
): Promise<void> {
  const { signal } = options;
  const outputs: ByteWriter[] = [];
  const entries: EntryFacts[] = [];
  try {
    throwIfAborted(signal);
    const { totalSize, entryCount } = metadata;
    if (
      checkedSize(totalSize) > maxPayloadBytes ||
      checkedSize(entryCount) > maxExtractEntries
    )
      throw new CoreError('RESOURCE_LIMIT');
    if (entryCount < 2) throw new CoreError('UNSUPPORTED_ARCHIVE');
    const archive = new ArchiveReader(source, totalSize, signal);
    const checkpoint = streamProgress(totalSize, options);
    const names = new Set<string>();
    let zip64Entry = false;
    let offset = archive.position;
    let signature = await archive.header(4);
    while (dataView(signature).getUint32(0, true) === localSignature) {
      if (entries.length === maxExtractEntries)
        throw new CoreError('RESOURCE_LIMIT');
      if (entries.length === entryCount)
        throw new CoreError('UNSUPPORTED_ARCHIVE');
      const { filename, entry } = await readLocal(archive, offset);
      if (names.has(filename)) throw new CoreError('UNSUPPORTED_ARCHIVE');
      names.add(filename);
      entries.push(entry);
      zip64Entry ||= entryLayout(entry.size, entry.offset).zip64;
      throwIfAborted(signal);
      const writer = await createOutput(filename, entry.size);
      outputs.push(writer);
      await extractEntry(archive, entry, writer, checkpoint, signal);
      if (entries.length % 64 === 0) await checkpoint(archive.position);
      offset = archive.position;
      signature = await archive.header(4);
    }
    if (entries.length !== entryCount)
      throw new CoreError('UNSUPPORTED_ARCHIVE');
    const centralOffset = offset;
    for (const entry of entries) {
      await checkCentral(
        archive,
        dataView(signature).getUint32(0, true),
        entry,
      );
      await checkpoint(archive.position);
      offset = archive.position;
      signature = await archive.header(4);
    }
    await checkDirectoryEnd(archive, signature, {
      size: offset - centralOffset,
      offset: centralOffset,
      count: entries.length,
      zip64Entry,
    });
    await archive.finish();
    await checkpoint(archive.position);
  } catch (error) {
    return await abortOutputs(outputs, error);
  } finally {
    for (const entry of entries) zeroize(entry.name);
  }
}
