// Symmetry partner maps (M6A-SPEC §5.14, research 13 §5.10): positional Object/World X/Y/Z symmetry.
//
// - Vertices: a vertex within `tolerance` (world metres) of the plane is its own partner (on the seam). Every other
//   vertex is reflected across the plane and matched to the nearest off-seam vertex within `tolerance` of the
//   reflection (integer spatial hash, cell = tolerance in local units; ties to the smaller index). A pair is accepted
//   only when the match is mutual, so the map is an involution (P9). Coincident vertices then pair among themselves:
//   the still unmatched ones match the nearest unmatched candidate (mutual), and two pairs of a coincident group swap
//   when that pairs more neighbours (M6A-INT-49). Every other vertex gets −1 and counts as `unmatched`.
// - Edges: the edge joining the endpoints' partners (−1 when absent). `edgeReversed` = 1 when the partner edge's
//   `edgeVert(…, 0)` is the partner of this edge's `edgeVert(…, 1)`; `edgeSelf` = 1 for a crossing edge (its
//   endpoints are each other's partners), 2 for an in-seam edge (both endpoints on the seam), 0 otherwise.
// - Faces: the face over the partners' vertex set, matched by sorted vertex tuple (smallest index on duplicates) and
//   accepted when mutual; −1 otherwise.
// The map reads positions and topology only (hidden components have partners like any other); rebuild it after a
// topology commit and, in World mode, after a placement change.
import type { ReadonlyXf } from '@ekza-studio/anim-core';
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
  /** The off-seam vertices within the tolerance of v's reflection (ascending index). */
  const candidates = (v: number): number[] => {
    reflectPoint(space, xyz[3 * v] as number, xyz[3 * v + 1] as number, xyz[3 * v + 2] as number, q);
    const qx = q[0] as number;
    const qy = q[1] as number;
    const qz = q[2] as number;
    const out: number[] = [];
    hash.near(qx, qy, qz, local, (u) => {
      if (u === v) return;
      const dx = ((xyz[3 * u] as number) - qx) * sx;
      const dy = ((xyz[3 * u + 1] as number) - qy) * sy;
      const dz = ((xyz[3 * u + 2] as number) - qz) * sz;
      if (Math.sqrt(dx * dx + dy * dy + dz * dz) <= tolerance) out.push(u);
    });
    return out.sort((a, b) => a - b);
  };
  // Coincident vertices (a V-snap, a merge left for later): every vertex of a coincident group has the group's first
  // mirror as its nearest, so only one pair is mutual. The rest pair among themselves: the unmatched vertices take the
  // nearest unmatched candidate, accepted when mutual (M6A-INT-49).
  const rest = new Int32Array(n).fill(-1);
  let ambiguous = false;
  for (let v = 0; v < n; v++) {
    if (seam[v] === 1 || partner[v] !== -1 || nearest[v] === -1) continue;
    ambiguous = true;
    reflectPoint(space, xyz[3 * v] as number, xyz[3 * v + 1] as number, xyz[3 * v + 2] as number, q);
    let best = -1;
    let bestD = Number.POSITIVE_INFINITY;
    for (const u of candidates(v)) {
      if (partner[u] !== -1) continue;
      const dx = ((xyz[3 * u] as number) - (q[0] as number)) * sx;
      const dy = ((xyz[3 * u + 1] as number) - (q[1] as number)) * sy;
      const dz = ((xyz[3 * u + 2] as number) - (q[2] as number)) * sz;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < bestD) {
        best = u;
        bestD = d;
      }
    }
    rest[v] = best;
  }
  if (!ambiguous) return partner;
  for (let v = 0; v < n; v++) {
    const u = rest[v] as number;
    if (u >= 0 && rest[u] === v) partner[v] = u;
  }
  untangleCoincident(m, partner, candidates);
  return partner;
}

/**
 * Within a coincident group the pairing by index can cross the topology (a's mirror is b′, not a′): swap two pairs
 * (v↔u, w↔x → v↔x, w↔u) when both new pairs are within the tolerance and more of their neighbours' partners are
 * neighbours (the edges and faces then pair too). Runs only on vertices with several candidates.
 */
function untangleCoincident(m: EditMesh, partner: Int32Array, candidates: (v: number) => number[]): void {
  const neighbours = (v: number): number[] => {
    const out: number[] = [];
    const first = m.vertEdge(v);
    if (first === -1) return out;
    let e = first;
    do {
      out.push(m.edgeOther(e, v));
      e = m.edgeDiskNext(e, v);
    } while (e !== first && e !== -1);
    return out;
  };
  const score = (v: number, u: number): number => {
    let s = 0;
    for (const w of neighbours(v)) {
      const p = partner[w] as number;
      if (p >= 0 && p !== u && m.findEdge(p, u) >= 0) s++;
    }
    return s;
  };
  for (let v = 0; v < partner.length; v++) {
    const u = partner[v] as number;
    if (u < 0 || u === v) continue;
    const list = candidates(v);
    if (list.length < 2) continue;
    for (const x of list) {
      if (x === u) continue;
      const w = partner[x] as number;
      if (w < 0 || w === x || w === v || w === u) continue;
      if (!candidates(w).includes(u)) continue;
      if (score(v, x) + score(w, u) > score(v, u) + score(w, x)) {
        partner[v] = x;
        partner[x] = v;
        partner[w] = u;
        partner[u] = w;
        break;
      }
    }
  }
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
  const maxCorners = m.counts.corners;
  const best = new Int32Array(n).fill(-1);
  // `stamp[w] = f` marks the partner vertex set of face f; `seen` counts a candidate's distinct vertices.
  const stamp = new Int32Array(m.counts.points).fill(-1);
  const seen = new Int32Array(m.counts.points).fill(-1);
  let token = 0;
  const mine: number[] = [];
  const theirs: number[] = [];
  const sortedOf = (f: number, out: number[], map: Int32Array | null): void => {
    out.length = 0;
    const start = m.faceCorner(f);
    let c = start;
    let guard = 0;
    do {
      const v = m.cornerVert(c);
      out.push(map === null ? v : (map[v] as number));
      c = m.cornerNext(c);
    } while (c !== start && ++guard <= maxCorners);
    out.sort((x, y) => x - y);
  };
  for (let f = 0; f < n; f++) {
    // The partner vertex set of f (any vertex without a partner: f has none).
    const start = m.faceCorner(f);
    let c = start;
    let len = 0;
    let distinct = 0;
    let complete = true;
    let guard = 0;
    do {
      const w = vertex[m.cornerVert(c)] as number;
      if (w < 0) {
        complete = false;
        break;
      }
      len++;
      if (stamp[w] !== f) {
        stamp[w] = f;
        distinct++;
      }
      c = m.cornerNext(c);
    } while (c !== start && ++guard <= maxCorners);
    if (!complete) continue;
    // A face visiting a vertex twice compares sorted tuples (multiplicities matter); others compare vertex sets.
    const repeated = distinct !== len;
    if (repeated) sortedOf(f, mine, vertex);
    const w0 = vertex[m.cornerVert(start)] as number;
    const first = m.vertEdge(w0);
    if (first < 0) continue;
    let found = -1;
    let e = first;
    let g1 = 0;
    do {
      const radial = m.edgeCorner(e);
      if (radial >= 0) {
        let r = radial;
        let g2 = 0;
        do {
          const g = m.cornerFace(r);
          if ((found === -1 || g < found) && m.faceLen(g) === len) {
            let same = true;
            if (repeated) {
              sortedOf(g, theirs, null);
              for (let i = 0; i < len && same; i++) same = mine[i] === theirs[i];
            } else {
              token++;
              let count = 0;
              const gs = m.faceCorner(g);
              let k = gs;
              let g3 = 0;
              do {
                const u = m.cornerVert(k);
                if (stamp[u] !== f) {
                  same = false;
                  break;
                }
                if (seen[u] !== token) {
                  seen[u] = token;
                  count++;
                }
                k = m.cornerNext(k);
              } while (k !== gs && ++g3 <= maxCorners);
              same = same && count === len;
            }
            if (same) found = g;
          }
          r = m.cornerRadialNext(r);
        } while (r !== radial && ++g2 <= maxCorners);
      }
      e = m.edgeDiskNext(e, w0);
    } while (e !== first && ++g1 <= m.counts.edges);
    best[f] = found;
  }
  const face = new Int32Array(n).fill(-1);
  for (let f = 0; f < n; f++) {
    const g = best[f] as number;
    if (g >= 0 && best[g] === f) face[f] = g;
  }
  return face;
}
