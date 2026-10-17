// Accessor reader: float and integer component types, normalized integers, interleaved bufferViews (byteStride),
// matrix column padding and sparse substitution. Buffers are the GLB BIN chunk (buffers[0] without uri) or base64
// data URIs. Data compressed by EXT_meshopt_compression / KHR_meshopt_compression (or held only in a meshopt
// fallback buffer) cannot be read headlessly and throws `CompressedDataError`.
import { EkzaError } from '@ekza-animator/anim-core';
import type { GltfJson } from '../types';
import {
  accessorsOf,
  bufferViewsOf,
  buffersOf,
  COMPONENT_SIZE,
  type GltfAccessorDef,
  type GltfBufferViewDef,
  isIndex,
  isRecord,
  meshoptOf,
  MESHOPT_EXTENSIONS,
  pointer,
  TYPE_COMPONENTS,
} from './schema';

/** Thrown when an accessor's data is meshopt-compressed (callers map it to their own error code). */
export class CompressedDataError extends EkzaError {
  constructor(
    message: string,
    readonly accessor: number,
  ) {
    super('unsupported', message, { compressed: true, pointer: pointer('accessors', accessor) });
  }
}

const MATRIX_ROWS: Readonly<Record<string, number>> = { MAT2: 2, MAT3: 3, MAT4: 4 };

export class GltfReader {
  readonly json: GltfJson;
  private readonly bin: Uint8Array | null;
  private readonly accessors: readonly GltfAccessorDef[];
  private readonly views: readonly GltfBufferViewDef[];
  private readonly decoded = new Map<number, Uint8Array>();

  constructor(json: GltfJson, bin: Uint8Array | null) {
    this.json = json;
    this.bin = bin;
    this.accessors = accessorsOf(json);
    this.views = bufferViewsOf(json);
  }

  accessor(index: number): GltfAccessorDef {
    const accessor = isIndex(index) ? this.accessors[index] : undefined;
    if (accessor === undefined) throw malformed(`Accessor ${String(index)} does not exist`, pointer('accessors'));
    return accessor;
  }

  /** True when reading this accessor needs a meshopt decoder. */
  isCompressed(index: number): boolean {
    const accessor = this.accessor(index);
    const views = [accessor.bufferView, accessor.sparse?.indices.bufferView, accessor.sparse?.values.bufferView];
    return views.some((v) => v !== undefined && this.isViewCompressed(v));
  }

  private isViewCompressed(viewIndex: number): boolean {
    const view = isIndex(viewIndex) ? this.views[viewIndex] : undefined;
    if (view === undefined) return false;
    if (meshoptOf(view) !== null) return true;
    const buffer = buffersOf(this.json)[view.buffer];
    const ext = buffer?.extensions;
    return isRecord(ext) && MESHOPT_EXTENSIONS.some((name) => isRecord(ext[name]) && ext[name]['fallback'] === true);
  }

  /** Bytes of buffer `index`: the BIN chunk for an embedded buffer, decoded bytes for a data URI. */
  buffer(index: number): Uint8Array {
    const buffers = buffersOf(this.json);
    const def = isIndex(index) ? buffers[index] : undefined;
    if (def === undefined) throw malformed(`Buffer ${String(index)} does not exist`, pointer('buffers'));
    if (def.uri === undefined) {
      if (index !== 0 || this.bin === null) {
        throw malformed(`Buffer ${index} has no uri and no GLB BIN chunk`, pointer('buffers', index));
      }
      return this.bin;
    }
    const cached = this.decoded.get(index);
    if (cached !== undefined) return cached;
    const bytes = decodeDataUri(def.uri);
    if (bytes === null) {
      throw new EkzaError('unsupported', `Buffer ${index} references an external file (only GLB is supported)`, {
        pointer: pointer('buffers', index, 'uri'),
      });
    }
    this.decoded.set(index, bytes);
    return bytes;
  }

  /** Accessor values as float32 (normalized integers mapped to [−1, 1] / [0, 1]; other integers converted). */
  readFloat(index: number): Float32Array {
    const accessor = this.accessor(index);
    const out = new Float32Array(this.length(accessor, index));
    this.read(accessor, index, out, accessor.normalized === true);
    return out;
  }

  /** Accessor values as unsigned integers (JOINTS_n, indices); floats are truncated. */
  readUint(index: number): Uint32Array {
    const accessor = this.accessor(index);
    const out = new Uint32Array(this.length(accessor, index));
    this.read(accessor, index, out, false);
    return out;
  }

  private length(accessor: GltfAccessorDef, index: number): number {
    const components = TYPE_COMPONENTS[accessor.type];
    if (components === undefined || COMPONENT_SIZE[accessor.componentType] === undefined) {
      throw malformed(`Accessor ${index} has an unknown type or componentType`, pointer('accessors', index));
    }
    if (!isIndex(accessor.count))
      throw malformed(`Accessor ${index} has an invalid count`, pointer('accessors', index));
    return accessor.count * components;
  }

  private read(accessor: GltfAccessorDef, index: number, out: Float32Array | Uint32Array, normalized: boolean): void {
    if (this.isCompressed(index)) {
      throw new CompressedDataError(`Accessor ${index} is meshopt-compressed`, index);
    }
    const components = TYPE_COMPONENTS[accessor.type] as number;
    const componentSize = COMPONENT_SIZE[accessor.componentType] as number;
    if (accessor.bufferView !== undefined) {
      const { data, start, stride } = this.viewSlice(accessor, index);
      readElements(data, start, stride, accessor, components, componentSize, out, normalized, 0, accessor.count);
    }
    const sparse = accessor.sparse;
    if (sparse === undefined) return;
    const at = pointer('accessors', index, 'sparse');
    if (!isIndex(sparse.count) || sparse.count > accessor.count)
      throw malformed(`Sparse count of accessor ${index}`, at);
    const indexSize = COMPONENT_SIZE[sparse.indices.componentType];
    if (indexSize === undefined || sparse.indices.componentType === 5126) {
      throw malformed(`Sparse indices of accessor ${index} have an invalid componentType`, at);
    }
    const indices = this.rawRange(
      sparse.indices.bufferView,
      sparse.indices.byteOffset ?? 0,
      sparse.count * indexSize,
      at,
    );
    const valueBytes = elementBytes(accessor, components, componentSize);
    const values = this.rawRange(
      sparse.values.bufferView,
      sparse.values.byteOffset ?? 0,
      sparse.count * valueBytes,
      at,
    );
    const idx = new DataView(indices.buffer, indices.byteOffset, indices.byteLength);
    for (let i = 0; i < sparse.count; i++) {
      const target =
        indexSize === 1 ? idx.getUint8(i) : indexSize === 2 ? idx.getUint16(i * 2, true) : idx.getUint32(i * 4, true);
      if (target >= accessor.count) throw malformed(`Sparse index ${target} of accessor ${index} is out of range`, at);
      readElements(values, i * valueBytes, valueBytes, accessor, components, componentSize, out, normalized, target, 1);
    }
  }

  private viewSlice(
    accessor: GltfAccessorDef,
    index: number,
  ): { readonly data: Uint8Array; readonly start: number; readonly stride: number } {
    const at = pointer('accessors', index);
    const view = this.views[accessor.bufferView as number];
    if (view === undefined) throw malformed(`Accessor ${index} references a missing bufferView`, at);
    const buffer = this.buffer(view.buffer);
    const viewStart = view.byteOffset ?? 0;
    const viewEnd = viewStart + view.byteLength;
    if (!isIndex(viewStart) || !isIndex(view.byteLength) || viewEnd > buffer.byteLength) {
      throw malformed(
        `bufferView ${String(accessor.bufferView)} exceeds its buffer`,
        pointer('bufferViews', accessor.bufferView ?? -1),
      );
    }
    const componentSize = COMPONENT_SIZE[accessor.componentType] as number;
    const size = elementBytes(accessor, TYPE_COMPONENTS[accessor.type] as number, componentSize);
    const stride = view.byteStride ?? size;
    const start = viewStart + (accessor.byteOffset ?? 0);
    if (accessor.count > 0 && start + stride * (accessor.count - 1) + size > viewEnd) {
      throw malformed(`Accessor ${index} reads past the end of bufferView ${String(accessor.bufferView)}`, at);
    }
    return { data: buffer, start, stride };
  }

  private rawRange(viewIndex: number, byteOffset: number, byteLength: number, at: string): Uint8Array {
    const view = isIndex(viewIndex) ? this.views[viewIndex] : undefined;
    if (view === undefined) throw malformed('Sparse data references a missing bufferView', at);
    const buffer = this.buffer(view.buffer);
    const start = (view.byteOffset ?? 0) + byteOffset;
    if (byteOffset + byteLength > view.byteLength || start + byteLength > buffer.byteLength) {
      throw malformed('Sparse data exceeds its bufferView', at);
    }
    return buffer.subarray(start, start + byteLength);
  }
}

/** Byte size of one element as stored (matrix columns padded to 4 bytes). */
function elementBytes(accessor: GltfAccessorDef, components: number, componentSize: number): number {
  const rows = MATRIX_ROWS[accessor.type];
  if (rows === undefined) return components * componentSize;
  return rows * ((rows * componentSize + 3) & ~3);
}

function readElements(
  data: Uint8Array,
  start: number,
  stride: number,
  accessor: GltfAccessorDef,
  components: number,
  componentSize: number,
  out: Float32Array | Uint32Array,
  normalized: boolean,
  firstElement: number,
  count: number,
): void {
  const type = accessor.componentType;
  const rows = MATRIX_ROWS[accessor.type];
  // Fast path: tightly packed, aligned float32 (animation data, positions, inverse bind matrices). Float matrix
  // columns never need padding, so this also covers MAT2/3/4.
  if (
    type === 5126 &&
    stride === components * 4 &&
    (data.byteOffset + start) % 4 === 0 &&
    out instanceof Float32Array
  ) {
    out.set(new Float32Array(data.buffer, data.byteOffset + start, count * components), firstElement * components);
    return;
  }
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const columnBytes = rows === undefined ? 0 : (rows * componentSize + 3) & ~3;
  for (let e = 0; e < count; e++) {
    const base = start + e * stride;
    const o = (firstElement + e) * components;
    for (let c = 0; c < components; c++) {
      const offset =
        rows === undefined
          ? base + c * componentSize
          : base + Math.floor(c / rows) * columnBytes + (c % rows) * componentSize;
      out[o + c] = readComponent(dv, offset, type, normalized);
    }
  }
}

function readComponent(dv: DataView, offset: number, type: number, normalized: boolean): number {
  switch (type) {
    case 5126:
      return dv.getFloat32(offset, true);
    case 5120: {
      const v = dv.getInt8(offset);
      return normalized ? Math.max(v / 127, -1) : v;
    }
    case 5121: {
      const v = dv.getUint8(offset);
      return normalized ? v / 255 : v;
    }
    case 5122: {
      const v = dv.getInt16(offset, true);
      return normalized ? Math.max(v / 32767, -1) : v;
    }
    case 5123: {
      const v = dv.getUint16(offset, true);
      return normalized ? v / 65535 : v;
    }
    default:
      return dv.getUint32(offset, true);
  }
}

function malformed(message: string, at: string): EkzaError {
  return new EkzaError('malformed-gltf', message, { pointer: at });
}

/** Decodes a base64 `data:` URI; null for any other URI. */
export function decodeDataUri(uri: string): Uint8Array | null {
  const match = /^data:[^,]*;base64,/i.exec(uri);
  if (match === null) return null;
  return decodeBase64(uri.slice(match[0].length));
}

const BASE64 = new Int16Array(128).fill(-1);
for (let i = 0; i < 64; i++) {
  BASE64['ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'.charCodeAt(i)] = i;
}

function decodeBase64(text: string): Uint8Array {
  const clean = text.replace(/[\s=]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let bits = 0;
  let value = 0;
  let o = 0;
  for (let i = 0; i < clean.length; i++) {
    const code = clean.charCodeAt(i);
    const digit = code < 128 ? (BASE64[code] as number) : -1;
    if (digit < 0) throw new EkzaError('malformed-gltf', 'Invalid base64 data URI');
    value = (value << 6) | digit;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (value >> bits) & 0xff;
    }
  }
  return out.subarray(0, o);
}
