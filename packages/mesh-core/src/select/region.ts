// Grow, shrink and convert (M6A-SPEC §5.6, research 10 §4.1). Hidden components are never added, never count as
// neighbours and never carry a flood fill. Each function changes only the bitset of the kind it returns; the other
// kinds' per-mode memory is copied.
//
// - Grow adds every visible component sharing a vertex with the selection (vertices: across edges and faces, the
//   default face step of common DCCs). Shrink removes the selected components that share a vertex with a visible
//   unselected component of the same kind.
// - Convert "touching" selects the components touching the selection (the usual DCC default), "contained" only those
//   fully inside it (edges with both ends, faces with every vertex or edge selected).
// - "perimeter": the boundary of the selected face region (faces: the selection; edges and vertices: the faces they
//   contain) — edges with exactly one region face, their vertices, or the region faces along them.
// - "border": the complete mesh-border loops (edges with one face) touching the selection.
// - "shell": every component of the pieces (flood fill over visible edges) touching the selection.
// - "loop" / "ring": the edge loops / rings of the selection's edges (vertices: the edges between selected vertices;
//   faces: the edges of the selected faces), then converted touching.
import { BitSet } from '../bitset';
import { kernelError } from '../kernel';
import type { ComponentKind, ComponentSelection, ConvertMode, EditMesh, HiddenSet } from '../types';
import {
  checkKind,
  countOf,
  forEachEdgeCorner,
  forEachFaceCorner,
  forEachVertEdge,
  forEachVertFace,
  type Hidden,
  hiddenEdge,
  hiddenFace,
  hiddenVert,
  isHidden,
  orderOf,
  resultSelection,
  setOf,
  visibleCopy,
} from './common';
import { edgeLoopWalk, edgeRingWalk } from './loops';

/** Visible neighbours of a component in the grow relation (sharing a vertex; vertices: across edges and faces). */
function forEachNeighbour(m: EditMesh, kind: ComponentKind, i: number, hidden: Hidden, fn: (j: number) => void): void {
  if (kind === 'vertex') {
    forEachVertEdge(m, i, (e) => {
      if (hiddenEdge(hidden, e)) return;
      const u = m.edgeOther(e, i);
      if (!hiddenVert(hidden, u)) fn(u);
    });
    forEachVertFace(m, i, (f) => {
      if (hiddenFace(hidden, f)) return;
      forEachFaceCorner(m, f, (c) => {
        const u = m.cornerVert(c);
        if (u !== i && !hiddenVert(hidden, u)) fn(u);
      });
    });
    return;
  }
  const verts: number[] = [];
  if (kind === 'edge') verts.push(m.edgeVert(i, 0), m.edgeVert(i, 1));
  else forEachFaceCorner(m, i, (c) => verts.push(m.cornerVert(c)));
  for (const v of verts) {
    if (kind === 'edge') {
      forEachVertEdge(m, v, (e) => {
        if (e !== i && !hiddenEdge(hidden, e)) fn(e);
      });
    } else {
      forEachVertFace(m, v, (f) => {
        if (f !== i && !hiddenFace(hidden, f)) fn(f);
      });
    }
  }
}

export function growSelection(m: EditMesh, sel: ComponentSelection, hidden?: HiddenSet | null): ComponentSelection {
  const kind = sel.kind;
  checkKind(kind);
  const source = setOf(sel, kind);
  const set = visibleCopy(m, source, kind, null);
  const added: number[] = [];
  const n = countOf(m, kind);
  source.forEach((i) => {
    if (i >= n || isHidden(hidden, kind, i)) return;
    forEachNeighbour(m, kind, i, hidden, (j) => {
      if (set.has(j)) return;
      set.add(j);
      added.push(j);
    });
  });
  added.sort((a, b) => a - b);
  return resultSelection(m, sel, kind, set, added, sel.kind === kind ? sel.active : -1);
}

export function shrinkSelection(m: EditMesh, sel: ComponentSelection, hidden?: HiddenSet | null): ComponentSelection {
  const kind = sel.kind;
  checkKind(kind);
  const source = setOf(sel, kind);
  const set = visibleCopy(m, source, kind, null);
  const n = countOf(m, kind);
  const drop: number[] = [];
  source.forEach((i) => {
    if (i >= n || isHidden(hidden, kind, i)) return;
    let edge = false;
    forEachNeighbour(m, kind, i, hidden, (j) => {
      if (!source.has(j)) edge = true;
    });
    if (edge) drop.push(i);
  });
  for (const i of drop) set.delete(i);
  return resultSelection(m, sel, kind, set, [], sel.kind === kind && set.has(sel.active) ? sel.active : -1);
}

// ---------- convert ----------

/** Visible vertices touching the selection. */
function touchingVerts(m: EditMesh, kind: ComponentKind, source: BitSet, hidden: Hidden): BitSet {
  const out = new BitSet(m.counts.points);
  const add = (v: number): void => {
    if (!hiddenVert(hidden, v)) out.add(v);
  };
  source.forEach((i) => {
    if (kind === 'vertex') add(i);
    else if (kind === 'edge') {
      add(m.edgeVert(i, 0));
      add(m.edgeVert(i, 1));
    } else forEachFaceCorner(m, i, (c) => add(m.cornerVert(c)));
  });
  return out;
}

/** Converts a visible source set of `from` to `to` (touching or contained). */
function convertBasic(
  m: EditMesh,
  from: ComponentKind,
  source: BitSet,
  to: ComponentKind,
  contained: boolean,
  hidden: Hidden,
): BitSet {
  if (from === to) return source.clone();
  const out = new BitSet(countOf(m, to));
  if (to === 'vertex') return touchingVerts(m, from, source, hidden);
  if (to === 'edge') {
    if (from === 'face') {
      source.forEach((f) =>
        forEachFaceCorner(m, f, (c) => {
          const e = m.cornerEdge(c);
          if (!hiddenEdge(hidden, e)) out.add(e);
        }),
      );
      return out;
    }
    // vertex → edge
    source.forEach((v) =>
      forEachVertEdge(m, v, (e) => {
        if (hiddenEdge(hidden, e)) return;
        if (!contained || source.has(m.edgeOther(e, v))) out.add(e);
      }),
    );
    return out;
  }
  // → face
  const candidates = new Set<number>();
  if (from === 'vertex') source.forEach((v) => forEachVertFace(m, v, (f) => candidates.add(f)));
  else source.forEach((e) => forEachEdgeCorner(m, e, (c) => candidates.add(m.cornerFace(c))));
  for (const f of candidates) {
    if (hiddenFace(hidden, f)) continue;
    if (contained) {
      let all = true;
      forEachFaceCorner(m, f, (c) => {
        if (!source.has(from === 'vertex' ? m.cornerVert(c) : m.cornerEdge(c))) all = false;
      });
      if (!all) continue;
    }
    out.add(f);
  }
  return out;
}

/** Faces of the selected region: the faces themselves, or the faces fully contained in a vertex/edge selection. */
function regionFaces(m: EditMesh, kind: ComponentKind, source: BitSet, hidden: Hidden): BitSet {
  return kind === 'face' ? source.clone() : convertBasic(m, kind, source, 'face', true, hidden);
}

function perimeter(m: EditMesh, kind: ComponentKind, source: BitSet, to: ComponentKind, hidden: Hidden): BitSet {
  const region = regionFaces(m, kind, source, hidden);
  const edges = new BitSet(m.counts.edges);
  region.forEach((f) =>
    forEachFaceCorner(m, f, (c) => {
      const e = m.cornerEdge(c);
      let inside = 0;
      forEachEdgeCorner(m, e, (r) => {
        if (region.has(m.cornerFace(r))) inside++;
      });
      if (inside === 1 && !hiddenEdge(hidden, e)) edges.add(e);
    }),
  );
  if (to === 'edge') return edges;
  if (to === 'vertex') return touchingVerts(m, 'edge', edges, hidden);
  const faces = new BitSet(m.counts.faces);
  region.forEach((f) =>
    forEachFaceCorner(m, f, (c) => {
      if (edges.has(m.cornerEdge(c))) faces.add(f);
    }),
  );
  return faces;
}

function border(m: EditMesh, kind: ComponentKind, source: BitSet, to: ComponentKind, hidden: Hidden): BitSet {
  const verts = touchingVerts(m, kind, source, hidden);
  const edges = new BitSet(m.counts.edges);
  verts.forEach((v) =>
    forEachVertEdge(m, v, (e) => {
      if (edges.has(e) || hiddenEdge(hidden, e) || m.edgeFaceCount(e) !== 1) return;
      for (const b of edgeLoopWalk(m, e, hidden).items) edges.add(b);
    }),
  );
  return fromEdges(m, edges, to, hidden);
}

function shell(m: EditMesh, kind: ComponentKind, source: BitSet, to: ComponentKind, hidden: Hidden): BitSet {
  const verts = touchingVerts(m, kind, source, hidden);
  const stack: number[] = [];
  verts.forEach((v) => stack.push(v));
  while (stack.length > 0) {
    const v = stack.pop() as number;
    forEachVertEdge(m, v, (e) => {
      if (hiddenEdge(hidden, e)) return;
      const u = m.edgeOther(e, v);
      if (verts.has(u) || hiddenVert(hidden, u)) return;
      verts.add(u);
      stack.push(u);
    });
  }
  if (to === 'vertex') return verts;
  return convertBasic(m, 'vertex', verts, to, false, hidden);
}

/** An edge set converted to `to` (touching), visible members only. */
function fromEdges(m: EditMesh, edges: BitSet, to: ComponentKind, hidden: Hidden): BitSet {
  if (to === 'edge') return edges;
  return convertBasic(m, 'edge', edges, to, false, hidden);
}

function loopsOrRings(
  m: EditMesh,
  kind: ComponentKind,
  source: BitSet,
  to: ComponentKind,
  ring: boolean,
  hidden: Hidden,
): BitSet {
  const seeds = kind === 'edge' ? source : convertBasic(m, kind, source, 'edge', true, hidden);
  const edges = new BitSet(m.counts.edges);
  seeds.forEach((e) => {
    if (edges.has(e)) return;
    const walk = ring ? edgeRingWalk(m, e, hidden) : edgeLoopWalk(m, e, hidden);
    for (const x of walk.items) edges.add(x);
  });
  return fromEdges(m, edges, to, hidden);
}

export function convertSelection(
  m: EditMesh,
  sel: ComponentSelection,
  to: ComponentKind,
  mode: ConvertMode,
  hidden?: HiddenSet | null,
): ComponentSelection {
  const kind = sel.kind;
  checkKind(kind);
  checkKind(to);
  const source = visibleCopy(m, setOf(sel, kind), kind, hidden);
  let set: BitSet;
  switch (mode) {
    case 'touching':
      set = convertBasic(m, kind, source, to, false, hidden);
      break;
    case 'contained':
      set = convertBasic(m, kind, source, to, true, hidden);
      break;
    case 'perimeter':
      set = perimeter(m, kind, source, to, hidden);
      break;
    case 'border':
      set = border(m, kind, source, to, hidden);
      break;
    case 'shell':
      set = shell(m, kind, source, to, hidden);
      break;
    case 'loop':
      set = loopsOrRings(m, kind, source, to, false, hidden);
      break;
    case 'ring':
      set = loopsOrRings(m, kind, source, to, true, hidden);
      break;
    default:
      throw kernelError(
        'invalid-argument',
        `convert mode ${String(mode)} is not one of touching, contained, perimeter, border, shell, loop, ring`,
      );
  }
  // The same kind keeps its pick order (members still selected first); a new kind starts in ascending order.
  const appended = kind === to ? orderOf(sel, kind) : [];
  return resultSelection(m, sel, to, set, appended, kind === to && set.has(sel.active) ? sel.active : -1);
}
