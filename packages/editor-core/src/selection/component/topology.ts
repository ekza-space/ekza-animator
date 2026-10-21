// Small topology reads of the selection service over the kernel's edit links (M6A-SPEC §4.3 EditMesh traversal, §5.6):
// the faces a selection touches (hide, face isolate) and the hidden closure (the edges and vertices that only hidden
// faces use are hidden with them, the rule mesh-view draws with, M6A-B6-6). Allocation is per call, never per frame.
import type { BitSet, ComponentKind, EditMesh, HiddenSet } from '@ekza-studio/mesh-core';
import type { MeshKernel } from '../../mesh';

/** Calls `fn` with every corner of face `f`, in winding order. */
export function forEachFaceCorner(m: EditMesh, f: number, fn: (c: number) => void): void {
  const first = m.faceCorner(f);
  if (first < 0) return;
  let c = first;
  let guard = m.counts.corners + 1;
  do {
    fn(c);
    c = m.cornerNext(c);
  } while (c !== first && c >= 0 && --guard > 0);
}

/** Calls `fn` with every face around edge `e` (radial cycle). */
export function forEachEdgeFace(m: EditMesh, e: number, fn: (f: number) => void): void {
  const first = m.edgeCorner(e);
  if (first < 0) return;
  let c = first;
  let guard = m.counts.corners + 1;
  do {
    fn(m.cornerFace(c));
    c = m.cornerRadialNext(c);
  } while (c !== first && c >= 0 && --guard > 0);
}

/** Calls `fn` with every edge at vertex `v` (disk cycle). */
export function forEachVertEdge(m: EditMesh, v: number, fn: (e: number) => void): void {
  const first = m.vertEdge(v);
  if (first < 0) return;
  let e = first;
  let guard = m.counts.edges + 1;
  do {
    fn(e);
    e = m.edgeDiskNext(e, v);
  } while (e !== first && e >= 0 && --guard > 0);
}

/**
 * The faces a set of `kind` touches: faces themselves, faces using a vertex of the set, faces bounded by an edge of
 * the set (Maya converts a component hide to faces).
 */
export function facesTouching(kernel: MeshKernel, m: EditMesh, kind: ComponentKind, set: BitSet): BitSet {
  const faces = new kernel.BitSet(m.counts.faces);
  if (kind === 'face') {
    set.forEach((f) => {
      if (f < faces.size) faces.add(f);
    });
    return faces;
  }
  for (let f = 0; f < m.counts.faces; f++) {
    let hit = false;
    forEachFaceCorner(m, f, (c) => {
      if (hit) return;
      hit = kind === 'vertex' ? set.has(m.cornerVert(c)) : set.has(m.cornerEdge(c));
    });
    if (hit) faces.add(f);
  }
  return faces;
}

/**
 * The hidden set the service hands out: the explicit sets plus every edge whose faces are all hidden (edges with no
 * face are hidden only explicitly) and every vertex whose edges are all hidden.
 */
export function hiddenClosure(
  m: EditMesh | null,
  explicit: { readonly vertex: BitSet; readonly edge: BitSet; readonly face: BitSet },
): HiddenSet {
  const verts = explicit.vertex.clone();
  const edges = explicit.edge.clone();
  const faces = explicit.face.clone();
  if (m === null || faces.isEmpty() || faces.size !== m.counts.faces) return { verts, edges, faces };
  if (edges.size === m.counts.edges) {
    for (let e = 0; e < m.counts.edges; e++) {
      if (edges.has(e) || m.edgeFaceCount(e) === 0) continue;
      let all = true;
      forEachEdgeFace(m, e, (f) => {
        if (all && !faces.has(f)) all = false;
      });
      if (all) edges.add(e);
    }
  }
  if (verts.size === m.counts.points && edges.size === m.counts.edges) {
    for (let v = 0; v < m.counts.points; v++) {
      if (verts.has(v) || m.vertEdge(v) < 0) continue;
      let all = true;
      forEachVertEdge(m, v, (e) => {
        if (all && !edges.has(e)) all = false;
      });
      if (all) verts.add(v);
    }
  }
  return { verts, edges, faces };
}
