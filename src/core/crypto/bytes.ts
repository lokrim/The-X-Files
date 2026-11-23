/** Length is public; the loop does not exit early on differing byte values. */
export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i]! ^ b[i]!;
  return difference === 0;
}

/** Best effort only: strings, GC/native copies and timing are not guaranteed. */
export function zeroize(...buffers: (Uint8Array | undefined)[]): void {
  for (const bytes of buffers) bytes?.fill(0);
}
