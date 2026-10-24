// `@ekza-studio/editor-core/forms` (STUDIO-TOUCH-SPEC §5.6, §20.3 item 6, §20.4; T5a): the touch shell's pre-run
// forms. Imported only by the touch shell (`tooling/param-lint.mjs` fails on any other importer), so Studio Pro, the
// Last-op card (`LastRun`), Repeat Last / Adjust Last and the agent schemas never read it, and nothing in Studio Pro
// depends on whether this chunk has loaded. There is no `addParams`: making an operator adjustable in Studio Pro is a
// separate, per-operator change (OQ-15).
import {
  assertParams,
  coerceArgs,
  EkzaError,
  type ParamDef,
  type ParamValues,
  paramDefaults,
} from '@ekza-studio/anim-core';
import type { OperatorDef } from '../types';
import {
  DELETE_TIME_FORM,
  HOLD_FORM,
  IK_FK_SWITCH_FORM,
  INFINITY_FORM,
  INSERT_TIME_FORM,
  LOOK_AT_FORM,
  LOOP_FORM,
  MATCH_RANGE_FORM,
  MIRROR_ANIMATION_FORM,
  NEW_CLIP_FORM,
  OFFSET_IN_LOOP_FORM,
  OFFSET_VALUES_FORM,
  PASTE_AT_FORM,
  PLACE_GOAL_FORM,
  REACH_FORM,
  REPLACE_IMAGE_FORM,
  SCALE_VALUES_FORM,
  SIMPLIFY_FORM,
  TWEEN_FORM,
  USE_CLIP_FORM,
} from './defs';
import type { AnyFormDef, FormSessionValue, FormView } from './types';

export {
  FORM_BLEND_FRAMES,
  FORM_CLIP_RANGE,
  FORM_TWEEN_LIMITS,
} from './defs';
export type {
  AnyFormDef,
  ArgAt,
  ArgPath,
  DefaultFor,
  FormArgs,
  FormDef,
  FormParam,
  FormSessionValue,
  FormView,
  KindFor,
  OptionFor,
} from './types';

function erase(form: {
  readonly id: string;
  readonly params: readonly ParamDef[];
  readonly fromSession?: readonly FormSessionValue[];
  readonly base?: object;
}): AnyFormDef {
  return Object.freeze({
    id: form.id,
    params: Object.freeze([...form.params]),
    fromSession: Object.freeze([...(form.fromSession ?? [])]),
    base: Object.freeze({ ...form.base }),
  });
}

/** Every form, by operator id (one per operator). */
export const FORM_DEFS: ReadonlyMap<string, AnyFormDef> = new Map(
  [
    SIMPLIFY_FORM,
    INFINITY_FORM,
    TWEEN_FORM,
    INSERT_TIME_FORM,
    DELETE_TIME_FORM,
    MIRROR_ANIMATION_FORM,
    NEW_CLIP_FORM,
    IK_FK_SWITCH_FORM,
    MATCH_RANGE_FORM,
    USE_CLIP_FORM,
    HOLD_FORM,
    PASTE_AT_FORM,
    PLACE_GOAL_FORM,
    LOOK_AT_FORM,
    REACH_FORM,
    LOOP_FORM,
    SCALE_VALUES_FORM,
    OFFSET_VALUES_FORM,
    OFFSET_IN_LOOP_FORM,
    REPLACE_IMAGE_FORM,
  ].map((form) => [form.id, erase(form)] as const),
);

/**
 * What the touch shell shows before running `id` (§5.6): its form; else, for an operator that declares ParamDefs but
 * is not adjustable after the run, those ParamDefs (Studio Pro's option-box fields); else null — an adjustable operator
 * gets after-run chips (`edit.adjustLast`), and an operator without parameters runs at once.
 */
export function formOf(
  id: string,
  def?: Pick<OperatorDef<unknown, unknown, unknown>, 'params' | 'flags'>,
): FormView | null {
  const form = FORM_DEFS.get(id);
  if (form !== undefined) return { ...form, source: 'form' };
  if (def?.params === undefined || def.flags?.adjustable === true) return null;
  const params = def.params.filter((param) => param.hidden !== true && param.kind !== 'data');
  if (params.length === 0) return null;
  return { id, params: def.params, fromSession: [], base: {}, source: 'params' };
}

/** The values a form opens with (dotted names; null for "auto"). */
export function formDefaults(form: Pick<AnyFormDef, 'params'>): ParamValues {
  return paramDefaults(form.params);
}

function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let node = target;
  for (const part of parts.slice(0, -1)) {
    const next = node[part];
    const copy: Record<string, unknown> =
      typeof next === 'object' && next !== null && !Array.isArray(next) ? { ...(next as Record<string, unknown>) } : {};
    node[part] = copy;
    node = copy;
  }
  node[parts.at(-1) as string] = value;
}

/**
 * The run arguments of a form: `values` (dotted names) over the defaults, coerced like an option box (clamped, ints
 * rounded, enums checked; `problems` says what changed), nested into objects by their paths over the form's `base` and
 * the caller's `base` (the targets the touch shell resolved: the limb, the clip, the picked plane). A nullable param
 * left at null ("auto") is left out, so the operator resolves it.
 */
export function formArgs(
  form: Pick<AnyFormDef, 'params'> & { readonly base?: Readonly<Record<string, unknown>> },
  values?: Readonly<Record<string, unknown>>,
  base?: Readonly<Record<string, unknown>>,
): { readonly args: Readonly<Record<string, unknown>>; readonly problems: readonly string[] } {
  const { args: coerced, problems } = coerceArgs(form.params, values ?? {});
  const args: Record<string, unknown> = { ...form.base, ...base };
  for (const param of form.params) {
    const value = coerced[param.name];
    if (value === null && param.nullable === true) continue;
    setPath(args, param.name, value);
  }
  return { args, problems };
}

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
