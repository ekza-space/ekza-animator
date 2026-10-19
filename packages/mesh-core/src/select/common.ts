// Shared pieces of the selection walkers (M6A-SPEC §5.6): hidden tests, adjacency iteration over the edit links and
// the construction of result selections. Results never share bitsets with their input (walkers are pure).
import { BitSet } from '../bitset';
import { kernelError } from '../kernel';
import type { ComponentKind, ComponentSelection, EditMesh, HiddenSet } from '../types';

export type Hidden = HiddenSet | null | undefined;

export const hiddenVert = (hidden: Hidden, v: number): boolean => hidden?.verts.has(v) === true;
export const hiddenEdge = (hidden: Hidden, e: number): boolean => hidden?.edges.has(e) === true;
export const hiddenFace = (hidden: Hidden, f: number): boolean => hidden?.faces.has(f) === true;

export function isHidden(hidden: Hidden, kind: ComponentKind, i: number): boolean {
  return kind === 'vertex' ? hiddenVert(hidden, i) : kind === 'edge' ? hiddenEdge(hidden, i) : hiddenFace(hidden, i);
}

export function countOf(m: EditMesh, kind: ComponentKind): number {
  return kind === 'vertex' ? m.counts.points : kind === 'edge' ? m.counts.edges : m.counts.faces;
}

export function checkKind(kind: ComponentKind): void {
  if (kind !== 'vertex' && kind !== 'edge' && kind !== 'face') {
    throw kernelError('invalid-argument', `component kind must be vertex, edge or face, got ${String(kind)}`);
  }
}

/** Throws `out-of-range` (a caller error) for an index outside the mesh. */
export function checkIndex(m: EditMesh, kind: ComponentKind, i: number): void {
  checkKind(kind);
  const n = countOf(m, kind);
  if (!Number.isInteger(i) || i < 0 || i >= n) {
    throw kernelError('out-of-range', `${kind} ${i} is outside 0…${n - 1}`);
  }
}

export function setOf(sel: ComponentSelection, kind: ComponentKind): BitSet {
  return kind === 'vertex' ? sel.verts : kind === 'edge' ? sel.edges : sel.faces;
}

/** Calls fn for every edge in v's disk cycle (canonical order: ascending index). */
export function forEachVertEdge(m: EditMesh, v: number, fn: (e: number) => void): void {
  const first = m.vertEdge(v);
  if (first < 0) return;
  let e = first;
  let guard = 0;
  do {
    fn(e);
    e = m.edgeDiskNext(e, v);
  } while (e !== first && e >= 0 && ++guard <= m.counts.edges);
}

/** Calls fn for every corner in e's radial cycle (one per face side). */
export function forEachEdgeCorner(m: EditMesh, e: number, fn: (c: number) => void): void {
  const first = m.edgeCorner(e);
  if (first < 0) return;
  let c = first;
  let guard = 0;
  do {
    fn(c);
    c = m.cornerRadialNext(c);
  } while (c !== first && c >= 0 && ++guard <= m.counts.corners);
}

/** Calls fn for every corner of face f in winding order. */
export function forEachFaceCorner(m: EditMesh, f: number, fn: (c: number) => void): void {
  const first = m.faceCorner(f);
  if (first < 0) return;
  let c = first;
  let guard = 0;
  do {
    fn(c);
    c = m.cornerNext(c);
  } while (c !== first && c >= 0 && ++guard <= m.counts.corners);
}

/** Calls fn for every face using vertex v (a face may come more than once). */
export function forEachVertFace(m: EditMesh, v: number, fn: (f: number) => void): void {
  forEachVertEdge(m, v, (e) => {
    forEachEdgeCorner(m, e, (c) => {
      if (m.cornerVert(c) === v) fn(m.cornerFace(c));
    });
  });
}

/** The other edge of face cornerFace(c) at vertex v, where c owns an edge that has v as an endpoint. */
export function otherEdgeAt(m: EditMesh, c: number, v: number): number {
  return m.cornerVert(c) === v ? m.cornerEdge(m.cornerPrev(c)) : m.cornerEdge(m.cornerNext(c));
}

/** The corner of edge e in a face other than f, or −1 (border or the face runs e twice). */
export function cornerInOtherFace(m: EditMesh, e: number, f: number): number {
  let found = -1;
  forEachEdgeCorner(m, e, (c) => {
    if (found < 0 && m.cornerFace(c) !== f) found = c;
  });
  return found;
}

/** The corner of face f that owns edge e (cornerEdge(c) = e), or −1. */
export function cornerOfEdgeInFace(m: EditMesh, e: number, f: number): number {
  let found = -1;
  forEachEdgeCorner(m, e, (c) => {
    if (found < 0 && m.cornerFace(c) === f) found = c;
  });
  return found;
}

/** A fresh bitset of the mesh's size for `kind`, holding the visible members of `set` (indices below the size). */
export function visibleCopy(m: EditMesh, set: BitSet, kind: ComponentKind, hidden: Hidden): BitSet {
  const out = new BitSet(countOf(m, kind));
  set.forEach((i) => {
    if (i < out.size && !isHidden(hidden, kind, i)) out.add(i);
  });
  return out;
}

/** A bitset of `size` sized for the mesh, re-sized copy of `set` (members beyond the size dropped). */
export function sizedClone(set: BitSet, size: number): BitSet {
  const out = set.clone();
  if (out.size !== size) out.resize(size);
  return out;
}

/**
 * The result selection: `kind`'s bitset replaced by `set`, the other kinds cloned (resized to the mesh), and the pick
 * order rebuilt: the previous order filtered to members still selected, then `appended` (members not yet in it), with
 * `active` moved to the end when it is selected. `active` −1 picks the last of the order (−1 when empty).
 */
export function resultSelection(
  m: EditMesh,
  sel: ComponentSelection,
  kind: ComponentKind,
  set: BitSet,
  appended: ArrayLike<number>,
  active: number,
): ComponentSelection {
  const order: number[] = [];
  const seen = new Set<number>();
  const push = (i: number): void => {
    if (seen.has(i) || !set.has(i)) return;
    seen.add(i);
    order.push(i);
  };
  if (sel.kind === kind && sel.order !== null) for (const i of sel.order) if (i !== active) push(i);
  for (let k = 0; k < appended.length; k++) if (appended[k] !== active) push(appended[k] as number);
  if (active >= 0) push(active);
  // Members the order does not name yet (a per-mode memory without order) keep ascending order before the picks.
  let full = order;
  if (order.length < set.count()) {
    const missing: number[] = [];
    set.forEach((i) => {
      if (!seen.has(i)) missing.push(i);
    });
    full = missing.concat(order);
  }
  const lead = active >= 0 && set.has(active) ? active : full.length === 0 ? -1 : (full.at(-1) as number);
  return Object.freeze({
    kind,
    verts: kind === 'vertex' ? set : sizedClone(sel.verts, m.counts.points),
    edges: kind === 'edge' ? set : sizedClone(sel.edges, m.counts.edges),
    faces: kind === 'face' ? set : sizedClone(sel.faces, m.counts.faces),
    order: full.length === 0 ? null : Uint32Array.from(full),
    active: lead,
  });
}

/** The pick order of `kind` in a selection (filtered to members), ascending members when it has none. */
export function orderOf(sel: ComponentSelection, kind: ComponentKind): number[] {
  const set = setOf(sel, kind);
  const out: number[] = [];
  if (sel.kind === kind && sel.order !== null) {
    for (const i of sel.order) if (set.has(i)) out.push(i);
    return out;
  }
  set.forEach((i) => {
    out.push(i);
  });
  return out;
}
