// The symmetry pieces the B4 ops need (M6A-SPEC §5.14): the plane of a `SymmetryMap`, the source-side rule, the
// unmatched-partner warning, the pointer rule for `{edge, t}` points, a partner expansion for the pointer-class ops
// (Multi-Cut, Slide expand their own selections; the runtime expands only 'expand'-class ops) and a vertex-partner
// builder for Symmetrize when no map is given. B2 owns `buildSymmetryMap`, `expandSelection` and `mirrorEdgePoint`
// (§4.3); these helpers follow the same rules on a map the caller passes, so the B4 ops work and are tested before B2
// merges. `test/ops/symmetry.test.ts` checks them against B2's functions once `READY.b2` holds (M6A-B4-2).
import type {
  ComponentKind,
  ComponentSelection,
  EditMesh,
  OpContext,
  OpWarning,
  SymmetryAxis,
  SymmetryMap,
} from '../types';
import type { BitSet } from '../bitset';

export function axisIndex(axis: SymmetryAxis): 0 | 1 | 2 {
  return axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
}

/** Signed distance of vertex `v` from the map's plane (mesh-local units; > 0 = the positive side). */
export function vertexSide(m: EditMesh, map: SymmetryMap, v: number): number {
  return (m.position[3 * v + axisIndex(map.axis)] as number) - map.plane;
}

/** The mirror image of a coordinate along the map's axis. */
export function mirrorCoord(map: SymmetryMap, x: number): number {
  return 2 * map.plane - x;
}

/** The mirror image of a point (in place). */
export function mirrorPoint(map: SymmetryMap, p: Float64Array | number[]): void {
  const k = axisIndex(map.axis);
  p[k] = mirrorCoord(map, p[k] as number);
}

function partnerArray(map: SymmetryMap, kind: ComponentKind): Int32Array {
  return kind === 'vertex' ? map.vertex : kind === 'edge' ? map.edge : map.face;
}

/** The partner of a component (−1 none; itself on the seam). */
export function partnerOf(map: SymmetryMap, kind: ComponentKind, i: number): number {
  const array = partnerArray(map, kind);
  return i >= 0 && i < array.length ? (array[i] as number) : -1;
}

/** §5.14 unmatched partners: the warning every op attaches when selected components had no mirror partner. */
export function unmatchedWarning(count: number, elements?: ArrayLike<number>): OpWarning {
  return {
    code: 'symmetry.unmatched-partner',
    message: 'No mirror partner: applied to one side',
    count,
    ...(elements !== undefined ? { elements: Uint32Array.from(elements) } : {}),
  };
}

/**
 * The unmatched-partner warning of an 'expand'-class run: the selected components of `sel.kind` whose partner is −1
 * (the runtime expanded the selection; these stayed on their own side). Null without symmetry or when all matched.
 */
export function expandWarnings(sel: ComponentSelection | null, ctx: OpContext): OpWarning[] {
  const map = ctx.symmetry?.map;
  if (map === undefined || sel === null) return [];
  const set = sel.kind === 'vertex' ? sel.verts : sel.kind === 'edge' ? sel.edges : sel.faces;
  const unmatched: number[] = [];
  set.forEach((i) => {
    if (partnerOf(map, sel.kind, i) === -1) unmatched.push(i);
  });
  return unmatched.length === 0 ? [] : [unmatchedWarning(unmatched.length, unmatched)];
}

/**
 * The selection plus every matched partner (§5.14 expansion for the pointer-class ops, which the runtime does not
 * expand), with the components that had none.
 */
export function expandWithPartners(
  sel: ComponentSelection,
  map: SymmetryMap,
): { readonly selection: ComponentSelection; readonly unmatched: number[] } {
  const verts = sel.verts.clone();
  const edges = sel.edges.clone();
  const faces = sel.faces.clone();
  const unmatched: number[] = [];
  const grow = (set: BitSet, kind: ComponentKind, track: boolean): void => {
    const add: number[] = [];
    set.forEach((i) => {
      const p = partnerOf(map, kind, i);
      if (p >= 0 && p < set.size) add.push(p);
      else if (track && p === -1) unmatched.push(i);
    });
    for (const p of add) set.add(p);
  };
  grow(verts, 'vertex', sel.kind === 'vertex');
  grow(edges, 'edge', sel.kind === 'edge');
  grow(faces, 'face', sel.kind === 'face');
  return { selection: { kind: sel.kind, verts, edges, faces, order: sel.order, active: sel.active }, unmatched };
}

/** The parameter where the plane crosses edge `e` (§5.14 `t*`), or null when it does not cross it. */
export function crossingT(m: EditMesh, map: SymmetryMap, e: number): number | null {
  const d0 = vertexSide(m, map, m.edgeVert(e, 0));
  const d1 = vertexSide(m, map, m.edgeVert(e, 1));
  if (d0 === d1) return null;
  const t = d0 / (d0 - d1);
  return t >= 0 && t <= 1 ? t : null;
}

/**
 * §5.14 pointer rule for a point `{edge, t}`: ordinary edges map to their partner (t or 1 − t by `edgeReversed`); a
 * crossing edge maps t ↦ 1 − t, and a point within tolerance of the plane is one point snapped onto the plane at the
 * crossing parameter t*; an in-seam edge maps t ↦ t and never snaps. Null when the edge has no partner. Same contract
 * as B2's `mirrorEdgePoint`.
 */
export function mirrorEdgePointOf(
  m: EditMesh,
  map: SymmetryMap,
  p: { readonly edge: number; readonly t: number },
): { readonly edge: number; readonly t: number; readonly self: boolean } | null {
  const partner = partnerOf(map, 'edge', p.edge);
  if (partner === -1) return null;
  const kind = map.edgeSelf[p.edge] ?? 0;
  if (kind === 2) return { edge: p.edge, t: p.t, self: true };
  if (kind === 1) {
    const d0 = vertexSide(m, map, m.edgeVert(p.edge, 0));
    const d1 = vertexSide(m, map, m.edgeVert(p.edge, 1));
    const d = d0 + (d1 - d0) * p.t;
    if (Math.abs(d) <= map.tolerance && d0 !== d1) return { edge: p.edge, t: d0 / (d0 - d1), self: true };
    return { edge: p.edge, t: 1 - p.t, self: false };
  }
  return { edge: partner, t: (map.edgeReversed[p.edge] ?? 0) === 1 ? 1 - p.t : p.t, self: false };
}

/**
 * Vertex partners by the §5.14 rule (reflect across the plane, the nearest vertex within `tolerance` in an integer
 * spatial hash, ties to the smaller index, mutual matches only; a vertex within tolerance of the plane is its own
 * partner). Symmetrize builds this when the mode is off or on another axis.
 */
export function vertexPartners(
  m: EditMesh,
  axis: SymmetryAxis,
  plane: number,
  tolerance: number,
): { readonly partner: Int32Array; readonly unmatched: number } {
  const P = m.counts.points;
  const p = m.position;
  const k = axisIndex(axis);
  const tol = Math.max(tolerance, 1e-12);
  const cell = tol;
  const key = (x: number, y: number, z: number): string =>
    `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  const buckets = new Map<string, number[]>();
  for (let v = 0; v < P; v++) {
    const id = key(p[3 * v] as number, p[3 * v + 1] as number, p[3 * v + 2] as number);
    const list = buckets.get(id);
    if (list === undefined) buckets.set(id, [v]);
    else list.push(v);
  }
  const nearest = new Int32Array(P).fill(-1);
  const q = [0, 0, 0];
  for (let v = 0; v < P; v++) {
    q[0] = p[3 * v] as number;
    q[1] = p[3 * v + 1] as number;
    q[2] = p[3 * v + 2] as number;
    if (Math.abs((q[k] as number) - plane) <= tol) {
      nearest[v] = v;
      continue;
    }
    q[k] = 2 * plane - (q[k] as number);
    const cx = Math.floor(q[0] / cell);
    const cy = Math.floor(q[1] / cell);
    const cz = Math.floor(q[2] / cell);
    let best = -1;
    let bestD = Number.POSITIVE_INFINITY;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const list = buckets.get(`${cx + dx},${cy + dy},${cz + dz}`);
          if (list === undefined) continue;
          for (const w of list) {
            if (w === v) continue;
            const ex = (p[3 * w] as number) - q[0];
            const ey = (p[3 * w + 1] as number) - q[1];
            const ez = (p[3 * w + 2] as number) - q[2];
            const d = Math.sqrt(ex * ex + ey * ey + ez * ez);
            if (d > tol) continue;
            if (d < bestD || (d === bestD && w < best)) {
              best = w;
              bestD = d;
            }
          }
        }
      }
    }
    nearest[v] = best;
  }
  const partner = new Int32Array(P).fill(-1);
  let unmatched = 0;
  for (let v = 0; v < P; v++) {
    const w = nearest[v] as number;
    if (w === v) partner[v] = v;
    else if (w >= 0 && nearest[w] === v) partner[v] = w;
    else unmatched++;
  }
  return { partner, unmatched };
}
