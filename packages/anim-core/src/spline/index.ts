// Control-shape library and registry (MVP-SPEC §7 WP-1, ARCHITECTURE §12): built-in shapes are always available;
// extensions add more with `registerControlShape`. `custom` is not a registry entry: a control with kind `custom`
// carries its own SplineSet (`ControlShape.custom`).
import { EkzaError } from '../errors';
import type { ControlShapeKind, Disposer, ReadonlyVec3, Spline, SplineSet } from '../types';
import { type BuiltinShapeKind, buildBuiltinShapes } from './shapes';

export type { BuiltinShapeKind } from './shapes';

const BUILTIN_ORDER: readonly BuiltinShapeKind[] = [
  'circle',
  'halfCircle',
  'square',
  'cube',
  'sphere',
  'diamond',
  'arrow4',
  'star',
  'cross',
  'lollipop',
];

let builtins: ReadonlyMap<BuiltinShapeKind, SplineSet> | undefined;
function builtinShapes(): ReadonlyMap<BuiltinShapeKind, SplineSet> {
  builtins ??= buildBuiltinShapes();
  return builtins;
}

/** Shapes registered by extensions, in registration order. */
const registered = new Map<ControlShapeKind, SplineSet>();

/** Built-in shapes are always available; extensions add more. Unit size; planar shapes in XY (normal +Z). */
export function getControlShape(kind: ControlShapeKind): SplineSet | undefined {
  return builtinShapes().get(kind as BuiltinShapeKind) ?? registered.get(kind);
}

/**
 * Registers an extension shape under a new kind. Throws `EkzaError('unsupported')` for an empty kind, a built-in
 * kind, `custom` or a kind that is already registered, and `EkzaError('invalid-record')` for malformed data. The
 * shape is copied and frozen. The disposer removes this registration only (idempotent).
 */
export function registerControlShape(kind: ControlShapeKind, shape: SplineSet): Disposer {
  if (typeof kind !== 'string' || kind.length === 0) {
    throw new EkzaError('unsupported', 'Control shape kinds are non-empty strings');
  }
  if (kind === 'custom' || builtinShapes().has(kind as BuiltinShapeKind) || registered.has(kind)) {
    throw new EkzaError('unsupported', `Control shape '${kind}' is already registered`);
  }
  const copy = validateSplineSet(shape, kind);
  registered.set(kind, copy);
  return () => {
    if (registered.get(kind) === copy) registered.delete(kind);
  };
}

/** Built-in kinds (fixed order), then extension kinds in registration order. */
export function listControlShapes(): readonly ControlShapeKind[] {
  return [...BUILTIN_ORDER, ...registered.keys()];
}

function invalid(kind: string, message: string): EkzaError {
  return new EkzaError('invalid-record', `Control shape '${kind}': ${message}`);
}

function copyPoints(points: unknown, kind: string, what: string): ReadonlyVec3[] {
  if (!Array.isArray(points)) throw invalid(kind, `${what} must be an array`);
  return points.map((p: unknown) => {
    if (!Array.isArray(p) || p.length !== 3 || !p.every((x: unknown) => typeof x === 'number' && Number.isFinite(x))) {
      throw invalid(kind, `${what} must hold finite [x, y, z] triples`);
    }
    return Object.freeze([p[0] as number, p[1] as number, p[2] as number] as const);
  });
}

/** Deep copy of a valid SplineSet, frozen. */
function validateSplineSet(shape: SplineSet, kind: string): SplineSet {
  if (typeof shape !== 'object' || shape === null || shape.v !== 1 || !Array.isArray(shape.splines)) {
    throw invalid(kind, 'expected { v: 1, splines: [...] }');
  }
  const splines = shape.splines.map((spline: Spline): Spline => {
    if (spline.kind !== 'poly' && spline.kind !== 'bezier')
      throw invalid(kind, `unknown spline kind '${String(spline.kind)}'`);
    if (typeof spline.closed !== 'boolean') throw invalid(kind, '`closed` must be a boolean');
    const points = copyPoints(spline.points, kind, 'points');
    if (spline.kind === 'poly')
      return Object.freeze({ kind: 'poly', closed: spline.closed, points: Object.freeze(points) });
    const handlesIn = copyPoints(spline.handlesIn, kind, 'handlesIn');
    const handlesOut = copyPoints(spline.handlesOut, kind, 'handlesOut');
    if (handlesIn.length !== points.length || handlesOut.length !== points.length) {
      throw invalid(kind, 'bezier handles must have one entry per point');
    }
    return Object.freeze({
      kind: 'bezier',
      closed: spline.closed,
      points: Object.freeze(points),
      handlesIn: Object.freeze(handlesIn),
      handlesOut: Object.freeze(handlesOut),
    });
  });
  return Object.freeze({ v: 1, splines: Object.freeze(splines) });
}

/** Default subdivision of a Bézier span: 6 → 48 segments per built-in circle (8 spans of 45°). */
const DEFAULT_SEGMENTS_PER_SPAN = 6;

/**
 * Line-segment geometry of a SplineSet for `LineSegments`: each segment contributes its two endpoints, so the result
 * holds 6 floats (x, y, z, x, y, z) per segment. Poly splines give one segment per edge; Bézier spans are split into
 * `segmentsPerSpan` uniform-parameter pieces (a span without handles is straight). Closed splines add the closing
 * span; a spline with fewer than two points adds nothing.
 */
export function tessellateSplineSet(s: SplineSet, segmentsPerSpan: number = DEFAULT_SEGMENTS_PER_SPAN): Float32Array {
  if (!Number.isInteger(segmentsPerSpan) || segmentsPerSpan < 1) {
    throw new EkzaError('unsupported', `tessellateSplineSet: segmentsPerSpan must be an integer ≥ 1`);
  }
  let segments = 0;
  for (const spline of s.splines) {
    const spans = spanCount(spline);
    segments += spline.kind === 'bezier' ? spans * segmentsPerSpan : spans;
  }
  const out = new Float32Array(segments * 6);
  let o = 0;
  const write = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void => {
    out[o++] = x0;
    out[o++] = y0;
    out[o++] = z0;
    out[o++] = x1;
    out[o++] = y1;
    out[o++] = z1;
  };
  for (const spline of s.splines) {
    const spans = spanCount(spline);
    const points = spline.points;
    const n = points.length;
    for (let i = 0; i < spans; i++) {
      const a = points[i]!;
      const b = points[(i + 1) % n]!;
      if (spline.kind !== 'bezier') {
        write(a[0], a[1], a[2], b[0], b[1], b[2]);
        continue;
      }
      // a missing handle sits a third of the way along the chord (a straight, uniformly parameterized span)
      const h1 = spline.handlesOut?.[i] ?? lerp3(a, b, 1 / 3);
      const h2 = spline.handlesIn?.[(i + 1) % n] ?? lerp3(a, b, 2 / 3);
      let px = a[0];
      let py = a[1];
      let pz = a[2];
      for (let j = 1; j <= segmentsPerSpan; j++) {
        const u = j / segmentsPerSpan;
        const w = 1 - u;
        const b0 = w * w * w;
        const b1 = 3 * w * w * u;
        const b2 = 3 * w * u * u;
        const b3 = u * u * u;
        const x = j === segmentsPerSpan ? b[0] : b0 * a[0] + b1 * h1[0] + b2 * h2[0] + b3 * b[0];
        const y = j === segmentsPerSpan ? b[1] : b0 * a[1] + b1 * h1[1] + b2 * h2[1] + b3 * b[1];
        const z = j === segmentsPerSpan ? b[2] : b0 * a[2] + b1 * h1[2] + b2 * h2[2] + b3 * b[2];
        write(px, py, pz, x, y, z);
        px = x;
        py = y;
        pz = z;
      }
    }
  }
  return out;
}

function lerp3(a: ReadonlyVec3, b: ReadonlyVec3, u: number): ReadonlyVec3 {
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
}

function spanCount(spline: Spline): number {
  const n = spline.points.length;
  if (n < 2) return 0;
  return spline.closed && n > 2 ? n : n - 1;
}
