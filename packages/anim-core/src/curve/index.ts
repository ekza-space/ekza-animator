// Curve engine (MVP-SPEC §7 WP-1, ADR 0003): AnimX segment evaluation, tangents and infinities (Apache-2.0 port in
// ./animx), the documented Spline/Clamped approximations, shape-preserving insert and tangent numeric fields.
import type { CurveEngine } from '../types';
import { compileAnimCurve } from './compile';
import { evaluateAnimCurve } from './evaluate';

export { compileAnimCurve } from './compile';
export {
  evaluateAnimCurve,
  evaluateAnimCurveSlope,
  infinityMap,
  keyIndexAt,
  sampleAnimCurve,
  segmentControlPoints,
  spanKindAt,
  visibleKeyRange,
} from './evaluate';
export { handleFromFields, tangentFields } from './fields';
export { resolveKeyHandles } from './handles';
export { insertKeyPreservingShape } from './insert';
export { makeKeyData } from './keys';

/** The production engine behind the injectable `CurveEngine` interface (default compile options). */
export const curveEngine: CurveEngine = {
  compile: (curve) => compileAnimCurve(curve),
  evaluate: (curve, frame) => evaluateAnimCurve(curve, frame),
};
