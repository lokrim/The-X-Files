import { CoreError } from '../crypto/errors';
import { addSize, checkedSize, maxPayloadBytes, multiplySize } from '../sizes';
import { headerBytes, writerChunkLog2 } from './header';

export const maxPayloadRecords = 2 ** 20;
export const recordOverhead = 21;
export const maxMetadataBytes = 65_536;

export function payloadRecordCount(
  payloadBytes: number,
  chunkLog2: number,
): number {
  if (
    !Number.isInteger(chunkLog2) ||
    chunkLog2 < 16 ||
    chunkLog2 > writerChunkLog2
  )
    throw new CoreError('BAD_HEADER');
  const count = Math.ceil(checkedSize(payloadBytes) / 2 ** chunkLog2);
  if (payloadBytes > maxPayloadBytes || count > maxPayloadRecords)
    throw new CoreError('RESOURCE_LIMIT');
  return count;
}

export function containerSize(
  payloadBytes: number,
  metadataBytes: number,
  chunkLog2 = writerChunkLog2,
): number {
  const records = payloadRecordCount(payloadBytes, chunkLog2);
  if (checkedSize(metadataBytes) > maxMetadataBytes)
    throw new CoreError('RESOURCE_LIMIT');
  const framing = addSize(
    headerBytes,
    multiplySize(recordOverhead, addSize(1, records)),
  );
  return addSize(framing, addSize(metadataBytes, payloadBytes));
}
