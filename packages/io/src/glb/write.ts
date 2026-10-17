// GLB assembly: header, JSON chunk padded with 0x20, BIN chunk padded with 0x00 (glTF 2.0 §4.4). The BIN data is
// given as parts so a large original prefix is copied exactly once, into the output.
import { CHUNK_BIN, CHUNK_HEADER_BYTES, CHUNK_JSON, GLB_HEADER_BYTES, GLB_MAGIC } from './parse';

export function align4(n: number): number {
  return (n + 3) & ~3;
}

/**
 * Builds a GLB from JSON text and BIN parts (concatenated in order). A BIN chunk is written only when
 * `binParts` is non-null; its length is the parts' total length padded to 4 bytes.
 */
export function assembleGlb(jsonText: string, binParts: readonly Uint8Array[] | null): Uint8Array {
  const jsonBytes = new TextEncoder().encode(jsonText);
  const jsonLength = align4(jsonBytes.length);
  const binData = binParts?.reduce((sum, part) => sum + part.length, 0) ?? 0;
  const binLength = binParts === null ? 0 : align4(binData);
  const total =
    GLB_HEADER_BYTES + CHUNK_HEADER_BYTES + jsonLength + (binParts === null ? 0 : CHUNK_HEADER_BYTES + binLength);
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, GLB_MAGIC, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  let offset = GLB_HEADER_BYTES;
  dv.setUint32(offset, jsonLength, true);
  dv.setUint32(offset + 4, CHUNK_JSON, true);
  offset += CHUNK_HEADER_BYTES;
  out.set(jsonBytes, offset);
  out.fill(0x20, offset + jsonBytes.length, offset + jsonLength);
  offset += jsonLength;
  if (binParts !== null) {
    dv.setUint32(offset, binLength, true);
    dv.setUint32(offset + 4, CHUNK_BIN, true);
    offset += CHUNK_HEADER_BYTES;
    for (const part of binParts) {
      out.set(part, offset);
      offset += part.length;
    }
    // The tail padding stays 0x00 (fresh allocation).
  }
  return out;
}
