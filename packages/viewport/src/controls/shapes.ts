// Control shape line geometry (MVP-SPEC §4.11.15): unit splines from the anim-core shape registry, tessellated
// into line segments, then placed in control-local space by `size` and `ControlShape.offset`.
import { EkzaError, getControlShape, mat4Compose, type SplineSet, tessellateSplineSet } from '@ekza-animator/anim-core';
import type { ControlShape } from '@ekza-animator/doc';

/** Segments per circle of the fallback shape. */
const FALLBACK_SEGMENTS = 48;

/** Unit segments (xyz pairs) per built-in kind; shapes are immutable, so the cache never invalidates. */
const unitCache = new Map<string, Float32Array>();
let registryAvailable = true;

/**
 * Line segments (xyz pairs, unit size, local XY plane for planar shapes) of a control shape.
 *
 * Until the anim-core shape library lands (WP-1) `getControlShape` / `tessellateSplineSet` throw
 * `not-implemented`; every kind then draws as a unit circle so controls stay visible and pickable. The fallback
 * runs only while that stub is in place (recorded in docs/wp-notes/wp-5.md).
 */
export function unitShapeSegments(shape: Pick<ControlShape, 'kind' | 'custom'>): Float32Array {
  if (shape.kind === 'custom') {
    return shape.custom === null ? fallbackCircle() : tessellate(shape.custom);
  }
  const cached = unitCache.get(shape.kind);
  if (cached !== undefined) return cached;
  let segments: Float32Array;
  if (!registryAvailable) {
    segments = fallbackCircle();
  } else {
    try {
      const spline = getControlShape(shape.kind);
      segments = spline === undefined ? fallbackCircle() : tessellate(spline);
    } catch (error) {
      if (!isNotImplemented(error)) throw error;
      registryAvailable = false;
      segments = fallbackCircle();
    }
  }
  unitCache.set(shape.kind, segments);
  return segments;
}

/**
 * Segments of a control shape in control-local space: `p_local = offset · (size · p_unit)` (offset is a TRS
 * transform: it orients the planar shape and slides it down the bone).
 */
export function shapeLocalSegments(shape: ControlShape): Float32Array {
  const unit = unitShapeSegments(shape);
  const m = mat4Compose(shape.offset);
  const size = Number.isFinite(shape.size) && shape.size > 0 ? shape.size : 0.05;
  const out = new Float32Array(unit.length);
  for (let i = 0; i < unit.length; i += 3) {
    const x = (unit[i] as number) * size;
    const y = (unit[i + 1] as number) * size;
    const z = (unit[i + 2] as number) * size;
    out[i] = (m[0] as number) * x + (m[4] as number) * y + (m[8] as number) * z + (m[12] as number);
    out[i + 1] = (m[1] as number) * x + (m[5] as number) * y + (m[9] as number) * z + (m[13] as number);
    out[i + 2] = (m[2] as number) * x + (m[6] as number) * y + (m[10] as number) * z + (m[14] as number);
  }
  return out;
}

function tessellate(spline: SplineSet): Float32Array {
  if (registryAvailable) {
    try {
      return tessellateSplineSet(spline);
    } catch (error) {
      if (!isNotImplemented(error)) throw error;
      registryAvailable = false;
    }
  }
  return polylineSegments(spline);
}

/** Tessellation stand-in: control points as straight segments (Bézier handles ignored). */
function polylineSegments(spline: SplineSet): Float32Array {
  const out: number[] = [];
  for (const s of spline.splines) {
    const n = s.points.length;
    const count = s.closed ? n : n - 1;
    for (let i = 0; i < count; i++) {
      const a = s.points[i];
      const b = s.points[(i + 1) % n];
      if (a === undefined || b === undefined) continue;
      out.push(a[0], a[1], a[2], b[0], b[1], b[2]);
    }
  }
  return out.length === 0 ? fallbackCircle() : new Float32Array(out);
}

function fallbackCircle(): Float32Array {
  const out = new Float32Array(FALLBACK_SEGMENTS * 6);
  for (let i = 0; i < FALLBACK_SEGMENTS; i++) {
    const a0 = (i / FALLBACK_SEGMENTS) * Math.PI * 2;
    const a1 = ((i + 1) / FALLBACK_SEGMENTS) * Math.PI * 2;
    out.set([Math.cos(a0), Math.sin(a0), 0, Math.cos(a1), Math.sin(a1), 0], i * 6);
  }
  return out;
}

function isNotImplemented(error: unknown): boolean {
  return error instanceof EkzaError && error.code === 'not-implemented';
}
