import { CoreError } from '@/core/crypto/errors';
import { addSize, checkedSize, withCapacityHeadroom } from '@/core/sizes';
import { nativeCall, type Volume } from './native';

type Demand = { bytes: number; volume: Volume | null };
export type CapacityWarning = () => void | Promise<void>;

export function checkCapacity(demands: readonly Demand[]) {
  const volumes = new Map<string, { bytes: number; available: number }>();
  let unknown = false;
  for (const { volume, bytes } of demands) {
    checkedSize(bytes);
    if (!volume) {
      unknown = true;
      continue;
    }
    const known = volumes.get(volume.id);
    volumes.set(volume.id, {
      bytes: addSize(known?.bytes ?? 0, bytes),
      available: Math.min(
        known?.available ?? volume.available,
        checkedSize(volume.available),
      ),
    });
  }
  for (const { bytes, available } of volumes.values()) {
    if (available < withCapacityHeadroom(bytes))
      throw new CoreError('NO_SPACE');
  }
  return { unknown };
}

export async function inspectCapacity(
  tree: string,
  destinationBytes: number,
  tempBytes?: number,
) {
  const destination = {
    bytes: destinationBytes,
    volume: await nativeCall((native) => native.volume(tree)),
  };
  const cache =
    tempBytes === undefined
      ? []
      : [
          {
            bytes: tempBytes,
            volume: await nativeCall((native) => native.volume(null)),
          },
        ];
  return checkCapacity([destination, ...cache]);
}

export async function preflight(
  tree: string,
  destinationBytes: number,
  warning: CapacityWarning,
  tempBytes?: number,
) {
  if ((await inspectCapacity(tree, destinationBytes, tempBytes)).unknown)
    await warning();
}

// Sample during writes as well. The original allocation plan has accounted
// for pending outputs; this checks that free space hasn't dropped below reserve.
export function writeSpaceCheck(tree: string | null, bytes: number) {
  const reserve = withCapacityHeadroom(bytes) - bytes;
  let sinceCheck = 0;
  return async (written: number) => {
    sinceCheck = addSize(sinceCheck, written);
    if (sinceCheck < 64 * 2 ** 20) return;
    sinceCheck = 0;
    const volume = await nativeCall((native) => native.volume(tree));
    if (volume && volume.available < reserve) throw new CoreError('NO_SPACE');
  };
}
