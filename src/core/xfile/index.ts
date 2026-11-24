export { decryptXfile, type DecryptResult } from './decrypt';
export {
  encryptXfile,
  planXfile,
  type EncryptPassword,
  type EncryptResult,
} from './encrypt';
export { inspectHeader, type HeaderHints, type XfileMode } from './header';
export type { XfileMetadata, XfileMetadataInput } from './metadata';
export { containerSize, payloadRecordCount } from './plan';
export { withCapacityHeadroom } from '../sizes';
