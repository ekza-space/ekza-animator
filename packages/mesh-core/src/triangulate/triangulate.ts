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
import { isEditMesh } from '../core/access';
import { KernelMesh } from '../core/mesh';
import { kernelError } from '../kernel';
import type { EditMesh, MeshData, Triangulation } from '../types';

/** The stored arrays triangulation reads (zero-copy views of a kernel mesh, or a MeshData). */
interface Arrays {
  readonly faces: number;
  readonly corners: number;
  readonly p: ArrayLike<number>;
  readonly cv: ArrayLike<number>;
  readonly cn: ArrayLike<number>;
  readonly fc: ArrayLike<number>;
  readonly ff: ArrayLike<number>;
}

function arraysOf(m: MeshData | EditMesh): Arrays {
  const d = m instanceof KernelMesh ? m.dataView() : isEditMesh(m) ? m.snapshot() : m;
  return {
    faces: d.counts.faces,
    corners: d.counts.corners,
    p: d.position,
    cv: d.cornerVert,
    cn: d.cornerNext,
    fc: d.faceCorner,
    ff: d.faceFlags,
  };
}

const normal = new Float64Array(3);

/** Newell normal (not normalized) of the corner cycle `c` into `normal`. */
function newellOf(a: Arrays, c: readonly number[]): void {
  const p = a.p;
  let x = 0;
  let y = 0;
  let z = 0;
  const n = c.length;
  for (let i = 0; i < n; i++) {
    const u = 3 * (a.cv[c[i] as number] as number);
    const w = 3 * (a.cv[c[(i + 1) % n] as number] as number);
    const ux = p[u] as number;
    const uy = p[u + 1] as number;
    const uz = p[u + 2] as number;
    const wx = p[w] as number;
    const wy = p[w + 1] as number;
    const wz = p[w + 2] as number;
    x += (uy - wy) * (uz + wz);
    y += (uz - wz) * (ux + wx);
    z += (ux - wx) * (uy + wy);
  }
  normal[0] = x;
  normal[1] = y;
  normal[2] = z;
}

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
function faceCorners(a: Arrays, f: number, out: number[]): number[] {
  out.length = 0;
  const start = a.fc[f] as number;
  let c = start;
  do {
    out.push(c);
    c = a.cn[c] as number;
  } while (c !== start && out.length <= a.corners);
  return out;
}

/** Writes triangles into `tris`/`triFace` from triangle `at`. */
class Sink {
  k = 0;
  constructor(
    readonly tris: Uint32Array,
    readonly triFace: Uint32Array,
  ) {}
  emit(f: number, a: number, b: number, c: number): void {
    const k = this.k++;
    this.tris[3 * k] = a;
    this.tris[3 * k + 1] = b;
    this.tris[3 * k + 2] = c;
    this.triFace[k] = f;
  }
}

function quad(a: Arrays, f: number, c: readonly number[], out: Sink): void {
  const p = a.p;
  const c0 = c[0] as number;
  const c1 = c[1] as number;
  const c2 = c[2] as number;
  const c3 = c[3] as number;
  const v0 = a.cv[c0] as number;
  const v1 = a.cv[c1] as number;
  const v2 = a.cv[c2] as number;
  const v3 = a.cv[c3] as number;
  const l0 = dist(p, v0, v2);
  const l1 = dist(p, v1, v3);
  let first: boolean; // true: diagonal c0–c2
  if (Math.abs(l0 - l1) <= 1e-12 * Math.max(l0, l1)) first = Math.min(v0, v2) < Math.min(v1, v3);
  else first = l0 < l1;
  if (((a.ff[f] as number) & FACE_FLIP_DIAGONAL) !== 0) first = !first;
  newellOf(a, c);
  const concave = first
    ? orientation(p, v0, v1, v2, normal) < 0 || orientation(p, v0, v2, v3, normal) < 0
    : orientation(p, v1, v2, v3, normal) < 0 || orientation(p, v1, v3, v0, normal) < 0;
  if (concave) first = !first;
  if (first) {
    out.emit(f, c0, c1, c2);
    out.emit(f, c0, c2, c3);
  } else {
    out.emit(f, c1, c2, c3);
    out.emit(f, c1, c3, c0);
  }
}

/** earcut over the dominant-plane projection; null when it returns fewer than n − 2 triangles. */
function earcutFace(a: Arrays, c: readonly number[]): number[] | null {
  const p = a.p;
  newellOf(a, c);
  const ax = Math.abs(normal[0] as number);
  const ay = Math.abs(normal[1] as number);
  const az = Math.abs(normal[2] as number);
  // Drop the largest component: (u, v) are the other two axes.
  const u = ax >= ay && ax >= az ? 1 : ay >= az ? 2 : 0;
  const v = ax >= ay && ax >= az ? 2 : ay >= az ? 0 : 1;
  const flat = new Float64Array(c.length * 2);
  for (let i = 0; i < c.length; i++) {
    const vertex = a.cv[c[i] as number] as number;
    flat[2 * i] = p[3 * vertex + u] as number;
    flat[2 * i + 1] = p[3 * vertex + v] as number;
  }
  const indices = earcut(flat);
  return indices.length / 3 < c.length - 2 ? null : indices;
}

function ngon(a: Arrays, f: number, c: readonly number[], out: Sink): void {
  const indices = earcutFace(a, c);
  if (indices === null) {
    for (let i = 1; i + 1 < c.length; i++) out.emit(f, c[0] as number, c[i] as number, c[i + 1] as number);
    return;
  }
  // earcutFace left the face's Newell normal in `normal`.
  const p = a.p;
  for (let i = 0; i < indices.length; i += 3) {
    const x = c[indices[i] as number] as number;
    let y = c[indices[i + 1] as number] as number;
    let z = c[indices[i + 2] as number] as number;
    if (orientation(p, a.cv[x] as number, a.cv[y] as number, a.cv[z] as number, normal) < 0) [y, z] = [z, y];
    out.emit(f, x, y, z);
  }
}

/** True when the n-gon `f` (n > 4) falls back to a fan because earcut could not triangulate it (§5.4, §5.25). */
export function isDegenerateNgon(m: MeshData | EditMesh, f: number): boolean {
  const a = arraysOf(m);
  const c = faceCorners(a, f, []);
  return c.length > 4 && earcutFace(a, c) === null;
}

function triangulateFace(a: Arrays, f: number, corners: number[], out: Sink): void {
  const c = faceCorners(a, f, corners);
  if (c.length < 3) throw kernelError('invalid-mesh', `triangulate: face ${f} has ${c.length} corners`);
  if (c.length === 3) out.emit(f, c[0] as number, c[1] as number, c[2] as number);
  else if (c.length === 4) quad(a, f, c, out);
  else ngon(a, f, c, out);
}

/** Triangles of every face (corner indices × 3, CCW), the face of each triangle and F + 1 prefix offsets. */
export function triangulate(
  m: MeshData | EditMesh,
  cache?: Triangulation,
  dirtyFaces?: Uint32Array | 'all',
): Triangulation {
  const a = arraysOf(m);
  const F = a.faces;
  const corners: number[] = [];
  if (cache !== undefined && dirtyFaces !== undefined && dirtyFaces !== 'all' && cache.faceTriStart.length === F + 1) {
    const incremental = incrementalTriangulation(a, cache, dirtyFaces, corners);
    if (incremental !== null) return incremental;
  }
  const faceTriStart = new Uint32Array(F + 1);
  let total = 0;
  for (let f = 0; f < F; f++) {
    faceTriStart[f] = total;
    total += faceCorners(a, f, corners).length - 2;
  }
  faceTriStart[F] = total;
  const out = new Sink(new Uint32Array(3 * total), new Uint32Array(total));
  for (let f = 0; f < F; f++) triangulateFace(a, f, corners, out);
  return { tris: out.tris, triFace: out.triFace, faceTriStart };
}

function incrementalTriangulation(
  a: Arrays,
  cache: Triangulation,
  dirtyFaces: Uint32Array,
  corners: number[],
): Triangulation | null {
  const F = a.faces;
  for (const f of dirtyFaces) {
    if (f >= F) return null;
    const n = faceCorners(a, f, corners).length;
    if ((cache.faceTriStart[f + 1] as number) - (cache.faceTriStart[f] as number) !== n - 2) return null;
  }
  const out = new Sink(cache.tris.slice(), cache.triFace.slice());
  for (const f of dirtyFaces) {
    out.k = cache.faceTriStart[f] as number;
    triangulateFace(a, f, corners, out);
  }
  return { tris: out.tris, triFace: out.triFace, faceTriStart: cache.faceTriStart };
}
