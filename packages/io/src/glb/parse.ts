// GLB container (glTF 2.0 binary): header, JSON chunk and the first BIN chunk. The original bytes are kept as is;
// `bin` is a zero-copy view. Consistency checks that do not prevent reading (declared length, chunk alignment,
// extra chunks) are reported by checkInputBudget instead of throwing here.
import { EkzaError } from '@ekza-studio/anim-core';
import { isRecord } from '../gltf/schema';
import { sha256Hex } from '../hash/sha256';
import type { GlbContainer, GltfJson } from '../types';

export { sha256Hex } from '../hash/sha256';

export const GLB_MAGIC = 0x46546c67; // 'glTF'
export const CHUNK_JSON = 0x4e4f534a; // 'JSON'
export const CHUNK_BIN = 0x004e4942; // 'BIN\0'
export const GLB_HEADER_BYTES = 12;
/**
 * JSON chunks above this are refused before JSON.parse (EkzaError('budget-exceeded')). It sits far above any real
 * model (the default JSON budget is 8 MiB) and only bounds the parse of hostile files.
 */
export const MAX_PARSE_JSON_BYTES = 67_108_864;
export const CHUNK_HEADER_BYTES = 8;

export interface GlbChunk {
  readonly type: number;
  /** Offset of the chunk data (after its 8-byte header). */
  readonly offset: number;
  readonly length: number;
}

export interface GlbLayout {
  readonly version: number;
  readonly declaredLength: number;
  readonly chunks: readonly GlbChunk[];
  /** Bytes after the last complete chunk that do not form a chunk header + data. */
  readonly trailingBytes: number;
  /** A chunk header announced more data than the file holds. */
  readonly truncated: boolean;
}

/** True when the bytes start with the GLB magic. */
export function isGlb(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 4 && view(bytes).getUint32(0, true) === GLB_MAGIC;
}

/** Reads the header and chunk table without interpreting chunk contents. Throws EkzaError('not-glb'). */
export function readGlbLayout(bytes: Uint8Array): GlbLayout {
  if (bytes.byteLength < GLB_HEADER_BYTES || !isGlb(bytes)) {
    throw new EkzaError('not-glb', 'Not a glTF binary (GLB) file');
  }
  const dv = view(bytes);
  const version = dv.getUint32(4, true);
  if (version !== 2) throw new EkzaError('not-glb', `Unsupported GLB version ${version} (only glTF 2.0 is supported)`);
  const chunks: GlbChunk[] = [];
  let offset = GLB_HEADER_BYTES;
  let truncated = false;
  while (offset + CHUNK_HEADER_BYTES <= bytes.byteLength) {
    const length = dv.getUint32(offset, true);
    const type = dv.getUint32(offset + 4, true);
    const dataOffset = offset + CHUNK_HEADER_BYTES;
    if (dataOffset + length > bytes.byteLength) {
      truncated = true;
      break;
    }
    chunks.push({ type, offset: dataOffset, length });
    offset = dataOffset + length;
  }
  return {
    version,
    declaredLength: dv.getUint32(8, true),
    chunks,
    trailingBytes: truncated ? 0 : bytes.byteLength - offset,
    truncated,
  };
}

/**
 * Parses a GLB. Throws EkzaError('not-glb') for anything that is not a glTF 2.0 binary and
 * EkzaError('malformed-gltf') when the JSON chunk is missing, truncated or not a glTF object.
 */
export async function parseGlb(bytes: Uint8Array): Promise<GlbContainer> {
  const { json, jsonByteLength, bin } = parseGlbSync(bytes);
  return { bytes, json, jsonByteLength, bin, sha256: await sha256Hex(bytes) };
}

/** `parseGlb` without the file hash (internal: read-back and lints re-parse their own outputs). */
export function parseGlbSync(bytes: Uint8Array): Omit<GlbContainer, 'sha256'> {
  const layout = readGlbLayout(bytes);
  const first = layout.chunks[0];
  if (first === undefined || first.type !== CHUNK_JSON) {
    throw new EkzaError('malformed-gltf', 'The GLB does not start with a complete JSON chunk');
  }
  if (first.length > MAX_PARSE_JSON_BYTES) {
    throw new EkzaError(
      'budget-exceeded',
      `The JSON chunk is ${first.length} bytes; files above 64 MiB of JSON are refused`,
    );
  }
  const json = parseJsonChunk(bytes.subarray(first.offset, first.offset + first.length));
  const binChunk = layout.chunks.slice(1).find((chunk) => chunk.type === CHUNK_BIN);
  return {
    bytes,
    json,
    jsonByteLength: first.length,
    bin: binChunk === undefined ? null : bytes.subarray(binChunk.offset, binChunk.offset + binChunk.length),
  };
}

function parseJsonChunk(data: Uint8Array): GltfJson {
  // Padding is 0x20 by the spec; some writers pad with NUL, which JSON.parse rejects.
  let end = data.length;
  while (end > 0 && (data[end - 1] === 0x20 || data[end - 1] === 0x00)) end--;
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(data.subarray(0, end));
  } catch {
    throw new EkzaError('malformed-gltf', 'The GLB JSON chunk is not valid UTF-8');
  }
  // A BOM is not allowed by the spec but tolerated by most readers.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new EkzaError('malformed-gltf', `The GLB JSON chunk is not valid JSON: ${(error as Error).message}`);
  }
  if (!isRecord(json) || !isRecord(json['asset']) || typeof json['asset']['version'] !== 'string') {
    throw new EkzaError('malformed-gltf', 'The GLB JSON is not a glTF object (missing asset.version)', {
      pointer: '/asset/version',
    });
  }
  return json as unknown as GltfJson;
}

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}
