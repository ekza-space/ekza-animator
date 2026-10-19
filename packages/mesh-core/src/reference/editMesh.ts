// Reference `EditMesh` for static meshes (M6A-SPEC §4.3, §9 B0a): edit links (disk, radial, face cycles) over the
// stored arrays, allocation-free traversal, value writes and layers through a write log with exact `apply` both ways.
// Topology never changes here: every Euler operator throws `not-implemented` until B1's kernel replaces this module
// (same contract). Writes outside `begin`/`end` throw (every write goes through the log, §3 rule 8).
import { validateMesh } from './validate';
import { isKernelDebug } from './debug';
import { kernelError, notImplemented } from '../kernel';
import type {
  AttrLayer,
  DirtySet,
  Domain,
  EditMesh,
  ElementRemap,
  LayerDef,
  MeshCounts,
  MeshData,
  MeshDelta,
} from '../types';
import { pairKey } from './build';
import { allocLayer, BYTES_PER, defaultLayerData, domainCount, type LayerArray, storedValue } from './layers';

/** Write-log targets of the stored arrays; attribute layers use their names. */
const POSITION = '$position';
const EDGE_FLAGS = '$edgeFlags';
const FACE_FLAGS = '$faceFlags';
const FACE_MATERIAL = '$faceMaterial';

interface Slot {
  readonly target: string;
  readonly domain: Domain;
  /** Flat index into the target array (element × comps + comp). */
  readonly index: number;
  readonly element: number;
  readonly before: number;
  after: number;
}

type LayerOp =
  | { readonly kind: 'add'; readonly def: LayerDef; readonly data: LayerArray; readonly at: number }
  | { readonly kind: 'remove'; readonly def: LayerDef; readonly data: LayerArray; readonly at: number };

/** Writes between two layer operations, coalesced per slot; `op` (if any) happened before them. */
interface Segment {
  readonly op: LayerOp | null;
  readonly slots: Map<string, Slot>;
}

interface Writes {
  readonly kind: 'ekza-reference-log';
  readonly segments: readonly { readonly op: LayerOp | null; readonly slots: readonly Slot[] }[];
}

class RefLayer implements AttrLayer {
  constructor(
    private readonly mesh: RefEditMesh,
    readonly def: LayerDef,
    public values: LayerArray,
  ) {}

  get data(): Readonly<LayerArray> {
    return this.values;
  }

  get(index: number, comp = 0): number {
    return this.values[index * this.def.comps + comp] ?? Number.NaN;
  }

  set(index: number, comp: number, value: number): void {
    this.mesh.writeLayer(this, index, comp, value);
  }

  read(index: number, out: Float64Array, offset = 0): void {
    const comps = this.def.comps;
    for (let k = 0; k < comps; k++) out[offset + k] = this.values[index * comps + k] as number;
  }
}

const NO_REMAP: DomainRemap = Object.freeze({ forward: null, createdFrom: 0 });
type DomainRemap = ElementRemap['point'];

function staticRemap(counts: MeshCounts): ElementRemap {
  return Object.freeze({
    point: { ...NO_REMAP, createdFrom: counts.points },
    edge: { ...NO_REMAP, createdFrom: counts.edges },
    face: { ...NO_REMAP, createdFrom: counts.faces },
    corner: { ...NO_REMAP, createdFrom: counts.corners },
  });
}

export class RefEditMesh implements EditMesh {
  readonly counts: MeshCounts;
  readonly position: Float32Array;
  private readonly ev: Uint32Array;
  private readonly ef: Uint8Array;
  private readonly cv: Uint32Array;
  private readonly cn: Uint32Array;
  private readonly fc: Uint32Array;
  private readonly fm: Uint16Array;
  private readonly ff: Uint8Array;
  private readonly layerMap = new Map<string, RefLayer>();
  private layerOrder: string[] = [];
  // edit links
  private readonly cp: Int32Array;
  private readonly cf: Int32Array;
  private readonly ce: Int32Array;
  private readonly cr: Int32Array;
  private readonly ec: Int32Array;
  private readonly dn: Int32Array;
  private readonly ve: Int32Array;
  // write log
  private log: { readonly opId: string; readonly segments: Segment[] } | null = null;

  constructor(data: MeshData) {
    const { points: P, edges: E, faces: F, corners: C } = data.counts;
    const expect = (name: string, actual: number, wanted: number): void => {
      if (actual !== wanted) {
        throw kernelError('invalid-mesh', `editMeshFrom: ${name} has ${actual} values, expected ${wanted}`);
      }
    };
    expect('position', data.position.length, 3 * P);
    expect('edgeVerts', data.edgeVerts.length, 2 * E);
    expect('edgeFlags', data.edgeFlags.length, E);
    expect('cornerVert', data.cornerVert.length, C);
    expect('cornerNext', data.cornerNext.length, C);
    expect('faceCorner', data.faceCorner.length, F);
    expect('faceMaterial', data.faceMaterial.length, F);
    expect('faceFlags', data.faceFlags.length, F);
    this.counts = Object.freeze({ points: P, edges: E, faces: F, corners: C });
    this.position = Float32Array.from(data.position);
    this.ev = Uint32Array.from(data.edgeVerts);
    this.ef = Uint8Array.from(data.edgeFlags);
    this.cv = Uint32Array.from(data.cornerVert);
    this.cn = Uint32Array.from(data.cornerNext);
    this.fc = Uint32Array.from(data.faceCorner);
    this.fm = Uint16Array.from(data.faceMaterial);
    this.ff = Uint8Array.from(data.faceFlags);
    for (const [name, layer] of data.layers) {
      const count = domainCount(this.counts, layer.def.domain);
      expect(`layer ${name}`, layer.data.length, count * layer.def.comps);
      const copy = allocLayer(layer.def.type, layer.data.length);
      copy.set(layer.data);
      this.layerMap.set(name, new RefLayer(this, layer.def, copy));
      this.layerOrder.push(name);
    }

    this.cp = new Int32Array(C).fill(-1);
    this.cf = new Int32Array(C).fill(-1);
    this.ce = new Int32Array(C).fill(-1);
    this.cr = new Int32Array(C).fill(-1);
    this.ec = new Int32Array(E).fill(-1);
    this.dn = new Int32Array(2 * E).fill(-1);
    this.ve = new Int32Array(P).fill(-1);
    for (let v = 0; v < 2 * E; v++) {
      if ((this.ev[v] as number) >= P) throw kernelError('invalid-mesh', `editMeshFrom: edge vertex out of range`);
    }
    // Face cycles.
    for (let f = 0; f < F; f++) {
      const start = this.fc[f] as number;
      if (start >= C) throw kernelError('invalid-mesh', `editMeshFrom: face ${f} starts at corner ${start} ≥ ${C}`);
      let c = start;
      let steps = 0;
      do {
        if ((this.cf[c] as number) !== -1)
          throw kernelError('invalid-mesh', `editMeshFrom: corner ${c} is in two faces`);
        if ((this.cv[c] as number) >= P)
          throw kernelError('invalid-mesh', `editMeshFrom: corner ${c} vertex out of range`);
        this.cf[c] = f;
        const next = this.cn[c] as number;
        if (next >= C) throw kernelError('invalid-mesh', `editMeshFrom: corner ${c} next out of range`);
        this.cp[next] = c;
        c = next;
        if (++steps > C) throw kernelError('invalid-mesh', `editMeshFrom: face ${f} does not close`);
      } while (c !== start);
      if (steps < 3) throw kernelError('invalid-mesh', `editMeshFrom: face ${f} has ${steps} corners`);
    }
    for (let c = 0; c < C; c++) {
      if ((this.cf[c] as number) === -1) throw kernelError('invalid-mesh', `editMeshFrom: corner ${c} is in no face`);
    }
    // Edges by vertex pair, corner → edge, radial cycles (corners in index order).
    const byPair = new Map<number, number>();
    for (let e = 0; e < E; e++) {
      const a = this.ev[2 * e] as number;
      const b = this.ev[2 * e + 1] as number;
      if (a === b) throw kernelError('invalid-mesh', `editMeshFrom: edge ${e} is a loop`);
      const key = pairKey(a, b, P);
      if (byPair.has(key))
        throw kernelError('invalid-mesh', `editMeshFrom: edges ${byPair.get(key)} and ${e} join the same vertices`);
      byPair.set(key, e);
    }
    const lastRadial = new Int32Array(E).fill(-1);
    for (let c = 0; c < C; c++) {
      const a = this.cv[c] as number;
      const b = this.cv[this.cn[c] as number] as number;
      const e = byPair.get(pairKey(a, b, P));
      if (e === undefined) throw kernelError('invalid-mesh', `editMeshFrom: no edge between corners ${c} and its next`);
      this.ce[c] = e;
      const last = lastRadial[e] as number;
      if (last === -1) this.ec[e] = c;
      else this.cr[last] = c;
      lastRadial[e] = c;
    }
    for (let e = 0; e < E; e++) {
      const last = lastRadial[e] as number;
      if (last !== -1) this.cr[last] = this.ec[e] as number;
    }
    // Disk cycles (incident edges in index order).
    const lastDisk = new Int32Array(P).fill(-1);
    for (let e = 0; e < E; e++) {
      for (let end = 0; end < 2; end++) {
        const v = this.ev[2 * e + end] as number;
        const last = lastDisk[v] as number;
        if (last === -1) this.ve[v] = e;
        else this.dn[2 * last + this.endOf(last, v)] = e;
        lastDisk[v] = e;
      }
    }
    for (let v = 0; v < P; v++) {
      const last = lastDisk[v] as number;
      if (last !== -1) this.dn[2 * last + this.endOf(last, v)] = this.ve[v] as number;
    }
  }

  private endOf(e: number, v: number): 0 | 1 {
    return (this.ev[2 * e] as number) === v ? 0 : 1;
  }

  // ---------- traversal ----------

  cornerVert(c: number): number {
    return this.cv[c] ?? -1;
  }
  cornerNext(c: number): number {
    return this.cn[c] ?? -1;
  }
  cornerPrev(c: number): number {
    return this.cp[c] ?? -1;
  }
  cornerEdge(c: number): number {
    return this.ce[c] ?? -1;
  }
  cornerFace(c: number): number {
    return this.cf[c] ?? -1;
  }
  cornerRadialNext(c: number): number {
    return this.cr[c] ?? -1;
  }
  edgeVert(e: number, end: 0 | 1): number {
    return this.ev[2 * e + end] ?? -1;
  }
  edgeCorner(e: number): number {
    return this.ec[e] ?? -1;
  }
  edgeDiskNext(e: number, v: number): number {
    if (e < 0 || e >= this.counts.edges) return -1;
    if ((this.ev[2 * e] as number) === v) return this.dn[2 * e] as number;
    if ((this.ev[2 * e + 1] as number) === v) return this.dn[2 * e + 1] as number;
    return -1;
  }
  edgeOther(e: number, v: number): number {
    if (e < 0 || e >= this.counts.edges) return -1;
    const a = this.ev[2 * e] as number;
    const b = this.ev[2 * e + 1] as number;
    return a === v ? b : b === v ? a : -1;
  }
  findEdge(a: number, b: number): number {
    const start = this.ve[a] ?? -1;
    if (start === -1) return -1;
    let e = start;
    let steps = 0;
    do {
      if (this.edgeOther(e, a) === b) return e;
      e = this.edgeDiskNext(e, a);
    } while (e !== start && e !== -1 && ++steps <= this.counts.edges);
    return -1;
  }
  vertEdge(v: number): number {
    return this.ve[v] ?? -1;
  }
  faceCorner(f: number): number {
    return this.fc[f] ?? -1;
  }
  faceLen(f: number): number {
    const start = this.fc[f];
    if (start === undefined) return 0;
    let n = 0;
    let c = start;
    do {
      n++;
      c = this.cn[c] as number;
    } while (c !== start && n <= this.counts.corners);
    return n;
  }
  edgeFaceCount(e: number): number {
    const start = this.ec[e] ?? -1;
    if (start === -1) return 0;
    let n = 0;
    let c = start;
    do {
      n++;
      c = this.cr[c] as number;
    } while (c !== start && n <= this.counts.corners);
    return n;
  }
  vertValence(v: number): number {
    const start = this.ve[v] ?? -1;
    if (start === -1) return 0;
    let n = 0;
    let e = start;
    do {
      n++;
      e = this.edgeDiskNext(e, v);
    } while (e !== start && e !== -1 && n <= this.counts.edges);
    return n;
  }
  /**
   * True when the faces around `v` form one fan (a disc or a half-disc): no incident edge has more than two faces, no
   * wire edge touches a face fan, and walking across two-face edges from one corner at `v` reaches every corner at `v`.
   * A vertex without faces is manifold (loose geometry is reported by Mesh Check, not here).
   */
  isManifoldVert(v: number): boolean {
    const start = this.ve[v] ?? -1;
    if (start === -1) return true;
    let corners = 0;
    let first = -1;
    let wire = false;
    let e = start;
    let steps = 0;
    do {
      const faces = this.edgeFaceCount(e);
      if (faces > 2) return false;
      if (faces === 0) wire = true;
      // Each corner at v is the one corner of its face whose out-edge (v → next) is an incident edge.
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
      e = this.edgeDiskNext(e, v);
    } while (e !== start && e !== -1 && ++steps <= this.counts.edges);
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
        if (at === c) return visited; // closed fan
        visited++;
        corner = at;
        came = next;
        if (++guard > this.counts.corners) break;
      }
    }
    return visited;
  }

  edgeFlags(e: number): number {
    return this.ef[e] ?? 0;
  }
  faceFlags(f: number): number {
    return this.ff[f] ?? 0;
  }
  faceMaterial(f: number): number {
    return this.fm[f] ?? 0;
  }

  // ---------- Euler operators (B1) ----------

  makeVert(_x: number, _y: number, _z: number): number {
    throw notImplemented('EditMesh.makeVert (reference kernel: static meshes only, B1)');
  }
  killVert(_v: number): void {
    throw notImplemented('EditMesh.killVert (reference kernel: static meshes only, B1)');
  }
  makeEdge(_a: number, _b: number): number {
    throw notImplemented('EditMesh.makeEdge (reference kernel: static meshes only, B1)');
  }
  killEdge(_e: number): void {
    throw notImplemented('EditMesh.killEdge (reference kernel: static meshes only, B1)');
  }
  makeFace(_verts: ArrayLike<number>, _opts?: { readonly material?: number; readonly example?: number }): number {
    throw notImplemented('EditMesh.makeFace (reference kernel: static meshes only, B1)');
  }
  killFace(_f: number): void {
    throw notImplemented('EditMesh.killFace (reference kernel: static meshes only, B1)');
  }
  splitEdgeMakeVert(_e: number, _t: number): number {
    throw notImplemented('EditMesh.splitEdgeMakeVert (reference kernel: static meshes only, B1)');
  }
  joinEdgeKillVert(_v: number): number {
    throw notImplemented('EditMesh.joinEdgeKillVert (reference kernel: static meshes only, B1)');
  }
  splitFaceMakeEdge(_f: number, _cA: number, _cB: number): number {
    throw notImplemented('EditMesh.splitFaceMakeEdge (reference kernel: static meshes only, B1)');
  }
  joinFaceKillEdge(_e: number): number {
    throw notImplemented('EditMesh.joinFaceKillEdge (reference kernel: static meshes only, B1)');
  }
  reverseFace(_f: number): void {
    throw notImplemented('EditMesh.reverseFace (reference kernel: static meshes only, B1)');
  }

  // ---------- value writes ----------

  setPosition(v: number, x: number, y: number, z: number): void {
    this.checkIndex(v, this.counts.points, 'vertex');
    this.write(POSITION, 'point', 3 * v, v, this.position, Math.fround(x));
    this.write(POSITION, 'point', 3 * v + 1, v, this.position, Math.fround(y));
    this.write(POSITION, 'point', 3 * v + 2, v, this.position, Math.fround(z));
  }
  setEdgeFlags(e: number, flags: number): void {
    this.checkIndex(e, this.counts.edges, 'edge');
    this.write(EDGE_FLAGS, 'edge', e, e, this.ef, flags & 0xff);
  }
  setFaceFlags(f: number, flags: number): void {
    this.checkIndex(f, this.counts.faces, 'face');
    this.write(FACE_FLAGS, 'face', f, f, this.ff, flags & 0xff);
  }
  setFaceMaterial(f: number, slot: number): void {
    this.checkIndex(f, this.counts.faces, 'face');
    this.write(FACE_MATERIAL, 'face', f, f, this.fm, slot & 0xffff);
  }
  layer(name: string): AttrLayer | undefined {
    return this.layerMap.get(name);
  }
  addLayer(def: LayerDef): AttrLayer {
    const existing = this.layerMap.get(def.name);
    if (existing !== undefined) return existing;
    const log = this.requireLog('addLayer');
    const data = defaultLayerData(def, domainCount(this.counts, def.domain));
    const layer = new RefLayer(this, def, data);
    const at = this.layerOrder.length;
    this.layerMap.set(def.name, layer);
    this.layerOrder.push(def.name);
    log.segments.push({ op: { kind: 'add', def, data: data.slice(), at }, slots: new Map() });
    return layer;
  }
  removeLayer(name: string): void {
    const layer = this.layerMap.get(name);
    if (layer === undefined) return;
    const log = this.requireLog('removeLayer');
    const at = this.layerOrder.indexOf(name);
    this.layerMap.delete(name);
    this.layerOrder.splice(at, 1);
    log.segments.push({ op: { kind: 'remove', def: layer.def, data: layer.values.slice(), at }, slots: new Map() });
  }
  layers(): readonly AttrLayer[] {
    return this.layerOrder.map((name) => this.layerMap.get(name) as RefLayer);
  }

  /** `AttrLayer.set` (logged). */
  writeLayer(layer: RefLayer, index: number, comp: number, value: number): void {
    if (this.layerMap.get(layer.def.name) !== layer)
      throw kernelError('invalid-layer', `layer ${layer.def.name} was removed`);
    this.checkIndex(index, domainCount(this.counts, layer.def.domain), layer.def.domain);
    if (!Number.isInteger(comp) || comp < 0 || comp >= layer.def.comps) {
      throw kernelError('out-of-range', `layer ${layer.def.name}: component ${comp} of ${layer.def.comps}`);
    }
    this.write(
      layer.def.name,
      layer.def.domain,
      index * layer.def.comps + comp,
      index,
      layer.values,
      storedValue(layer.def.type, value),
    );
  }

  private checkIndex(i: number, count: number, what: string): void {
    if (!Number.isInteger(i) || i < 0 || i >= count)
      throw kernelError('out-of-range', `${what} ${i} is outside 0…${count - 1}`);
  }

  private requireLog(what: string): { readonly opId: string; readonly segments: Segment[] } {
    if (this.log === null) throw kernelError('mesh-no-transaction', `${what} outside begin()/end()`);
    return this.log;
  }

  private write(
    target: string,
    domain: Domain,
    index: number,
    element: number,
    array: LayerArray,
    value: number,
  ): void {
    const log = this.requireLog('a write');
    const before = array[index] as number;
    if (Object.is(before, value)) return;
    array[index] = value;
    const segment = log.segments.at(-1) as Segment;
    const key = `${target}\u0000${index}`;
    const slot = segment.slots.get(key);
    if (slot === undefined) segment.slots.set(key, { target, domain, index, element, before, after: value });
    else slot.after = value;
  }

  // ---------- transactions ----------

  get inTransaction(): boolean {
    return this.log !== null;
  }

  begin(opId: string): void {
    if (this.log !== null) throw kernelError('mesh-transaction-open', `begin('${opId}') inside '${this.log.opId}'`);
    this.log = { opId, segments: [{ op: null, slots: new Map() }] };
  }

  end(): MeshDelta {
    const log = this.requireLog('end()');
    this.log = null;
    const writes: Writes = {
      kind: 'ekza-reference-log',
      segments: log.segments
        .filter((segment) => segment.op !== null || segment.slots.size > 0)
        .map((segment) => ({ op: segment.op, slots: [...segment.slots.values()].map((slot) => ({ ...slot })) })),
    };
    const delta = deltaOf(log.opId, this.counts, writes);
    if (isKernelDebug()) {
      const problems = validateMesh(this);
      if (problems.length > 0) {
        this.apply(delta, 'backward');
        throw kernelError(
          'invalid-mesh',
          `'${log.opId}' left an invalid mesh: ${problems.map((p) => p.message).join('; ')}`,
          {
            opId: log.opId,
          },
        );
      }
    }
    return delta;
  }

  abort(): void {
    const log = this.requireLog('abort()');
    this.log = null;
    for (let s = log.segments.length - 1; s >= 0; s--) {
      const segment = log.segments[s] as Segment;
      this.applySegment({ op: segment.op, slots: [...segment.slots.values()] }, 'backward');
    }
  }

  apply(delta: MeshDelta, dir: 'forward' | 'backward'): void {
    if (this.log !== null) throw kernelError('mesh-transaction-open', `apply() inside '${this.log.opId}'`);
    const writes = delta.writes as Writes | null;
    if (writes === null || typeof writes !== 'object' || writes.kind !== 'ekza-reference-log') {
      throw kernelError('invalid-delta', `apply(): '${delta.opId}' is not a delta of this kernel`);
    }
    if (dir === 'forward') for (const segment of writes.segments) this.applySegment(segment, 'forward');
    else
      for (let s = writes.segments.length - 1; s >= 0; s--)
        this.applySegment(writes.segments[s] as Writes['segments'][number], 'backward');
  }

  private applySegment(
    segment: { readonly op: LayerOp | null; readonly slots: readonly Slot[] },
    dir: 'forward' | 'backward',
  ): void {
    if (dir === 'forward' && segment.op !== null) this.applyLayerOp(segment.op, 'forward');
    for (const slot of segment.slots) {
      const array = this.arrayOf(slot.target);
      array[slot.index] = dir === 'forward' ? slot.after : slot.before;
    }
    if (dir === 'backward' && segment.op !== null) this.applyLayerOp(segment.op, 'backward');
  }

  private applyLayerOp(op: LayerOp, dir: 'forward' | 'backward'): void {
    const adding = (op.kind === 'add') === (dir === 'forward');
    if (adding) {
      this.layerMap.set(op.def.name, new RefLayer(this, op.def, op.data.slice()));
      this.layerOrder.splice(op.at, 0, op.def.name);
    } else {
      this.layerMap.delete(op.def.name);
      this.layerOrder = this.layerOrder.filter((name) => name !== op.def.name);
    }
  }

  private arrayOf(target: string): LayerArray {
    switch (target) {
      case POSITION:
        return this.position;
      case EDGE_FLAGS:
        return this.ef;
      case FACE_FLAGS:
        return this.ff;
      case FACE_MATERIAL:
        return this.fm;
      default: {
        const layer = this.layerMap.get(target);
        if (layer === undefined) throw kernelError('invalid-delta', `apply(): layer ${target} does not exist`);
        return layer.values;
      }
    }
  }

  snapshot(): MeshData {
    const layers = new Map<string, { readonly def: LayerDef; readonly data: LayerArray }>();
    for (const name of this.layerOrder) {
      const layer = this.layerMap.get(name) as RefLayer;
      layers.set(name, { def: layer.def, data: layer.values.slice() });
    }
    return {
      counts: this.counts,
      position: this.position.slice(),
      edgeVerts: this.ev.slice(),
      edgeFlags: this.ef.slice(),
      cornerVert: this.cv.slice(),
      cornerNext: this.cn.slice(),
      faceCorner: this.fc.slice(),
      faceMaterial: this.fm.slice(),
      faceFlags: this.ff.slice(),
      layers,
    };
  }
}

/** Sorted unique elements of one domain written by the log. */
function dirtyOf(writes: Writes, domain: Domain): Uint32Array {
  const set = new Set<number>();
  for (const segment of writes.segments)
    for (const slot of segment.slots) if (slot.domain === domain) set.add(slot.element);
  return Uint32Array.from([...set].sort((a, b) => a - b));
}

function deltaOf(opId: string, counts: MeshCounts, writes: Writes): MeshDelta {
  const layers = new Set<string>();
  let bytes = 64;
  for (const segment of writes.segments) {
    if (segment.op !== null) {
      layers.add(segment.op.def.name);
      bytes += segment.op.data.length * BYTES_PER[segment.op.def.type];
    }
    for (const slot of segment.slots) {
      if (!slot.target.startsWith('$')) layers.add(slot.target);
      bytes += 48;
    }
  }
  // Layer operations change which elements a layer covers: every element of its domain is dirty.
  const opDomains = new Set<Domain>();
  for (const segment of writes.segments) if (segment.op !== null) opDomains.add(segment.op.def.domain);
  const dirty: DirtySet = Object.freeze({
    topology: false,
    points: opDomains.has('point') ? 'all' : dirtyOf(writes, 'point'),
    edges: opDomains.has('edge') ? 'all' : dirtyOf(writes, 'edge'),
    faces: opDomains.has('face') ? 'all' : dirtyOf(writes, 'face'),
    corners: opDomains.has('corner') ? 'all' : dirtyOf(writes, 'corner'),
    layers: Object.freeze([...layers].sort()),
  });
  return Object.freeze({
    opId,
    countsBefore: counts,
    countsAfter: counts,
    remap: staticRemap(counts),
    dirty,
    bytes,
    writes: Object.freeze(writes),
  });
}

/** Builds edit links (disk, radial, loop cycles) over a copy of `data`. Throws `EkzaError('invalid-mesh')` for data
 *  that violates the stored-form invariants (§5.1). */
export function editMeshFrom(data: MeshData): EditMesh {
  return new RefEditMesh(data);
}

export function emptyMesh(): EditMesh {
  return new RefEditMesh({
    counts: { points: 0, edges: 0, faces: 0, corners: 0 },
    position: new Float32Array(0),
    edgeVerts: new Uint32Array(0),
    edgeFlags: new Uint8Array(0),
    cornerVert: new Uint32Array(0),
    cornerNext: new Uint32Array(0),
    faceCorner: new Uint32Array(0),
    faceMaterial: new Uint16Array(0),
    faceFlags: new Uint8Array(0),
    layers: new Map(),
  });
}
