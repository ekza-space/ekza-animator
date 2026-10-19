// SHA-256 wrappers of io (M6A-SPEC §4.1): the digest core lives in anim-core (streaming, non-copying); io keeps its
// shipped names and signatures. `sha256Hex` uses WebCrypto when the platform has it; `sha256HexSync` is the
// synchronous path for `skeletonFromGltf` fingerprints and platforms without `crypto.subtle`.
import { sha256, toHex as hex } from '@ekza-animator/anim-core';

/** Lowercase hex of a byte array. */
export function toHex(bytes: Uint8Array): string {
  return hex(bytes);
}

/** SHA-256 of `bytes` as lowercase hex, computed synchronously in JavaScript. */
export function sha256HexSync(bytes: Uint8Array): string {
  return hex(sha256(bytes));
}

/** SHA-256 of `bytes` as lowercase hex (WebCrypto when available, otherwise the synchronous implementation). */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle === undefined) return sha256HexSync(bytes);
  // WebCrypto rejects views over SharedArrayBuffer and needs an ArrayBuffer-backed view.
  const input = bytes.buffer instanceof ArrayBuffer ? (bytes as Uint8Array<ArrayBuffer>) : bytes.slice();
  return toHex(new Uint8Array(await subtle.digest('SHA-256', input)));
}
