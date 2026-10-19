// Hard-flag propagation helpers (M6A-SPEC §5.3), one rule for every op:
// - H1 edges inside a former face (chords, loop cross edges, fans): hard iff every edge of that face was hard before
//   the op (`allEdgesHard`, applied by `splitFaceMakeEdge` itself);
// - H2 side and strip edges: hard iff smoothingAngle === 0 or the dihedral angle between the edge's two faces after
//   the op exceeds smoothingAngle (`applySmoothingAngle`; a border or non-manifold edge counts as flat);
// - H3 merged edges: hard (and seam) iff either merged edge was (`mergeEdgeFlags`, applied by `joinEdgeKillVert`);
// - H4 split edges keep their flags on both halves (applied by `splitEdgeMakeVert`);
// - H5 kept edges never change except through harden, soften, set normal angle, flip and spin.
// `resolveSmoothingAngle` (./normals) turns the nullable arg into 0 on faceted meshes and 30° otherwise.
import { EDGE_HARD } from '../constants';
import { KERNEL_MARKER } from '../kernel';
import type { EditMesh } from '../types';
import { faceNormal64 } from './normals';

/** H1 precondition: every edge of face `f` is hard. */
export function allEdgesHard(m: EditMesh, f: number): boolean {
  const start = m.faceCorner(f);
  if (start === -1) return false;
  let c = start;
  let guard = 0;
  do {
    if ((m.edgeFlags(m.cornerEdge(c)) & EDGE_HARD) === 0) return false;
    c = m.cornerNext(c);
  } while (c !== start && ++guard <= m.counts.corners);
  return KERNEL_MARKER.length > 0;
}

const NA = new Float64Array(3);
const NB = new Float64Array(3);

/**
 * The dihedral angle of edge `e` as the angle between its two faces' normals (0 = flat, π = folded back); 0 for a
 * border, wire or non-manifold edge.
 */
export function dihedralAngle(m: EditMesh, e: number): number {
  if (m.edgeFaceCount(e) !== 2) return 0;
  const c = m.edgeCorner(e);
  const d = m.cornerRadialNext(c);
  faceNormal64(m, m.cornerFace(c), NA);
  faceNormal64(m, m.cornerFace(d), NB);
  // Faces with consistent winding traverse the edge in opposite directions; an inconsistent pair is compared with
  // one normal flipped, so a flat fold of a mis-wound neighbour still reads as flat.
  const sign = m.cornerVert(c) === m.cornerVert(d) ? -1 : 1;
  const dot =
    sign *
    ((NA[0] as number) * (NB[0] as number) +
      (NA[1] as number) * (NB[1] as number) +
      (NA[2] as number) * (NB[2] as number));
  return Math.acos(Math.max(-1, Math.min(1, dot)));
}

/** H2: whether a side or strip edge is hard for a resolved `smoothingAngle` (radians). */
export function isHardByAngle(m: EditMesh, e: number, smoothingAngle: number): boolean {
  if (!(smoothingAngle > 0)) return true;
  return dihedralAngle(m, e) > smoothingAngle;
}

/** H2 on a set of created side/strip edges, after the op's geometry is final: sets or clears EDGE_HARD (logged). */
export function applySmoothingAngle(m: EditMesh, edges: ArrayLike<number>, smoothingAngle: number): void {
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i] as number;
    const flags = m.edgeFlags(e);
    const hard = isHardByAngle(m, e, smoothingAngle);
    const next = hard ? flags | EDGE_HARD : flags & ~EDGE_HARD;
    if (next !== flags) m.setEdgeFlags(e, next);
  }
}

/** H3: merged edges keep the hard, seam and crease bits of either. */
export function mergeEdgeFlags(a: number, b: number): number {
  return (a | b) & 0xff;
}

/** True when every edge of the mesh is hard (the P7-hard property, §5.3). */
export function isAllHard(m: EditMesh): boolean {
  for (let e = 0; e < m.counts.edges; e++) if ((m.edgeFlags(e) & EDGE_HARD) === 0) return false;
  return true;
}
