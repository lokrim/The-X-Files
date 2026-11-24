/** Buffers crossing these contracts are Uint8Array, never platform key objects. */
export type SealedRecord = { ciphertext: Uint8Array; tag: Uint8Array };

export interface Aead {
  seal(
    key: Uint8Array,
    nonce: Uint8Array,
    aad: Uint8Array,
    plaintext: Uint8Array,
  ): Promise<SealedRecord>;
  /** Resolve with plaintext only after the complete tag has authenticated. */
  open(
    key: Uint8Array,
    nonce: Uint8Array,
    aad: Uint8Array,
    ciphertext: Uint8Array,
    tag: Uint8Array,
  ): Promise<Uint8Array>;
}

export interface Rng {
  bytes(length: number): Uint8Array;
}

export type ScryptLog2N = 15 | 16 | 17 | 18;
export type ScryptParams = Readonly<{
  log2N: ScryptLog2N;
  r: 8;
  p: 1;
  dkLen: 32;
}>;
export type KdfProgress = (fraction: number) => void;

export interface Kdf {
  /**
   * Core policy must run before dispatch. The caller retains its input buffers;
   * adapters own any copies and wipe them when work actually finishes. Cancel
   * may reject before native work ends: discard/wipe late keys, never continue.
   * A successful returned key belongs to the caller, who must wipe it later.
   */
  derive(
    passwordBytes: Uint8Array,
    salt: Uint8Array,
    params: ScryptParams,
    signal?: AbortSignal,
    onProgress?: KdfProgress,
  ): Promise<Uint8Array>;
}

export interface ByteReader {
  /**
   * Up to max bytes; short reads are valid, null/empty means terminal EOF.
   * Returned bytes are scratch. Consume or copy them before the next read.
   * The caller may clear them after consumption.
   */
  read(max: number): Promise<Uint8Array | null>;
  size(): Promise<number>;
}

export interface ByteWriter {
  /** Resolves after all bytes are consumed; only then may the caller reuse them. */
  write(bytes: Uint8Array): Promise<void>;
  close(): Promise<void>;
  /**
   * Idempotently delete this operation's new output, even after close.
   * A failed close or deletion must be reported.
   */
  abort(): Promise<void>;
}

/** Byte progress is bounded to ten notifications per second by job coordinators. */
export type OnProgress = (processedBytes: number, totalBytes: number) => void;
