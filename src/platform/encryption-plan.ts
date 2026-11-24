import { CoreError } from '@/core/crypto/errors';
import { planXfile, type XfileMetadataInput } from '@/core/xfile';
import { planStoreZip } from '@/core/zip';
import type { PickedSource } from './file-io';

export function planEncryption(
  sources: readonly PickedSource[],
  bundleName: string,
) {
  const first = sources[0];
  if (!first) throw new CoreError('IO_ERROR');

  const zip = sources.length > 1 ? planStoreZip(sources) : undefined;
  const metadata: XfileMetadataInput = zip
    ? {
        name: bundleName,
        isZip: true,
        totalSize: zip.totalSize,
        entryCount: sources.length,
      }
    : {
        name: first.name.normalize('NFC'),
        isZip: false,
        totalSize: first.size,
        entryCount: 1,
        mime: first.mime,
      };

  return { ...planXfile(metadata), zip, metadata };
}
