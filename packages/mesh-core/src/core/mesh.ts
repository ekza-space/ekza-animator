// The kernel's `EditMesh` (M6A-SPEC §4.3, research 13 K-1, ADR 0014): a BMesh-style radial-edge structure of arrays.
//
// - **Stored arrays** (`position`, `edgeVerts`, `edgeFlags`, `cornerVert`, `cornerNext`, `faceCorner`,
//   `faceMaterial`, `faceFlags`) and **edit links** (`vertEdge`, edge disk links, `edgeCorner`, `cornerPrev`,
//   `cornerEdge`, `cornerFace`, `cornerRadialNext`) are typed arrays with capacity growth (amortized doubling);
//   float values are stored through `Math.fround`.
// - **Canonical links**: every disk cycle lists a vertex's edges in ascending edge index (`vertEdge` = the smallest)
//   and every radial cycle an edge's corners in ascending corner index (`edgeCorner` = the smallest), so the edit
//   links are a pure function of the stored arrays: an edited mesh and `editMeshFrom(snapshot())` traverse
//   identically, and an op's result never depends on the mesh's history (P6).
// - **Every write goes through the write log** (../log/log.ts), edit links included, so `apply(delta, 'backward')`
//   restores stored and edit arrays bit-identically without rebuilding anything.
// - **Identity = dense indices.** Creation appends. Removal keeps the transaction's elements partitioned as
//   [surviving pre-op elements][created elements]: removing a pre-op element moves the last surviving pre-op element
//   into the hole and then the last created element into the freed slot; removing a created element moves the last
//   element into the hole. Every element a removal moves comes from an index ≥ the removed one, so removals in
//   descending index order never invalidate the indices still to be removed. `MeshDelta.remap` is therefore exact:
//   `forward` maps every pre-op index, and the created elements are exactly [createdFrom, count).
// - **Dead slots are canonical.** Every slot in [count, capacity) holds its target's dead value (0 in the stored
//   arrays, −1 in the edit links, a layer's default): construction and growth fill them, a removal writes them
//   (logged) into the slot it vacates, and `apply` restores them. The arrays are therefore a pure function of the live
//   state, and a delta replays exactly on any mesh in the same state, not only on the object that recorded it.
//
// Topology changes only through the Euler operators of ../euler/operators.ts; this module owns storage, traversal,
// logged writes, element moves, transactions and `apply`.
import { EkzaError } from '@ekza-studio/anim-core';
import { isKernelDebug } from './debug';
import { kernelError } from '../kernel';
import {
  allocLayer,
  BYTES_PER,
  checkLayerDef,
  domainIndex,
  fillDefault,
  grownCapacity,
  grownCopy,
  type KernelArray,
  type LayerArray,
  storedValue,
} from '../layers/arrays';
import {
  BUILTIN_TARGETS,
  isKernelWrites,
  type KernelWrites,
  type LayerEvent,
  OpenSegment,
  type SegmentRecord,
  segmentBytes,
  T_CE,
  T_CF,
  T_CN,
  T_COUNTS,
  T_CP,
  T_CR,
  T_CV,
  T_DN,
  T_EC,
  T_EF,
  T_EV,
  T_FC,
  T_FF,
  T_FM,
  T_POS,
  T_VE,
  TARGET_DOMAIN,
  TARGET_STORED,
  TARGET_STRIDE,
  TARGET_TOPOLOGY,
  TARGET_DEAD,
  type TargetAccess,
} from '../log/log';
import type {
  AttrLayer,
  DirtySet,
  Domain,
  DomainRemap,
  EditMesh,
  ElementRemap,
  LayerDef,
  MeshCounts,
  MeshData,
  MeshDelta,
} from '../types';
import { validateMesh } from '../validate/validate';
import * as euler from '../euler/operators';

const D_POINT = 0;
const D_EDGE = 1;
const D_FACE = 2;
const D_CORNER = 3;
const DOMAIN_NAMES: readonly Domain[] = ['point', 'edge', 'face', 'corner'];
/** The built-in targets (stored arrays and edit links) of each domain. */
const DOMAIN_TARGETS: readonly (readonly number[])[] = [0, 1, 2, 3].map((domain) => {
  const out: number[] = [];
  for (let tid = 1; tid < BUILTIN_TARGETS; tid++) if (TARGET_DOMAIN[tid] === domain) out.push(tid);
  return out;
});

/** One attribute layer's storage (capacity × comps values). */
export class LayerStore {
  view: LayerArray | null = null;
  viewCount = -1;
  attached = true;
  readonly handle: KernelLayer;

  constructor(
    mesh: KernelMesh,
    readonly def: LayerDef,
    readonly tid: number,
    public data: LayerArray,
  ) {
    this.handle = new KernelLayer(mesh, this);
  }

  get domain(): number {
    return domainIndex(this.def.domain);
  }
}

class KernelLayer implements AttrLayer {
  constructor(
    private readonly mesh: KernelMesh,
    private readonly store: LayerStore,
  ) {}

  get def(): LayerDef {
    return this.store.def;
  }

  get data(): Readonly<LayerArray> {
    return this.mesh.layerView(this.store);
  }

  get(index: number, comp = 0): number {
    const s = this.store;
    if (index < 0 || index >= this.mesh.count(s.domain) || comp < 0 || comp >= s.def.comps) return Number.NaN;
    return s.data[index * s.def.comps + comp] as number;
  }

  set(index: number, comp: number, value: number): void {
    this.mesh.writeLayer(this.store, index, comp, value);
  }

  read(index: number, out: Float64Array, offset = 0): void {
    const s = this.store;
    const comps = s.def.comps;
    for (let k = 0; k < comps; k++) out[offset + k] = s.data[index * comps + k] as number;
  }
}

/** Transaction state: the open segment, closed segments, the survivor boundary and the remap per domain. */
class Tx {
  readonly segments: SegmentRecord[] = [];
  /** Surviving pre-op elements per domain occupy [0, boundary). */
  readonly boundary: Int32Array;
  readonly peak: Int32Array;
  /** Pre-op index → current index (−1 removed), allocated on the domain's first removal of a pre-op element. */
  readonly fwd: (Int32Array | null)[] = [null, null, null, null];
  /** Current index (< boundary) → pre-op index. */
  readonly org: (Int32Array | null)[] = [null, null, null, null];
  readonly layerNames = new Set<string>();
  readonly layerDomains = new Set<number>();

  constructor(
    readonly opId: string,
    readonly countsBefore: MeshCounts,
    counts: Int32Array,
    public open: OpenSegment,
  ) {
    this.boundary = counts.slice();
    this.peak = counts.slice();
  }
}

const EMPTY_U32 = new Uint32Array(0);

export class KernelMesh implements EditMesh {
  /** [P, E, F, C] (a logged target). */
  readonly cnt = new Int32Array(4);
  readonly cap = new Int32Array(4);
  // stored arrays
  pos: Float32Array;
  ev: Uint32Array;
  ef: Uint8Array;
  cv: Uint32Array;
  cn: Uint32Array;
  fc: Uint32Array;
  fm: Uint16Array;
  ff: Uint8Array;
  // edit links
  ve: Int32Array;
  dn: Int32Array;
  ec: Int32Array;
  cp: Int32Array;
  ce: Int32Array;
  cf: Int32Array;
  cr: Int32Array;
  // layers
  readonly layerList: LayerStore[] = [];
  private readonly byName = new Map<string, LayerStore>();
  private readonly byTid = new Map<number, LayerStore>();
  private nextTid = BUILTIN_TARGETS;
  private handles: readonly AttrLayer[] | null = null;
  private readonly domainLayers: (LayerStore[] | null)[] = [null, null, null, null];
  private readonly domainHandles: (readonly AttrLayer[] | null)[] = [null, null, null, null];
  // views and caches
  private posView: Float32Array | null = null;
  private countsView: MeshCounts | null = null;
  // transaction
  tx: Tx | null = null;
  private readonly access: TargetAccess;
  /** Scratch list for cycle walks. */
  private scratch: number[] = [];

  constructor(caps: readonly [number, number, number, number]) {
    const [P, E, F, C] = caps.map((n) => Math.max(n, 1)) as [number, number, number, number];
    this.cap.set([P, E, F, C]);
    this.pos = new Float32Array(3 * P);
    this.ev = new Uint32Array(2 * E);
    this.ef = new Uint8Array(E);
    this.cv = new Uint32Array(C);
    this.cn = new Uint32Array(C);
    this.fc = new Uint32Array(F);
    this.fm = new Uint16Array(F);
    this.ff = new Uint8Array(F);
    this.ve = new Int32Array(P).fill(-1);
    this.dn = new Int32Array(2 * E).fill(-1);
    this.ec = new Int32Array(E).fill(-1);
    this.cp = new Int32Array(C).fill(-1);
    this.ce = new Int32Array(C).fill(-1);
    this.cf = new Int32Array(C).fill(-1);
    this.cr = new Int32Array(C).fill(-1);
    this.access = {
      array: (tid) => this.arrayOfTid(tid),
      lengthAt: (tid, counts) => this.lengthAt(tid, counts),
      counts: () => this.cnt,
      key: (tid) => (tid < BUILTIN_TARGETS ? tid : (this.byTid.get(tid) as LayerStore).def.name),
    };
  }

  // ---------- counts, views ----------

  get counts(): MeshCounts {
    const c = this.cnt;
    const view = this.countsView;
    if (view !== null && view.points === c[0] && view.edges === c[1] && view.faces === c[2] && view.corners === c[3]) {
      return view;
    }
    const next = Object.freeze({
      points: c[0] as number,
      edges: c[1] as number,
      faces: c[2] as number,
      corners: c[3] as number,
    });
    this.countsView = next;
    return next;
  }

  /** Live positions (exactly 3P values; the view is replaced when the count or the capacity changes). */
  get position(): Readonly<Float32Array> {
    const n = 3 * (this.cnt[0] as number);
    const view = this.posView;
    if (view !== null && view.length === n && view.buffer === this.pos.buffer) return view;
    const next = this.pos.subarray(0, n);
    this.posView = next;
    return next;
  }

  count(domain: number): number {
    return this.cnt[domain] as number;
  }

  /** A layer's live values (count × comps). */
  layerView(store: LayerStore): LayerArray {
    const n = this.count(store.domain) * store.def.comps;
    const view = store.view;
    if (view !== null && view.length === n && view.buffer === store.data.buffer) return view;
    const next = store.data.subarray(0, n);
    store.view = next;
    return next;
  }

  // ---------- traversal (allocation-free; −1 = none) ----------

  cornerVert(c: number): number {
    return c >= 0 && c < (this.cnt[3] as number) ? (this.cv[c] as number) : -1;
  }
  cornerNext(c: number): number {
    return c >= 0 && c < (this.cnt[3] as number) ? (this.cn[c] as number) : -1;
  }
  cornerPrev(c: number): number {
    return c >= 0 && c < (this.cnt[3] as number) ? (this.cp[c] as number) : -1;
  }
  cornerEdge(c: number): number {
    return c >= 0 && c < (this.cnt[3] as number) ? (this.ce[c] as number) : -1;
  }
  cornerFace(c: number): number {
    return c >= 0 && c < (this.cnt[3] as number) ? (this.cf[c] as number) : -1;
  }
  cornerRadialNext(c: number): number {
    return c >= 0 && c < (this.cnt[3] as number) ? (this.cr[c] as number) : -1;
  }
  edgeVert(e: number, end: 0 | 1): number {
    return e >= 0 && e < (this.cnt[1] as number) ? (this.ev[2 * e + end] as number) : -1;
  }
  edgeCorner(e: number): number {
    return e >= 0 && e < (this.cnt[1] as number) ? (this.ec[e] as number) : -1;
  }
  edgeDiskNext(e: number, v: number): number {
    if (e < 0 || e >= (this.cnt[1] as number)) return -1;
    if ((this.ev[2 * e] as number) === v) return this.dn[2 * e] as number;
    if ((this.ev[2 * e + 1] as number) === v) return this.dn[2 * e + 1] as number;
    return -1;
  }
  edgeOther(e: number, v: number): number {
    if (e < 0 || e >= (this.cnt[1] as number)) return -1;
    const a = this.ev[2 * e] as number;
    const b = this.ev[2 * e + 1] as number;
    return a === v ? b : b === v ? a : -1;
  }
  findEdge(a: number, b: number): number {
    if (a < 0 || a >= (this.cnt[0] as number) || b < 0 || b >= (this.cnt[0] as number) || a === b) return -1;
    const start = this.ve[a] as number;
    if (start === -1) return -1;
    let e = start;
    let guard = 0;
    do {
      const x = this.ev[2 * e] as number;
      const end = x === a ? 0 : 1;
      if ((end === 0 ? (this.ev[2 * e + 1] as number) : x) === b) return e;
      e = this.dn[2 * e + end] as number;
    } while (e !== start && ++guard <= (this.cnt[1] as number));
    return -1;
  }
  vertEdge(v: number): number {
    return v >= 0 && v < (this.cnt[0] as number) ? (this.ve[v] as number) : -1;
  }
  faceCorner(f: number): number {
    return f >= 0 && f < (this.cnt[2] as number) ? (this.fc[f] as number) : -1;
  }
  faceLen(f: number): number {
    if (f < 0 || f >= (this.cnt[2] as number)) return 0;
    const start = this.fc[f] as number;
    let n = 0;
    let c = start;
    const max = this.cnt[3] as number;
    do {
      n++;
      c = this.cn[c] as number;
    } while (c !== start && n <= max);
    return n;
  }
  edgeFaceCount(e: number): number {
    if (e < 0 || e >= (this.cnt[1] as number)) return 0;
    const start = this.ec[e] as number;
    if (start === -1) return 0;
    let n = 0;
    let c = start;
    const max = this.cnt[3] as number;
    do {
      n++;
      c = this.cr[c] as number;
    } while (c !== start && n <= max);
    return n;
  }
  vertValence(v: number): number {
    if (v < 0 || v >= (this.cnt[0] as number)) return 0;
    const start = this.ve[v] as number;
    if (start === -1) return 0;
    let n = 0;
    let e = start;
    const max = this.cnt[1] as number;
    do {
      n++;
      e = this.dn[2 * e + ((this.ev[2 * e] as number) === v ? 0 : 1)] as number;
    } while (e !== start && n <= max);
    return n;
  }
  /**
   * True when the faces around `v` form one fan (a disc or a half-disc): no incident edge has more than two faces, no
   * wire edge touches a face fan, and walking across two-face edges from one corner at `v` reaches every corner at
   * `v`. A vertex without faces is manifold (loose geometry is Mesh Check's, not this test's).
   */
  isManifoldVert(v: number): boolean {
    if (v < 0 || v >= (this.cnt[0] as number)) return true;
    const start = this.ve[v] as number;
    if (start === -1) return true;
    let corners = 0;
    let first = -1;
    let wire = false;
    let e = start;
    let guard = 0;
    do {
      const faces = this.edgeFaceCount(e);
      if (faces > 2) return false;
      if (faces === 0) wire = true;
      const radial = this.ec[e] as number;
      if (radial !== -1) {
        let c = radial;
        do {
          if ((this.cv[c] as number) === v) {
            corners++;
            if (first === -1) first = c;
          }
          c = this.cr[c] as number;
        } while (c !== radial);
      }
      e = this.dn[2 * e + ((this.ev[2 * e] as number) === v ? 0 : 1)] as number;
    } while (e !== start && ++guard <= (this.cnt[1] as number));
    if (corners === 0) return true;
    if (wire) return false;
    return this.fanSize(first, v) === corners;
  }

  /** Corners at `v` reachable from corner `c` across two-face edges (both directions). */
  private fanSize(c: number, v: number): number {
    let visited = 1;
    for (const direction of [0, 1] as const) {
      let corner = c;
      let came = direction === 0 ? (this.ce[c] as number) : (this.ce[this.cp[c] as number] as number);
      let guard = 0;
      for (;;) {
        const inEdge = this.ce[this.cp[corner] as number] as number;
        const outEdge = this.ce[corner] as number;
        const next = came === inEdge ? outEdge : inEdge;
        if (this.edgeFaceCount(next) !== 2) break;
        const owner = next === outEdge ? corner : (this.cp[corner] as number);
        const q = this.cr[owner] as number;
        const at = (this.cv[q] as number) === v ? q : (this.cn[q] as number);
        if (at === c) return visited;
        visited++;
        corner = at;
        came = next;
        if (++guard > (this.cnt[3] as number)) break;
      }
    }
    return visited;
  }

  edgeFlags(e: number): number {
    return e >= 0 && e < (this.cnt[1] as number) ? (this.ef[e] as number) : 0;
  }
  faceFlags(f: number): number {
    return f >= 0 && f < (this.cnt[2] as number) ? (this.ff[f] as number) : 0;
  }
  faceMaterial(f: number): number {
    return f >= 0 && f < (this.cnt[2] as number) ? (this.fm[f] as number) : 0;
  }

  // ---------- Euler operators (logged; the only topology API) ----------

  makeVert(x: number, y: number, z: number): number {
    return euler.makeVert(this, x, y, z);
  }
  killVert(v: number): void {
    euler.killVert(this, v);
  }
  makeEdge(a: number, b: number): number {
    return euler.makeEdge(this, a, b);
  }
  killEdge(e: number): void {
    euler.killEdge(this, e);
  }
  makeFace(verts: ArrayLike<number>, opts?: { readonly material?: number; readonly example?: number }): number {
    return euler.makeFace(this, verts, opts);
  }
  killFace(f: number): void {
    euler.killFace(this, f);
  }
  splitEdgeMakeVert(e: number, t: number): number {
    return euler.splitEdgeMakeVert(this, e, t);
  }
  joinEdgeKillVert(v: number): number {
    return euler.joinEdgeKillVert(this, v);
  }
  splitFaceMakeEdge(f: number, cA: number, cB: number): number {
    return euler.splitFaceMakeEdge(this, f, cA, cB);
  }
  joinFaceKillEdge(e: number): number {
    return euler.joinFaceKillEdge(this, e);
  }
  reverseFace(f: number): void {
    euler.reverseFace(this, f);
  }

  // ---------- value writes (logged) ----------

  setPosition(v: number, x: number, y: number, z: number): void {
    this.checkIndex(v, D_POINT, 'vertex');
    this.requireTx('setPosition');
    const p = this.pos;
    this.w(T_POS, p, 3 * v, Math.fround(x));
    this.w(T_POS, p, 3 * v + 1, Math.fround(y));
    this.w(T_POS, p, 3 * v + 2, Math.fround(z));
  }
  setEdgeFlags(e: number, flags: number): void {
    this.checkIndex(e, D_EDGE, 'edge');
    this.requireTx('setEdgeFlags');
    this.w(T_EF, this.ef, e, flags & 0xff);
  }
  setFaceFlags(f: number, flags: number): void {
    this.checkIndex(f, D_FACE, 'face');
    this.requireTx('setFaceFlags');
    this.w(T_FF, this.ff, f, flags & 0xff);
  }
  setFaceMaterial(f: number, slot: number): void {
    this.checkIndex(f, D_FACE, 'face');
    this.requireTx('setFaceMaterial');
    this.w(T_FM, this.fm, f, slot & 0xffff);
  }

  layer(name: string): AttrLayer | undefined {
    return this.byName.get(name)?.handle;
  }

  /** The layer stores of a domain, in layer order (propagation helpers and the Euler operators). */
  layersOf(domain: number): readonly LayerStore[] {
    let list = this.domainLayers[domain];
    if (list === null || list === undefined) {
      list = this.layerList.filter((store) => store.domain === domain);
      this.domainLayers[domain] = list;
    }
    return list;
  }

  /** The layer handles of a domain, in layer order (cached until the layer set changes). */
  handlesOf(domain: number): readonly AttrLayer[] {
    let list = this.domainHandles[domain];
    if (list === null || list === undefined) {
      list = Object.freeze(this.layersOf(domain).map((store) => store.handle));
      this.domainHandles[domain] = list;
    }
    return list;
  }

  storeOf(name: string): LayerStore | undefined {
    return this.byName.get(name);
  }

  addLayer(def: LayerDef): AttrLayer {
    const existing = this.byName.get(def?.name);
    if (existing !== undefined) return existing.handle;
    checkLayerDef(def);
    const tx = this.requireTx('addLayer');
    const frozen: LayerDef = Object.freeze({ ...def, default: Object.freeze([...def.default]) });
    const at = this.layerList.length;
    const event: LayerEvent = { kind: 'add', def: frozen, at };
    this.openSegment(tx, event);
    const store = this.attachLayer(frozen, at, null);
    tx.layerNames.add(frozen.name);
    tx.layerDomains.add(store.domain);
    return store.handle;
  }

  removeLayer(name: string): void {
    const store = this.byName.get(name);
    if (store === undefined) return;
    const tx = this.requireTx('removeLayer');
    const at = this.layerList.indexOf(store);
    const data = this.layerView(store).slice() as LayerArray;
    this.openSegment(tx, { kind: 'remove', def: store.def, at, data });
    this.detachLayer(store);
    tx.layerNames.add(name);
    tx.layerDomains.add(store.domain);
  }

  layers(): readonly AttrLayer[] {
    if (this.handles === null) this.handles = Object.freeze(this.layerList.map((store) => store.handle));
    return this.handles;
  }

  /** `AttrLayer.set` (logged). */
  writeLayer(store: LayerStore, index: number, comp: number, value: number): void {
    if (!store.attached || this.byName.get(store.def.name) !== store) {
      throw kernelError('invalid-layer', `layer ${store.def.name} was removed`);
    }
    this.checkIndex(index, store.domain, store.def.domain);
    if (!Number.isInteger(comp) || comp < 0 || comp >= store.def.comps) {
      throw kernelError('out-of-range', `layer ${store.def.name}: component ${comp} of ${store.def.comps}`);
    }
    this.requireTx('a layer write');
    this.w(store.tid, store.data, index * store.def.comps + comp, storedValue(store.def.type, value));
  }

  /** A new layer store with default values (or `data`, a live prefix) inserted at `at` in the layer order. */
  attachLayer(def: LayerDef, at: number, data: LayerArray | null): LayerStore {
    const domain = domainIndex(def.domain);
    const capacity = (this.cap[domain] as number) * def.comps;
    const array = allocLayer(def.type, capacity);
    if (data === null) fillDefault(array, def, 0, this.cap[domain] as number);
    else {
      // The rest of the capacity is dead: the layer's default (see the header).
      array.set(data.subarray(0, Math.min(data.length, capacity)));
      fillDefault(array, def, Math.min(data.length, capacity) / def.comps, this.cap[domain] as number);
    }
    const store = new LayerStore(this, def, this.nextTid++, array);
    this.layerList.splice(Math.min(at, this.layerList.length), 0, store);
    this.byName.set(def.name, store);
    this.byTid.set(store.tid, store);
    this.layersChanged();
    return store;
  }

  private detachLayer(store: LayerStore): void {
    store.attached = false;
    const at = this.layerList.indexOf(store);
    if (at !== -1) this.layerList.splice(at, 1);
    this.byName.delete(store.def.name);
    this.byTid.delete(store.tid);
    this.layersChanged();
  }

  private layersChanged(): void {
    this.handles = null;
    this.domainLayers.fill(null);
    this.domainHandles.fill(null);
  }

  // ---------- logged writes ----------

  /** Writes `value` into slot `i` of target `tid` (array `arr`), logging the old value once per segment. */
  w(tid: number, arr: KernelArray, i: number, value: number): void {
    const old = arr[i] as number;
    if (old === value && (value !== 0 || 1 / old === 1 / value)) return;
    (this.tx as Tx).open.record(tid, i, old, arr);
    arr[i] = value;
  }

  requireTx(what: string): Tx {
    const tx = this.tx;
    if (tx === null) throw kernelError('mesh-no-transaction', `${what} outside begin()/end()`);
    return tx;
  }

  checkIndex(i: number, domain: number, what: string): void {
    const count = this.cnt[domain] as number;
    if (!Number.isInteger(i) || i < 0 || i >= count) {
      throw kernelError('out-of-range', `${what} ${i} is outside 0…${count - 1}`);
    }
  }

  private arrayOfTid(tid: number): KernelArray {
    switch (tid) {
      case T_COUNTS:
        return this.cnt;
      case T_POS:
        return this.pos;
      case T_EV:
        return this.ev;
      case T_EF:
        return this.ef;
      case T_CV:
        return this.cv;
      case T_CN:
        return this.cn;
      case T_FC:
        return this.fc;
      case T_FM:
        return this.fm;
      case T_FF:
        return this.ff;
      case T_VE:
        return this.ve;
      case T_DN:
        return this.dn;
      case T_EC:
        return this.ec;
      case T_CP:
        return this.cp;
      case T_CE:
        return this.ce;
      case T_CF:
        return this.cf;
      case T_CR:
        return this.cr;
      default: {
        const store = this.byTid.get(tid);
        if (store === undefined) throw kernelError('invalid-delta', `unknown write target ${tid}`);
        return store.data;
      }
    }
  }

  private lengthAt(tid: number, counts: Int32Array): number {
    if (tid === T_COUNTS) return 4;
    if (tid < BUILTIN_TARGETS) return (counts[TARGET_DOMAIN[tid] as number] as number) * (TARGET_STRIDE[tid] as number);
    const store = this.byTid.get(tid) as LayerStore;
    return (counts[store.domain] as number) * store.def.comps;
  }

  /** The array of a delta key (built-in id or layer name) for `apply`. */
  private arrayOfKey(key: number | string): KernelArray {
    if (typeof key === 'number') return this.arrayOfTid(key);
    const store = this.byName.get(key);
    if (store === undefined) throw kernelError('invalid-delta', `apply(): layer ${key} does not exist`);
    return store.data;
  }

  // ---------- capacity ----------

  ensureCapacity(domain: number, needed: number): void {
    const current = this.cap[domain] as number;
    if (needed <= current) return;
    const next = grownCapacity(current, needed);
    this.cap[domain] = next;
    switch (domain) {
      case D_POINT:
        this.pos = grownCopy(this.pos, 3 * next, 3 * current);
        this.ve = grownCopy(this.ve, next, current);
        this.ve.fill(-1, current);
        break;
      case D_EDGE:
        this.ev = grownCopy(this.ev, 2 * next, 2 * current);
        this.ef = grownCopy(this.ef, next, current);
        this.dn = grownCopy(this.dn, 2 * next, 2 * current);
        this.dn.fill(-1, 2 * current);
        this.ec = grownCopy(this.ec, next, current);
        this.ec.fill(-1, current);
        break;
      case D_FACE:
        this.fc = grownCopy(this.fc, next, current);
        this.fm = grownCopy(this.fm, next, current);
        this.ff = grownCopy(this.ff, next, current);
        break;
      case D_CORNER:
        this.cv = grownCopy(this.cv, next, current);
        this.cn = grownCopy(this.cn, next, current);
        this.cp = grownCopy(this.cp, next, current);
        this.ce = grownCopy(this.ce, next, current);
        this.cf = grownCopy(this.cf, next, current);
        this.cr = grownCopy(this.cr, next, current);
        this.cp.fill(-1, current);
        this.ce.fill(-1, current);
        this.cf.fill(-1, current);
        this.cr.fill(-1, current);
        break;
    }
    for (const store of this.layersOf(domain)) {
      const comps = store.def.comps;
      store.data = grownCopy(store.data, next * comps, current * comps);
      fillDefault(store.data, store.def, current, next);
    }
  }

  // ---------- element slots ----------

  /** Appends an element slot to `domain` (logged count), growing the capacity; the caller initializes it. */
  newSlot(domain: number): number {
    const tx = this.requireTx('an Euler operator');
    const n = this.cnt[domain] as number;
    this.ensureCapacity(domain, n + 1);
    this.w(T_COUNTS, this.cnt, domain, n + 1);
    if (n + 1 > (tx.peak[domain] as number)) tx.peak[domain] = n + 1;
    return n;
  }

  /**
   * Removes the (already unlinked) element `k` of `domain`, keeping [survivors][created] (see the header): a pre-op
   * element's hole takes the last survivor, whose slot takes the last created element; a created element's hole
   * takes the last element.
   */
  removeSlot(domain: number, k: number): void {
    const tx = this.requireTx('an Euler operator');
    const n = this.cnt[domain] as number;
    const b = tx.boundary[domain] as number;
    if (k >= b) {
      if (k !== n - 1) this.move(domain, n - 1, k);
    } else {
      let fwd = tx.fwd[domain] as Int32Array | null;
      let org = tx.org[domain] as Int32Array | null;
      if (fwd === null || org === null) {
        const before = domainCountOf(tx.countsBefore, domain);
        fwd = new Int32Array(before);
        org = new Int32Array(before);
        for (let i = 0; i < before; i++) {
          fwd[i] = i;
          org[i] = i;
        }
        tx.fwd[domain] = fwd;
        tx.org[domain] = org;
      }
      fwd[org[k] as number] = -1;
      const lastOld = b - 1;
      if (k !== lastOld) {
        this.move(domain, lastOld, k);
        const origin = org[lastOld] as number;
        org[k] = origin;
        fwd[origin] = k;
      }
      tx.boundary[domain] = lastOld;
      if (n - 1 > lastOld) this.move(domain, n - 1, lastOld);
    }
    this.vacate(domain, n - 1);
    this.w(T_COUNTS, this.cnt, domain, n - 1);
  }

  /**
   * Writes the dead values into slot `i` of every target of `domain` (stored arrays, edit links, layers) through the
   * log, so the slot's live content is in the delta and the slot is dead-canonical once the count drops past it.
   */
  private vacate(domain: number, i: number): void {
    for (const tid of DOMAIN_TARGETS[domain] as readonly number[]) {
      const stride = TARGET_STRIDE[tid] as number;
      const array = this.arrayOfTid(tid);
      const dead = TARGET_DEAD[tid] as number;
      for (let k = 0; k < stride; k++) this.w(tid, array, i * stride + k, dead);
    }
    for (const store of this.layersOf(domain)) {
      const def = store.def;
      const comps = def.comps;
      for (let k = 0; k < comps; k++) {
        this.w(store.tid, store.data, i * comps + k, storedValue(def.type, def.default[k] ?? 0));
      }
    }
  }

  /** Writes the dead values into values [from, to) of a delta key's array (no logging: `apply` only). */
  private fillDead(key: number | string, from: number, to: number): void {
    if (to <= from) return;
    if (typeof key === 'number') {
      this.arrayOfTid(key).fill(TARGET_DEAD[key] as number, from, to);
      return;
    }
    const store = this.byName.get(key);
    if (store === undefined) throw kernelError('invalid-delta', `apply(): layer ${key} does not exist`);
    fillDefault(store.data, store.def, from / store.def.comps, to / store.def.comps);
  }

  private move(domain: number, j: number, i: number): void {
    switch (domain) {
      case D_POINT:
        this.moveVert(j, i);
        break;
      case D_EDGE:
        this.moveEdge(j, i);
        break;
      case D_FACE:
        this.moveFace(j, i);
        break;
      case D_CORNER:
        this.moveCorner(j, i);
        break;
    }
  }

  private copyLayers(domain: number, j: number, i: number): void {
    for (const store of this.layersOf(domain)) {
      const comps = store.def.comps;
      const data = store.data;
      for (let k = 0; k < comps; k++) this.w(store.tid, data, i * comps + k, data[j * comps + k] as number);
    }
  }

  private moveVert(j: number, i: number): void {
    const p = this.pos;
    this.w(T_POS, p, 3 * i, p[3 * j] as number);
    this.w(T_POS, p, 3 * i + 1, p[3 * j + 1] as number);
    this.w(T_POS, p, 3 * i + 2, p[3 * j + 2] as number);
    this.w(T_VE, this.ve, i, this.ve[j] as number);
    this.copyLayers(D_POINT, j, i);
    const edges = this.diskList(j, this.scratch);
    const count = edges.length;
    const list = edges.slice(0, count);
    // Corners at j: each has an out-edge incident to j.
    for (const e of list) {
      const start = this.ec[e] as number;
      if (start === -1) continue;
      let c = start;
      do {
        if ((this.cv[c] as number) === j) this.w(T_CV, this.cv, c, i);
        c = this.cr[c] as number;
      } while (c !== start);
    }
    for (const e of list) {
      if ((this.ev[2 * e] as number) === j) this.w(T_EV, this.ev, 2 * e, i);
      else this.w(T_EV, this.ev, 2 * e + 1, i);
    }
  }

  private moveEdge(j: number, i: number): void {
    const a = this.ev[2 * j] as number;
    const b = this.ev[2 * j + 1] as number;
    this.w(T_EV, this.ev, 2 * i, a);
    this.w(T_EV, this.ev, 2 * i + 1, b);
    this.w(T_EF, this.ef, i, this.ef[j] as number);
    this.w(T_EC, this.ec, i, this.ec[j] as number);
    this.copyLayers(D_EDGE, j, i);
    for (const v of [a, b]) {
      this.diskRemove(v, j);
      this.diskInsert(v, i);
    }
    const start = this.ec[j] as number;
    if (start !== -1) {
      let c = start;
      do {
        this.w(T_CE, this.ce, c, i);
        c = this.cr[c] as number;
      } while (c !== start);
    }
  }

  private moveCorner(j: number, i: number): void {
    const prev = this.cp[j] as number;
    const next = this.cn[j] as number;
    const f = this.cf[j] as number;
    const e = this.ce[j] as number;
    this.w(T_CV, this.cv, i, this.cv[j] as number);
    this.w(T_CN, this.cn, i, next);
    this.w(T_CP, this.cp, i, prev);
    this.w(T_CE, this.ce, i, e);
    this.w(T_CF, this.cf, i, f);
    this.copyLayers(D_CORNER, j, i);
    this.w(T_CN, this.cn, prev, i);
    this.w(T_CP, this.cp, next, i);
    if ((this.fc[f] as number) === j) this.w(T_FC, this.fc, f, i);
    if (e !== -1) {
      this.radialRemove(e, j);
      this.radialInsert(e, i);
    }
  }

  private moveFace(j: number, i: number): void {
    const start = this.fc[j] as number;
    this.w(T_FC, this.fc, i, start);
    this.w(T_FM, this.fm, i, this.fm[j] as number);
    this.w(T_FF, this.ff, i, this.ff[j] as number);
    this.copyLayers(D_FACE, j, i);
    let c = start;
    let guard = 0;
    do {
      this.w(T_CF, this.cf, c, i);
      c = this.cn[c] as number;
    } while (c !== start && ++guard <= (this.cnt[3] as number));
  }

  // ---------- canonical cycles ----------

  /** The disk cycle of `v` (ascending edge indices) into `out`. */
  diskList(v: number, out: number[]): number[] {
    out.length = 0;
    const start = this.ve[v] as number;
    if (start === -1) return out;
    let e = start;
    let guard = 0;
    do {
      out.push(e);
      e = this.dn[2 * e + ((this.ev[2 * e] as number) === v ? 0 : 1)] as number;
    } while (e !== start && ++guard <= (this.cnt[1] as number));
    return out;
  }

  private diskSlot(e: number, v: number): number {
    return 2 * e + ((this.ev[2 * e] as number) === v ? 0 : 1);
  }

  /** Inserts edge `e` (whose endpoints already include `v`) into `v`'s disk cycle at its sorted position. */
  diskInsert(v: number, e: number): void {
    const start = this.ve[v] as number;
    const slot = this.diskSlot(e, v);
    if (start === -1) {
      this.w(T_DN, this.dn, slot, e);
      this.w(T_VE, this.ve, v, e);
      return;
    }
    // The predecessor: the largest edge < e, or the largest edge overall when e is the smallest.
    let p = start;
    let guard = 0;
    for (;;) {
      const next = this.dn[this.diskSlot(p, v)] as number;
      if (next === start || next > e) break;
      p = next;
      if (++guard > (this.cnt[1] as number)) break;
    }
    if (e < start) {
      // e becomes the smallest: its predecessor is the largest (the walk above stops at the last before start).
      p = start;
      guard = 0;
      while ((this.dn[this.diskSlot(p, v)] as number) !== start && ++guard <= (this.cnt[1] as number)) {
        p = this.dn[this.diskSlot(p, v)] as number;
      }
    }
    const pSlot = this.diskSlot(p, v);
    this.w(T_DN, this.dn, slot, this.dn[pSlot] as number);
    this.w(T_DN, this.dn, pSlot, e);
    if (e < start) this.w(T_VE, this.ve, v, e);
  }

  /** Removes edge `e` from `v`'s disk cycle. */
  diskRemove(v: number, e: number): void {
    const slot = this.diskSlot(e, v);
    const next = this.dn[slot] as number;
    if (next === e) {
      this.w(T_VE, this.ve, v, -1);
      this.w(T_DN, this.dn, slot, -1);
      return;
    }
    let p = e;
    let guard = 0;
    while ((this.dn[this.diskSlot(p, v)] as number) !== e && ++guard <= (this.cnt[1] as number)) {
      p = this.dn[this.diskSlot(p, v)] as number;
    }
    this.w(T_DN, this.dn, this.diskSlot(p, v), next);
    this.w(T_DN, this.dn, slot, -1);
    if ((this.ve[v] as number) === e) this.w(T_VE, this.ve, v, next);
  }

  /** Inserts corner `c` into `e`'s radial cycle at its sorted position. */
  radialInsert(e: number, c: number): void {
    const start = this.ec[e] as number;
    if (start === -1) {
      this.w(T_CR, this.cr, c, c);
      this.w(T_EC, this.ec, e, c);
      return;
    }
    let p = start;
    if (c < start) {
      let guard = 0;
      while ((this.cr[p] as number) !== start && ++guard <= (this.cnt[3] as number)) p = this.cr[p] as number;
    } else {
      let guard = 0;
      for (;;) {
        const next = this.cr[p] as number;
        if (next === start || next > c) break;
        p = next;
        if (++guard > (this.cnt[3] as number)) break;
      }
    }
    this.w(T_CR, this.cr, c, this.cr[p] as number);
    this.w(T_CR, this.cr, p, c);
    if (c < start) this.w(T_EC, this.ec, e, c);
  }

  /** Removes corner `c` from `e`'s radial cycle. */
  radialRemove(e: number, c: number): void {
    const next = this.cr[c] as number;
    if (next === c) {
      this.w(T_EC, this.ec, e, -1);
      this.w(T_CR, this.cr, c, -1);
      return;
    }
    let p = c;
    let guard = 0;
    while ((this.cr[p] as number) !== c && ++guard <= (this.cnt[3] as number)) p = this.cr[p] as number;
    this.w(T_CR, this.cr, p, next);
    this.w(T_CR, this.cr, c, -1);
    if ((this.ec[e] as number) === c) this.w(T_EC, this.ec, e, next);
  }

  // ---------- transactions ----------

  get inTransaction(): boolean {
    return this.tx !== null;
  }

  begin(opId: string): void {
    if (this.tx !== null) throw kernelError('mesh-transaction-open', `begin('${opId}') inside '${this.tx.opId}'`);
    if (typeof opId !== 'string') throw new EkzaError('invalid-argument', 'begin(opId): opId must be a string');
    this.tx = new Tx(opId, this.counts, this.cnt, new OpenSegment(null, this.access));
  }

  private openSegment(tx: Tx, event: LayerEvent): void {
    tx.segments.push(tx.open.close());
    tx.open = new OpenSegment(event, this.access);
  }

  end(): MeshDelta {
    const tx = this.requireTx('end()');
    tx.segments.push(tx.open.close());
    this.tx = null;
    const delta = this.deltaOf(tx);
    if (isKernelDebug()) {
      const problems = validateMesh(this);
      if (problems.length > 0) {
        this.apply(delta, 'backward');
        throw kernelError(
          'invalid-mesh',
          `'${tx.opId}' left an invalid mesh: ${problems.map((p) => p.message).join('; ')}`,
          { opId: tx.opId },
        );
      }
    }
    return delta;
  }

  abort(): void {
    const tx = this.requireTx('abort()');
    tx.segments.push(tx.open.close());
    this.tx = null;
    for (let s = tx.segments.length - 1; s >= 0; s--) this.applySegment(tx.segments[s] as SegmentRecord, false);
  }

  apply(delta: MeshDelta, dir: 'forward' | 'backward'): void {
    if (this.tx !== null) throw kernelError('mesh-transaction-open', `apply() inside '${this.tx.opId}'`);
    const writes = delta?.writes;
    if (!isKernelWrites(writes)) {
      throw kernelError('invalid-delta', `apply(): '${String(delta?.opId)}' is not a delta of this kernel`);
    }
    const from = dir === 'forward' ? delta.countsBefore : delta.countsAfter;
    const c = this.cnt;
    if (c[0] !== from.points || c[1] !== from.edges || c[2] !== from.faces || c[3] !== from.corners) {
      throw kernelError(
        'invalid-delta',
        `apply(): '${delta.opId}' ${dir} expects ${from.points}/${from.edges}/${from.faces}/${from.corners}, the mesh has ${c[0]}/${c[1]}/${c[2]}/${c[3]}`,
      );
    }
    for (let d = 0; d < 4; d++) this.ensureCapacity(d, writes.peak[d] as number);
    if (dir === 'forward') for (const segment of writes.segments) this.applySegment(segment, true);
    else
      for (let s = writes.segments.length - 1; s >= 0; s--)
        this.applySegment(writes.segments[s] as SegmentRecord, false);
  }

  private applySegment(segment: SegmentRecord, forward: boolean): void {
    if (forward && segment.event !== null) this.applyEvent(segment.event, true);
    if (forward) {
      for (const slot of segment.slots) {
        const array = this.arrayOfKey(slot.key);
        const idx = slot.idx;
        const values = slot.after;
        for (let k = 0; k < idx.length; k++) array[idx[k] as number] = values[k] as number;
      }
      for (const snap of segment.snaps) {
        const domain = this.keyDomain(snap.key);
        if (domain !== -1) this.ensureCapacityFor(domain, snap.key, snap.after.length);
        this.arrayOfKey(snap.key).set(snap.after);
      }
    } else {
      for (let s = segment.snaps.length - 1; s >= 0; s--) {
        const snap = segment.snaps[s] as SegmentRecord['snaps'][number];
        this.arrayOfKey(snap.key).set(snap.before);
        // Slots the segment brought to life were dead at its start.
        this.fillDead(snap.key, snap.before.length, snap.after.length);
      }
      for (let s = segment.slots.length - 1; s >= 0; s--) {
        const slot = segment.slots[s] as SegmentRecord['slots'][number];
        const array = this.arrayOfKey(slot.key);
        const idx = slot.idx;
        const values = slot.before;
        for (let k = 0; k < idx.length; k++) array[idx[k] as number] = values[k] as number;
      }
    }
    if (!forward && segment.event !== null) this.applyEvent(segment.event, false);
  }

  private keyDomain(key: number | string): number {
    if (typeof key === 'number') return TARGET_DOMAIN[key] ?? -1;
    return this.byName.get(key)?.domain ?? -1;
  }

  private ensureCapacityFor(domain: number, key: number | string, values: number): void {
    const stride =
      typeof key === 'number' ? (TARGET_STRIDE[key] as number) : ((this.byName.get(key)?.def.comps ?? 1) as number);
    this.ensureCapacity(domain, Math.ceil(values / stride));
  }

  private applyEvent(event: LayerEvent, forward: boolean): void {
    const adding = (event.kind === 'add') === forward;
    if (adding) {
      if (this.byName.has(event.def.name)) {
        throw kernelError('invalid-delta', `apply(): layer ${event.def.name} already exists`);
      }
      this.attachLayer(event.def, event.at, event.kind === 'remove' ? event.data : null);
    } else {
      const store = this.byName.get(event.def.name);
      if (store === undefined) throw kernelError('invalid-delta', `apply(): layer ${event.def.name} does not exist`);
      this.detachLayer(store);
    }
  }

  private deltaOf(tx: Tx): MeshDelta {
    const countsAfter = this.counts;
    const before = tx.countsBefore;
    const span = [
      Math.max(before.points, countsAfter.points),
      Math.max(before.edges, countsAfter.edges),
      Math.max(before.faces, countsAfter.faces),
      Math.max(before.corners, countsAfter.corners),
    ];
    const marks: (Uint8Array | null)[] = [null, null, null, null];
    const mark = (domain: number, element: number): void => {
      if (element >= (span[domain] as number)) return;
      let m = marks[domain];
      if (m === null || m === undefined) {
        m = new Uint8Array(span[domain] as number);
        marks[domain] = m;
      }
      m[element] = 1;
    };
    let topology =
      before.points !== countsAfter.points ||
      before.edges !== countsAfter.edges ||
      before.faces !== countsAfter.faces ||
      before.corners !== countsAfter.corners;
    const layerNames = new Set(tx.layerNames);
    let bytes = 64;
    for (const segment of tx.segments) {
      bytes += segmentBytes(segment);
      for (const slot of segment.slots) {
        const info = this.targetInfo(slot.key);
        if (typeof slot.key === 'string') layerNames.add(slot.key);
        else if (TARGET_TOPOLOGY[slot.key] === true) topology = true;
        if (!info.stored) continue;
        const idx = slot.idx;
        for (let k = 0; k < idx.length; k++) mark(info.domain, Math.floor((idx[k] as number) / info.stride));
      }
      for (const snap of segment.snaps) {
        const info = this.targetInfo(snap.key);
        if (typeof snap.key === 'string') layerNames.add(snap.key);
        else if (TARGET_TOPOLOGY[snap.key] === true) topology = true;
        if (!info.stored) continue;
        const n = Math.max(snap.before.length, snap.after.length);
        for (let i = 0; i < n; i++) {
          if (i >= snap.before.length || i >= snap.after.length || !Object.is(snap.before[i], snap.after[i])) {
            mark(info.domain, Math.floor(i / info.stride));
          }
        }
      }
    }
    const list = (domain: number): Uint32Array | 'all' => {
      if (tx.layerDomains.has(domain)) return 'all';
      const m = marks[domain];
      if (m === null || m === undefined) return EMPTY_U32;
      let n = 0;
      for (let i = 0; i < m.length; i++) n += m[i] as number;
      const out = new Uint32Array(n);
      let o = 0;
      for (let i = 0; i < m.length; i++) if (m[i] === 1) out[o++] = i;
      return out;
    };
    const dirty: DirtySet = Object.freeze({
      topology,
      points: list(D_POINT),
      edges: list(D_EDGE),
      faces: list(D_FACE),
      corners: list(D_CORNER),
      layers: Object.freeze([...layerNames].sort()),
    });
    const remapOf = (domain: number): DomainRemap => {
      const fwd = tx.fwd[domain];
      return Object.freeze({
        forward: fwd === null || fwd === undefined ? null : fwd,
        createdFrom: tx.boundary[domain] as number,
      });
    };
    const remap: ElementRemap = Object.freeze({
      point: remapOf(D_POINT),
      edge: remapOf(D_EDGE),
      face: remapOf(D_FACE),
      corner: remapOf(D_CORNER),
    });
    const writes: KernelWrites = Object.freeze({
      kind: 'ekza-mesh-log',
      marker: 'ekza-mesh-kernel',
      peak: [tx.peak[0], tx.peak[1], tx.peak[2], tx.peak[3]] as [number, number, number, number],
      segments: Object.freeze(tx.segments.slice()),
    });
    return Object.freeze({ opId: tx.opId, countsBefore: before, countsAfter, remap, dirty, bytes, writes });
  }

  private targetInfo(key: number | string): {
    readonly domain: number;
    readonly stride: number;
    readonly stored: boolean;
  } {
    if (typeof key === 'number') {
      return {
        domain: TARGET_DOMAIN[key] as number,
        stride: TARGET_STRIDE[key] as number,
        stored: TARGET_STORED[key] === true,
      };
    }
    const store = this.byName.get(key);
    if (store !== undefined) return { domain: store.domain, stride: store.def.comps, stored: true };
    // A layer removed later in the transaction: its domain is all-dirty through layerDomains already.
    return { domain: 0, stride: 1, stored: false };
  }

  // ---------- snapshot ----------

  snapshot(): MeshData {
    const [P, E, F, C] = [this.cnt[0], this.cnt[1], this.cnt[2], this.cnt[3]] as [number, number, number, number];
    const layers = new Map<string, { readonly def: LayerDef; readonly data: LayerArray }>();
    for (const store of this.layerList) {
      layers.set(store.def.name, { def: store.def, data: this.layerView(store).slice() });
    }
    return {
      counts: this.counts,
      position: this.pos.slice(0, 3 * P),
      edgeVerts: this.ev.slice(0, 2 * E),
      edgeFlags: this.ef.slice(0, E),
      cornerVert: this.cv.slice(0, C),
      cornerNext: this.cn.slice(0, C),
      faceCorner: this.fc.slice(0, F),
      faceMaterial: this.fm.slice(0, F),
      faceFlags: this.ff.slice(0, F),
      layers,
    };
  }

  /**
   * The stored subset as zero-copy views of the live arrays (exact lengths). Valid until the next write or capacity
   * growth; readers that finish synchronously (`writeRevision`) use it instead of `snapshot()`.
   */
  dataView(): MeshData {
    const [P, E, F, C] = [this.cnt[0], this.cnt[1], this.cnt[2], this.cnt[3]] as [number, number, number, number];
    const layers = new Map<string, { readonly def: LayerDef; readonly data: LayerArray }>();
    for (const store of this.layerList) layers.set(store.def.name, { def: store.def, data: this.layerView(store) });
    return {
      counts: this.counts,
      position: this.pos.subarray(0, 3 * P),
      edgeVerts: this.ev.subarray(0, 2 * E),
      edgeFlags: this.ef.subarray(0, E),
      cornerVert: this.cv.subarray(0, C),
      cornerNext: this.cn.subarray(0, C),
      faceCorner: this.fc.subarray(0, F),
      faceMaterial: this.fm.subarray(0, F),
      faceFlags: this.ff.subarray(0, F),
      layers,
    };
  }

  /** Retained bytes of the mesh's arrays (capacity), for memory budgets. */
  byteSize(): number {
    let bytes = 0;
    for (const array of [this.pos, this.ev, this.ef, this.cv, this.cn, this.fc, this.fm, this.ff])
      bytes += array.byteLength;
    for (const array of [this.ve, this.dn, this.ec, this.cp, this.ce, this.cf, this.cr]) bytes += array.byteLength;
    for (const store of this.layerList) bytes += store.data.length * BYTES_PER[store.def.type];
    return bytes;
  }
}

function domainCountOf(counts: MeshCounts, domain: number): number {
  switch (domain) {
    case D_POINT:
      return counts.points;
    case D_EDGE:
      return counts.edges;
    case D_FACE:
      return counts.faces;
    default:
      return counts.corners;
  }
}

export const DOMAIN_OF = DOMAIN_NAMES;
