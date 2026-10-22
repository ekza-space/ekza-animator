// Silhouette rasters and projected centres for Quick Rig (M6B-SPEC §0.4.2, §5.3, §5.8 step 2; C2).
//
// A raster row at height y marks the columns (along x for the front view, along z for the side view) where a view ray
// through (column, y) meets the surface: exactly the columns covered by the projection of the triangles' cross-sections
// with the plane y. Computing the cross-sections per triangle (instead of one ray per sample) gives the same samples as
// `raycastAll` over the grid at a fraction of the cost: O(triangles × rows they span). Deterministic (float64, fixed
// order). Projected centres pair the entry and exit hits of `raycastAll` into slabs and take their midpoints.
import type { TriangleBvh } from '@ekza-studio/mesh-core';

type Vec3 = readonly [number, number, number];

export interface Raster {
  /** Rows bottom-up; row r samples y = y0 + (r + 0.5)·step. */
  readonly rows: number;
  /** Columns; column c samples u = u0 + c·step (u = x for the front view, z for the side view). */
  readonly cols: number;
  readonly y0: number;
  readonly u0: number;
  readonly step: number;
  /** rows × cols, 1 = inside. */
  readonly inside: Uint8Array;
}

/** The y of row r's sample. */
export const rowY = (raster: Raster, r: number): number => raster.y0 + (r + 0.5) * raster.step;
/** The u (x or z) of column c. */
export const colU = (raster: Raster, c: number): number => raster.u0 + c * raster.step;

/**
 * Rasterizes the projection of the triangles onto the plane of `axis` (0: front view, columns along x; 2: side view,
 * columns along z) for `rows` rows from `y0` with a square `step`, columns from `u0`.
 */
export function rasterize(
  bvh: TriangleBvh,
  axis: 0 | 2,
  y0: number,
  u0: number,
  step: number,
  rows: number,
  cols: number,
): Raster {
  const inside = new Uint8Array(rows * cols);
  const P = bvh.positions;
  const T = bvh.tris;
  const n = bvh.triangles;
  const ys = [0, 0, 0];
  const us = [0, 0, 0];
  for (let t = 0; t < n; t++) {
    for (let k = 0; k < 3; k++) {
      const v = 3 * (T[3 * t + k] as number);
      ys[k] = P[v + 1] as number;
      us[k] = P[v + axis] as number;
    }
    const ymin = Math.min(ys[0] as number, ys[1] as number, ys[2] as number);
    const ymax = Math.max(ys[0] as number, ys[1] as number, ys[2] as number);
    if (!(ymax > ymin)) continue; // horizontal triangles add nothing their neighbours do not
    const r0 = Math.max(0, Math.ceil((ymin - y0) / step - 0.5));
    const r1 = Math.min(rows - 1, Math.floor((ymax - y0) / step - 0.5));
    for (let r = r0; r <= r1; r++) {
      const y = y0 + (r + 0.5) * step;
      // The cross-section of the triangle with the plane y: the u range over its edge crossings.
      let lo = Infinity;
      let hi = -Infinity;
      for (let k = 0; k < 3; k++) {
        const ya = ys[k] as number;
        const yb = ys[(k + 1) % 3] as number;
        const ua = us[k] as number;
        const ub = us[(k + 1) % 3] as number;
        if (ya === y) {
          if (ua < lo) lo = ua;
          if (ua > hi) hi = ua;
        }
        if ((ya < y && yb > y) || (ya > y && yb < y)) {
          const u = ua + ((y - ya) / (yb - ya)) * (ub - ua);
          if (u < lo) lo = u;
          if (u > hi) hi = u;
        }
      }
      if (!(hi >= lo)) continue;
      const c0 = Math.max(0, Math.ceil((lo - u0) / step));
      const c1 = Math.min(cols - 1, Math.floor((hi - u0) / step));
      for (let c = c0; c <= c1; c++) inside[r * cols + c] = 1;
    }
  }
  return { rows, cols, y0, u0, step, inside };
}

/** Runs of inside columns of a row: [first, last] column pairs, left to right. */
export function rowRuns(raster: Raster, r: number): [number, number][] {
  const runs: [number, number][] = [];
  const base = r * raster.cols;
  let start = -1;
  for (let c = 0; c < raster.cols; c++) {
    const on = raster.inside[base + c] === 1;
    if (on && start < 0) start = c;
    if (!on && start >= 0) {
      runs.push([start, c - 1]);
      start = -1;
    }
  }
  if (start >= 0) runs.push([start, raster.cols - 1]);
  return runs;
}

export const isInside = (raster: Raster, r: number, c: number): boolean =>
  r >= 0 && r < raster.rows && c >= 0 && c < raster.cols && raster.inside[r * raster.cols + c] === 1;

/**
 * Slabs along a ray: [entry t, exit t] pairs of the union of shells (a depth counter over front/back hits). A slab
 * left open at the end by an unclosed shell (an overlapping part whose inner faces were removed, e.g. Polybot's belt
 * over its torso: front, front, back) closes at its last back-facing hit (INT; else the projected centre fell back to
 * the first hit, on the surface).
 */
export function slabs(bvh: TriangleBvh, origin: Vec3, dir: Vec3): { slabs: [number, number][]; first: number | null } {
  const hits = bvh.raycastAll(origin, dir);
  const out: [number, number][] = [];
  let depth = 0;
  let entry = 0;
  let lastExit: number | null = null;
  for (const hit of hits) {
    if (hit.front) {
      if (depth === 0) {
        entry = hit.t;
        lastExit = null;
      }
      depth++;
    } else if (depth > 0) {
      depth--;
      lastExit = hit.t;
      if (depth === 0) out.push([entry, hit.t]);
    }
  }
  if (depth > 0 && lastExit !== null) out.push([entry, lastExit]);
  return { slabs: out, first: hits[0]?.t ?? null };
}

/**
 * Snap to Projected Center (§5.3): the slab midpoint along the ray. `mode: 'new'` takes the slab nearest the origin;
 * `'reposition'` the slab containing `depth` (a ray parameter, in units of `dir`), else the nearest one to it. An open
 * mesh with hits but no closed slab gives the first hit pushed inward by `fallbackRadius` (metres). Null = no hit.
 */
export function projectedCenterOf(
  bvh: TriangleBvh,
  origin: Vec3,
  dir: Vec3,
  opts: { readonly mode: 'new' | 'reposition'; readonly depth?: number; readonly fallbackRadius: number },
): Vec3 | null {
  const { slabs: list, first } = slabs(bvh, origin, dir);
  const at = (t: number): Vec3 => [origin[0] + t * dir[0], origin[1] + t * dir[1], origin[2] + t * dir[2]];
  if (list.length === 0) {
    if (first === null) return null;
    const len = Math.hypot(dir[0], dir[1], dir[2]);
    return at(first + (len > 0 ? opts.fallbackRadius / len : 0));
  }
  let chosen = list[0] as [number, number];
  if (opts.mode === 'reposition' && opts.depth !== undefined) {
    const depth = opts.depth;
    let best = Infinity;
    for (const slab of list) {
      const gap = depth < slab[0] ? slab[0] - depth : depth > slab[1] ? depth - slab[1] : 0;
      if (gap < best) {
        best = gap;
        chosen = slab;
      }
    }
  }
  return at((chosen[0] + chosen[1]) / 2);
}

/** The thickness of the first slab along a ray (0 without one). */
export function firstSlabThickness(bvh: TriangleBvh, origin: Vec3, dir: Vec3): number {
  const first = slabs(bvh, origin, dir).slabs[0];
  if (first === undefined) return 0;
  return (first[1] - first[0]) * Math.hypot(dir[0], dir[1], dir[2]);
}
