// Euler operators (M6A-SPEC §4.3, research 13 §4.2, ADR 0014 §6): the only topology API; every op composes them.
// Each operator checks its preconditions before its first write (a refused call throws `EkzaError` and leaves the
// mesh untouched, so a caller can still end or abort its transaction), keeps the §5.1 invariants and the canonical
// cycle order of ../core/mesh.ts, and applies the §5.2 layer rules to the elements it creates:
//
// | operator | effect | layers and flags |
// |---|---|---|
// | makeVert(x, y, z) | appends a loose vertex | point layers at their defaults |
// | killVert(v) | kills v with its edges and their faces | — |
// | makeEdge(a, b) | appends a wire edge (returns the existing edge of the pair) | flags 0, edge layers default |
// | killEdge(e) | kills e and the faces using it | — |
// | makeFace(verts, {material, example}) | appends a face over the vertex cycle, creating missing edges (flags 0) | the example face's face layers and material; each corner copies the example's corner at the same vertex ('clear' layers cleared) |
// | killFace(f) | kills f and its corners; edges stay (possibly wire) | — |
// | splitEdgeMakeVert(e, t) | new vertex at t from edgeVert(e, 0); e keeps (v0, new), a new edge (new, v1) | point layers interpolated, a new corner per face side interpolated between that side's corners (seams kept), the new edge copies flags (H4) and edge layers |
// | joinEdgeKillVert(v) | dissolves a valence-2 vertex; the smaller-index edge survives (its endpoint order kept) | flags merged (H3) |
// | splitFaceMakeEdge(f, cA, cB) | cuts f between the vertices of two non-adjacent corners; f keeps cA's side, a new face takes cB's side | new edge hard iff every edge of f was hard (H1); the new face copies f's layers, material and flags; the two new corners copy the corners at their vertices |
// | joinFaceKillEdge(e) | merges the two faces of a manifold edge (opposite directions); the smaller face index survives | the survivor's face layers |
// | reverseFace(f) | flips the winding; corners keep their vertex and values | — |
import { EDGE_HARD } from '../constants';
import type { KernelMesh, LayerStore } from '../core/mesh';
import { kernelError } from '../kernel';
import { storedValue } from '../layers/arrays';
import { interpolateCornerAttributes, interpolatePointAttributes } from '../layers/propagate';
import { T_CE, T_CF, T_CN, T_CP, T_CR, T_CV, T_DN, T_EC, T_EF, T_EV, T_FC, T_FF, T_FM, T_POS, T_VE } from '../log/log';

const D_POINT = 0;
const D_EDGE = 1;
const D_FACE = 2;
const D_CORNER = 3;

function refuse(message: string): never {
  throw kernelError('mesh-euler', message);
}

function writeDefaults(m: KernelMesh, store: LayerStore, i: number): void {
  const def = store.def;
  for (let k = 0; k < def.comps; k++)
    m.w(store.tid, store.data, i * def.comps + k, storedValue(def.type, def.default[k] ?? 0));
}

function initLayers(m: KernelMesh, domain: number, i: number): void {
  for (const store of m.layersOf(domain)) writeDefaults(m, store, i);
}

/** Copies every layer of `domain` from `src` to `dst`; with `clear`, 'clear'-rule layers get their default. */
function copyLayers(m: KernelMesh, domain: number, src: number, dst: number, clear: boolean): void {
  for (const store of m.layersOf(domain)) {
    if (clear && store.def.interp === 'clear') {
      writeDefaults(m, store, dst);
      continue;
    }
    const comps = store.def.comps;
    for (let k = 0; k < comps; k++) m.w(store.tid, store.data, dst * comps + k, store.data[src * comps + k] as number);
  }
}

/** The corners of face `f` in cycle order. */
function faceCorners(m: KernelMesh, f: number): number[] {
  const out: number[] = [];
  const start = m.fc[f] as number;
  let c = start;
  do {
    out.push(c);
    c = m.cn[c] as number;
  } while (c !== start && out.length <= (m.cnt[D_CORNER] as number));
  return out;
}

/** The corners of edge `e`'s radial cycle (ascending). */
function radialCorners(m: KernelMesh, e: number): number[] {
  const out: number[] = [];
  const start = m.ec[e] as number;
  if (start === -1) return out;
  let c = start;
  do {
    out.push(c);
    c = m.cr[c] as number;
  } while (c !== start && out.length <= (m.cnt[D_CORNER] as number));
  return out;
}

function descending(list: number[]): number[] {
  return list.sort((a, b) => b - a);
}

// ---------- vertices ----------

export function makeVert(m: KernelMesh, x: number, y: number, z: number): number {
  m.requireTx('makeVert');
  const v = m.newSlot(D_POINT);
  m.w(T_POS, m.pos, 3 * v, Math.fround(x));
  m.w(T_POS, m.pos, 3 * v + 1, Math.fround(y));
  m.w(T_POS, m.pos, 3 * v + 2, Math.fround(z));
  m.w(T_VE, m.ve, v, -1);
  initLayers(m, D_POINT, v);
  return v;
}

export function killVert(m: KernelMesh, v: number): void {
  m.checkIndex(v, D_POINT, 'vertex');
  m.requireTx('killVert');
  // Each pass removes one incident edge; the bound is the valence before the first removal.
  for (let left = m.vertValence(v); (m.ve[v] as number) !== -1 && left > 0; left--) killEdge(m, m.ve[v] as number);
  m.removeSlot(D_POINT, v);
}

// ---------- edges ----------

export function makeEdge(m: KernelMesh, a: number, b: number): number {
  m.checkIndex(a, D_POINT, 'vertex');
  m.checkIndex(b, D_POINT, 'vertex');
  if (a === b) refuse(`makeEdge: an edge needs two different vertices (${a})`);
  const existing = m.findEdge(a, b);
  if (existing !== -1) return existing;
  m.requireTx('makeEdge');
  const e = m.newSlot(D_EDGE);
  m.w(T_EV, m.ev, 2 * e, a);
  m.w(T_EV, m.ev, 2 * e + 1, b);
  m.w(T_EF, m.ef, e, 0);
  m.w(T_EC, m.ec, e, -1);
  m.w(T_DN, m.dn, 2 * e, -1);
  m.w(T_DN, m.dn, 2 * e + 1, -1);
  initLayers(m, D_EDGE, e);
  m.diskInsert(a, e);
  m.diskInsert(b, e);
  return e;
}

export function killEdge(m: KernelMesh, e: number): void {
  m.checkIndex(e, D_EDGE, 'edge');
  m.requireTx('killEdge');
  // Each pass removes one face of the radial cycle; the bound is the cycle length before the first removal.
  for (let left = m.edgeFaceCount(e); (m.ec[e] as number) !== -1 && left > 0; left--) {
    killFace(m, m.cf[m.ec[e] as number] as number);
  }
  m.diskRemove(m.ev[2 * e] as number, e);
  m.diskRemove(m.ev[2 * e + 1] as number, e);
  m.removeSlot(D_EDGE, e);
}

// ---------- faces ----------

export function makeFace(
  m: KernelMesh,
  verts: ArrayLike<number>,
  opts?: { readonly material?: number; readonly example?: number },
): number {
  const n = verts?.length ?? 0;
  if (n < 3) refuse(`makeFace: a face needs at least three vertices (${n})`);
  const list: number[] = [];
  for (let i = 0; i < n; i++) {
    const v = verts[i] as number;
    m.checkIndex(v, D_POINT, 'vertex');
    list.push(v);
  }
  for (let i = 0; i < n; i++) {
    if (list[i] === list[(i + 1) % n]) refuse(`makeFace: consecutive corners share vertex ${list[i]}`);
  }
  const example = opts?.example;
  if (example !== undefined) m.checkIndex(example, D_FACE, 'example face');
  const material = opts?.material ?? (example !== undefined ? (m.fm[example] ?? 0) : 0);
  if (!Number.isInteger(material) || material < 0 || material > 0xffff) {
    refuse(`makeFace: material slot ${material} is outside 0…65535`);
  }
  m.requireTx('makeFace');
  const edges: number[] = [];
  for (let i = 0; i < n; i++) edges.push(makeEdge(m, list[i] as number, list[(i + 1) % n] as number));
  const f = m.newSlot(D_FACE);
  const corners: number[] = [];
  for (let i = 0; i < n; i++) corners.push(m.newSlot(D_CORNER));
  for (let i = 0; i < n; i++) {
    const c = corners[i] as number;
    m.w(T_CV, m.cv, c, list[i] as number);
    m.w(T_CN, m.cn, c, corners[(i + 1) % n] as number);
    m.w(T_CP, m.cp, c, corners[(i + n - 1) % n] as number);
    m.w(T_CE, m.ce, c, edges[i] as number);
    m.w(T_CF, m.cf, c, f);
    m.w(T_CR, m.cr, c, -1);
  }
  m.w(T_FC, m.fc, f, corners[0] as number);
  m.w(T_FM, m.fm, f, material);
  m.w(T_FF, m.ff, f, 0);
  if (example !== undefined) copyLayers(m, D_FACE, example, f, false);
  else initLayers(m, D_FACE, f);
  const exampleCorners = example !== undefined ? faceCorners(m, example) : [];
  for (let i = 0; i < n; i++) {
    const c = corners[i] as number;
    const source = exampleCorners.find((x) => (m.cv[x] as number) === list[i]);
    if (source !== undefined) copyLayers(m, D_CORNER, source, c, true);
    else initLayers(m, D_CORNER, c);
    m.radialInsert(edges[i] as number, c);
  }
  return f;
}

export function killFace(m: KernelMesh, f: number): void {
  m.checkIndex(f, D_FACE, 'face');
  m.requireTx('killFace');
  const corners = faceCorners(m, f);
  for (const c of corners) m.radialRemove(m.ce[c] as number, c);
  for (const c of descending(corners)) m.removeSlot(D_CORNER, c);
  m.removeSlot(D_FACE, f);
}

// ---------- split / join edge ----------

export function splitEdgeMakeVert(m: KernelMesh, e: number, t: number): number {
  m.checkIndex(e, D_EDGE, 'edge');
  if (typeof t !== 'number' || !Number.isFinite(t)) refuse(`splitEdgeMakeVert: t must be a finite number (${t})`);
  m.requireTx('splitEdgeMakeVert');
  const a = m.ev[2 * e] as number;
  const b = m.ev[2 * e + 1] as number;
  const p = m.pos;
  const x = (p[3 * a] as number) + ((p[3 * b] as number) - (p[3 * a] as number)) * t;
  const y = (p[3 * a + 1] as number) + ((p[3 * b + 1] as number) - (p[3 * a + 1] as number)) * t;
  const z = (p[3 * a + 2] as number) + ((p[3 * b + 2] as number) - (p[3 * a + 2] as number)) * t;
  const radial = radialCorners(m, e);
  const v = makeVert(m, x, y, z);
  interpolatePointAttributes(m, a, b, t, v);
  // The new edge (v, b) copies e's flags (H4) and edge layers.
  const e2 = m.newSlot(D_EDGE);
  m.w(T_EV, m.ev, 2 * e2, v);
  m.w(T_EV, m.ev, 2 * e2 + 1, b);
  m.w(T_EF, m.ef, e2, m.ef[e] as number);
  m.w(T_EC, m.ec, e2, -1);
  m.w(T_DN, m.dn, 2 * e2, -1);
  m.w(T_DN, m.dn, 2 * e2 + 1, -1);
  copyLayers(m, D_EDGE, e, e2, false);
  // e becomes (a, v).
  m.diskRemove(b, e);
  m.w(T_EV, m.ev, 2 * e + 1, v);
  m.diskInsert(v, e);
  m.diskInsert(b, e2);
  m.diskInsert(v, e2);
  // A new corner at v in every face side, between that side's corners at a and b.
  for (const c of radial) {
    const f = m.cf[c] as number;
    const next = m.cn[c] as number;
    const n = m.newSlot(D_CORNER);
    m.w(T_CV, m.cv, n, v);
    m.w(T_CF, m.cf, n, f);
    m.w(T_CN, m.cn, n, next);
    m.w(T_CP, m.cp, n, c);
    m.w(T_CR, m.cr, n, -1);
    m.w(T_CP, m.cp, next, n);
    m.w(T_CN, m.cn, c, n);
    if ((m.cv[c] as number) === a) {
      // c: a → v keeps e; n: v → b uses e2.
      m.w(T_CE, m.ce, n, e2);
      m.radialInsert(e2, n);
      interpolateCornerAttributes(m, c, next, t, n);
    } else {
      // c: b → v moves to e2; n: v → a uses e.
      m.radialRemove(e, c);
      m.w(T_CE, m.ce, c, e2);
      m.radialInsert(e2, c);
      m.w(T_CE, m.ce, n, e);
      m.radialInsert(e, n);
      interpolateCornerAttributes(m, next, c, t, n);
    }
  }
  return v;
}

export function joinEdgeKillVert(m: KernelMesh, v: number): number {
  m.checkIndex(v, D_POINT, 'vertex');
  const edges = m.diskList(v, []);
  if (edges.length !== 2) refuse(`joinEdgeKillVert: vertex ${v} has valence ${edges.length}, not 2`);
  const keep = edges[0] as number;
  const drop = edges[1] as number;
  const a = m.edgeOther(keep, v);
  const b = m.edgeOther(drop, v);
  if (a === b) refuse(`joinEdgeKillVert: both edges of vertex ${v} end at vertex ${a}`);
  if (m.findEdge(a, b) !== -1) refuse(`joinEdgeKillVert: vertices ${a} and ${b} are already joined by an edge`);
  const corners: number[] = [];
  for (const e of [keep, drop]) for (const c of radialCorners(m, e)) if ((m.cv[c] as number) === v) corners.push(c);
  for (const c of corners) {
    if (m.faceLen(m.cf[c] as number) < 4) {
      refuse(`joinEdgeKillVert: face ${m.cf[c]} would keep fewer than three corners`);
    }
    if ((m.ce[m.cp[c] as number] as number) === (m.ce[c] as number)) {
      refuse(`joinEdgeKillVert: face ${m.cf[c]} turns back at vertex ${v}`);
    }
  }
  m.requireTx('joinEdgeKillVert');
  m.w(T_EF, m.ef, keep, ((m.ef[keep] as number) | (m.ef[drop] as number)) & 0xff);
  for (const c of corners) {
    const p = m.cp[c] as number;
    const next = m.cn[c] as number;
    const f = m.cf[c] as number;
    m.w(T_CN, m.cn, p, next);
    m.w(T_CP, m.cp, next, p);
    if ((m.fc[f] as number) === c) m.w(T_FC, m.fc, f, next);
    if ((m.ce[p] as number) === drop) {
      m.radialRemove(drop, p);
      m.w(T_CE, m.ce, p, keep);
      m.radialInsert(keep, p);
    }
    m.radialRemove(m.ce[c] as number, c);
  }
  m.diskRemove(v, keep);
  m.diskRemove(v, drop);
  m.diskRemove(b, drop);
  m.w(T_EV, m.ev, (m.ev[2 * keep] as number) === v ? 2 * keep : 2 * keep + 1, b);
  m.diskInsert(b, keep);
  for (const c of descending(corners)) m.removeSlot(D_CORNER, c);
  m.removeSlot(D_EDGE, drop);
  m.removeSlot(D_POINT, v);
  return keep;
}

// ---------- split / join face ----------

export function splitFaceMakeEdge(m: KernelMesh, f: number, cA: number, cB: number): number {
  m.checkIndex(f, D_FACE, 'face');
  m.checkIndex(cA, D_CORNER, 'corner');
  m.checkIndex(cB, D_CORNER, 'corner');
  if ((m.cf[cA] as number) !== f || (m.cf[cB] as number) !== f) {
    refuse(`splitFaceMakeEdge: corners ${cA} and ${cB} must belong to face ${f}`);
  }
  if (cA === cB || (m.cn[cA] as number) === cB || (m.cn[cB] as number) === cA) {
    refuse(`splitFaceMakeEdge: corners ${cA} and ${cB} must be distinct and not adjacent`);
  }
  const vA = m.cv[cA] as number;
  const vB = m.cv[cB] as number;
  if (vA === vB) refuse(`splitFaceMakeEdge: both corners are at vertex ${vA}`);
  let allHard = true;
  for (const c of faceCorners(m, f)) if (((m.ef[m.ce[c] as number] as number) & EDGE_HARD) === 0) allHard = false;
  m.requireTx('splitFaceMakeEdge');
  let e = m.findEdge(vA, vB);
  if (e === -1) {
    e = makeEdge(m, vA, vB);
    m.w(T_EF, m.ef, e, allHard ? EDGE_HARD : 0);
  }
  const g = m.newSlot(D_FACE);
  m.w(T_FM, m.fm, g, m.fm[f] as number);
  m.w(T_FF, m.ff, g, m.ff[f] as number);
  copyLayers(m, D_FACE, f, g, false);
  const pA = m.cp[cA] as number;
  const pB = m.cp[cB] as number;
  const nB = m.newSlot(D_CORNER);
  const nA = m.newSlot(D_CORNER);
  // f: cA → … → pB → nB(vB) → cA
  m.w(T_CV, m.cv, nB, vB);
  m.w(T_CF, m.cf, nB, f);
  m.w(T_CN, m.cn, nB, cA);
  m.w(T_CP, m.cp, nB, pB);
  m.w(T_CE, m.ce, nB, e);
  m.w(T_CR, m.cr, nB, -1);
  m.w(T_CN, m.cn, pB, nB);
  m.w(T_CP, m.cp, cA, nB);
  // g: cB → … → pA → nA(vA) → cB
  m.w(T_CV, m.cv, nA, vA);
  m.w(T_CF, m.cf, nA, g);
  m.w(T_CN, m.cn, nA, cB);
  m.w(T_CP, m.cp, nA, pA);
  m.w(T_CE, m.ce, nA, e);
  m.w(T_CR, m.cr, nA, -1);
  m.w(T_CN, m.cn, pA, nA);
  m.w(T_CP, m.cp, cB, nA);
  copyLayers(m, D_CORNER, cB, nB, true);
  copyLayers(m, D_CORNER, cA, nA, true);
  let c = cB;
  let guard = 0;
  do {
    m.w(T_CF, m.cf, c, g);
    c = m.cn[c] as number;
  } while (c !== cB && ++guard <= (m.cnt[D_CORNER] as number));
  m.w(T_FC, m.fc, g, cB);
  if ((m.cf[m.fc[f] as number] as number) !== f) m.w(T_FC, m.fc, f, cA);
  m.radialInsert(e, nB);
  m.radialInsert(e, nA);
  return e;
}

export function joinFaceKillEdge(m: KernelMesh, e: number): number {
  m.checkIndex(e, D_EDGE, 'edge');
  const radial = radialCorners(m, e);
  if (radial.length !== 2) {
    refuse(`joinFaceKillEdge: edge ${e} has ${radial.length} faces; joining needs exactly two`);
  }
  const [c1, c2] = radial as [number, number];
  const f1 = m.cf[c1] as number;
  const f2 = m.cf[c2] as number;
  if (f1 === f2) refuse(`joinFaceKillEdge: both sides of edge ${e} are face ${f1}`);
  if ((m.cv[c1] as number) === (m.cv[c2] as number)) {
    refuse(`joinFaceKillEdge: faces ${f1} and ${f2} run edge ${e} in the same direction (inconsistent winding)`);
  }
  m.requireTx('joinFaceKillEdge');
  const s = Math.min(f1, f2);
  const o = Math.max(f1, f2);
  const cS = f1 === s ? c1 : c2;
  const cO = f1 === s ? c2 : c1;
  const pS = m.cp[cS] as number;
  const nS = m.cn[cS] as number;
  const pO = m.cp[cO] as number;
  const nO = m.cn[cO] as number;
  m.w(T_CN, m.cn, pS, nO);
  m.w(T_CP, m.cp, nO, pS);
  m.w(T_CN, m.cn, pO, nS);
  m.w(T_CP, m.cp, nS, pO);
  let c = pS;
  let guard = 0;
  do {
    m.w(T_CF, m.cf, c, s);
    c = m.cn[c] as number;
  } while (c !== pS && ++guard <= (m.cnt[D_CORNER] as number));
  if ((m.fc[s] as number) === cS) m.w(T_FC, m.fc, s, nS);
  m.radialRemove(e, cS);
  m.radialRemove(e, cO);
  for (const corner of descending([cS, cO])) m.removeSlot(D_CORNER, corner);
  m.diskRemove(m.ev[2 * e] as number, e);
  m.diskRemove(m.ev[2 * e + 1] as number, e);
  m.removeSlot(D_EDGE, e);
  m.removeSlot(D_FACE, o);
  return s;
}

export function reverseFace(m: KernelMesh, f: number): void {
  m.checkIndex(f, D_FACE, 'face');
  m.requireTx('reverseFace');
  const corners = faceCorners(m, f);
  const n = corners.length;
  const edges = corners.map((c) => m.ce[c] as number);
  for (let i = 0; i < n; i++) m.radialRemove(edges[i] as number, corners[i] as number);
  for (let i = 0; i < n; i++) {
    const c = corners[i] as number;
    m.w(T_CN, m.cn, c, corners[(i + n - 1) % n] as number);
    m.w(T_CP, m.cp, c, corners[(i + 1) % n] as number);
    m.w(T_CE, m.ce, c, edges[(i + n - 1) % n] as number);
  }
  for (let i = 0; i < n; i++) m.radialInsert(m.ce[corners[i] as number] as number, corners[i] as number);
}
