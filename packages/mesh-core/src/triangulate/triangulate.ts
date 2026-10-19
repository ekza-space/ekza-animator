// The one triangulation (M6A-SPEC §5.4): what the viewport draws, picking hits, the HUD counts, Mesh Check reads and
// export writes.
// - Triangles as they are.
// - Quads split along the shorter diagonal (float64 lengths; a tie within 1e-12 × the longer length goes to the
//   diagonal containing the smaller vertex index), inverted by FACE_FLIP_DIAGONAL; a concave quad (the chosen
//   diagonal's triangles disagree in orientation with the face's Newell normal) always takes the other diagonal.
// - n-gons by earcut on the projection that drops the largest component of the Newell normal, every triangle turned
//   to the face's winding; when earcut returns fewer than n − 2 triangles the face falls back to a fan from its first
//   corner (Mesh Check reports `ngon-degenerate`, `isDegenerateNgon`).
// - Triangles are emitted in face order, CCW; every face yields exactly n − 2 triangles, so the arrays are sized
//   C − 2F up front.
// Incremental: with a `cache` of the same face layout and a list of dirty faces, only those faces are recomputed
// (the list is valid for edits that kept the counts and corner cycles — positions, flags; a topology edit passes
// 'all'); a cache whose layout no longer matches is ignored.
import earcut from 'earcut';
import { FACE_FLIP_DIAGONAL } from '../constants';
import { newell, type Topo, topoOf } from '../core/access';
import { kernelError } from '../kernel';
import type { EditMesh, MeshData, Triangulation } from '../types';

const normal = new Float64Array(3);

function dist(p: ArrayLike<number>, a: number, b: number): number {
  const dx = (p[3 * a] as number) - (p[3 * b] as number);
  const dy = (p[3 * a + 1] as number) - (p[3 * b + 1] as number);
  const dz = (p[3 * a + 2] as number) - (p[3 * b + 2] as number);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Dot of the triangle (a, b, c) normal with `n` (positions by vertex index). */
function orientation(p: ArrayLike<number>, a: number, b: number, c: number, n: Float64Array): number {
  const ux = (p[3 * b] as number) - (p[3 * a] as number);
  const uy = (p[3 * b + 1] as number) - (p[3 * a + 1] as number);
  const uz = (p[3 * b + 2] as number) - (p[3 * a + 2] as number);
  const vx = (p[3 * c] as number) - (p[3 * a] as number);
  const vy = (p[3 * c + 1] as number) - (p[3 * a + 1] as number);
  const vz = (p[3 * c + 2] as number) - (p[3 * a + 2] as number);
  return (
    (uy * vz - uz * vy) * (n[0] as number) +
    (uz * vx - ux * vz) * (n[1] as number) +
    (ux * vy - uy * vx) * (n[2] as number)
  );
}

/** The corners of a face in cycle order. */
function faceCorners(t: Topo, f: number, out: number[]): number[] {
  out.length = 0;
  const start = t.fc(f);
  let c = start;
  do {
    out.push(c);
    c = t.cn(c);
  } while (c !== start && out.length <= t.counts.corners);
  return out;
}

type Emit = (a: number, b: number, c: number) => void;

function quad(t: Topo, f: number, c: readonly number[], emit: Emit): void {
  const p = t.position;
  const [c0, c1, c2, c3] = c as [number, number, number, number];
  const v0 = t.cv(c0);
  const v1 = t.cv(c1);
  const v2 = t.cv(c2);
  const v3 = t.cv(c3);
  const l0 = dist(p, v0, v2);
  const l1 = dist(p, v1, v3);
  let first: boolean; // true: diagonal c0–c2
  if (Math.abs(l0 - l1) <= 1e-12 * Math.max(l0, l1)) first = Math.min(v0, v2) < Math.min(v1, v3);
  else first = l0 < l1;
  if ((t.ff(f) & FACE_FLIP_DIAGONAL) !== 0) first = !first;
  newell(t, f, normal);
  const concave = first
    ? orientation(p, v0, v1, v2, normal) < 0 || orientation(p, v0, v2, v3, normal) < 0
    : orientation(p, v1, v2, v3, normal) < 0 || orientation(p, v1, v3, v0, normal) < 0;
  if (concave) first = !first;
  if (first) {
    emit(c0, c1, c2);
    emit(c0, c2, c3);
  } else {
    emit(c1, c2, c3);
    emit(c1, c3, c0);
  }
}

/** earcut over the dominant-plane projection; null when it returns fewer than n − 2 triangles. */
function earcutFace(t: Topo, f: number, c: readonly number[]): number[] | null {
  const p = t.position;
  newell(t, f, normal);
  const ax = Math.abs(normal[0] as number);
  const ay = Math.abs(normal[1] as number);
  const az = Math.abs(normal[2] as number);
  // Drop the largest component: (u, v) are the other two axes.
  const u = ax >= ay && ax >= az ? 1 : ay >= az ? 2 : 0;
  const v = ax >= ay && ax >= az ? 2 : ay >= az ? 0 : 1;
  const flat = new Float64Array(c.length * 2);
  for (let i = 0; i < c.length; i++) {
    const vertex = t.cv(c[i] as number);
    flat[2 * i] = p[3 * vertex + u] as number;
    flat[2 * i + 1] = p[3 * vertex + v] as number;
  }
  const indices = earcut(flat);
  return indices.length / 3 < c.length - 2 ? null : indices;
}

function ngon(t: Topo, f: number, c: readonly number[], emit: Emit): void {
  const indices = earcutFace(t, f, c);
  if (indices === null) {
    for (let i = 1; i + 1 < c.length; i++) emit(c[0] as number, c[i] as number, c[i + 1] as number);
    return;
  }
  const p = t.position;
  for (let i = 0; i < indices.length; i += 3) {
    const a = c[indices[i] as number] as number;
    let b = c[indices[i + 1] as number] as number;
    let d = c[indices[i + 2] as number] as number;
    if (orientation(p, t.cv(a), t.cv(b), t.cv(d), normal) < 0) [b, d] = [d, b];
    emit(a, b, d);
  }
}

/** True when the n-gon `f` (n > 4) falls back to a fan because earcut could not triangulate it (§5.4, §5.25). */
export function isDegenerateNgon(m: MeshData | EditMesh, f: number): boolean {
  const t = topoOf(m);
  const c = faceCorners(t, f, []);
  return c.length > 4 && earcutFace(t, f, c) === null;
}

/** Triangles of face `f` written into `tris` from triangle `at` (corner indices × 3, CCW). */
function triangulateFace(
  t: Topo,
  f: number,
  corners: number[],
  tris: Uint32Array,
  triFace: Uint32Array,
  at: number,
): void {
  const c = faceCorners(t, f, corners);
  if (c.length < 3) throw kernelError('invalid-mesh', `triangulate: face ${f} has ${c.length} corners`);
  let k = at;
  const emit: Emit = (a, b, d) => {
    tris[3 * k] = a;
    tris[3 * k + 1] = b;
    tris[3 * k + 2] = d;
    triFace[k] = f;
    k++;
  };
  if (c.length === 3) emit(c[0] as number, c[1] as number, c[2] as number);
  else if (c.length === 4) quad(t, f, c, emit);
  else ngon(t, f, c, emit);
}

/** Triangles of every face (corner indices × 3, CCW), the face of each triangle and F + 1 prefix offsets. */
export function triangulate(
  m: MeshData | EditMesh,
  cache?: Triangulation,
  dirtyFaces?: Uint32Array | 'all',
): Triangulation {
  const t = topoOf(m);
  const F = t.counts.faces;
  const corners: number[] = [];
  if (cache !== undefined && dirtyFaces !== undefined && dirtyFaces !== 'all' && cache.faceTriStart.length === F + 1) {
    const incremental = incrementalTriangulation(t, cache, dirtyFaces, corners);
    if (incremental !== null) return incremental;
  }
  const faceTriStart = new Uint32Array(F + 1);
  let total = 0;
  for (let f = 0; f < F; f++) {
    faceTriStart[f] = total;
    total += faceCorners(t, f, corners).length - 2;
  }
  faceTriStart[F] = total;
  const tris = new Uint32Array(3 * total);
  const triFace = new Uint32Array(total);
  for (let f = 0; f < F; f++) triangulateFace(t, f, corners, tris, triFace, faceTriStart[f] as number);
  return { tris, triFace, faceTriStart };
}

function incrementalTriangulation(
  t: Topo,
  cache: Triangulation,
  dirtyFaces: Uint32Array,
  corners: number[],
): Triangulation | null {
  const F = t.counts.faces;
  for (const f of dirtyFaces) {
    if (f >= F) return null;
    const n = faceCorners(t, f, corners).length;
    if ((cache.faceTriStart[f + 1] as number) - (cache.faceTriStart[f] as number) !== n - 2) return null;
  }
  const tris = cache.tris.slice();
  const triFace = cache.triFace.slice();
  for (const f of dirtyFaces) triangulateFace(t, f, corners, tris, triFace, cache.faceTriStart[f] as number);
  return { tris, triFace, faceTriStart: cache.faceTriStart };
}
