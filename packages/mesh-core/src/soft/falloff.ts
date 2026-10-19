// Soft-selection falloff curves (M6A-SPEC §5.15): w = f(x), x = d / r clamped to [0, 1]. Presets: smooth (default,
// 1 − (3x² − 2x³)), linear (1 − x), sharp ((1 − x)²), root (√(1 − x)), sphere (√(1 − x²)), constant (1). A custom
// falloff is an anim-core `AnimCurve` evaluated at frame x (research 13 §5.15; M6a-stretch in the UI), clamped to
// [0, 1].
import { type AnimCurve, curveEngine } from '@ekza-animator/anim-core';
import { kernelError } from '../kernel';
import type { FalloffCurve } from '../types';

export type FalloffPreset = Exclude<FalloffCurve, AnimCurve>;

export const FALLOFF_PRESETS: readonly FalloffPreset[] = Object.freeze([
  'smooth',
  'linear',
  'sharp',
  'root',
  'sphere',
  'constant',
]);

/** A preset's weight at x (clamped to [0, 1]). */
export function presetFalloff(curve: FalloffPreset, x: number): number {
  const t = x <= 0 ? 0 : x >= 1 ? 1 : x;
  switch (curve) {
    case 'smooth':
      return 1 - t * t * (3 - 2 * t);
    case 'linear':
      return 1 - t;
    case 'sharp':
      return (1 - t) * (1 - t);
    case 'root':
      return Math.sqrt(1 - t);
    case 'sphere':
      return Math.sqrt(1 - t * t);
    case 'constant':
      return 1;
    default:
      throw kernelError('invalid-argument', `unknown falloff curve '${String(curve)}'`);
  }
}

/** The falloff as a function of x ∈ [0, 1] (custom curves compiled once). */
export function falloffFunction(curve: FalloffCurve): (x: number) => number {
  if (typeof curve === 'string') {
    presetFalloff(curve, 0); // validates the name
    return (x) => presetFalloff(curve, x);
  }
  if (typeof curve !== 'object' || curve === null || !Array.isArray(curve.keys)) {
    throw kernelError('invalid-argument', 'a custom falloff must be an AnimCurve');
  }
  const compiled = curveEngine.compile(curve);
  return (x) => {
    const t = x <= 0 ? 0 : x >= 1 ? 1 : x;
    const w = curveEngine.evaluate(compiled, t);
    return Number.isFinite(w) ? Math.min(1, Math.max(0, w)) : 0;
  };
}
