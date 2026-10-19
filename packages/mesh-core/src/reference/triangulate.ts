// The one triangulation (M6A-SPEC §5.4; reference implementation of B0a, B1 replaces it with the incremental one):
// triangles as they are; quads split along the shorter diagonal (float64 lengths; a tie within 1e-12 × the longer
// length goes to the diagonal containing the smaller vertex index), inverted by FACE_FLIP_DIAGONAL, and a concave
// quad (the chosen diagonal's triangles disagree in orientation with the face normal) always takes the other
// diagonal; n-gons by earcut on the projection that drops the largest component of the Newell normal, every triangle
// turned to the face's winding; when earcut returns fewer than n − 2 triangles the face falls back to a fan from its
// first corner. Triangles are emitted in face order, CCW. The reference recomputes everything (`cache` and
// `dirtyFaces` are accepted and ignored).
import earcut from 'earcut';
import { FACE_FLIP_DIAGONAL } from '../constants';
import { kernelError } from '../kernel';
import type { EditMesh, MeshData, Triangulation } from '../types';
import { newell, type Topo, topoOf } from './access';

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

function quad(t: Topo, f: number, c: readonly number[], emit: (a: number, b: number, c: number) => void): void {
  const p = t.position;
  const [c0, c1, c2, c3] = c as [number, number, number, number];
  const [v0, v1, v2, v3] = [t.cv(c0), t.cv(c1), t.cv(c2), t.cv(c3)];
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

function ngon(t: Topo, f: number, c: readonly number[], emit: (a: number, b: number, c: number) => void): void {
  const p = t.position;
  newell(t, f, normal);
  const ax = Math.abs(normal[0] as number);
  const ay = Math.abs(normal[1] as number);
  const az = Math.abs(normal[2] as number);
  // Drop the largest component: (u, v) are the other two axes.
  const [u, v] = ax >= ay && ax >= az ? [1, 2] : ay >= az ? [2, 0] : [0, 1];
  const flat = new Float64Array(c.length * 2);
  for (let i = 0; i < c.length; i++) {
    const vertex = t.cv(c[i] as number);
    flat[2 * i] = p[3 * vertex + u] as number;
    flat[2 * i + 1] = p[3 * vertex + v] as number;
  }
  const indices = earcut(flat);
  if (indices.length / 3 < c.length - 2) {
    for (let i = 1; i + 1 < c.length; i++) emit(c[0] as number, c[i] as number, c[i + 1] as number);
    return;
  }
  for (let i = 0; i < indices.length; i += 3) {
    const a = c[indices[i] as number] as number;
    let b = c[indices[i + 1] as number] as number;
    let d = c[indices[i + 2] as number] as number;
    if (orientation(p, t.cv(a), t.cv(b), t.cv(d), normal) < 0) [b, d] = [d, b];
    emit(a, b, d);
  }
}

/** Triangles of every face (corner indices × 3, CCW), the face of each triangle and F + 1 prefix offsets. */
export function triangulate(
  m: MeshData | EditMesh,
  _cache?: Triangulation,
  _dirtyFaces?: Uint32Array | 'all',
): Triangulation {
  const t = topoOf(m);
  const F = t.counts.faces;
  const tris: number[] = [];
  const triFace: number[] = [];
  const faceTriStart = new Uint32Array(F + 1);
  const corners: number[] = [];
  for (let f = 0; f < F; f++) {
    faceTriStart[f] = triFace.length;
    const c = faceCorners(t, f, corners);
    if (c.length < 3) throw kernelError('invalid-mesh', `triangulate: face ${f} has ${c.length} corners`);
    const emit = (a: number, b: number, d: number): void => {
      tris.push(a, b, d);
      triFace.push(f);
    };
    if (c.length === 3) emit(c[0] as number, c[1] as number, c[2] as number);
    else if (c.length === 4) quad(t, f, c, emit);
    else ngon(t, f, c, emit);
  }
  faceTriStart[F] = triFace.length;
  return { tris: Uint32Array.from(tris), triFace: Uint32Array.from(triFace), faceTriStart };
}
