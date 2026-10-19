// Uniform read access to the stored subset of a `MeshData` or an `EditMesh` (derived-data functions accept both), and
// Newell's face normal, the one formula every face normal, triangulation plane and Mesh Check test shares (§5.4).
import { KERNEL_MARKER } from '../kernel';
import type { EditMesh, MeshCounts, MeshData } from '../types';

export interface Topo {
  readonly counts: MeshCounts;
  readonly position: ArrayLike<number>;
  cv(c: number): number;
  cn(c: number): number;
  fc(f: number): number;
  ff(f: number): number;
  ev(e: number, end: 0 | 1): number;
  ef(e: number): number;
}

export function isEditMesh(m: MeshData | EditMesh): m is EditMesh {
  return typeof (m as EditMesh).cornerVert === 'function' && KERNEL_MARKER.length > 0;
}

export function topoOf(m: MeshData | EditMesh): Topo {
  if (isEditMesh(m)) {
    return {
      counts: m.counts,
      position: m.position,
      cv: (c) => m.cornerVert(c),
      cn: (c) => m.cornerNext(c),
      fc: (f) => m.faceCorner(f),
      ff: (f) => m.faceFlags(f),
      ev: (e, end) => m.edgeVert(e, end),
      ef: (e) => m.edgeFlags(e),
    };
  }
  return {
    counts: m.counts,
    position: m.position,
    cv: (c) => m.cornerVert[c] ?? -1,
    cn: (c) => m.cornerNext[c] ?? -1,
    fc: (f) => m.faceCorner[f] ?? -1,
    ff: (f) => m.faceFlags[f] ?? 0,
    ev: (e, end) => m.edgeVerts[2 * e + end] ?? -1,
    ef: (e) => m.edgeFlags[e] ?? 0,
  };
}

/** Newell normal of a face (not normalized), into `out`, in float64. */
export function newell(t: Topo, f: number, out: Float64Array): void {
  newellOf(
    t.position,
    (c) => t.cv(c),
    (c) => t.cn(c),
    t.fc(f),
    t.counts.corners,
    out,
  );
}

/** Newell normal of the corner cycle starting at `start` (not normalized), into `out`, in float64. */
export function newellOf(
  p: ArrayLike<number>,
  cv: (c: number) => number,
  cn: (c: number) => number,
  start: number,
  maxCorners: number,
  out: Float64Array,
): void {
  let x = 0;
  let y = 0;
  let z = 0;
  let c = start;
  let guard = 0;
  do {
    const next = cn(c);
    const a = 3 * cv(c);
    const b = 3 * cv(next);
    const ax = p[a] as number;
    const ay = p[a + 1] as number;
    const az = p[a + 2] as number;
    const bx = p[b] as number;
    const by = p[b + 1] as number;
    const bz = p[b + 2] as number;
    x += (ay - by) * (az + bz);
    y += (az - bz) * (ax + bx);
    z += (ax - bx) * (ay + by);
    c = next;
  } while (c !== start && ++guard <= maxCorners);
  out[0] = x;
  out[1] = y;
  out[2] = z;
}
