import { getDocumentAsync } from 'expo-document-picker';
import { Share } from 'react-native';

import type { ByteReader, ByteWriter } from '@/core/contracts';
import { zeroize } from '@/core/crypto/bytes';
import { CoreError } from '@/core/crypto/errors';
import { encodeFlatName } from '@/core/file-names';
import { checkedSize } from '@/core/sizes';
import { inspectHeader } from '@/core/xfile';
import { nativeCall } from './native';

export type PickedSource = {
  uri: string;
  name: string;
  mime: string;
  size: number;
};
export type Destination = { tree: string; label: string };
export type SavedFile = {
  uri: string;
  mime: string;
  kind: 'ciphertext' | 'plaintext';
};

export async function pickSources(multiple: boolean): Promise<PickedSource[]> {
  const result = await getDocumentAsync({
    multiple,
    copyToCacheDirectory: false,
  }).catch(() => {
    throw new CoreError('UNSUPPORTED_PROVIDER');
  });
  if (result.canceled) return [];
  const sources: PickedSource[] = [];
  for (const asset of result.assets) {
    sources.push({
      uri: asset.uri,
      name: asset.name,
      mime: asset.mimeType ?? 'application/octet-stream',
      size: checkedSize(
        await nativeCall((native) => native.sourceSize(asset.uri)),
      ),
    });
  }
  return sources;
}

export async function chooseDestination(): Promise<Destination | null> {
  const tree = await nativeCall((native) => native.chooseDirectory());
  if (!tree) return null;
  const label = await nativeCall((native) => native.directoryLabel(tree));
  return { tree, label };
}

export async function inspectPickedHeader(source: PickedSource) {
  const prefix = await nativeCall((native) => native.inspectHeader(source.uri));
  let offset = 0;
  return inspectHeader({
    async read(maximum) {
      const end = Math.min(offset + maximum, prefix.length);
      const bytes = prefix.subarray(offset, end);
      offset = end;
      return bytes.length ? bytes : null;
    },
    async size() {
      return source.size;
    },
  });
}

export async function withReader<T>(
  generation: number,
  source: string | number,
  use: (reader: ByteReader) => Promise<T>,
) {
  const handle = await nativeCall((native) =>
    typeof source === 'string'
      ? native.openSource(generation, source)
      : native.openTemp(generation, source),
  );
  const reader: ByteReader = {
    async read(maximum) {
      const bytes = await nativeCall((native) =>
        native.read(generation, handle, maximum),
      );
      return bytes.length ? bytes : null;
    },
    async size() {
      return checkedSize(
        await nativeCall((native) => native.readerSize(generation, handle)),
      );
    },
  };
  const close = () =>
    nativeCall((native) => native.closeReader(generation, handle));
  let result: T;
  try {
    result = await use(reader);
  } catch (error) {
    // Preserve the operation error. The native job still owns any handle
    // whose close failed and can retry it during its cleanup pass.
    await close().catch(() => undefined);
    throw error;
  }
  await close();
  return result;
}

type JobOutput = ByteWriter & { id: number; uri: string | null };

export async function createWriter(
  generation: number,
  tree: string | null,
  name: string,
  mime: string,
  checkSpace: (written: number) => Promise<void>,
): Promise<JobOutput> {
  if (tree !== null) zeroize(encodeFlatName(name, 'IO_ERROR'));
  const { id, uri } = await nativeCall((native) =>
    native.createOutput(generation, tree, name, mime),
  );
  let aborted = false;
  return {
    id,
    uri,
    async write(bytes) {
      await nativeCall((native) => native.write(generation, id, bytes));
      await checkSpace(bytes.length);
    },
    close: () => nativeCall((native) => native.closeWriter(generation, id)),
    async abort() {
      if (aborted) return;
      await nativeCall((native) => native.abortOutput(generation, id));
      aborted = true;
    },
  };
}

export function savedFile(
  output: JobOutput,
  mime: string,
  kind: SavedFile['kind'],
): SavedFile {
  if (!output.uri) throw new CoreError('IO_ERROR');
  return { uri: output.uri, mime, kind };
}

export async function shareFile(file: SavedFile, confirmPlaintext = false) {
  if (file.kind === 'plaintext' && !confirmPlaintext)
    throw new CoreError('CANCELLED');
  await nativeCall((native) => native.shareDocument(file.uri, file.mime));
}

export async function shareSecret(message: string) {
  try {
    await Share.share({ message });
  } catch {
    throw new CoreError('IO_ERROR');
  }
}
