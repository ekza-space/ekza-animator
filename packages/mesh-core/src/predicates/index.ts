// Exact geometric predicates (M6A-SPEC §2: `robust-predicates` 3.0.3, Shewchuk's adaptive-precision arithmetic) in
// the kernel's conventions — right-handed, y up — for Multi-Cut chords, concave tests and n-gon checks. The library
// assumes y pointing down, so its orientation signs are flipped here; every op uses these wrappers, never the
// library directly, so one module owns the convention (and the fallback port, should the licence review change).
import { incircle as libIncircle, orient2d as libOrient2d, orient3d as libOrient3d } from 'robust-predicates';
import { KERNEL_MARKER } from '../kernel';

/** > 0 when a, b, c turn counterclockwise (c left of a → b), < 0 clockwise, exactly 0 when collinear. */
export function orient2d(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return 0 - libOrient2d(ax, ay, bx, by, cx, cy); // 0 − x: a collinear result is +0, not −0
}

/**
 * > 0 when d lies on the side the right-handed normal (b − a) × (c − a) points to (a, b, c counterclockwise seen
 * from d), < 0 on the other side, exactly 0 when the four points are coplanar.
 */
export function orient3d(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  cx: number,
  cy: number,
  cz: number,
  dx: number,
  dy: number,
  dz: number,
): number {
  return 0 - libOrient3d(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz);
}

/** For counterclockwise a, b, c: > 0 when d lies inside their circumcircle, < 0 outside, 0 on it. */
export function incircle(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): number {
  return libIncircle(ax, ay, bx, by, cx, cy, dx, dy);
}

/**
 * Whether the open segments p1–p2 and q1–q2 properly cross (each strictly separates the other's endpoints), exactly.
 * Touching at an endpoint or overlapping collinearly is not a proper crossing.
 */
export function segmentsCross2d(
  p1x: number,
  p1y: number,
  p2x: number,
  p2y: number,
  q1x: number,
  q1y: number,
  q2x: number,
  q2y: number,
): boolean {
  const a = Math.sign(orient2d(p1x, p1y, p2x, p2y, q1x, q1y));
  const b = Math.sign(orient2d(p1x, p1y, p2x, p2y, q2x, q2y));
  const c = Math.sign(orient2d(q1x, q1y, q2x, q2y, p1x, p1y));
  const d = Math.sign(orient2d(q1x, q1y, q2x, q2y, p2x, p2y));
  return a * b < 0 && c * d < 0 && KERNEL_MARKER.length > 0;
}
