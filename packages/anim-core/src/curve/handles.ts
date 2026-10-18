import { EkzaError } from '../errors';
import type { AnimCurve, Handle } from '../types';
import { infinityModeOf, normalizeKeys } from './keys';
import { type CurveOptions, resolveTangents } from './resolve';

/**
 * Resolved handles of key `index` (frames, value) before any monotonic correction: computed sides give the handle
 * the engine derives (a third of the span along the resolved slope); non-weighted fixed sides keep their direction
 * at a third of the span; weighted fixed sides return the stored handle. Writing these as `fixed` handles leaves the
 * curve unchanged (MVP-SPEC §4.11.4: `graph.tangent.set fixed`, handle drags, shape-preserving insert).
 */
export function resolveKeyHandles(
  curve: AnimCurve,
  index: number,
  opts?: CurveOptions,
): { readonly inHandle: Handle; readonly outHandle: Handle } {
  const keys = normalizeKeys(curve.keys);
  if (!Number.isInteger(index) || index < 0 || index >= keys.length) {
    throw new EkzaError('unsupported', `resolveKeyHandles: no key ${index} (keys: ${keys.length})`);
  }
  const r = resolveTangents(keys, curve.weighted === true, infinityModeOf(curve.pre), infinityModeOf(curve.post), opts);
  return {
    inHandle: { dt: r.inDt[index]!, dv: r.inDv[index]! },
    outHandle: { dt: r.outDt[index]!, dv: r.outDv[index]! },
  };
}
