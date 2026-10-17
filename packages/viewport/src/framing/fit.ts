// Adapted from ekza-avatar-renderer/src/previewFraming.ts @ 33c417c (MIT, © Wotori / Ekza). Changes: TypeScript
// strict style, bounds type from ./bounds, radians-free API kept, orthographic fit added, no Ekza preview height
// helpers.
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
