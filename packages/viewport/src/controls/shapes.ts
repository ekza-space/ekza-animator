// Control shape line geometry (MVP-SPEC §4.11.15): unit splines from the anim-core shape registry, tessellated
// into line segments, then placed in control-local space by `size` and `ControlShape.offset`.
import { getControlShape, mat4Compose, tessellateSplineSet } from '@ekza-animator/anim-core';
import type { ControlShape } from '@ekza-animator/doc';

/** Segments per circle of the fallback shape (an unknown kind, or a `custom` shape without data). */
const FALLBACK_SEGMENTS = 48;

/** Unit segments (xyz pairs) per built-in kind; shapes are immutable, so the cache never invalidates. */
const unitCache = new Map<string, Float32Array>();

/**
 * Line segments (xyz pairs, unit size, local XY plane for planar shapes) of a control shape: the anim-core shape
 * registry (built-ins and registered kinds) or the shape's own `custom` spline set; an unknown kind or a `custom`
 * shape without data draws as a unit circle so the control stays visible and pickable.
 */
export function unitShapeSegments(shape: Pick<ControlShape, 'kind' | 'custom'>): Float32Array {
  if (shape.kind === 'custom') {
    return shape.custom === null ? fallbackCircle() : tessellateSplineSet(shape.custom);
  }
  const cached = unitCache.get(shape.kind);
  if (cached !== undefined) return cached;
  const spline = getControlShape(shape.kind);
  const segments = spline === undefined ? fallbackCircle() : tessellateSplineSet(spline);
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

function fallbackCircle(): Float32Array {
  const out = new Float32Array(FALLBACK_SEGMENTS * 6);
  for (let i = 0; i < FALLBACK_SEGMENTS; i++) {
    const a0 = (i / FALLBACK_SEGMENTS) * Math.PI * 2;
    const a1 = ((i + 1) / FALLBACK_SEGMENTS) * Math.PI * 2;
    out.set([Math.cos(a0), Math.sin(a0), 0, Math.cos(a1), Math.sin(a1), 0], i * 6);
  }
  return out;
}
