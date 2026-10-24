// The forms' well-formedness check (STUDIO-TOUCH-SPEC §20.5 test 9, T5a; split out at T6-INT, P-T6A-6): read by
// `tooling/param-lint.mjs` and the forms tests (by path), never by the touch shell, and deliberately not re-exported
// from the forms index: Turbopack emits a shared module once with every export any chunk uses, so a re-export kept
// anim-core's `assertParams` in the `params` module every route loads. Measured at T6-INT: /editor −380 B,
// /autorig −323 B, /app −374 B (ST-T6A-20, ST-T6INT-*).
import { assertParams, EkzaError } from '@ekza-studio/anim-core';
import type { AnyFormDef } from './types';

/** Why a form is unusable (bad params, a path inside another param's path, no operator id), else []. */
export function formProblems(form: Pick<AnyFormDef, 'id' | 'params'>): string[] {
  const problems: string[] = [];
  if (!/^[A-Za-z][A-Za-z0-9]*(\.[A-Za-z][A-Za-z0-9]*)+$/.test(form.id)) problems.push(`${form.id}: not an operator id`);
  try {
    assertParams(form.params);
  } catch (error) {
    problems.push(`${form.id}: ${error instanceof EkzaError ? error.message : String(error)}`);
  }
  const names = form.params.map((param) => param.name);
  for (const name of names) {
    const inner = names.find((other) => other !== name && other.startsWith(`${name}.`));
    if (inner !== undefined) problems.push(`${form.id}: '${inner}' is inside '${name}'`);
  }
  return problems;
}
