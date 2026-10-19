// Revisions (M6A-SPEC §4.3, §5.20; reference implementation of B0a, B1 replaces it with the same contract):
// - the manifest (`format: 'ekza-mesh'`, `version: 1`) in canonical JSON (sorted keys, shortest round-trip numbers,
//   no whitespace); its SHA-256 is the revision id;
// - stored arrays under reserved names ('$position', '$edgeVerts', …) first, then the attribute layers in mesh order;
// - each array cut into chunks of `chunkElems` elements (the largest power of two whose bytes fit 32 KiB), raw
//   little-endian slices hashed with SHA-256;
// - canonical tails: a trailing chunk whose every element equals the default is never stored (full and incremental
//   writes alike), so the same content always gives the same manifest id; readers fill the missing tail with the
//   default;
// - incremental writes (`previous` + `dirty`) keep the hashes of chunks no dirty index spans; a topology change or a
//   count change re-hashes everything.
import { sha256Hex } from '@ekza-animator/anim-core';
import { kernelError } from '../kernel';
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
import { isEditMesh } from './access';
import { allocLayer, BYTES_PER, domainCount, isDomain, isLayerType, type LayerArray } from './layers';

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

/** The stored arrays of the revision format, in manifest order. */
const STORED: readonly StoredSpec[] = [
  {
    name: '$position',
    domain: 'point',
    type: 'f32',
    comps: 3,
    interp: 'linear',
    mirror: 'negate-axis',
    get: (d) => d.position,
  },
  {
    name: '$edgeVerts',
    domain: 'edge',
    type: 'u32',
    comps: 2,
    interp: 'copy',
    mirror: 'none',
    get: (d) => d.edgeVerts,
  },
  { name: '$edgeFlags', domain: 'edge', type: 'u8', comps: 1, interp: 'copy', mirror: 'none', get: (d) => d.edgeFlags },
  {
    name: '$cornerVert',
    domain: 'corner',
    type: 'u32',
    comps: 1,
    interp: 'copy',
    mirror: 'none',
    get: (d) => d.cornerVert,
  },
  {
    name: '$cornerNext',
    domain: 'corner',
    type: 'u32',
    comps: 1,
    interp: 'copy',
    mirror: 'none',
    get: (d) => d.cornerNext,
  },
  {
    name: '$faceCorner',
    domain: 'face',
    type: 'u32',
    comps: 1,
    interp: 'copy',
    mirror: 'none',
    get: (d) => d.faceCorner,
  },
  {
    name: '$faceMaterial',
    domain: 'face',
    type: 'u16',
    comps: 1,
    interp: 'copy',
    mirror: 'none',
    get: (d) => d.faceMaterial,
  },
  { name: '$faceFlags', domain: 'face', type: 'u8', comps: 1, interp: 'copy', mirror: 'none', get: (d) => d.faceFlags },
];
const STORED_NAMES: ReadonlySet<string> = new Set(STORED.map((spec) => spec.name));
/** Arrays that change only with topology (connectivity), whatever `dirty` lists. */
const TOPOLOGY_ARRAYS: ReadonlySet<string> = new Set(['$edgeVerts', '$cornerVert', '$cornerNext', '$faceCorner']);

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
  const view = new Uint8Array(array.buffer, array.byteOffset + start * bpe, (end - start) * bpe);
  const out = view.slice();
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

/** Chunk indices spanned by sorted dirty element indices. */
function dirtyChunks(indices: Uint32Array | 'all', chunkElems: number): ReadonlySet<number> | 'all' {
  if (indices === 'all') return 'all';
  const out = new Set<number>();
  for (const i of indices) out.add(Math.floor(i / chunkElems));
  return out;
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

/** Writes a revision; with `previous` and `dirty`, clean chunks keep their hashes and are not re-hashed. */
export function writeRevision(
  m: MeshData | EditMesh,
  opts?: { readonly previous?: RevisionManifest; readonly dirty?: DirtySet },
): RevisionOutput {
  const data = isEditMesh(m) ? m.snapshot() : m;
  const counts = data.counts;
  const previous = opts?.previous;
  const dirty = opts?.dirty;
  const incremental =
    previous !== undefined &&
    dirty !== undefined &&
    !dirty.topology &&
    previous.counts.points === counts.points &&
    previous.counts.edges === counts.edges &&
    previous.counts.faces === counts.faces &&
    previous.counts.corners === counts.corners;
  const previousLayers = new Map<string, ManifestLayer>((previous?.layers ?? []).map((layer) => [layer.name, layer]));
  const previousIds = new Set(previous === undefined ? [] : manifestChunkIds(previous));
  const newChunks = new Map<string, Uint8Array>();

  const entry = (
    name: string,
    def: Omit<LayerDef, 'name'>,
    array: LayerArray,
    layerDirty: (chunkElems: number) => ReadonlySet<number> | 'all',
  ): ManifestLayer => {
    const count = domainCount(counts, def.domain);
    const chunkElems = chunkElemsOf(def.type, def.comps);
    const total = Math.ceil(count / chunkElems);
    // Canonical tail: drop trailing all-default chunks.
    let stored = total;
    while (stored > 0) {
      const from = (stored - 1) * chunkElems;
      if (!isDefaultRange(array, def.comps, def.default, from, Math.min(count, from + chunkElems))) break;
      stored--;
    }
    const prior = incremental ? previousLayers.get(name) : undefined;
    const reusable =
      prior !== undefined &&
      prior.type === def.type &&
      prior.comps === def.comps &&
      prior.domain === def.domain &&
      prior.chunkElems === chunkElems;
    const changed = reusable ? layerDirty(chunkElems) : 'all';
    const chunks: string[] = [];
    for (let k = 0; k < stored; k++) {
      const reuse = reusable && changed !== 'all' && !changed.has(k) && k < prior.chunks.length;
      if (reuse) {
        chunks.push(prior.chunks[k] as string);
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
    const def = {
      domain: spec.domain,
      type: spec.type,
      comps: spec.comps,
      interp: spec.interp,
      mirror: spec.mirror,
      default: Array.from({ length: spec.comps }, () => 0),
    };
    layers.push(
      entry(spec.name, def, spec.get(data), (chunkElems) =>
        dirty === undefined || TOPOLOGY_ARRAYS.has(spec.name)
          ? new Set()
          : dirtyChunks(domainDirty(dirty, spec.domain), chunkElems),
      ),
    );
  }
  for (const [name, layer] of data.layers) {
    if (STORED_NAMES.has(name)) throw kernelError('invalid-layer', `writeRevision: '${name}' is a reserved name`);
    layers.push(
      entry(name, layer.def, layer.data, (chunkElems) =>
        dirty === undefined || !dirty.layers.includes(name)
          ? new Set()
          : dirtyChunks(domainDirty(dirty, layer.def.domain), chunkElems),
      ),
    );
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

function boundsOf(position: Float32Array, points: number): RevisionManifest['bounds'] {
  if (points === 0) return null;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let v = 0; v < points; v++) {
    for (let k = 0; k < 3; k++) {
      const x = position[3 * v + k] as number;
      if (x < (min[k] as number)) min[k] = x;
      if (x > (max[k] as number)) max[k] = x;
    }
  }
  return [
    [min[0] as number, min[1] as number, min[2] as number],
    [max[0] as number, max[1] as number, max[2] as number],
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
    if (typeof name !== 'string' || name.length === 0 || names.has(name))
      return fail('layer names must be unique strings');
    names.add(name);
    if (!isDomain(layer['domain']) || !isLayerType(layer['type'])) return fail(`layer ${name}: unknown domain or type`);
    const comps = layer['comps'];
    if (comps !== 1 && comps !== 2 && comps !== 3 && comps !== 4) return fail(`layer ${name}: comps must be 1…4`);
    if (typeof layer['interp'] !== 'string' || typeof layer['mirror'] !== 'string') {
      return fail(`layer ${name}: interp and mirror must be strings`);
    }
    const defaults = layer['default'];
    if (!Array.isArray(defaults) || defaults.length !== comps || !defaults.every((x) => typeof x === 'number')) {
      return fail(`layer ${name}: default must hold ${comps} numbers`);
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
    if (layer.default.some((x) => x !== 0)) {
      for (let i = 0; i < count; i++) for (let k = 0; k < comps; k++) array[i * comps + k] = layer.default[k] as number;
    }
    const bpe = BYTES_PER[layer.type];
    layer.chunks.forEach((id, k) => {
      const from = k * layer.chunkElems;
      const elems = Math.min(layer.chunkElems, count - from);
      const bytes = chunk(id);
      if (bytes.length !== elems * comps * bpe) {
        throw kernelError(
          'mesh-chunk-size',
          `Chunk ${id} of ${layer.name} has ${bytes.length} bytes, expected ${elems * comps * bpe}`,
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
  const stored = <T extends LayerArray>(name: string): T => arrays.get(name) as T;
  return {
    counts: { ...manifest.counts },
    position: stored<Float32Array>('$position'),
    edgeVerts: stored<Uint32Array>('$edgeVerts'),
    edgeFlags: stored<Uint8Array>('$edgeFlags'),
    cornerVert: stored<Uint32Array>('$cornerVert'),
    cornerNext: stored<Uint32Array>('$cornerNext'),
    faceCorner: stored<Uint32Array>('$faceCorner'),
    faceMaterial: stored<Uint16Array>('$faceMaterial'),
    faceFlags: stored<Uint8Array>('$faceFlags'),
    layers,
  };
}
