// The mirror of a symmetry mode in mesh-local coordinates (M6A-SPEC §5.14). Object X/Y/Z reflects across the mesh-local
// axis plane through the object origin; World X/Y/Z across the world axis plane through the world origin, mapped into
// mesh-local space through the placement. Both are written as one affine reflection
//
//   S(p) = p − 2 · d(p) · g,   d(p) = n·p − c,   n·g = 1,
//
// where d(p) is the **signed world distance** (metres) of a local point to the plane (positive side = the positive
// world axis in World mode, the positive local axis in Object mode) and g is the local reflection direction. S is an
// involution; with a rotated or non-uniformly scaled placement it is not orthogonal in local coordinates (World mode),
// but it always is the exact local image of the world-space reflection. The in-plane projection of a point is the
// midpoint of p and S(p) (`p − d(p)·g`), the in-plane part of a delta `Δ − (n·Δ)·g` — the helpers ops share (§5.14
// seam rules). World distances between local points are |diag(s)·(p − q)| (the rotation keeps lengths).
import type { ReadonlyVec3, ReadonlyXf } from '@ekza-animator/anim-core';
import { kernelError } from '../kernel';
import type { SymmetryAxis, SymmetryMap } from '../types';

/** A symmetry mode's mirror in mesh-local coordinates. */
export interface MirrorSpace {
  readonly axis: SymmetryAxis;
  readonly space: 'object' | 'world';
  /** Plane normal in local coordinates, scaled so that `n·p − c` is the signed world distance in metres. */
  readonly n: readonly [number, number, number];
  readonly c: number;
  /** Local reflection direction (`n·g = 1`). */
  readonly g: readonly [number, number, number];
  /** |placement scale| per local axis (world length of a local unit vector), each at least 1e-12. */
  readonly scale: readonly [number, number, number];
  /** The smallest of `scale`: a world distance r covers at most r / minScale local units. */
  readonly minScale: number;
}

const AXIS_INDEX: Readonly<Record<SymmetryAxis, 0 | 1 | 2>> = { x: 0, y: 1, z: 2 };
const MIN_SCALE = 1e-12;

export function axisIndex(axis: SymmetryAxis): 0 | 1 | 2 {
  const k = AXIS_INDEX[axis];
  if (k === undefined)
    throw kernelError('invalid-argument', `symmetry axis must be 'x', 'y' or 'z', got ${String(axis)}`);
  return k;
}

/** Rotation matrix (row-major 3×3) of a quaternion, normalized first; identity for a zero quaternion. */
export function rotation(q: readonly [number, number, number, number] | readonly number[]): Float64Array {
  let [x, y, z, w] = [q[0] ?? 0, q[1] ?? 0, q[2] ?? 0, q[3] ?? 1];
  const len = Math.hypot(x, y, z, w);
  if (!(len > 0) || !Number.isFinite(len)) [x, y, z, w] = [0, 0, 0, 1];
  else [x, y, z, w] = [x / len, y / len, z / len, w / len];
  return Float64Array.of(
    1 - 2 * (y * y + z * z),
    2 * (x * y - z * w),
    2 * (x * z + y * w),
    2 * (x * y + z * w),
    1 - 2 * (x * x + z * z),
    2 * (y * z - x * w),
    2 * (x * z - y * w),
    2 * (y * z + x * w),
    1 - 2 * (x * x + y * y),
  );
}

/** The mirror of `axis`/`space` for a mesh with `placement` (world from local). */
export function mirrorSpace(opts: {
  readonly axis: SymmetryAxis;
  readonly space: 'object' | 'world';
  readonly placement: ReadonlyXf;
}): MirrorSpace {
  const k = axisIndex(opts.axis);
  const s = opts.placement.s;
  const signed = [s[0] ?? 1, s[1] ?? 1, s[2] ?? 1].map((v) =>
    Math.abs(v) < MIN_SCALE ? (v < 0 ? -MIN_SCALE : MIN_SCALE) : v,
  ) as [number, number, number];
  const scale = signed.map(Math.abs) as [number, number, number];
  const minScale = Math.min(scale[0], scale[1], scale[2]);
  if (opts.space === 'object') {
    const n: [number, number, number] = [0, 0, 0];
    const g: [number, number, number] = [0, 0, 0];
    n[k] = scale[k];
    g[k] = 1 / scale[k];
    return Object.freeze({ axis: opts.axis, space: 'object', n, c: 0, g, scale, minScale });
  }
  if (opts.space !== 'world') {
    throw kernelError('invalid-argument', `symmetry space must be 'object' or 'world', got ${String(opts.space)}`);
  }
  // world w = R·diag(s)·p + t; d(p) = w_k = Σ_j R_kj s_j p_j + t_k; S(p) = p − 2 d(p) · diag(1/s)·Rᵀ·e_k.
  const r = rotation(opts.placement.q);
  const n: [number, number, number] = [0, 0, 0];
  const g: [number, number, number] = [0, 0, 0];
  for (let j = 0; j < 3; j++) {
    const rkj = r[3 * k + j] as number;
    n[j] = rkj * (signed[j] as number);
    g[j] = rkj / (signed[j] as number);
  }
  const c = -(opts.placement.t[k] ?? 0);
  return Object.freeze({ axis: opts.axis, space: 'world', n, c, g, scale, minScale });
}

const registry = new WeakMap<SymmetryMap, MirrorSpace>();

/** Records the mirror a map was built with (`buildSymmetryMap`), so pointer and seam helpers can read it. */
export function registerMirrorSpace(map: SymmetryMap, space: MirrorSpace): void {
  registry.set(map, space);
}

/**
 * The mirror of a symmetry map: the one `buildSymmetryMap` recorded, else (a map assembled by hand, e.g. in a test)
 * the axis plane at `map.plane` in mesh-local units with an identity placement.
 */
export function mirrorSpaceOf(map: SymmetryMap): MirrorSpace {
  const recorded = registry.get(map);
  if (recorded !== undefined) return recorded;
  const k = axisIndex(map.axis);
  const n: [number, number, number] = [0, 0, 0];
  n[k] = 1;
  return Object.freeze({
    axis: map.axis,
    space: map.space,
    n,
    c: Number.isFinite(map.plane) ? map.plane : 0,
    g: [n[0], n[1], n[2]] as const,
    scale: [1, 1, 1] as const,
    minScale: 1,
  });
}

/** Signed world distance (metres) of a local point to the mirror plane. */
export function planeDistance(space: MirrorSpace, x: number, y: number, z: number): number {
  return space.n[0] * x + space.n[1] * y + space.n[2] * z - space.c;
}

/** S(p): the mirror image of a local point, into `out` (may alias nothing it reads after writing). */
export function reflectPoint(space: MirrorSpace, x: number, y: number, z: number, out: Float64Array, o = 0): void {
  const d2 = 2 * planeDistance(space, x, y, z);
  out[o] = x - d2 * space.g[0];
  out[o + 1] = y - d2 * space.g[1];
  out[o + 2] = z - d2 * space.g[2];
}

/** The linear part of S applied to a local vector (a delta or a direction). */
export function reflectVector(space: MirrorSpace, x: number, y: number, z: number, out: Float64Array, o = 0): void {
  const d2 = 2 * (space.n[0] * x + space.n[1] * y + space.n[2] * z);
  out[o] = x - d2 * space.g[0];
  out[o + 1] = y - d2 * space.g[1];
  out[o + 2] = z - d2 * space.g[2];
}

/** The in-plane projection of a local point: the midpoint of p and S(p) (on the plane: `planeDistance` = 0). */
export function projectOntoPlane(space: MirrorSpace, x: number, y: number, z: number, out: Float64Array, o = 0): void {
  const d = planeDistance(space, x, y, z);
  out[o] = x - d * space.g[0];
  out[o + 1] = y - d * space.g[1];
  out[o + 2] = z - d * space.g[2];
}

/** The in-plane part of a local delta: the average of Δ and its mirror (the seam rule of §5.14). */
export function inPlanePart(space: MirrorSpace, x: number, y: number, z: number, out: Float64Array, o = 0): void {
  const d = space.n[0] * x + space.n[1] * y + space.n[2] * z;
  out[o] = x - d * space.g[0];
  out[o + 1] = y - d * space.g[1];
  out[o + 2] = z - d * space.g[2];
}

/** World distance (metres) between two local points. */
export function worldDistance(
  space: MirrorSpace,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
): number {
  return Math.hypot((ax - bx) * space.scale[0], (ay - by) * space.scale[1], (az - bz) * space.scale[2]);
}

/** The plane offset along the axis in mesh-local units (`SymmetryMap.plane`); 0 when the plane is parallel to it. */
export function planeOffset(space: MirrorSpace): number {
  const k = AXIS_INDEX[space.axis];
  const nk = space.n[k];
  return Math.abs(nk) < 1e-12 ? 0 : space.c / nk;
}

/** Signed world distance of a point given as a vector. */
export function planeDistanceOf(space: MirrorSpace, p: ReadonlyVec3): number {
  return planeDistance(space, p[0], p[1], p[2]);
}

/**
 * The placement as a row-major 3×4 affine matrix (world from local): rows [R·diag(s) | t]. Read-only helper for
 * world-space measurements (soft radii, component frames).
 */
export function placementAffine(placement: ReadonlyXf): Float64Array {
  const r = rotation(placement.q);
  const s = placement.s;
  const t = placement.t;
  const out = new Float64Array(12);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) out[4 * i + j] = (r[3 * i + j] as number) * (s[j] ?? 1);
    out[4 * i + 3] = t[i] ?? 0;
  }
  return out;
}

/** World positions (3 per point, float64) of a local position array under a row-major 3×4 affine. */
export function transformPositions(position: ArrayLike<number>, count: number, a: Float64Array): Float64Array {
  const out = new Float64Array(3 * count);
  for (let v = 0; v < count; v++) {
    const x = position[3 * v] as number;
    const y = position[3 * v + 1] as number;
    const z = position[3 * v + 2] as number;
    out[3 * v] = (a[0] as number) * x + (a[1] as number) * y + (a[2] as number) * z + (a[3] as number);
    out[3 * v + 1] = (a[4] as number) * x + (a[5] as number) * y + (a[6] as number) * z + (a[7] as number);
    out[3 * v + 2] = (a[8] as number) * x + (a[9] as number) * y + (a[10] as number) * z + (a[11] as number);
  }
  return out;
}
