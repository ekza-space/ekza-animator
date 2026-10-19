// Revisions (M6A-SPEC §4.3, §5.20, P8):
// - the manifest (`format: 'ekza-mesh'`, `version: 1`) in canonical JSON (sorted keys, shortest round-trip numbers,
//   −0 written as 0, no whitespace); its SHA-256 is the revision id;
// - stored arrays under reserved names ('$position', '$edgeVerts', …) first, then the attribute layers in mesh order;
// - each array cut into chunks of `chunkElems` elements (the largest power of two whose bytes fit 32 KiB), raw
//   little-endian slices hashed with SHA-256;
// - canonical tails: a trailing chunk whose every element equals the default is never stored, in full and
//   incremental writes alike, so the same content always has the same manifest id; readers fill the missing tail
//   with the default and keep unknown layers;
// - incremental writes (`previous` + `dirty`, the DirtySet of the edits since `previous`): a chunk is re-hashed only
//   when a dirty index of its domain falls into it (layers: only layers the DirtySet names), or when it holds the
//   old or new end of a domain whose count changed — topology edits included, since the kernel's DirtySet lists every
//   stored-array element it wrote; every other chunk keeps its hash. The canonical tail is re-derived from what is
//   known: an unchanged last stored chunk was non-default, unchanged chunks past it were default.
import { sha256Hex } from '@ekza-animator/anim-core';
import { isEditMesh } from '../core/access';
import { KernelMesh } from '../core/mesh';
import { kernelError } from '../kernel';
import { allocLayer, BYTES_PER, domainCount, isDomain, isLayerType, type LayerArray } from '../layers/arrays';
import type {
  DirtySet,
  Domain,
  EditMesh,
  LayerDef,
  LayerInterp,
  LayerMirror,
  LayerType,
  MeshCounts,
  MeshData,
  RevisionManifest,
  RevisionOutput,
} from '../types';

type ManifestLayer = RevisionManifest['layers'][number];

interface StoredSpec {
  readonly name: string;
  readonly domain: Domain;
  readonly type: LayerType;
  readonly comps: 1 | 2 | 3 | 4;
  readonly interp: LayerInterp;
  readonly mirror: LayerMirror;
  readonly get: (data: MeshData) => LayerArray;
}

const stored = (
  name: string,
  domain: Domain,
  type: LayerType,
  comps: 1 | 2 | 3,
  interp: LayerInterp,
  mirror: LayerMirror,
  get: (data: MeshData) => LayerArray,
): StoredSpec => ({ name, domain, type, comps, interp, mirror, get });

/** The stored arrays of the revision format, in manifest order. */
export const STORED: readonly StoredSpec[] = [
  stored('$position', 'point', 'f32', 3, 'linear', 'negate-axis', (d) => d.position),
  stored('$edgeVerts', 'edge', 'u32', 2, 'copy', 'none', (d) => d.edgeVerts),
  stored('$edgeFlags', 'edge', 'u8', 1, 'copy', 'none', (d) => d.edgeFlags),
  stored('$cornerVert', 'corner', 'u32', 1, 'copy', 'none', (d) => d.cornerVert),
  stored('$cornerNext', 'corner', 'u32', 1, 'copy', 'none', (d) => d.cornerNext),
  stored('$faceCorner', 'face', 'u32', 1, 'copy', 'none', (d) => d.faceCorner),
  stored('$faceMaterial', 'face', 'u16', 1, 'copy', 'none', (d) => d.faceMaterial),
  stored('$faceFlags', 'face', 'u8', 1, 'copy', 'none', (d) => d.faceFlags),
];
const STORED_NAMES: ReadonlySet<string> = new Set(STORED.map((spec) => spec.name));

const CHUNK_BYTES = 32 * 1024;
const LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
const HEX64 = /^[0-9a-f]{64}$/;

/** The largest power of two of elements whose bytes fit 32 KiB. */
export function chunkElemsOf(type: LayerType, comps: number): number {
  const bytes = BYTES_PER[type] * comps;
  let elems = 1;
  while (elems * 2 * bytes <= CHUNK_BYTES) elems *= 2;
  return elems;
}

// ---------- canonical JSON ----------

/** Canonical JSON: sorted keys, shortest round-trip numbers (−0 written as 0), no whitespace; throws for non-JSON. */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw kernelError('invalid-mesh-manifest', 'canonicalJson: non-finite number');
      return JSON.stringify(value === 0 ? 0 : value);
    case 'string':
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
      const record = value as Readonly<Record<string, unknown>>;
      const keys = Object.keys(record)
        .filter((key) => record[key] !== undefined)
        .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
    }
    case 'bigint':
    case 'function':
    case 'symbol':
    case 'undefined':
      break;
  }
  throw kernelError('invalid-mesh-manifest', `canonicalJson: ${typeof value} is not JSON`);
}

// ---------- chunk bytes ----------

/** Little-endian bytes of elements [from, to) of an array with `comps` values per element. */
function chunkBytes(array: LayerArray, comps: number, from: number, to: number): Uint8Array {
  const bpe = array.BYTES_PER_ELEMENT;
  const start = from * comps;
  const end = to * comps;
  const out = new Uint8Array(array.buffer, array.byteOffset + start * bpe, (end - start) * bpe).slice();
  if (!LITTLE_ENDIAN && bpe > 1) swapBytes(out, bpe);
  return out;
}

function swapBytes(bytes: Uint8Array, bpe: number): void {
  for (let i = 0; i < bytes.length; i += bpe) {
    for (let a = i, b = i + bpe - 1; a < b; a++, b--) {
      const t = bytes[a] as number;
      bytes[a] = bytes[b] as number;
      bytes[b] = t;
    }
  }
}

/** True when elements [from, to) all equal the default (bit-exact: −0 differs from 0). */
function isDefaultRange(array: LayerArray, comps: number, def: readonly number[], from: number, to: number): boolean {
  for (let i = from; i < to; i++) {
    for (let k = 0; k < comps; k++) if (!Object.is(array[i * comps + k], def[k] ?? 0)) return false;
  }
  return true;
}

function domainDirty(dirty: DirtySet, domain: Domain): Uint32Array | 'all' {
  switch (domain) {
    case 'point':
      return dirty.points;
    case 'edge':
      return dirty.edges;
    case 'face':
      return dirty.faces;
    case 'corner':
      return dirty.corners;
  }
}

// ---------- writer ----------

interface EntryDef {
  readonly domain: Domain;
  readonly type: LayerType;
  readonly comps: number;
  readonly interp: LayerInterp;
  readonly mirror: LayerMirror;
  readonly default: readonly number[];
  readonly meta?: Readonly<Record<string, unknown>>;
}

/** Writes a revision; with `previous` and `dirty`, clean chunks keep their hashes and are not re-hashed. */
export function writeRevision(
  m: MeshData | EditMesh,
  opts?: { readonly previous?: RevisionManifest; readonly dirty?: DirtySet },
): RevisionOutput {
  const data = m instanceof KernelMesh ? m.dataView() : isEditMesh(m) ? m.snapshot() : m;
  const counts = data.counts;
  const previous = opts?.previous;
  const dirty = opts?.dirty;
  const incremental = previous !== undefined && dirty !== undefined;
  const previousLayers = new Map<string, ManifestLayer>((previous?.layers ?? []).map((layer) => [layer.name, layer]));
  const previousIds = new Set(previous === undefined ? [] : manifestChunkIds(previous));
  const newChunks = new Map<string, Uint8Array>();

  const entry = (name: string, def: EntryDef, array: LayerArray, layerDirty: boolean): ManifestLayer => {
    const count = domainCount(counts, def.domain);
    const chunkElems = chunkElemsOf(def.type, def.comps);
    const total = Math.ceil(count / chunkElems);
    const prior = incremental ? previousLayers.get(name) : undefined;
    const reusable =
      prior !== undefined &&
      prior.type === def.type &&
      prior.comps === def.comps &&
      prior.domain === def.domain &&
      prior.chunkElems === chunkElems;
    // Chunks whose content may differ from `prior`'s chunk at the same index.
    let changed: ReadonlySet<number> | 'all' = 'all';
    if (reusable && dirty !== undefined && previous !== undefined) {
      const set = new Set<number>();
      const before = domainCount(previous.counts, def.domain);
      if (before !== count) for (let k = Math.floor(Math.min(before, count) / chunkElems); k < total; k++) set.add(k);
      const indices = layerDirty ? domainDirty(dirty, def.domain) : null;
      if (indices === 'all') changed = 'all';
      else {
        if (indices !== null) for (const i of indices) if (i < count) set.add(Math.floor(i / chunkElems));
        changed = set;
      }
    }
    const known = (k: number): boolean => reusable && changed !== 'all' && !changed.has(k);
    const priorStored = reusable ? prior.chunks.length : 0;
    // Canonical tail: the last chunk holding a non-default element.
    let keep = 0;
    for (let k = total - 1; k >= 0; k--) {
      if (known(k)) {
        if (k === priorStored - 1) {
          keep = k + 1;
          break;
        }
        if (k >= priorStored) continue;
      }
      const from = k * chunkElems;
      if (!isDefaultRange(array, def.comps, def.default, from, Math.min(count, from + chunkElems))) {
        keep = k + 1;
        break;
      }
    }
    const chunks: string[] = [];
    for (let k = 0; k < keep; k++) {
      if (known(k) && k < priorStored) {
        chunks.push((prior as ManifestLayer).chunks[k] as string);
        continue;
      }
      const bytes = chunkBytes(array, def.comps, k * chunkElems, Math.min(count, (k + 1) * chunkElems));
      const id = sha256Hex(bytes);
      chunks.push(id);
      if (!previousIds.has(id)) newChunks.set(id, bytes);
    }
    return {
      name,
      domain: def.domain,
      type: def.type,
      comps: def.comps,
      interp: def.interp,
      mirror: def.mirror,
      default: [...def.default],
      ...(def.meta === undefined ? {} : { meta: def.meta }),
      chunkElems,
      chunks,
    };
  };

  const layers: ManifestLayer[] = [];
  for (const spec of STORED) {
    const def: EntryDef = {
      domain: spec.domain,
      type: spec.type,
      comps: spec.comps,
      interp: spec.interp,
      mirror: spec.mirror,
      default: Array.from({ length: spec.comps }, () => 0),
    };
    layers.push(entry(spec.name, def, spec.get(data), true));
  }
  for (const [name, layer] of data.layers) {
    if (STORED_NAMES.has(name)) throw kernelError('invalid-layer', `writeRevision: '${name}' is a reserved name`);
    layers.push(entry(name, layer.def, layer.data, dirty === undefined || dirty.layers.includes(name)));
  }

  const manifest: RevisionManifest = {
    format: 'ekza-mesh',
    version: 1,
    counts: { points: counts.points, edges: counts.edges, faces: counts.faces, corners: counts.corners },
    bounds: boundsOf(data.position, counts.points),
    layers,
  };
  const manifestBytes = new TextEncoder().encode(canonicalJson(manifest));
  return { manifestBytes, manifestId: sha256Hex(manifestBytes), manifest, newChunks };
}

function boundsOf(position: ArrayLike<number>, points: number): RevisionManifest['bounds'] {
  if (points === 0) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  let z1 = -Infinity;
  for (let v = 0; v < points; v++) {
    const x = position[3 * v] as number;
    const y = position[3 * v + 1] as number;
    const z = position[3 * v + 2] as number;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
    if (z < z0) z0 = z;
    if (z > z1) z1 = z;
  }
  return [
    [x0, y0, z0],
    [x1, y1, z1],
  ];
}

// ---------- reader ----------

const isObject = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/** Parses manifest bytes; EkzaError('mesh-manifest-version') on a newer version, ('invalid-mesh-manifest') otherwise. */
export function parseManifest(bytes: Uint8Array): RevisionManifest {
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw kernelError('invalid-mesh-manifest', 'The mesh manifest is not UTF-8 JSON');
  }
  const fail = (why: string): never => {
    throw kernelError('invalid-mesh-manifest', `Invalid mesh manifest: ${why}`);
  };
  if (!isObject(raw) || raw['format'] !== 'ekza-mesh') return fail("format is not 'ekza-mesh'");
  const version = raw['version'];
  if (typeof version === 'number' && Number.isInteger(version) && version > 1) {
    throw kernelError('mesh-manifest-version', 'Update the app to edit this mesh', { version });
  }
  if (version !== 1) return fail('version must be 1');
  const counts = raw['counts'];
  if (!isObject(counts) || !['points', 'edges', 'faces', 'corners'].every((key) => isCount(counts[key]))) {
    return fail('counts must be four non-negative integers');
  }
  const meshCounts = counts as unknown as MeshCounts;
  const bounds = raw['bounds'];
  const triple = (value: unknown): boolean =>
    Array.isArray(value) && value.length === 3 && value.every((x) => typeof x === 'number' && Number.isFinite(x));
  if (bounds !== null && !(Array.isArray(bounds) && bounds.length === 2 && bounds.every(triple))) {
    return fail('bounds must be null or [[x, y, z], [x, y, z]]');
  }
  const layers = raw['layers'];
  if (!Array.isArray(layers)) return fail('layers must be an array');
  const names = new Set<string>();
  for (const layer of layers as readonly unknown[]) {
    if (!isObject(layer)) return fail('a layer is not an object');
    const name = layer['name'];
    if (typeof name !== 'string' || name.length === 0 || names.has(name)) {
      return fail('layer names must be unique strings');
    }
    names.add(name);
    if (!isDomain(layer['domain']) || !isLayerType(layer['type'])) return fail(`layer ${name}: unknown domain or type`);
    const comps = layer['comps'];
    if (comps !== 1 && comps !== 2 && comps !== 3 && comps !== 4) return fail(`layer ${name}: comps must be 1…4`);
    if (typeof layer['interp'] !== 'string' || typeof layer['mirror'] !== 'string') {
      return fail(`layer ${name}: interp and mirror must be strings`);
    }
    const defaults = layer['default'];
    if (
      !Array.isArray(defaults) ||
      defaults.length !== comps ||
      !defaults.every((x) => typeof x === 'number' && Number.isFinite(x))
    ) {
      return fail(`layer ${name}: default must hold ${comps} finite numbers`);
    }
    if (layer['meta'] !== undefined && !isObject(layer['meta'])) return fail(`layer ${name}: meta must be an object`);
    const chunkElems = layer['chunkElems'];
    if (!isCount(chunkElems) || chunkElems === 0) return fail(`layer ${name}: chunkElems must be a positive integer`);
    const chunks = layer['chunks'];
    if (!Array.isArray(chunks) || !chunks.every((id) => typeof id === 'string' && HEX64.test(id))) {
      return fail(`layer ${name}: chunks must be SHA-256 hex ids`);
    }
    const count = domainCount(meshCounts, layer['domain']);
    if (chunks.length > Math.ceil(count / chunkElems)) return fail(`layer ${name}: more chunks than elements`);
  }
  for (const spec of STORED) {
    const layer = (layers as readonly Readonly<Record<string, unknown>>[]).find((entry) => entry['name'] === spec.name);
    if (layer === undefined) return fail(`missing ${spec.name}`);
    if (layer['domain'] !== spec.domain || layer['type'] !== spec.type || layer['comps'] !== spec.comps) {
      return fail(`${spec.name} has the wrong domain, type or comps`);
    }
  }
  return raw as unknown as RevisionManifest;
}

/** Every chunk id a manifest lists, without repeats, in first-use order. */
export function manifestChunkIds(manifest: RevisionManifest): readonly string[] {
  const out = new Set<string>();
  for (const layer of manifest.layers) for (const id of layer.chunks) out.add(id);
  return [...out];
}

/** Reads a revision: arrays filled from chunks, the missing tail from the default; unknown layers are kept. */
export function readRevision(manifest: RevisionManifest, chunk: (id: string) => Uint8Array): MeshData {
  const arrays = new Map<string, LayerArray>();
  const layers = new Map<string, { readonly def: LayerDef; readonly data: LayerArray }>();
  for (const layer of manifest.layers) {
    const count = domainCount(manifest.counts, layer.domain);
    const comps = layer.comps;
    const array = allocLayer(layer.type, count * comps);
    if (layer.default.some((x) => x !== 0 || Object.is(x, -0))) {
      for (let i = 0; i < count; i++) for (let k = 0; k < comps; k++) array[i * comps + k] = layer.default[k] as number;
    }
    const bpe = BYTES_PER[layer.type];
    layer.chunks.forEach((id, k) => {
      const from = k * layer.chunkElems;
      const elems = Math.min(layer.chunkElems, count - from);
      const bytes = chunk(id);
      if (!(bytes instanceof Uint8Array) || bytes.length !== elems * comps * bpe) {
        throw kernelError(
          'mesh-chunk-size',
          `Chunk ${id} of ${layer.name} has ${bytes?.length} bytes, expected ${elems * comps * bpe}`,
        );
      }
      const copy = bytes.slice();
      if (!LITTLE_ENDIAN && bpe > 1) swapBytes(copy, bpe);
      new Uint8Array(array.buffer, array.byteOffset + from * comps * bpe, copy.length).set(copy);
    });
    if (STORED_NAMES.has(layer.name)) {
      arrays.set(layer.name, array);
    } else {
      const def: LayerDef = {
        name: layer.name,
        domain: layer.domain,
        type: layer.type,
        comps: comps as LayerDef['comps'],
        interp: layer.interp,
        mirror: layer.mirror,
        default: [...layer.default],
        ...(layer.meta === undefined ? {} : { meta: layer.meta }),
      };
      layers.set(layer.name, { def, data: array });
    }
  }
  const storedArray = <T extends LayerArray>(name: string): T => arrays.get(name) as T;
  return {
    counts: { ...manifest.counts },
    position: storedArray<Float32Array>('$position'),
    edgeVerts: storedArray<Uint32Array>('$edgeVerts'),
    edgeFlags: storedArray<Uint8Array>('$edgeFlags'),
    cornerVert: storedArray<Uint32Array>('$cornerVert'),
    cornerNext: storedArray<Uint32Array>('$cornerNext'),
    faceCorner: storedArray<Uint32Array>('$faceCorner'),
    faceMaterial: storedArray<Uint16Array>('$faceMaterial'),
    faceFlags: storedArray<Uint8Array>('$faceFlags'),
    layers,
  };
}
