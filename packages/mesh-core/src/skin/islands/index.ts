// C4 (auto-skin; M6B-SPEC §5.9 step 1): islands = connected components of the point graph (points sharing a
// triangle; a point in no triangle is an island of its own), numbered by their smallest point, with the
// area-weighted centroid the island rules use.
import type { SkinGeometry } from '../types';

export interface Islands {
  readonly count: number;
  /** Island of every point. */
  readonly of: Int32Array;
  /** Points of island i: `points[start[i]…start[i+1]]`, ascending. */
  readonly start: Int32Array;
  readonly points: Int32Array;
  /** 3·count: the area-weighted centroid of the island's triangles (the mean of its points when it has no area). */
  readonly centroid: Float64Array;
}

function find(parent: Int32Array, i: number): number {
  let r = i;
  while (parent[r] !== r) r = parent[r] as number;
  // path compression
  let c = i;
  while (parent[c] !== r) {
    const n = parent[c] as number;
    parent[c] = r;
    c = n;
  }
  return r;
}

export function skinIslands(geom: SkinGeometry): Islands {
  const P = Math.floor(geom.positions.length / 3);
  const T = Math.floor(geom.tris.length / 3);
  const parent = new Int32Array(P);
  for (let i = 0; i < P; i++) parent[i] = i;
  const union = (a: number, b: number): void => {
    const ra = find(parent, a);
    const rb = find(parent, b);
    if (ra === rb) return;
    // The smaller index becomes the root, so roots are the islands' smallest points.
    if (ra < rb) parent[rb] = ra;
    else parent[ra] = rb;
  };
  for (let t = 0; t < T; t++) {
    union(geom.tris[3 * t] as number, geom.tris[3 * t + 1] as number);
    union(geom.tris[3 * t + 1] as number, geom.tris[3 * t + 2] as number);
  }
  const of = new Int32Array(P);
  const rootIsland = new Int32Array(P).fill(-1);
  let count = 0;
  for (let i = 0; i < P; i++) {
    const r = find(parent, i);
    if (rootIsland[r] === -1) rootIsland[r] = count++;
    of[i] = rootIsland[r] as number;
  }
  const start = new Int32Array(count + 1);
  for (let i = 0; i < P; i++) {
    const at = (of[i] as number) + 1;
    start[at] = (start[at] as number) + 1;
  }
  for (let i = 0; i < count; i++) start[i + 1] = (start[i + 1] as number) + (start[i] as number);
  const fill = start.slice(0, count);
  const points = new Int32Array(P);
  for (let i = 0; i < P; i++) {
    const isl = of[i] as number;
    points[fill[isl] as number] = i;
    fill[isl] = (fill[isl] as number) + 1;
  }
  // Area-weighted centroids.
  const sum = new Float64Array(3 * count);
  const area = new Float64Array(count);
  const p = geom.positions;
  for (let t = 0; t < T; t++) {
    const a = geom.tris[3 * t] as number;
    const b = geom.tris[3 * t + 1] as number;
    const c = geom.tris[3 * t + 2] as number;
    const ux = (p[3 * b] as number) - (p[3 * a] as number);
    const uy = (p[3 * b + 1] as number) - (p[3 * a + 1] as number);
    const uz = (p[3 * b + 2] as number) - (p[3 * a + 2] as number);
    const vx = (p[3 * c] as number) - (p[3 * a] as number);
    const vy = (p[3 * c + 1] as number) - (p[3 * a + 1] as number);
    const vz = (p[3 * c + 2] as number) - (p[3 * a + 2] as number);
    const cx = uy * vz - uz * vy;
    const cy = uz * vx - ux * vz;
    const cz = ux * vy - uy * vx;
    const A = Math.sqrt(cx * cx + cy * cy + cz * cz) / 2;
    if (!(A > 0) || !Number.isFinite(A)) continue;
    const isl = of[a] as number;
    area[isl] = (area[isl] as number) + A;
    for (let d = 0; d < 3; d++) {
      sum[3 * isl + d] =
        (sum[3 * isl + d] as number) +
        (A * ((p[3 * a + d] as number) + (p[3 * b + d] as number) + (p[3 * c + d] as number))) / 3;
    }
  }
  const centroid = new Float64Array(3 * count);
  for (let i = 0; i < count; i++) {
    if ((area[i] as number) > 0) {
      for (let d = 0; d < 3; d++) centroid[3 * i + d] = (sum[3 * i + d] as number) / (area[i] as number);
      continue;
    }
    const s = start[i] as number;
    const e = start[i + 1] as number;
    for (let k = s; k < e; k++) {
      const q = points[k] as number;
      for (let d = 0; d < 3; d++) centroid[3 * i + d] = (centroid[3 * i + d] as number) + (p[3 * q + d] as number);
    }
    for (let d = 0; d < 3; d++) centroid[3 * i + d] = (centroid[3 * i + d] as number) / (e - s);
  }
  return { count, of, start, points, centroid };
}
