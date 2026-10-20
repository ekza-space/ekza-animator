// Corner rewiring through Euler operators only (M6A-SPEC §3 rule 8; B3 decision M6A-B3-2): `swapCorner` moves face
// f's corner at vertex v onto another vertex w while f keeps its index, its face layers and every other corner. The
// cap of an extrude and the inner faces of an inset keep their original face indices this way (§5.8 step 2): the
// kernel's removal rule moves the last pre-op face into any removed pre-op slot (M6A-B1-2), so a face that must keep
// its index can never be killed and re-made; it is re-shaped by splits and joins whose removed elements are all
// created by the same call.
//
// The construction (p, n = f's neighbours of v; w the new vertex):
// - quads and larger faces without an edge p–n: cut f along the chord p–n (f keeps the side without v, the cut-off
//   triangle T = (p, v, n) is a new face), make Q = (n, p, w), kill T, join f and Q across the chord (f has the
//   smaller index and survives): f now runs … p → w → n …;
// - triangles (p, v, n): split the edge n–p first (a temporary vertex x joins f and the face across), so f = (p, v, n, x)
//   has no edge p–n; then as above, and dissolve x again (joinEdgeKillVert restores the split edge and its neighbour);
// - faces with an existing edge p–n elsewhere: split f's edge n–q (q after n) by x, cut along p–x (T = (p, v, n, x)),
//   make Q = (x, p, w, n), kill T, join across p–x, dissolve x.
// Every element a call creates and removes is removed while it is the newest of its domain or by a join that keeps
// the older face, so pre-op indices never move; created indices the caller holds in the vertex domain stay valid
// (a temporary vertex is the last vertex when it is dissolved). Edge indices change: callers re-find edges by their
// vertex pairs.
//
// Corner values: f's corners at p and n keep their values bit-for-bit, the corner at w takes v's corner values with
// the 'clear' layers cleared (§5.2 "normal.custom cleared on touched corners").
import { kernelError } from '../../../kernel';
import { copyCornerAttributes } from '../../../layers/propagate';
import type { EditMesh } from '../../../types';
import { cornerAt, faceCorners } from './util';

/** Copies every corner layer value from corner `src` to `dst` exactly (no clearing). */
export function copyCornerRaw(m: EditMesh, src: number, dst: number): void {
  if (src === dst) return;
  for (const layer of m.layers()) {
    if (layer.def.domain !== 'corner') continue;
    for (let k = 0; k < layer.def.comps; k++) layer.set(dst, k, layer.get(src, k));
  }
}

/** The corner of face `f` at vertex `v` right after the corner at `after` (−1 if absent). */
function cornerAfter(m: EditMesh, f: number, after: number, v: number): number {
  const c = cornerAt(m, f, after);
  if (c === -1) return -1;
  const next = m.cornerNext(c);
  return m.cornerVert(next) === v ? next : -1;
}

/**
 * Replaces face `f`'s corner at vertex `v` by vertex `w` (see the header). `f` keeps its index; returns false (and
 * writes nothing) when the face has no simple corner at v or w is one of v's neighbours in f.
 */
export function swapCorner(m: EditMesh, f: number, v: number, w: number): boolean {
  const c = cornerAt(m, f, v);
  if (c === -1 || v === w) return false;
  const cp = m.cornerPrev(c);
  const cn = m.cornerNext(c);
  const p = m.cornerVert(cp);
  const n = m.cornerVert(cn);
  if (p === n || p === w || n === w) return false;
  // The face must pass through v once (a face visiting v twice has no single fan corner to move).
  let visits = 0;
  for (const corner of faceCorners(m, f)) if (m.cornerVert(corner) === v) visits++;
  if (visits !== 1) return false;
  const len = m.faceLen(f);
  if (len === 3) {
    swapTriangle(m, f, c, v, w);
    return true;
  }
  if (m.findEdge(p, n) === -1) {
    swapDirect(m, f, c, cp, cn, w);
    return true;
  }
  swapAround(m, f, c, w);
  return true;
}

/** f has ≥ 4 corners and no edge p–n exists. */
function swapDirect(m: EditMesh, f: number, c: number, cp: number, cn: number, w: number): void {
  const p = m.cornerVert(cp);
  const n = m.cornerVert(cn);
  // f keeps the side from n round to p; T = (p, v, n) holds the original corners cp and c.
  const chord = m.splitFaceMakeEdge(f, cn, cp);
  const t = m.cornerFace(c);
  const q = m.makeFace([n, p, w], { example: f });
  const qp = cornerAt(m, q, p);
  const qw = cornerAt(m, q, w);
  copyCornerRaw(m, cp, qp);
  copyCornerAttributes(m, c, qw);
  m.killFace(t);
  const join = m.findEdge(p, n);
  if (join === -1) throw kernelError('mesh-op', `swapCorner: chord ${chord} vanished`);
  m.joinFaceKillEdge(join);
}

/** f is a triangle (p, v, n): split n–p by a temporary vertex, swap directly, dissolve it. */
function swapTriangle(m: EditMesh, f: number, c: number, v: number, w: number): void {
  const cn = m.cornerNext(c);
  const n = m.cornerVert(cn);
  const p = m.cornerVert(m.cornerPrev(c));
  const e = m.findEdge(n, p);
  const x = m.splitEdgeMakeVert(e, 0.5);
  // f = (p, v, n, x); no edge p–n remains.
  const c2 = cornerAt(m, f, v);
  swapDirect(m, f, c2, m.cornerPrev(c2), m.cornerNext(c2), w);
  m.joinEdgeKillVert(x);
  if (cornerAfter(m, f, p, w) === -1) throw kernelError('mesh-op', `swapCorner: triangle ${f} lost its shape`);
}

/** f has ≥ 4 corners and an edge p–n exists elsewhere: cut through a temporary vertex on n's next edge. */
function swapAround(m: EditMesh, f: number, c: number, w: number): void {
  const v = m.cornerVert(c);
  const cn = m.cornerNext(c);
  const n = m.cornerVert(cn);
  const p = m.cornerVert(m.cornerPrev(c));
  const q = m.cornerVert(m.cornerNext(cn));
  const e = m.findEdge(n, q);
  const x = m.splitEdgeMakeVert(e, 0.5);
  // f = (…, p, v, n, x, q, …); cut p–x: f keeps x → … → p, T = (p, v, n, x).
  const cx = cornerAt(m, f, x);
  const cP = m.cornerPrev(cornerAt(m, f, v));
  const cv = cornerAt(m, f, v);
  const cN = m.cornerNext(cv);
  m.splitFaceMakeEdge(f, cx, cP);
  const t = m.cornerFace(cv);
  const g = m.makeFace([x, p, w, n], { example: f });
  copyCornerRaw(m, cP, cornerAt(m, g, p));
  copyCornerAttributes(m, cv, cornerAt(m, g, w));
  copyCornerRaw(m, cN, cornerAt(m, g, n));
  m.killFace(t);
  const join = m.findEdge(p, x);
  m.joinFaceKillEdge(join);
  m.joinEdgeKillVert(x);
}
