// Adapted from ekza-avatar-renderer/src/previewFraming.ts @ 33c417c (MIT, © Wotori / Ekza). Changes: TypeScript
// strict style, bounds type from ./bounds, near/far tuned for an editor camera, an orthographic fit added, the Ekza
// preview height helpers and orbit distance limits dropped.
import type { SpatialBounds } from './bounds';

export const DEFAULT_FRAME_PADDING = 1.12;

export interface CameraFrame {
  readonly target: { readonly x: number; readonly y: number; readonly z: number };
  readonly radius: number;
  readonly distance: number;
  readonly near: number;
  readonly far: number;
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function orderedPair(left: number, right: number): [number, number] {
  const a = finiteOr(left, 0);
  const b = finiteOr(right, a);
  return a <= b ? [a, b] : [b, a];
}

/**
 * Camera distance that contains the whole bounds (padded bounding sphere) at any pane aspect, guarded against
 * degenerate input. The caller keeps its view direction and places the camera `distance` from `target`.
 */
export function fitCameraFrame(args: {
  readonly bounds: SpatialBounds;
  readonly aspect: number;
  readonly verticalFovDegrees: number;
  readonly padding?: number;
}): CameraFrame {
  const [minX, maxX] = orderedPair(args.bounds.minX, args.bounds.maxX);
  const [minY, maxY] = orderedPair(args.bounds.minY, args.bounds.maxY);
  const [minZ, maxZ] = orderedPair(args.bounds.minZ, args.bounds.maxZ);
  const target = { x: (minX + maxX) / 2, y: (minY + maxY) / 2, z: (minZ + maxZ) / 2 };
  const halfDiagonal = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) / 2;
  const radius = Math.max(0.05, finiteOr(halfDiagonal, 0.05));
  const aspect = Math.max(0.001, finiteOr(args.aspect, 1));
  const fovDegrees = Math.min(120, Math.max(1, finiteOr(args.verticalFovDegrees, 32)));
  const verticalHalfFov = (fovDegrees * Math.PI) / 360;
  const horizontalHalfFov = Math.atan(Math.tan(verticalHalfFov) * aspect);
  const limitingHalfFov = Math.max(0.001, Math.min(verticalHalfFov, horizontalHalfFov));
  const padding = Math.max(1, finiteOr(args.padding ?? DEFAULT_FRAME_PADDING, 1));
  const distance = (radius * padding) / Math.sin(limitingHalfFov);
  return {
    target,
    radius,
    distance,
    near: Math.max(0.001, Math.min(0.01, distance - radius * 1.01)),
    far: Math.max(100, distance + radius * 3),
  };
}

/** Visible height (metres) an orthographic view needs to contain the bounds' padded sphere at a pane aspect. */
export function fitOrthoHeight(bounds: SpatialBounds, aspect: number, padding = DEFAULT_FRAME_PADDING): number {
  const radius = Math.max(
    0.05,
    Math.hypot(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, bounds.maxZ - bounds.minZ) / 2,
  );
  const a = Math.max(0.001, finiteOr(aspect, 1));
  return (2 * radius * padding) / Math.min(1, a);
}

/**
 * Visible height (metres) an orthographic view looking along a fixed direction needs to contain the bounds: the eight
 * corners projected on the view's right and up axes (unit vectors), padded, at the pane aspect. Tighter than the
 * bounding sphere of {@link fitOrthoHeight}: a T-posed character in a narrow side pane fills the pane's height instead
 * of a third of it (M6b acceptance: joint fitting after Create Skeleton).
 */
export function fitOrthoViewHeight(
  bounds: SpatialBounds,
  right: readonly [number, number, number],
  up: readonly [number, number, number],
  aspect: number,
  padding = DEFAULT_FRAME_PADDING,
): number {
  const [minX, maxX] = orderedPair(bounds.minX, bounds.maxX);
  const [minY, maxY] = orderedPair(bounds.minY, bounds.maxY);
  const [minZ, maxZ] = orderedPair(bounds.minZ, bounds.maxZ);
  let loR = Number.POSITIVE_INFINITY;
  let hiR = Number.NEGATIVE_INFINITY;
  let loU = Number.POSITIVE_INFINITY;
  let hiU = Number.NEGATIVE_INFINITY;
  for (const x of [minX, maxX]) {
    for (const y of [minY, maxY]) {
      for (const z of [minZ, maxZ]) {
        const r = x * right[0] + y * right[1] + z * right[2];
        const u = x * up[0] + y * up[1] + z * up[2];
        loR = Math.min(loR, r);
        hiR = Math.max(hiR, r);
        loU = Math.min(loU, u);
        hiU = Math.max(hiU, u);
      }
    }
  }
  const a = Math.max(0.001, finiteOr(aspect, 1));
  const height = Math.max(finiteOr(hiU - loU, 0), finiteOr(hiR - loR, 0) / a);
  return Math.max(0.1, height) * Math.max(1, finiteOr(padding, 1));
}
