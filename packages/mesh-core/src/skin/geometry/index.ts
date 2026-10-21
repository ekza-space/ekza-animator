// C4 (auto-skin; M6B-SPEC §4.2, §5.9): the skin pipeline's geometry — positions, M6a's one triangulation mapped
// corners → points, angle-weighted point normals and the fixed X partner map — plus the point adjacency the solvers
// share (incident triangles, the point graph).
import type { ReadonlyXf } from '@ekza-studio/anim-core';
import { isEditMesh, topoOf } from '../../core/access';
import { editMeshFrom } from '../../core/edit';
import { buildSymmetryMap } from '../../symmetry/map';
import { triangulate } from '../../triangulate/triangulate';
import type { EditMesh, MeshData } from '../../types';
import type { SkinGeometry } from '../types';

const IDENTITY: ReadonlyXf = { t: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] };

/** Stored (immutable) MeshData → its geometry per height: the "cache per revision" of §4.2 (one MeshData per ref). */
const cache = new WeakMap<MeshData, { readonly height: number; readonly geom: SkinGeometry }>();

/** The partner map is **fixed and session-independent**: `buildSymmetryMap(edit, {axis: 'x', space: 'object',
 *  placement: identity, tolerance: 1e-4·height})` (M6a B2), cached per revision manifest. It never reads a user's
 *  Model symmetry settings or `MeshRuntime.symmetry()`, so the same args give the same weights for every user, after
 *  a reload and on adjust-last (P-S4, P-S5, M3 replay). */
export function skinGeometryOf(m: MeshData | EditMesh, height: number): SkinGeometry {
  if (!isEditMesh(m)) {
    const hit = cache.get(m);
    if (hit !== undefined && hit.height === height) return hit.geom;
  }
  const topo = topoOf(m);
  const P = m.counts.points;
  const positions = new Float64Array(3 * P);
  for (let i = 0; i < 3 * P; i++) positions[i] = topo.position[i] as number;
  const corners = triangulate(m).tris;
  const tris = new Uint32Array(corners.length);
  for (let i = 0; i < corners.length; i++) tris[i] = topo.cv(corners[i] as number);
  const normals = pointNormals(positions, tris, P);
  const edit = isEditMesh(m) ? m : editMeshFrom(m);
  const tolerance = 1e-4 * (height > 0 && Number.isFinite(height) ? height : 1);
  const partner = Int32Array.from(
    buildSymmetryMap(edit, { axis: 'x', space: 'object', placement: IDENTITY, tolerance }).vertex,
  );
  let pairedCount = 0;
  for (let i = 0; i < P; i++) if ((partner[i] as number) >= 0) pairedCount++;
  const geom: SkinGeometry = { positions, tris, normals, partner, paired: P === 0 ? 0 : pairedCount / P };
  if (!isEditMesh(m)) cache.set(m, { height, geom });
  return geom;
}

/** Angle-weighted point normals over the triangles (unit; [0, 1, 0] when degenerate or unused). */
export function pointNormals(positions: Float64Array, tris: Uint32Array, points: number): Float64Array {
  const acc = new Float64Array(3 * points);
  const T = Math.floor(tris.length / 3);
  for (let t = 0; t < T; t++) {
    const a = tris[3 * t] as number;
    const b = tris[3 * t + 1] as number;
    const c = tris[3 * t + 2] as number;
    if (a === b || b === c || a === c) continue;
    const ex = [
      (positions[3 * b] as number) - (positions[3 * a] as number),
      (positions[3 * b + 1] as number) - (positions[3 * a + 1] as number),
      (positions[3 * b + 2] as number) - (positions[3 * a + 2] as number),
    ];
    const fx = [
      (positions[3 * c] as number) - (positions[3 * a] as number),
      (positions[3 * c + 1] as number) - (positions[3 * a + 1] as number),
      (positions[3 * c + 2] as number) - (positions[3 * a + 2] as number),
    ];
    let nx = (ex[1] as number) * (fx[2] as number) - (ex[2] as number) * (fx[1] as number);
    let ny = (ex[2] as number) * (fx[0] as number) - (ex[0] as number) * (fx[2] as number);
    let nz = (ex[0] as number) * (fx[1] as number) - (ex[1] as number) * (fx[0] as number);
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (!(len > 0) || !Number.isFinite(len)) continue;
    nx /= len;
    ny /= len;
    nz /= len;
    const v = [a, b, c] as const;
    for (let k = 0; k < 3; k++) {
      const i = v[k] as number;
      const j = v[(k + 1) % 3] as number;
      const l = v[(k + 2) % 3] as number;
      const angle = cornerAngle(positions, i, j, l);
      acc[3 * i] = (acc[3 * i] as number) + angle * nx;
      acc[3 * i + 1] = (acc[3 * i + 1] as number) + angle * ny;
      acc[3 * i + 2] = (acc[3 * i + 2] as number) + angle * nz;
    }
  }
  const out = new Float64Array(3 * points);
  for (let i = 0; i < points; i++) {
    const x = acc[3 * i] as number;
    const y = acc[3 * i + 1] as number;
    const z = acc[3 * i + 2] as number;
    const len = Math.sqrt(x * x + y * y + z * z);
    if (len > 1e-12 && Number.isFinite(len)) {
      out[3 * i] = x / len;
      out[3 * i + 1] = y / len;
      out[3 * i + 2] = z / len;
    } else out[3 * i + 1] = 1;
  }
  return out;
}

function cornerAngle(p: Float64Array, i: number, j: number, l: number): number {
  const ux = (p[3 * j] as number) - (p[3 * i] as number);
  const uy = (p[3 * j + 1] as number) - (p[3 * i + 1] as number);
  const uz = (p[3 * j + 2] as number) - (p[3 * i + 2] as number);
  const vx = (p[3 * l] as number) - (p[3 * i] as number);
  const vy = (p[3 * l + 1] as number) - (p[3 * i + 1] as number);
  const vz = (p[3 * l + 2] as number) - (p[3 * i + 2] as number);
  const cx = uy * vz - uz * vy;
  const cy = uz * vx - ux * vz;
  const cz = ux * vy - uy * vx;
  return Math.atan2(Math.sqrt(cx * cx + cy * cy + cz * cz), ux * vx + uy * vy + uz * vz);
}

/** Incident triangles per point (CSR: `start[p]…start[p+1]` into `tris`, ascending triangle index). */
export interface PointTriangles {
  readonly start: Int32Array;
  readonly tris: Int32Array;
}

export function pointTriangles(geom: SkinGeometry): PointTriangles {
  const P = Math.floor(geom.positions.length / 3);
  const T = Math.floor(geom.tris.length / 3);
  const start = new Int32Array(P + 1);
  for (let t = 0; t < T; t++) {
    const a = geom.tris[3 * t] as number;
    const b = geom.tris[3 * t + 1] as number;
    const c = geom.tris[3 * t + 2] as number;
    start[a + 1] = (start[a + 1] as number) + 1;
    if (b !== a) start[b + 1] = (start[b + 1] as number) + 1;
    if (c !== a && c !== b) start[c + 1] = (start[c + 1] as number) + 1;
  }
  for (let i = 0; i < P; i++) start[i + 1] = (start[i + 1] as number) + (start[i] as number);
  const fill = start.slice(0, P);
  const out = new Int32Array(start[P] as number);
  for (let t = 0; t < T; t++) {
    const a = geom.tris[3 * t] as number;
    const b = geom.tris[3 * t + 1] as number;
    const c = geom.tris[3 * t + 2] as number;
    const put = (q: number): void => {
      out[fill[q] as number] = t;
      fill[q] = (fill[q] as number) + 1;
    };
    put(a);
    if (b !== a) put(b);
    if (c !== a && c !== b) put(c);
  }
  return { start, tris: out };
}

/** The point graph (CSR, neighbours ascending, no self loops): points sharing a triangle edge. */
export function pointGraph(geom: SkinGeometry): { readonly start: Int32Array; readonly next: Int32Array } {
  const P = Math.floor(geom.positions.length / 3);
  const T = Math.floor(geom.tris.length / 3);
  const lists: number[][] = Array.from({ length: P }, () => []);
  const link = (a: number, b: number): void => {
    if (a === b) return;
    (lists[a] as number[]).push(b);
    (lists[b] as number[]).push(a);
  };
  for (let t = 0; t < T; t++) {
    const a = geom.tris[3 * t] as number;
    const b = geom.tris[3 * t + 1] as number;
    const c = geom.tris[3 * t + 2] as number;
    link(a, b);
    link(b, c);
    link(c, a);
  }
  const start = new Int32Array(P + 1);
  const next: number[] = [];
  for (let i = 0; i < P; i++) {
    start[i] = next.length;
    const sorted = (lists[i] as number[]).sort((x, y) => x - y);
    for (let k = 0; k < sorted.length; k++) if (k === 0 || sorted[k] !== sorted[k - 1]) next.push(sorted[k] as number);
  }
  start[P] = next.length;
  return { start, next: Int32Array.from(next) };
}
