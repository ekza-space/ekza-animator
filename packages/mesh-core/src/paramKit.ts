// Shorthands for the `ParamDef` lists of the op descriptors and primitives (M6A-SPEC §6.1, §6.3). Eager-safe: plain
// data, no kernel code. Units are stored units (metres, radians, fractions 0…1); steps follow §4.1 (int 1, angle 1°,
// distance 0.01). Selection- and pointer-bound params are hidden (the card and INPUTS never show them).
import type { JsonValue, ParamBound, ParamDef } from '@ekza-studio/anim-core';

export const DEG = Math.PI / 180;

type Extra = Partial<Omit<ParamDef, 'name' | 'label' | 'kind' | 'default'>>;

const bound = (extra: Extra | undefined): { readonly bound: ParamBound } => ({ bound: extra?.bound ?? 'value' });
const hiddenIfBound = (extra: Extra | undefined): { readonly hidden?: true } =>
  extra?.bound === 'selection' || extra?.bound === 'pointer' || extra?.hidden === true ? { hidden: true } : {};

export function distance(name: string, label: string, value: number | null, extra?: Extra): ParamDef {
  return {
    name,
    label,
    kind: 'distance',
    default: value,
    step: 0.01,
    ...(value === null ? { nullable: true } : {}),
    ...extra,
    ...bound(extra),
    ...hiddenIfBound(extra),
  };
}

export function number(name: string, label: string, value: number, extra?: Extra): ParamDef {
  return {
    name,
    label,
    kind: 'number',
    default: value,
    step: 0.01,
    ...extra,
    ...bound(extra),
    ...hiddenIfBound(extra),
  };
}

export function int(name: string, label: string, value: number | null, extra?: Extra): ParamDef {
  return {
    name,
    label,
    kind: 'int',
    default: value,
    step: 1,
    ...(value === null ? { nullable: true } : {}),
    ...extra,
    ...bound(extra),
    ...hiddenIfBound(extra),
  };
}

/** Degrees in, radians stored (`null` = nullable "auto"). */
export function angle(name: string, label: string, degrees: number | null, extra?: Extra): ParamDef {
  return {
    name,
    label,
    kind: 'angle',
    default: degrees === null ? null : degrees * DEG,
    step: DEG,
    ...(degrees === null ? { nullable: true } : {}),
    ...extra,
    ...bound(extra),
    ...hiddenIfBound(extra),
  };
}

export function fraction(name: string, label: string, value: number, extra?: Extra): ParamDef {
  return {
    name,
    label,
    kind: 'fraction',
    default: value,
    step: 0.01,
    ...extra,
    ...bound(extra),
    ...hiddenIfBound(extra),
  };
}

export function bool(name: string, label: string, value: boolean, extra?: Extra): ParamDef {
  return { name, label, kind: 'bool', default: value, ...extra, ...bound(extra), ...hiddenIfBound(extra) };
}

export function enumOf(
  name: string,
  label: string,
  options: readonly (readonly [value: string, label: string])[],
  value: string,
  extra?: Extra,
): ParamDef {
  return {
    name,
    label,
    kind: 'enum',
    default: value,
    options: options.map(([v, l]) => ({ value: v, label: l })),
    ...extra,
    ...bound(extra),
    ...hiddenIfBound(extra),
  };
}

export function axis(name: string, label: string, value: 'x' | 'y' | 'z', extra?: Extra): ParamDef {
  return {
    name,
    label,
    kind: 'axis',
    default: value,
    options: [
      { value: 'x', label: 'X' },
      { value: 'y', label: 'Y' },
      { value: 'z', label: 'Z' },
    ],
    ...extra,
    ...bound(extra),
    ...hiddenIfBound(extra),
  };
}

/** Structured data: always hidden; `null` default = nullable (absent → resolved by the op or the tool). */
export function data(name: string, label: string, schema: JsonValue, value: JsonValue | null, extra?: Extra): ParamDef {
  return {
    name,
    label,
    kind: 'data',
    default: value,
    schema,
    hidden: true,
    ...(value === null ? { nullable: true } : {}),
    ...extra,
    ...bound(extra),
  };
}

export const NUMBERS: JsonValue = { type: 'array', items: { type: 'number' } };
export const INTS: JsonValue = { type: 'array', items: { type: 'integer', minimum: 0 } };

/** `smoothingAngle`: the nullable angle of every op that creates side or strip edges (§5.3). */
export const SMOOTHING_ANGLE: ParamDef = angle('smoothingAngle', 'Smoothing Angle', null, { min: 0, max: Math.PI });
