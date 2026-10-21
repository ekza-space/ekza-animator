// Simplify feedback and tolerances (MVP-SPEC §4.11.4 Simplify). Acceptance round 1: Simplify gave no feedback, and
// on clips imported with key reduction (the same 0.1° default) it silently removed nothing.
import { DEFAULT_REDUCE, type ReduceSpec } from '@ekza-studio/rig';

/** Tolerance choices as multiples of `DEFAULT_REDUCE`, named by their rotation value. */
export const SIMPLIFY_TOLERANCES = [
  { value: '1', label: '0.1°' },
  { value: '2.5', label: '0.25°' },
  { value: '5', label: '0.5°' },
  { value: '10', label: '1°' },
  { value: '20', label: '2°' },
] as const;
export type SimplifyFactor = (typeof SIMPLIFY_TOLERANCES)[number]['value'];

/** `DEFAULT_REDUCE` scaled by `factor`: translation and scale tolerances grow with the rotation one. */
export function simplifyTolerance(factor: number): ReduceSpec {
  return {
    rotationRad: DEFAULT_REDUCE.rotationRad * factor,
    translationM: DEFAULT_REDUCE.translationM * factor,
    scale: DEFAULT_REDUCE.scale * factor,
  };
}

/** "0.25°" for a tolerance (the default when the run had none). */
export function toleranceLabel(spec: ReduceSpec | undefined): string {
  const degrees = ((spec ?? DEFAULT_REDUCE).rotationRad * 180) / Math.PI;
  return `${Number(degrees.toPrecision(3))}°`;
}

/** The tolerance of a `graph.curves.simplify` run's arguments. */
export function toleranceOfArgs(args: unknown): ReduceSpec | undefined {
  if (typeof args !== 'object' || args === null) return undefined;
  const tolerance = (args as { readonly tolerance?: unknown }).tolerance;
  return typeof tolerance === 'object' && tolerance !== null ? (tolerance as ReduceSpec) : undefined;
}

/** What a finished Simplify did, for a toast or the help line. */
export function simplifyMessage(result: unknown, spec: ReduceSpec | undefined): string | null {
  if (typeof result !== 'object' || result === null) return null;
  const { before, after } = result as { readonly before?: unknown; readonly after?: unknown };
  if (typeof before !== 'number' || typeof after !== 'number') return null;
  const tolerance = toleranceLabel(spec);
  if (after < before) return `Simplify: ${before} → ${after} keys (${before - after} removed within ${tolerance})`;
  return `Simplify: nothing to remove within ${tolerance} (${before} keys); choose a larger tolerance`;
}
