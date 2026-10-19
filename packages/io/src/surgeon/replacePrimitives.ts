// Surgeon "replace primitives" (M6A-SPEC §5.22) and the in-memory display rebuild (§5.23), lazy `io/write` entry.
//
// The geometry step appends one bufferView + accessor per new attribute, index and morph target array after the
// existing data and re-points `meshes[i].primitives` of the edited meshes only: the array is replaced by one primitive
// per used material slot, with `mode`, `material`, `extras` and primitive extensions (minus Draco) copied from the
// original primitive of that slot. Nodes, skins, materials, textures and VRM extensions keep their indices; every
// other JSON value and the BIN prefix stay byte-identical. The original accessors and bufferViews stay (unused) so the
// bake marker v2 can re-point the original primitives at them. Quantized inputs are written as float accessors, and
// `extensionsUsed`/`extensionsRequired` lose Draco and mesh quantization when their last user is replaced.
import { EkzaError } from '@ekza-animator/anim-core';
import { parseGlb, parseGlbSync } from '../glb/parse';
import { align4, assembleGlb } from '../glb/write';
import type { GltfReader } from '../gltf/accessor';
import {
  accessorsOf,
  bufferViewsOf,
  DRACO_EXTENSION,
  type GltfAccessorDef,
  isIndex,
  isRecord,
  type JsonRecord,
  packedElementSize,
  stringList,
} from '../gltf/schema';
import { sha256Hex } from '../hash/sha256';
import type { DetailedPrimitive } from '../mesh/toPrimitives';
import type { GlbContainer, PrimitiveEdit } from '../types';
import {
  arrayOf,
  binLength,
  binPrefix,
  type MutableJson,
  type MutableMarker,
  readMarker,
  setBinLength,
  setList,
  writeMarker,
} from './marker';

const FLOAT = 5126;
const UNSIGNED_BYTE = 5121;
const UNSIGNED_SHORT = 5123;
const UNSIGNED_INT = 5125;
const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;
const QUANTIZATION = 'KHR_mesh_quantization';
/** Attribute order of new primitives after the original primitive's own order. */
const ATTRIBUTE_ORDER = ['POSITION', 'NORMAL', 'TEXCOORD_0', 'TEXCOORD_1', 'COLOR_0', 'JOINTS_0', 'WEIGHTS_0'];

type TypedData = Float32Array | Uint32Array | Uint16Array | Uint8Array;

/** Appends tightly packed data after `offset` in buffers[0], one 4-byte-aligned bufferView per accessor. */
export class GeometryWriter {
  private readonly parts: Uint8Array[] = [];
  private length = 0;

  constructor(
    private readonly json: MutableJson,
    private readonly offset: number,
  ) {}

  /** End of the appended data in buffers[0] (4-byte aligned). */
  get end(): number {
    return this.offset + align4(this.length);
  }

  /** Appends raw bytes as a bufferView; returns its index. */
  view(bytes: Uint8Array, target?: number): number {
    const pad = align4(this.length) - this.length;
    if (pad > 0) {
      this.parts.push(new Uint8Array(pad));
      this.length += pad;
    }
    const byteOffset = this.offset + this.length;
    this.parts.push(bytes);
    this.length += bytes.length;
    const views = arrayOf(this.json, 'bufferViews');
    views.push({ buffer: 0, byteOffset, byteLength: bytes.length, ...(target === undefined ? {} : { target }) });
    this.json['bufferViews'] = views;
    return views.length - 1;
  }

  /** Appends `data` as a new accessor (POSITION accessors get exact float32 min/max); returns its index. */
  accessor(
    data: TypedData,
    type: 'SCALAR' | 'VEC2' | 'VEC3' | 'VEC4',
    opts: { readonly target?: number; readonly minMax?: boolean } = {},
  ): number {
    const comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[type];
    const bytes = new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
    const view = this.view(bytes, opts.target);
    const accessor: MutableJson = {
      bufferView: view,
      componentType:
        data instanceof Float32Array
          ? FLOAT
          : data instanceof Uint32Array
            ? UNSIGNED_INT
            : data instanceof Uint16Array
              ? UNSIGNED_SHORT
              : UNSIGNED_BYTE,
      count: data.length / comps,
      type,
    };
    if (opts.minMax === true) {
      const min = Array.from({ length: comps }, () => Infinity);
      const max = Array.from({ length: comps }, () => -Infinity);
      for (let i = 0; i < data.length; i++) {
        const c = i % comps;
        const v = data[i] as number;
        if (v < (min[c] as number)) min[c] = v;
        if (v > (max[c] as number)) max[c] = v;
      }
      accessor['max'] = data.length === 0 ? Array.from({ length: comps }, () => 0) : max;
      accessor['min'] = data.length === 0 ? Array.from({ length: comps }, () => 0) : min;
    }
    const accessors = arrayOf(this.json, 'accessors');
    accessors.push(accessor);
    this.json['accessors'] = accessors;
    return accessors.length - 1;
  }

  /** Appends an accessor definition as it is (its bufferView written by `view`); returns its index. */
  rawAccessor(def: MutableJson): number {
    const accessors = arrayOf(this.json, 'accessors');
    accessors.push(def);
    this.json['accessors'] = accessors;
    return accessors.length - 1;
  }

  /** The appended bytes, padded to a multiple of 4. */
  finish(): Uint8Array {
    const out = new Uint8Array(align4(this.length));
    let offset = 0;
    for (const part of this.parts) {
      out.set(part, offset);
      offset += part.length;
    }
    return out;
  }
}

/** Primitives of one edited mesh, ready to write (from `meshToPrimitivesDetailed`). */
export interface MeshPrimitivesOut {
  readonly meshIndex: number;
  readonly primitives: readonly DetailedPrimitive[];
}

/** A mesh whose current (already replaced) primitives are re-appended verbatim after a rollback. */
export interface CarriedMesh {
  readonly meshIndex: number;
  readonly primitives: readonly unknown[];
  /** The container the primitives' accessors live in (the pre-rollback file). */
  readonly reader: GltfReader;
  readonly json: JsonRecord;
}

/**
 * Applies the geometry step to `json`: writes the edited meshes' primitives and re-appends carried ones, then drops
 * Draco and mesh quantization from the extension lists when nothing uses them any more. Returns the `primitives`
 * JSON each replaced mesh had before the step.
 */
export function applyGeometry(
  json: MutableJson,
  writer: GeometryWriter,
  edits: readonly MeshPrimitivesOut[],
  carried: readonly CarriedMesh[] = [],
): ReadonlyMap<number, unknown> {
  const meshes = arrayOf(json, 'meshes');
  const before = new Map<number, unknown>();
  const accessors = accessorsOf(json);
  const seen = new Set<number>();
  for (const edit of [...edits.map((e) => e.meshIndex), ...carried.map((c) => c.meshIndex)]) {
    if (seen.has(edit)) throw new EkzaError('unsupported', `Mesh ${edit} is edited twice in one export`);
    seen.add(edit);
    const mesh = meshes[edit];
    if (!isRecord(mesh) || !Array.isArray(mesh['primitives']) || mesh['primitives'].length === 0) {
      throw new EkzaError('unsupported', `The model has no mesh ${edit} with primitives to replace`);
    }
    before.set(edit, structuredClone(mesh['primitives']));
  }
  for (const edit of edits) {
    const mesh = meshes[edit.meshIndex] as JsonRecord;
    const originals = (mesh['primitives'] as readonly unknown[]).map((p) => (isRecord(p) ? p : {}));
    if (edit.primitives.length === 0) {
      throw new EkzaError('unsupported', `Mesh ${edit.meshIndex} has no faces left; a glTF mesh needs a primitive`);
    }
    const primitives = edit.primitives.map((out) =>
      writePrimitive(writer, out, originals[out.material] ?? originals[0] ?? {}, accessors),
    );
    meshes[edit.meshIndex] = { ...mesh, primitives };
  }
  for (const carry of carried) {
    const mesh = meshes[carry.meshIndex] as JsonRecord;
    const copied = new Map<number, number>();
    const copy = (index: unknown): unknown => (isIndex(index) ? copyAccessor(writer, carry, index, copied) : index);
    const primitives = carry.primitives.map((p) => {
      if (!isRecord(p)) return p;
      const out: MutableJson = { ...p };
      if (isRecord(p['attributes'])) {
        out['attributes'] = Object.fromEntries(Object.entries(p['attributes']).map(([k, v]) => [k, copy(v)]));
      }
      if (p['indices'] !== undefined) out['indices'] = copy(p['indices']);
      if (Array.isArray(p['targets'])) {
        out['targets'] = (p['targets'] as unknown[]).map((t) =>
          isRecord(t) ? Object.fromEntries(Object.entries(t).map(([k, v]) => [k, copy(v)])) : t,
        );
      }
      return out;
    });
    meshes[carry.meshIndex] = { ...mesh, primitives };
  }
  json['meshes'] = meshes;
  dropUnusedExtensions(json);
  return before;
}

function writePrimitive(
  writer: GeometryWriter,
  out: DetailedPrimitive,
  template: JsonRecord,
  accessors: readonly GltfAccessorDef[],
): MutableJson {
  const had = isRecord(template['attributes']) ? template['attributes'] : {};
  const names = [
    ...Object.keys(had).filter((name) => out.attributes[name] !== undefined),
    ...ATTRIBUTE_ORDER.filter((name) => out.attributes[name] !== undefined && had[name] === undefined),
  ].filter((name) => name === 'POSITION' || name === 'NORMAL' || had[name] !== undefined);
  const attributes: MutableJson = {};
  for (const name of names) {
    let data = out.attributes[name] as TypedData;
    const comps = data.length / out.vertexCount;
    let type = (['SCALAR', 'VEC2', 'VEC3', 'VEC4'] as const)[comps - 1] ?? 'VEC4';
    if (name === 'COLOR_0' && comps === 4 && isIndex(had[name]) && accessors[had[name]]?.type === 'VEC3') {
      // The original colours were RGB: keep them RGB.
      const rgb = new Float32Array(out.vertexCount * 3);
      for (let v = 0; v < out.vertexCount; v++) for (let k = 0; k < 3; k++) rgb[3 * v + k] = data[4 * v + k] as number;
      data = rgb;
      type = 'VEC3';
    }
    attributes[name] = writer.accessor(data, type, { target: ARRAY_BUFFER, minMax: name === 'POSITION' });
  }
  const primitive: MutableJson = { attributes };
  primitive['indices'] = writer.accessor(out.indices, 'SCALAR', { target: ELEMENT_ARRAY_BUFFER });
  if (template['material'] !== undefined) primitive['material'] = template['material'];
  if (template['mode'] === 4) primitive['mode'] = 4;
  const hadTargets = Array.isArray(template['targets']) && template['targets'].length > 0;
  if (hadTargets || out.targets.length > 0) {
    primitive['targets'] = out.targets.map((target) => {
      const json: MutableJson = {
        POSITION: writer.accessor(target.POSITION, 'VEC3', { target: ARRAY_BUFFER, minMax: true }),
      };
      if (target.NORMAL !== undefined)
        json['NORMAL'] = writer.accessor(target.NORMAL, 'VEC3', { target: ARRAY_BUFFER });
      return json;
    });
  }
  if (isRecord(template['extensions'])) {
    const { [DRACO_EXTENSION]: _draco, ...extensions } = template['extensions'];
    if (Object.keys(extensions).length > 0) primitive['extensions'] = extensions;
  }
  if (template['extras'] !== undefined) primitive['extras'] = structuredClone(template['extras']);
  return primitive;
}

/** Copies one accessor of a carried primitive (dense data, any stride) as a tightly packed new accessor. */
function copyAccessor(writer: GeometryWriter, carry: CarriedMesh, index: number, copied: Map<number, number>): number {
  const done = copied.get(index);
  if (done !== undefined) return done;
  const accessor = carry.reader.accessor(index);
  const views = bufferViewsOf(carry.json);
  const viewDef = isIndex(accessor.bufferView) ? views[accessor.bufferView] : undefined;
  const size = packedElementSize(accessor);
  if (viewDef === undefined || size === undefined || accessor.sparse !== undefined) {
    throw new EkzaError('unsupported', `Accessor ${index} of an edited mesh cannot be carried over (sparse or empty)`);
  }
  const stride = viewDef.byteStride ?? size;
  const source = carry.reader.buffer(viewDef.buffer);
  const start = (viewDef.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const bytes = new Uint8Array(size * accessor.count);
  for (let e = 0; e < accessor.count; e++)
    bytes.set(source.subarray(start + e * stride, start + e * stride + size), e * size);
  const view = writer.view(bytes, isIndex(viewDef.target) ? viewDef.target : undefined);
  const { bufferView: _v, byteOffset: _o, sparse: _s, ...rest } = accessor as unknown as MutableJson;
  const out = writer.rawAccessor({ bufferView: view, ...rest });
  copied.set(index, out);
  return out;
}

/** Removes Draco and mesh quantization from the extension lists when no primitive uses them any more. */
function dropUnusedExtensions(json: MutableJson): void {
  const used = stringList(json['extensionsUsed']);
  const required = stringList(json['extensionsRequired']);
  const drop = new Set<string>();
  if ((used.includes(DRACO_EXTENSION) || required.includes(DRACO_EXTENSION)) && !usesDraco(json))
    drop.add(DRACO_EXTENSION);
  if ((used.includes(QUANTIZATION) || required.includes(QUANTIZATION)) && !usesQuantization(json))
    drop.add(QUANTIZATION);
  if (drop.size === 0) return;
  if (json['extensionsUsed'] !== undefined)
    setList(
      json,
      'extensionsUsed',
      used.filter((name) => !drop.has(name)),
    );
  if (json['extensionsRequired'] !== undefined) {
    setList(
      json,
      'extensionsRequired',
      required.filter((name) => !drop.has(name)),
    );
  }
}

function primitivesOfJson(json: MutableJson): JsonRecord[] {
  return arrayOf(json, 'meshes').flatMap((mesh) =>
    isRecord(mesh) && Array.isArray(mesh['primitives']) ? (mesh['primitives'] as unknown[]).filter(isRecord) : [],
  );
}

function usesDraco(json: MutableJson): boolean {
  return primitivesOfJson(json).some(
    (p) => isRecord(p['extensions']) && p['extensions'][DRACO_EXTENSION] !== undefined,
  );
}

/** True when a primitive attribute needs KHR_mesh_quantization (a type core glTF does not allow there). */
function usesQuantization(json: MutableJson): boolean {
  const accessors = arrayOf(json, 'accessors');
  const quantized = (name: string, index: unknown): boolean => {
    const accessor = isIndex(index) ? accessors[index] : undefined;
    if (!isRecord(accessor)) return false;
    const type = accessor['componentType'];
    if (type === FLOAT) return false;
    if (name.startsWith('TEXCOORD_')) {
      return !(accessor['normalized'] === true && (type === UNSIGNED_BYTE || type === UNSIGNED_SHORT));
    }
    return name === 'POSITION' || name === 'NORMAL' || name === 'TANGENT';
  };
  for (const p of primitivesOfJson(json)) {
    const attributes = isRecord(p['attributes']) ? p['attributes'] : {};
    if (Object.entries(attributes).some(([name, index]) => quantized(name, index))) return true;
    for (const target of Array.isArray(p['targets']) ? (p['targets'] as unknown[]) : []) {
      if (isRecord(target) && Object.entries(target).some(([name, index]) => quantized(name, index))) return true;
    }
  }
  return false;
}

/** Turns edits into primitives through the lazy mesh entry (one primitive per used material slot). */
export async function primitivesOfEdits(edits: readonly PrimitiveEdit[]): Promise<MeshPrimitivesOut[]> {
  if (edits.length === 0) return [];
  const { meshToPrimitivesDetailed } = await import('../mesh/toPrimitives');
  return edits.map((edit) => {
    const out = meshToPrimitivesDetailed(edit.data, {
      colourOutput: 'asset',
      palette: null,
      paint: null,
      morphNormals: edit.morphNormals,
      hadTangents: edit.hadTangents,
      dropTangents: edit.dropTangents,
    });
    if ('refused' in out) throw new EkzaError('tangents', out.reason, { meshIndex: edit.meshIndex });
    return { meshIndex: edit.meshIndex, primitives: out.primitives };
  });
}

/** The extension lists as they are now (null for an absent key). */
export function extensionLists(json: MutableJson): {
  readonly used: readonly string[] | null;
  readonly required: readonly string[] | null;
} {
  return {
    used: Array.isArray(json['extensionsUsed']) ? stringList(json['extensionsUsed']) : null,
    required: Array.isArray(json['extensionsRequired']) ? stringList(json['extensionsRequired']) : null,
  };
}

/** Refuses a model whose buffers[0] lives in an external file (only self-contained GLB/VRM can be changed). */
export function assertSelfContained(json: MutableJson): void {
  const buffer0 = arrayOf(json, 'buffers')[0];
  if (isRecord(buffer0) && buffer0['uri'] !== undefined) {
    throw new EkzaError(
      'external-buffer',
      'The model keeps buffers[0] in an external file; only self-contained GLB/VRM can be baked into',
      { pointer: '/buffers/0/uri' },
    );
  }
}

/** Appends accessors and re-points `meshes[i].primitives` of edited meshes only (§5.22); with `marker`, writes or
 *  extends `ekza_animator_bake_v2`. Untouched JSON values and the BIN prefix stay byte-identical. */
export async function replacePrimitives(
  source: Uint8Array,
  edits: readonly PrimitiveEdit[],
  opts: { readonly marker: boolean },
): Promise<Uint8Array> {
  const parsed = parseGlbSync(source);
  const json = structuredClone(parsed.json) as unknown as MutableJson;
  assertSelfContained(json);
  const outputs = await primitivesOfEdits(edits);
  let marker: MutableMarker | null = null;
  if (opts.marker) {
    const existing = readMarker(json);
    const lists = extensionLists(json);
    if (existing === null) {
      const baseBinLength = binLength(json);
      marker = {
        version: 2,
        baseAnimations: arrayOf(json, 'animations').length,
        baseAccessors: arrayOf(json, 'accessors').length,
        baseBufferViews: arrayOf(json, 'bufferViews').length,
        baseBinLength,
        baseBinSha256: await sha256Hex(binPrefix(parsed.bin, baseBinLength)),
        baseSha256: await sha256Hex(source),
        replaced: {},
        replacedPrimitives: {},
        originalExtensions: lists,
      };
    } else {
      marker = {
        ...existing,
        version: 2,
        replaced: { ...existing.replaced },
        replacedPrimitives: { ...existing.replacedPrimitives },
        originalExtensions: existing.originalExtensions ?? lists,
      };
    }
  }
  const offset = align4(binLength(json));
  const writer = new GeometryWriter(json, offset);
  const before = applyGeometry(json, writer, outputs);
  const appended = writer.finish();
  if (appended.length > 0) setBinLength(json, offset + appended.length);
  if (marker !== null) {
    for (const [mesh, primitives] of before) {
      if (!Object.hasOwn(marker.replacedPrimitives, String(mesh))) marker.replacedPrimitives[String(mesh)] = primitives;
    }
    const asset: MutableJson = isRecord(json['asset']) ? { ...json['asset'] } : { version: '2.0' };
    const extras: MutableJson = isRecord(asset['extras']) ? { ...asset['extras'] } : {};
    writeMarker(extras, marker);
    asset['extras'] = extras;
    json['asset'] = asset;
  }
  const binParts = binLength(json) > 0 || parsed.bin !== null ? [binPrefix(parsed.bin, offset), appended] : null;
  return assembleGlb(JSON.stringify(json), binParts);
}

/** In-memory container for the display of edited characters (§5.23): replacePrimitives without a marker, parsed. */
export async function rebuildContainer(
  container: GlbContainer,
  edits: readonly PrimitiveEdit[],
): Promise<GlbContainer> {
  return parseGlb(await replacePrimitives(container.bytes, edits, { marker: false }));
}
