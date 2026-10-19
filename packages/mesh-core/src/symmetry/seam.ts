// Seam helpers every symmetric op shares (M6A-SPEC §5.14 seam rules):
// - the source side of a mirrored pair: the element whose centroid lies on the positive side of the plane;
// - symmetrizing a region that is its own mirror: each vertex and its partner set to the mean of p and S·p(partner),
//   seam vertices projected onto the plane;
// - Preserve Seam: seam vertices stay on the plane; an op that would pull one off refuses with `symmetry.seam`.
import { kernelError } from '../kernel';
import { refuse } from '../refusal';
import type { ComponentKind, EditMesh, Refusal, SymmetryMap } from '../types';
import { type MirrorSpace, mirrorSpaceOf, planeDistance, projectOntoPlane, reflectPoint } from './space';

/** Signed world distance (metres) of vertex `v` to the plane. */
export function vertexPlaneDistance(m: EditMesh, space: MirrorSpace, v: number): number {
  const p = m.position;
  return planeDistance(space, p[3 * v] as number, p[3 * v + 1] as number, p[3 * v + 2] as number);
}

/** Signed world distance of an element's centroid (vertex position, edge midpoint, face vertex mean) to the plane. */
export function centroidPlaneDistance(m: EditMesh, space: MirrorSpace, kind: ComponentKind, index: number): number {
  if (kind === 'vertex') return vertexPlaneDistance(m, space, index);
  if (kind === 'edge') {
    return (
      0.5 * (vertexPlaneDistance(m, space, m.edgeVert(index, 0)) + vertexPlaneDistance(m, space, m.edgeVert(index, 1)))
    );
  }
  if (kind !== 'face') throw kernelError('invalid-argument', `component kind must be vertex, edge or face`);
  const start = m.faceCorner(index);
  let c = start;
  let sum = 0;
  let n = 0;
  do {
    sum += vertexPlaneDistance(m, space, m.cornerVert(c));
    n++;
    c = m.cornerNext(c);
  } while (c !== start && n <= m.counts.corners);
  return sum / n;
}

/**
 * True when `index` is the source of its mirrored pair (§5.14 "keep: 'positive'"): its centroid lies on the positive
 * side, or it is its own partner, or it has none. Its partner then uses the reflected frame S·F.
 */
export function isSourceOfPair(m: EditMesh, map: SymmetryMap, kind: ComponentKind, index: number): boolean {
  const partners = kind === 'vertex' ? map.vertex : kind === 'edge' ? map.edge : map.face;
  const p = partners[index] ?? -1;
  if (p < 0 || p === index) return true;
  const space = mirrorSpaceOf(map);
  const mine = centroidPlaneDistance(m, space, kind, index);
  const theirs = centroidPlaneDistance(m, space, kind, p);
  return mine > theirs || (mine === theirs && index < p);
}

/**
 * Symmetrizes vertices of a region that is its own mirror (§5.14): each vertex v with partner u is set to the mean of
 * p(v) and S·p(u), and u to the mirror of that; a vertex that is its own partner is projected onto the plane; a vertex
 * without a partner (−1) keeps its position. `partner` may be a map's vertex array or a per-op lookup (new vertices).
 * Writes go through `setPosition`, inside the caller's open transaction.
 */
export function symmetrizeVertices(
  m: EditMesh,
  verts: ArrayLike<number>,
  partner: ArrayLike<number> | ((v: number) => number),
  space: MirrorSpace,
): void {
  const lookup =
    typeof partner === 'function' ? partner : (v: number): number => (partner[v] as number | undefined) ?? -1;
  const done = new Set<number>();
  const p = m.position;
  const s = new Float64Array(3);
  for (let i = 0; i < verts.length; i++) {
    const v = verts[i] as number;
    if (done.has(v)) continue;
    done.add(v);
    const u = lookup(v);
    if (u < 0) continue;
    if (u === v) {
      projectOntoPlane(space, p[3 * v] as number, p[3 * v + 1] as number, p[3 * v + 2] as number, s);
      m.setPosition(v, s[0] as number, s[1] as number, s[2] as number);
      continue;
    }
    if (done.has(u)) continue;
    done.add(u);
    reflectPoint(space, p[3 * u] as number, p[3 * u + 1] as number, p[3 * u + 2] as number, s);
    const x = 0.5 * ((p[3 * v] as number) + (s[0] as number));
    const y = 0.5 * ((p[3 * v + 1] as number) + (s[1] as number));
    const z = 0.5 * ((p[3 * v + 2] as number) + (s[2] as number));
    m.setPosition(v, x, y, z);
    reflectPoint(space, x, y, z, s);
    m.setPosition(u, s[0] as number, s[1] as number, s[2] as number);
  }
}

/** The §5.14 seam refusal ("This would pull the centre line off the mirror plane"). */
export function seamRefusal(): Refusal {
  return refuse('symmetry.seam', 'This would pull the centre line off the mirror plane');
}

/**
 * With Preserve Seam: the first of `verts` (seam vertices of the map the op ran with) that now lies farther than the
 * map's tolerance from the plane, or −1. Ops call it after their writes and refuse with `seamRefusal()` when ≥ 0.
 */
export function seamViolation(m: EditMesh, map: SymmetryMap, verts: ArrayLike<number>): number {
  const space = mirrorSpaceOf(map);
  for (let i = 0; i < verts.length; i++) {
    const v = verts[i] as number;
    if (Math.abs(vertexPlaneDistance(m, space, v)) > map.tolerance) return v;
  }
  return -1;
}

/** Seam vertices of a map (vertices that are their own partner), ascending. */
export function seamVertices(map: SymmetryMap): Uint32Array {
  const out: number[] = [];
  for (let v = 0; v < map.vertex.length; v++) if (map.vertex[v] === v) out.push(v);
  return Uint32Array.from(out);
}
