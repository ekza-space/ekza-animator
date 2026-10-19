// Loop and ring walkers (M6A-SPEC §5.6, research 10 §4.1, research 13 §5.14).
//
// - Edge loop: through an interior vertex only when it is manifold with valence 4 and its four faces are quads (the
//   loop continues through the edge that shares no face with the incoming one); along the border through vertices
//   with exactly two border edges; it stops at poles, triangles, n-gons, non-manifold edges, hidden components or
//   where it started (a closed loop). Wire and non-manifold seeds are a loop of one.
// - Edge ring: across quads to the opposite edge; stops at borders, non-quads, non-manifold edges, hidden components
//   or the start.
// - Face loop: the quads crossed by the ring through the shared edge; a vertex loop: the vertices of an edge loop.
// - Partial loops: the shorter arc between two components of one loop (ties: the arc that starts in the direction
//   of the reference edge's `edgeVert(e, 1)`, of `along` for vertices, of `across` for faces).
// Results are ordered along the loop. A closed loop starts at the seed and runs towards `edgeVert(seed, 1)` (edges),
// along `along` (vertices) or across `across` (faces); an open one runs from its backward end to its forward end.
import { kernelError } from '../kernel';
import type { ComponentKind, EditMesh, HiddenSet } from '../types';
import {
  checkIndex,
  cornerInOtherFace,
  cornerOfEdgeInFace,
  forEachEdgeCorner,
  forEachFaceCorner,
  forEachVertEdge,
  type Hidden,
  hiddenEdge,
  hiddenFace,
  hiddenVert,
  otherEdgeAt,
} from './common';

/** A walked loop: its members in order, and whether it closes on itself. */
export interface Walk {
  readonly items: readonly number[];
  readonly closed: boolean;
}

const EMPTY: Walk = Object.freeze({ items: Object.freeze([]), closed: false });
const one = (i: number): Walk => Object.freeze({ items: Object.freeze([i]), closed: false });

/** The loop's next edge after `cur` at its interior vertex `v`, or −1 where the loop stops. */
function interiorNext(m: EditMesh, cur: number, v: number, hidden: Hidden): number {
  if (hiddenVert(hidden, v) || m.vertValence(v) !== 4) return -1;
  let quads = true;
  forEachVertEdge(m, v, (e) => {
    if (m.edgeFaceCount(e) !== 2) quads = false;
    else
      forEachEdgeCorner(m, e, (c) => {
        if (m.faceLen(m.cornerFace(c)) !== 4) quads = false;
      });
  });
  if (!quads || !m.isManifoldVert(v)) return -1;
  const c0 = m.edgeCorner(cur);
  const f0 = m.cornerFace(c0);
  const e1 = otherEdgeAt(m, c0, v);
  const c1 = cornerInOtherFace(m, e1, f0);
  if (c1 < 0) return -1;
  const e2 = otherEdgeAt(m, c1, v);
  if (e2 < 0 || e2 === cur || e2 === e1) return -1;
  // The continuing edge shares no face with the incoming one.
  let shared = false;
  forEachEdgeCorner(m, e2, (a) => {
    forEachEdgeCorner(m, cur, (b) => {
      if (m.cornerFace(a) === m.cornerFace(b)) shared = true;
    });
  });
  if (shared || hiddenEdge(hidden, e2)) return -1;
  return e2;
}

/** The border loop's next edge after `cur` at `v` (exactly two border edges there), or −1. */
function borderNext(m: EditMesh, cur: number, v: number, hidden: Hidden): number {
  if (hiddenVert(hidden, v)) return -1;
  let count = 0;
  let other = -1;
  forEachVertEdge(m, v, (e) => {
    if (m.edgeFaceCount(e) !== 1) return;
    count++;
    if (e !== cur) other = e;
  });
  if (count !== 2 || other < 0 || hiddenEdge(hidden, other)) return -1;
  return other;
}

/** The edge loop through `e` (see the module comment). */
export function edgeLoopWalk(m: EditMesh, e: number, hidden?: HiddenSet | null): Walk {
  checkIndex(m, 'edge', e);
  if (hiddenEdge(hidden, e)) return EMPTY;
  const faces = m.edgeFaceCount(e);
  if (faces === 0 || faces > 2) return one(e);
  const step = faces === 1 ? borderNext : interiorNext;
  const seen = new Set<number>([e]);
  const walk = (start: number): { readonly items: number[]; readonly closed: boolean } => {
    const items: number[] = [];
    let cur = e;
    let v = start;
    for (;;) {
      const next = step(m, cur, v, hidden);
      if (next < 0) return { items, closed: false };
      if (next === e) return { items, closed: true };
      if (seen.has(next)) return { items, closed: false };
      seen.add(next);
      items.push(next);
      v = m.edgeOther(next, v);
      cur = next;
    }
  };
  const forward = walk(m.edgeVert(e, 1));
  if (forward.closed) return Object.freeze({ items: Object.freeze([e, ...forward.items]), closed: true });
  const backward = walk(m.edgeVert(e, 0));
  return Object.freeze({ items: Object.freeze([...backward.items.reverse(), e, ...forward.items]), closed: false });
}

/** The edge ring through `e`. */
export function edgeRingWalk(m: EditMesh, e: number, hidden?: HiddenSet | null): Walk {
  checkIndex(m, 'edge', e);
  if (hiddenEdge(hidden, e)) return EMPTY;
  const faces = m.edgeFaceCount(e);
  if (faces === 0 || faces > 2) return one(e);
  const seen = new Set<number>([e]);
  const walk = (corner: number): { readonly items: number[]; readonly closed: boolean } => {
    const items: number[] = [];
    let c = corner;
    for (;;) {
      const f = m.cornerFace(c);
      if (hiddenFace(hidden, f) || m.faceLen(f) !== 4) return { items, closed: false };
      const next = m.cornerEdge(m.cornerNext(m.cornerNext(c)));
      if (next === e) return { items, closed: true };
      if (seen.has(next) || hiddenEdge(hidden, next)) return { items, closed: false };
      seen.add(next);
      items.push(next);
      if (m.edgeFaceCount(next) !== 2) return { items, closed: false };
      c = cornerInOtherFace(m, next, f);
      if (c < 0) return { items, closed: false };
    }
  };
  const c0 = m.edgeCorner(e);
  const forward = walk(c0);
  if (forward.closed) return Object.freeze({ items: Object.freeze([e, ...forward.items]), closed: true });
  const backward = faces === 2 ? walk(m.cornerRadialNext(c0)) : { items: [], closed: false };
  return Object.freeze({ items: Object.freeze([...backward.items.reverse(), e, ...forward.items]), closed: false });
}

/** The face loop through `f` across its edge `across` (the quads the ring through `across` crosses). */
export function faceLoopWalk(m: EditMesh, f: number, across: number, hidden?: HiddenSet | null): Walk {
  checkIndex(m, 'face', f);
  checkIndex(m, 'edge', across);
  if (hiddenFace(hidden, f)) return EMPTY;
  const cf = cornerOfEdgeInFace(m, across, f);
  if (cf < 0) return one(f);
  const seen = new Set<number>([f]);
  const walk = (edge: number): { readonly items: number[]; readonly closed: boolean } => {
    const items: number[] = [];
    let cur = f;
    let e = edge;
    for (;;) {
      if (m.edgeFaceCount(e) !== 2) return { items, closed: false };
      const c = cornerInOtherFace(m, e, cur);
      if (c < 0) return { items, closed: false };
      const g = m.cornerFace(c);
      if (g === f) return { items, closed: true };
      if (seen.has(g) || hiddenFace(hidden, g) || m.faceLen(g) !== 4) return { items, closed: false };
      seen.add(g);
      items.push(g);
      e = m.cornerEdge(m.cornerNext(m.cornerNext(c)));
      cur = g;
    }
  };
  const forward = walk(across);
  if (forward.closed) return Object.freeze({ items: Object.freeze([f, ...forward.items]), closed: true });
  if (m.faceLen(f) !== 4) return Object.freeze({ items: Object.freeze([f, ...forward.items]), closed: false });
  const backward = walk(m.cornerEdge(m.cornerNext(m.cornerNext(cf))));
  return Object.freeze({ items: Object.freeze([...backward.items.reverse(), f, ...forward.items]), closed: false });
}

/** The vertex loop through `v` along its edge `along` (the vertices of the edge loop through `along`). */
export function vertexLoopWalk(m: EditMesh, v: number, along: number, hidden?: HiddenSet | null): Walk {
  checkIndex(m, 'vertex', v);
  checkIndex(m, 'edge', along);
  if (hiddenVert(hidden, v)) return EMPTY;
  const a0 = m.edgeVert(along, 0);
  const a1 = m.edgeVert(along, 1);
  if (a0 !== v && a1 !== v) return one(v);
  const loop = edgeLoopWalk(m, along, hidden);
  if (loop.items.length === 0) return one(v);
  const verts: number[] = [];
  if (loop.closed) {
    // Edges [along, e1, …, ek] run from a0 to a1 and on; start at v, first along `along`.
    const chain: number[] = [a0];
    let cur = a0;
    for (let i = 0; i < loop.items.length - 1; i++) {
      cur = m.edgeOther(loop.items[i] as number, cur);
      chain.push(cur);
    }
    if (v === a0) verts.push(...chain);
    else verts.push(a1, a0, ...chain.slice(2).reverse());
  } else {
    const items = loop.items;
    let start = m.edgeVert(items[0] as number, 0);
    if (items.length > 1) {
      const e0 = items[0] as number;
      const e1 = items[1] as number;
      const shared = m.edgeVert(e0, 0) === m.edgeVert(e1, 0) || m.edgeVert(e0, 0) === m.edgeVert(e1, 1) ? 0 : 1;
      start = m.edgeVert(e0, shared === 0 ? 1 : 0);
    }
    let cur = start;
    verts.push(cur);
    for (const e of items) {
      cur = m.edgeOther(e, cur);
      verts.push(cur);
    }
  }
  const visible = verts.filter((u) => !hiddenVert(hidden, u));
  return Object.freeze({ items: Object.freeze(visible), closed: loop.closed && visible.length === verts.length });
}

/** Edge loop through `e`, ordered (§4.3). */
export function edgeLoop(m: EditMesh, e: number, hidden?: HiddenSet | null): Uint32Array {
  return Uint32Array.from(edgeLoopWalk(m, e, hidden).items);
}

/** Edge ring through `e`, ordered. */
export function edgeRing(m: EditMesh, e: number, hidden?: HiddenSet | null): Uint32Array {
  return Uint32Array.from(edgeRingWalk(m, e, hidden).items);
}

/** Vertex loop through `v` along the edge `along` at v, ordered. */
export function vertexLoop(m: EditMesh, v: number, along: number, hidden?: HiddenSet | null): Uint32Array {
  return Uint32Array.from(vertexLoopWalk(m, v, along, hidden).items);
}

/** Face loop through `f` across its edge `across`, ordered. */
export function faceLoop(m: EditMesh, f: number, across: number, hidden?: HiddenSet | null): Uint32Array {
  return Uint32Array.from(faceLoopWalk(m, f, across, hidden).items);
}

/** The loops of `kind` through component `a` (edges: one; vertices: one per edge at a; faces: one per edge of a). */
export function loopsThrough(m: EditMesh, a: number, kind: ComponentKind, hidden?: HiddenSet | null): Walk[] {
  if (kind === 'edge') return [edgeLoopWalk(m, a, hidden)];
  const walks: Walk[] = [];
  if (kind === 'vertex') {
    checkIndex(m, 'vertex', a);
    forEachVertEdge(m, a, (e) => {
      walks.push(vertexLoopWalk(m, a, e, hidden));
    });
    return walks;
  }
  if (kind !== 'face') throw kernelError('invalid-argument', `component kind must be vertex, edge or face`);
  checkIndex(m, 'face', a);
  forEachFaceCorner(m, a, (c) => {
    walks.push(faceLoopWalk(m, a, m.cornerEdge(c), hidden));
  });
  return walks;
}

/** The arc of a walk from member index `ia` to `ib` (the shorter way round a closed walk; ties forward). */
export function arcOf(walk: Walk, ia: number, ib: number): number[] {
  const items = walk.items;
  const n = items.length;
  const out: number[] = [];
  if (!walk.closed) {
    const step = ib >= ia ? 1 : -1;
    for (let i = ia; ; i += step) {
      out.push(items[i] as number);
      if (i === ib) break;
    }
    return out;
  }
  const forward = (ib - ia + n) % n;
  const backward = n - forward;
  const step = forward <= backward ? 1 : -1;
  for (let i = ia; ; i = (i + step + n) % n) {
    out.push(items[i] as number);
    if (i === ib) break;
  }
  return out;
}

/**
 * The partial loop from `a` to `b` (inclusive, ordered from a): the shorter arc of a loop through both, choosing
 * among a's loops (vertices, faces) the one with the shortest arc (ties: the first in disk/corner order); null when
 * no loop through a contains b.
 */
export function partialLoop(
  m: EditMesh,
  a: number,
  b: number,
  kind: ComponentKind,
  hidden?: HiddenSet | null,
): Uint32Array | null {
  checkIndex(m, kind, a);
  checkIndex(m, kind, b);
  let best: number[] | null = null;
  for (const walk of loopsThrough(m, a, kind, hidden)) {
    const ia = walk.items.indexOf(a);
    const ib = walk.items.indexOf(b);
    if (ia < 0 || ib < 0) continue;
    const arc = arcOf(walk, ia, ib);
    if (best === null || arc.length < best.length) best = arc;
  }
  return best === null ? null : Uint32Array.from(best);
}
