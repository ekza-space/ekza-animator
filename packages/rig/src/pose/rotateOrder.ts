import {
  type AnimCurve,
  type CurveEngine,
  curveEngine,
  eulerFilter,
  eulerNear,
  eulerToQuat,
  type KeyData,
  type RotateOrder,
  type Vec3,
} from '@ekza-animator/anim-core';

const TIME_EPSILON = 1e-6;

/**
 * Pose-preserving rotate-order change (M1-stretch, MVP-SPEC §4.11.5): rx ry rz are sampled at the union of their key
 * times, each sample is converted with eulerNear against the previously converted one, Euler-filtered, and written
 * as keys on all three curves at the union (synchronizing them). A key that existed on a curve keeps its tangent types
 * and handles; new keys are `auto`. Values between a curve's keys come from anim-core's curve engine.
 */
export function convertRotateOrderKeys(
  curves: readonly [AnimCurve, AnimCurve, AnimCurve],
  from: RotateOrder,
  to: RotateOrder,
): [KeyData[], KeyData[], KeyData[]] {
  return convertRotateOrderKeysWith(curveEngine, curves, from, to);
}

export function convertRotateOrderKeysWith(
  engine: CurveEngine,
  curves: readonly [AnimCurve, AnimCurve, AnimCurve],
  from: RotateOrder,
  to: RotateOrder,
): [KeyData[], KeyData[], KeyData[]] {
  const times: number[] = [];
  for (const curve of curves) for (const key of curve.keys) times.push(key.t);
  times.sort((a, b) => a - b);
  const union: number[] = [];
  for (const t of times) if (union.length === 0 || t - (union[union.length - 1] as number) > TIME_EPSILON) union.push(t);
  if (union.length === 0) return [[], [], []];

  // Compile lazily: synchronized curves (every key at every union time) never need the engine.
  const compiled: (ReturnType<CurveEngine['compile']> | undefined)[] = [undefined, undefined, undefined];
  const compiledOf = (axis: number): ReturnType<CurveEngine['compile']> => {
    let c = compiled[axis];
    if (c === undefined) {
      c = engine.compile(curves[axis] as AnimCurve);
      compiled[axis] = c;
    }
    return c;
  };
  const samples: Vec3[] = [];
  let previous: Vec3 | null = null;
  for (const t of union) {
    const old: Vec3 = [0, 1, 2].map((axis) => valueAt(curves[axis] as AnimCurve, () => compiledOf(axis), engine, t)) as Vec3;
    const converted = eulerNear(eulerToQuat(old, from), to, previous ?? old);
    samples.push(converted);
    previous = converted;
  }
  eulerFilter(samples, to);

  const result: [KeyData[], KeyData[], KeyData[]] = [[], [], []];
  for (let axis = 0; axis < 3; axis++) {
    const source = (curves[axis] as AnimCurve).keys;
    union.forEach((t, i) => {
      const v = (samples[i] as Vec3)[axis] as number;
      const existing = source.find((key) => Math.abs(key.t - t) <= TIME_EPSILON);
      result[axis]?.push(
        existing !== undefined
          ? { ...existing, t, v }
          : {
              t,
              v,
              inType: 'auto',
              outType: 'auto',
              inHandle: { dt: 0, dv: 0 },
              outHandle: { dt: 0, dv: 0 },
              broken: false,
              weightLocked: true,
            },
      );
    });
  }
  return result;
}

function valueAt(
  curve: AnimCurve,
  compiled: () => ReturnType<CurveEngine['compile']>,
  engine: CurveEngine,
  t: number,
): number {
  const exact = curve.keys.find((key) => Math.abs(key.t - t) <= TIME_EPSILON);
  if (exact !== undefined) return exact.v;
  if (curve.keys.length === 0) return 0;
  return engine.evaluate(compiled(), t);
}
