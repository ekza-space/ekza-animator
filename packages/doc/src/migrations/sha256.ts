// SHA-256 wrappers of doc (M6A-SPEC §4.1): the digest core lives in anim-core (streaming, non-copying); doc keeps its
// shipped names and signatures for deterministic ID derivation in migrations and auto-rig IDs.
import { sha256 as sha256Digest, toHex } from '@ekza-animator/anim-core';

/** SHA-256 digest of `bytes` (32 bytes). */
export function sha256(bytes: Uint8Array): Uint8Array {
  return sha256Digest(bytes);
}

/** SHA-256 of a string's UTF-8 bytes as lowercase hex. */
export function sha256Hex(text: string): string {
  return toHex(sha256Digest(new TextEncoder().encode(text)));
}

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/**
 * `length` unbiased base62 characters drawn from a digest (bytes ≥ 248 are skipped), re-hashing when its bytes run
 * out. Shared by `deriveMigratedId` and the deterministic auto-rig IDs (`solverId`).
 */
export function digestBase62(digest: Uint8Array, length: number): string {
  let out = '';
  let bytes = digest;
  for (;;) {
    for (const byte of bytes) {
      if (byte >= 248) continue;
      out += BASE62.charAt(byte % 62);
      if (out.length === length) return out;
    }
    bytes = sha256(bytes);
  }
}
