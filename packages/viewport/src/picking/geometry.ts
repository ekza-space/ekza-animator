// Screen-space geometry for analytic picking (ADR 0006 §5): world → pane CSS px projection with near-plane
// clipping, point-to-segment distance and the segment/rectangle crossing test. Allocation-free hot paths.
import type { Camera } from 'three';

/**
 * Projects world points into a pane: x right and y down in pane CSS px, depth = view-space distance in metres along
 * the camera's forward axis (positive in front of the camera).
 */
export class PaneProjector {
  /** Column-major view-projection matrix. */
  private readonly vp = new Float64Array(16);
  /** Column-major world → view matrix. */
  private readonly view = new Float64Array(16);
  width = 1;
  height = 1;
  near = 0.01;

  /** Reads the camera's current matrices; call after the camera's world matrix and projection are up to date. */
  set(camera: Camera, width: number, height: number, near: number): this {
    const v = camera.matrixWorldInverse.elements;
    const p = camera.projectionMatrix.elements;
    for (let i = 0; i < 16; i++) this.view[i] = v[i] as number;
    multiply(p, v, this.vp);
    this.width = width;
    this.height = height;
    this.near = near;
    return this;
  }

  /** View-space depth of a world point (metres in front of the camera; negative behind it). */
  depth(x: number, y: number, z: number): number {
    const m = this.view;
    return -((m[2] as number) * x + (m[6] as number) * y + (m[10] as number) * z + (m[14] as number));
  }

  /**
   * Projects a point; `out` receives [x, y, depth]. Returns false (and leaves `out` unspecified) when the point is
   * not in front of the near plane.
   */
  project(x: number, y: number, z: number, out: Float64Array | number[]): boolean {
    const d = this.depth(x, y, z);
    if (!(d > this.near * 0.999)) return false;
    const m = this.vp;
    const cx = (m[0] as number) * x + (m[4] as number) * y + (m[8] as number) * z + (m[12] as number);
    const cy = (m[1] as number) * x + (m[5] as number) * y + (m[9] as number) * z + (m[13] as number);
    const cw = (m[3] as number) * x + (m[7] as number) * y + (m[11] as number) * z + (m[15] as number);
    if (cw === 0) return false;
    out[0] = ((cx / cw) * 0.5 + 0.5) * this.width;
    out[1] = (0.5 - (cy / cw) * 0.5) * this.height;
    out[2] = d;
    return true;
  }

  /**
   * Projects segment ab after clipping it to the near plane; `out` receives [x0, y0, d0, x1, y1, d1]. Returns false
   * when the whole segment is behind the near plane.
   */
  projectSegment(
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    out: Float64Array | number[],
  ): boolean {
    const near = this.near;
    const da = this.depth(ax, ay, az);
    const db = this.depth(bx, by, bz);
    if (da < near && db < near) return false;
    let x0 = ax;
    let y0 = ay;
    let z0 = az;
    let x1 = bx;
    let y1 = by;
    let z1 = bz;
    if (da < near) {
      const t = (near - da) / (db - da);
      x0 = ax + (bx - ax) * t;
      y0 = ay + (by - ay) * t;
      z0 = az + (bz - az) * t;
    } else if (db < near) {
      const t = (near - db) / (da - db);
      x1 = bx + (ax - bx) * t;
      y1 = by + (ay - by) * t;
      z1 = bz + (az - bz) * t;
    }
    if (!this.project(x0, y0, z0, scratch)) return false;
    out[0] = scratch[0] as number;
    out[1] = scratch[1] as number;
    out[2] = scratch[2] as number;
    if (!this.project(x1, y1, z1, scratch)) return false;
    out[3] = scratch[0] as number;
    out[4] = scratch[1] as number;
    out[5] = scratch[2] as number;
    return true;
  }

  /** World-space ray through a pane point: origin and unit direction written into `origin` and `dir`. */
  ray(camera: Camera, x: number, y: number, origin: Float64Array | number[], dir: Float64Array | number[]): void {
    const ndcX = (x / this.width) * 2 - 1;
    const ndcY = 1 - (y / this.height) * 2;
    const inv = camera.projectionMatrixInverse.elements;
    const world = camera.matrixWorld.elements;
    unproject(inv, world, ndcX, ndcY, -1, origin);
    unproject(inv, world, ndcX, ndcY, 1, dir);
    const dx = (dir[0] as number) - (origin[0] as number);
    const dy = (dir[1] as number) - (origin[1] as number);
    const dz = (dir[2] as number) - (origin[2] as number);
    const len = Math.hypot(dx, dy, dz) || 1;
    dir[0] = dx / len;
    dir[1] = dy / len;
    dir[2] = dz / len;
  }
}

const scratch = new Float64Array(3);

function unproject(
  projInv: ArrayLike<number>,
  world: ArrayLike<number>,
  x: number,
  y: number,
  z: number,
  out: Float64Array | number[],
): void {
  // view = projInv · (x, y, z, 1)
  const vx =
    (projInv[0] as number) * x + (projInv[4] as number) * y + (projInv[8] as number) * z + (projInv[12] as number);
  const vy =
    (projInv[1] as number) * x + (projInv[5] as number) * y + (projInv[9] as number) * z + (projInv[13] as number);
  const vz =
    (projInv[2] as number) * x + (projInv[6] as number) * y + (projInv[10] as number) * z + (projInv[14] as number);
  const vw =
    (projInv[3] as number) * x + (projInv[7] as number) * y + (projInv[11] as number) * z + (projInv[15] as number);
  const px = vx / vw;
  const py = vy / vw;
  const pz = vz / vw;
  out[0] = (world[0] as number) * px + (world[4] as number) * py + (world[8] as number) * pz + (world[12] as number);
  out[1] = (world[1] as number) * px + (world[5] as number) * py + (world[9] as number) * pz + (world[13] as number);
  out[2] = (world[2] as number) * px + (world[6] as number) * py + (world[10] as number) * pz + (world[14] as number);
}

/** out = a · b for column-major 4×4 matrices. */
function multiply(a: ArrayLike<number>, b: ArrayLike<number>, out: Float64Array): void {
  for (let c = 0; c < 4; c++) {
    const b0 = b[c * 4] as number;
    const b1 = b[c * 4 + 1] as number;
    const b2 = b[c * 4 + 2] as number;
    const b3 = b[c * 4 + 3] as number;
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] =
        (a[r] as number) * b0 + (a[4 + r] as number) * b1 + (a[8 + r] as number) * b2 + (a[12 + r] as number) * b3;
    }
  }
}

/** Distance from p to segment ab and the parameter t ∈ [0, 1] of the closest point (`out` = [distance, t]). */
export function pointSegmentDistance(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  out: Float64Array | number[],
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const d = Math.hypot(ax + dx * t - px, ay + dy * t - py);
  out[0] = d;
  out[1] = t;
  return d;
}

/** True when segment ab intersects the axis-aligned rectangle [x0, x1] × [y0, y1] or lies inside it (Liang–Barsky). */
export function segmentIntersectsRect(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  const range = clipRange;
  range[0] = 0;
  range[1] = 1;
  return (
    clipEdge(-dx, ax - x0, range) &&
    clipEdge(dx, x1 - ax, range) &&
    clipEdge(-dy, ay - y0, range) &&
    clipEdge(dy, y1 - ay, range)
  );
}

const clipRange = new Float64Array(2);

/** One Liang–Barsky boundary: narrows [t0, t1] in `range`; false when the segment lies outside it. */
function clipEdge(p: number, q: number, range: Float64Array): boolean {
  if (p === 0) return q >= 0;
  const r = q / p;
  if (p < 0) {
    if (r > (range[1] as number)) return false;
    if (r > (range[0] as number)) range[0] = r;
  } else {
    if (r < (range[0] as number)) return false;
    if (r < (range[1] as number)) range[1] = r;
  }
  return true;
}

/** Normalizes a rectangle given by two corners. */
export function normalizeRect(rect: {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}): {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
} {
  return {
    x0: Math.min(rect.x0, rect.x1),
    y0: Math.min(rect.y0, rect.y1),
    x1: Math.max(rect.x0, rect.x1),
    y1: Math.max(rect.y0, rect.y1),
  };
}
