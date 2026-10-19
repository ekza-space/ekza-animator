// The pointer rule (M6A-SPEC §5.14): how a point `{edge, t}` picked by a tool (Multi-Cut, Insert Edge Loop seeds,
// Slide rails) maps to its mirror image.
// - An ordinary edge maps to its partner edge at `t` (same orientation) or `1 − t` (`edgeReversed`).
// - A **crossing** edge (`edgeSelf` 1: its endpoints are each other's partners) maps `t ↦ 1 − t`; a point within
//   `tolerance` of the plane is one point, snapped onto the plane at the edge's crossing parameter `t*` (where the plane
//   cuts the edge; 0.5 only when the plane bisects it).
// - An **in-seam** edge (`edgeSelf` 2: both endpoints on the seam) maps `t ↦ t` and is never snapped.
// Vertex picks map to partner vertices.
import { kernelError } from '../kernel';
import type { EditMesh, SymmetryMap } from '../types';
import { mirrorSpaceOf, planeDistance } from './space';

function checkEdge(m: EditMesh, map: SymmetryMap, edge: number): void {
  if (!Number.isInteger(edge) || edge < 0 || edge >= m.counts.edges) {
    throw kernelError('out-of-range', `edge ${edge} is outside 0…${m.counts.edges - 1}`);
  }
  if (map.edge.length !== m.counts.edges) {
    throw kernelError('symmetry-stale', `the symmetry map has ${map.edge.length} edges, the mesh ${m.counts.edges}`);
  }
}

/** Signed plane distances (world metres) of an edge's two endpoints. */
function endDistances(m: EditMesh, map: SymmetryMap, edge: number): readonly [number, number] {
  const space = mirrorSpaceOf(map);
  const p = m.position;
  const a = 3 * m.edgeVert(edge, 0);
  const b = 3 * m.edgeVert(edge, 1);
  return [
    planeDistance(space, p[a] as number, p[a + 1] as number, p[a + 2] as number),
    planeDistance(space, p[b] as number, p[b + 1] as number, p[b + 2] as number),
  ];
}

/**
 * The crossing parameter `t*` of an edge (measured from `edgeVert(edge, 0)`): where the mirror plane cuts it, or null
 * when both endpoints lie on the same side (or the edge lies in the plane).
 */
export function crossingParameter(m: EditMesh, map: SymmetryMap, edge: number): number | null {
  checkEdge(m, map, edge);
  const [da, db] = endDistances(m, map, edge);
  if (da === db) return null;
  const t = da / (da - db);
  return t >= 0 && t <= 1 ? t : null;
}

/** §5.14 pointer rule. `self: true` = the mapped point is the same point. null = the edge has no partner. */
export function mirrorEdgePoint(
  m: EditMesh,
  map: SymmetryMap,
  p: { readonly edge: number; readonly t: number },
): { readonly edge: number; readonly t: number; readonly self: boolean } | null {
  checkEdge(m, map, p.edge);
  const partner = map.edge[p.edge] as number;
  if (partner < 0) return null;
  const kind = map.edgeSelf[p.edge] as number;
  if (kind === 2) return Object.freeze({ edge: p.edge, t: p.t, self: true });
  if (kind === 1) {
    const [da, db] = endDistances(m, map, p.edge);
    const d = da + p.t * (db - da);
    if (Math.abs(d) <= map.tolerance && da !== db) {
      return Object.freeze({ edge: p.edge, t: Math.min(1, Math.max(0, da / (da - db))), self: true });
    }
    return Object.freeze({ edge: p.edge, t: 1 - p.t, self: false });
  }
  return Object.freeze({ edge: partner, t: map.edgeReversed[p.edge] === 1 ? 1 - p.t : p.t, self: false });
}

/** A vertex pick's mirror: the partner vertex (itself on the seam), or −1 when it has none. */
export function mirrorVertex(map: SymmetryMap, v: number): number {
  return map.vertex[v] ?? -1;
}
