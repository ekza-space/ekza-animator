// Symmetry partner maps (M6A-SPEC §5.14, research 13 §5.10): positional Object/World X/Y/Z symmetry.
//
// - Vertices: a vertex within `tolerance` (world metres) of the plane is its own partner (on the seam). Every other
//   vertex is reflected across the plane and matched to the nearest off-seam vertex within `tolerance` of the
//   reflection (integer spatial hash, cell = tolerance in local units; ties to the smaller index). A pair is accepted
//   only when the match is mutual, so the map is an involution (P9); every other vertex gets −1 and counts as
//   `unmatched`.
// - Edges: the edge joining the endpoints' partners (−1 when absent). `edgeReversed` = 1 when the partner edge's
//   `edgeVert(…, 0)` is the partner of this edge's `edgeVert(…, 1)`; `edgeSelf` = 1 for a crossing edge (its
//   endpoints are each other's partners), 2 for an in-seam edge (both endpoints on the seam), 0 otherwise.
// - Faces: the face over the partners' vertex set, matched by sorted vertex tuple (smallest index on duplicates) and
//   accepted when mutual; −1 otherwise.
// The map reads positions and topology only (hidden components have partners like any other); rebuild it after a
// topology commit and, in World mode, after a placement change.
import type { ReadonlyXf } from '@ekza-animator/anim-core';
import { kernelError } from '../kernel';
import type { EditMesh, SymmetryAxis, SymmetryMap } from '../types';
import { PointHash } from './hash';
import { type MirrorSpace, mirrorSpace, planeDistance, planeOffset, reflectPoint, registerMirrorSpace } from './space';

/** Smallest tolerance used for hashing (metres); a zero tolerance matches exact mirrors only. */
const MIN_TOLERANCE = 1e-12;

export interface SymmetryMapOptions {
  readonly axis: SymmetryAxis;
  readonly space: 'object' | 'world';
  readonly placement: ReadonlyXf;
  readonly tolerance: number;
}

export function buildSymmetryMap(m: EditMesh, opts: SymmetryMapOptions): SymmetryMap {
  if (!(opts.tolerance >= 0) || !Number.isFinite(opts.tolerance)) {
    throw kernelError('invalid-argument', `symmetry tolerance must be a finite distance ≥ 0, got ${opts.tolerance}`);
  }
  const space = mirrorSpace(opts);
  const tolerance = opts.tolerance;
  const vertex = vertexPartners(m, space, tolerance);
  const { edge, edgeReversed, edgeSelf } = edgePartners(m, vertex);
  const face = facePartners(m, vertex);
  let unmatched = 0;
  for (let v = 0; v < vertex.length; v++) if (vertex[v] === -1) unmatched++;
  const map: SymmetryMap = Object.freeze({
    axis: opts.axis,
    space: opts.space,
    plane: planeOffset(space),
    tolerance,
    vertex,
    edge,
    edgeReversed,
    edgeSelf,
    face,
    unmatched,
  });
  registerMirrorSpace(map, space);
  return map;
}

function vertexPartners(m: EditMesh, space: MirrorSpace, tolerance: number): Int32Array {
  const n = m.counts.points;
  const pos = m.position;
  const xyz = new Float64Array(3 * n);
  for (let i = 0; i < 3 * n; i++) xyz[i] = pos[i] as number;
  const partner = new Int32Array(n).fill(-1);
  const seam = new Uint8Array(n);
  for (let v = 0; v < n; v++) {
    const d = planeDistance(space, xyz[3 * v] as number, xyz[3 * v + 1] as number, xyz[3 * v + 2] as number);
    if (Math.abs(d) <= tolerance) {
      seam[v] = 1;
      partner[v] = v;
    }
  }
  const tol = Math.max(tolerance, MIN_TOLERANCE);
  const local = tol / space.minScale;
  const hash = new PointHash(xyz, n, local, (i) => seam[i] === 0);
  const nearest = new Int32Array(n).fill(-1);
  const q = new Float64Array(3);
  const [sx, sy, sz] = space.scale;
  for (let v = 0; v < n; v++) {
    if (seam[v] === 1) continue;
    reflectPoint(space, xyz[3 * v] as number, xyz[3 * v + 1] as number, xyz[3 * v + 2] as number, q);
    const qx = q[0] as number;
    const qy = q[1] as number;
    const qz = q[2] as number;
    let best = -1;
    let bestD = Number.POSITIVE_INFINITY;
    hash.near(qx, qy, qz, local, (u) => {
      if (u === v) return;
      const dx = ((xyz[3 * u] as number) - qx) * sx;
      const dy = ((xyz[3 * u + 1] as number) - qy) * sy;
      const dz = ((xyz[3 * u + 2] as number) - qz) * sz;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > tolerance) return;
      if (d < bestD || (d === bestD && u < best)) {
        best = u;
        bestD = d;
      }
    });
    nearest[v] = best;
  }
  for (let v = 0; v < n; v++) {
    if (seam[v] === 1) continue;
    const u = nearest[v] as number;
    if (u >= 0 && nearest[u] === v) partner[v] = u;
  }
  return partner;
}

function edgePartners(
  m: EditMesh,
  vertex: Int32Array,
): { readonly edge: Int32Array; readonly edgeReversed: Uint8Array; readonly edgeSelf: Uint8Array } {
  const n = m.counts.edges;
  const edge = new Int32Array(n).fill(-1);
  const edgeReversed = new Uint8Array(n);
  const edgeSelf = new Uint8Array(n);
  for (let e = 0; e < n; e++) {
    const a = m.edgeVert(e, 0);
    const b = m.edgeVert(e, 1);
    const pa = vertex[a] ?? -1;
    const pb = vertex[b] ?? -1;
    if (pa < 0 || pb < 0) continue;
    const p = m.findEdge(pa, pb);
    if (p < 0) continue;
    edge[e] = p;
    const reversed = m.edgeVert(p, 0) === pb;
    edgeReversed[e] = reversed ? 1 : 0;
    if (p === e) edgeSelf[e] = reversed ? 1 : 2;
  }
  return { edge, edgeReversed, edgeSelf };
}

function facePartners(m: EditMesh, vertex: Int32Array): Int32Array {
  const n = m.counts.faces;
  const best = new Int32Array(n).fill(-1);
  const mine: number[] = [];
  const theirs: number[] = [];
  const sortedOf = (f: number, out: number[], map: Int32Array | null): boolean => {
    out.length = 0;
    const start = m.faceCorner(f);
    let c = start;
    let guard = 0;
    do {
      const v = m.cornerVert(c);
      const w = map === null ? v : (map[v] ?? -1);
      if (w < 0) return false;
      out.push(w);
      c = m.cornerNext(c);
    } while (c !== start && ++guard <= m.counts.corners);
    out.sort((x, y) => x - y);
    return true;
  };
  for (let f = 0; f < n; f++) {
    if (!sortedOf(f, mine, vertex)) continue;
    // Faces around the partner of the first corner's vertex.
    const w = vertex[m.cornerVert(m.faceCorner(f))] as number;
    const first = m.vertEdge(w);
    if (first < 0) continue;
    let found = -1;
    let e = first;
    let guard = 0;
    do {
      const radial = m.edgeCorner(e);
      if (radial >= 0) {
        let c = radial;
        let g2 = 0;
        do {
          const g = m.cornerFace(c);
          if ((found === -1 || g < found) && m.faceLen(g) === mine.length) {
            sortedOf(g, theirs, null);
            let same = true;
            for (let i = 0; i < mine.length; i++) {
              if (mine[i] !== theirs[i]) {
                same = false;
                break;
              }
            }
            if (same) found = g;
          }
          c = m.cornerRadialNext(c);
        } while (c !== radial && ++g2 <= m.counts.corners);
      }
      e = m.edgeDiskNext(e, w);
    } while (e !== first && ++guard <= m.counts.edges);
    best[f] = found;
  }
  const face = new Int32Array(n).fill(-1);
  for (let f = 0; f < n; f++) {
    const g = best[f] as number;
    if (g >= 0 && best[g] === f) face[f] = g;
  }
  return face;
}
