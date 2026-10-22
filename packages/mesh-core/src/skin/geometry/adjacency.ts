// C4 (auto-skin; M6B-SPEC §5.9): the point adjacency the solvers share — incident triangles and the point graph — on
// `SkinGeometry` alone (no kernel import: the skin worker bundles the solvers without the mesh kernel, §2.1).
import type { SkinGeometry } from '../types';

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
