// Typed values and display text of operator parameters (M6A-SPEC §1, §5.10, §8.6; B11): the Last-op card, Channel Box
// INPUTS, option boxes and the numeric capture window read and write `ParamDef` values through these helpers, so a
// typed `30%` means the same everywhere.
//
// `parseParamInput` wraps the shipped numeric-field grammar (`parseNumericInput`, research 09 §6.4: `[=]expr`,
// `+=`/`-=`/`*=`/`/=` against the current value, a decimal comma, `deg`/`rad`/`°`) and leaves that parser and its
// callers unchanged. It adds, by param kind:
// - `angle`: typed in degrees (`30` is 30°), alone takes `deg`/`rad`/`°`; stored in radians;
// - `distance`: metres, alone takes `m`/`cm`/`mm` (`50cm` → 0.5);
// - `fraction`: `30%` and `0.3` are the same value; a bare number is always a fraction (`30` is clamped to the field's
//   maximum with a problem string, §1);
// - `int`: rounds half away from zero;
// - every numeric kind: clamped into `[min, max]` with a problem string ('Fraction clamped to 1');
// - nullable params: an empty entry or `auto` is null ("auto");
// - `bool`, `enum`, `axis`: words and option labels; `data` cannot be typed.
import {
  DEG2RAD,
  isNumericParam,
  type ParamDef,
  type ParamValue,
  type ParamValues,
  paramLimits,
  primaryParam,
  RAD2DEG,
} from '@ekza-animator/anim-core';
import { parseNumericInput } from './numeric';

export type ParamInputResult =
  | { readonly value: ParamValue; readonly problem: string | null }
  | { readonly error: string };

/** A number with a length unit (`50cm`, `0.5 m`, `1,5mm`); the divisor turns it into a metres group. */
const LENGTH = /((?:\d+(?:[.,]\d*)?|[.,]\d+)(?:e[+-]?\d+)?)\s*(mm|cm|m)(?![a-z])/gi;
const LENGTH_DIVISOR: Readonly<Record<string, string>> = { m: '', cm: '/100', mm: '/1000' };
const ANGLE_UNIT = /deg|rad|°/i;

function roundHalfAwayFromZero(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/** Clamps a stored numeric value into the param's hard limits; the problem names what changed. */
export function clampParamValue(
  def: ParamDef,
  value: number,
): { readonly value: number; readonly problem: string | null } {
  let v = def.kind === 'int' ? roundHalfAwayFromZero(value) : value;
  if (v === 0) v = 0; // never -0
  const { min, max } = paramLimits(def);
  if (min !== undefined && v < min) return { value: min, problem: `${def.label} clamped to ${formatLimit(def, min)}` };
  if (max !== undefined && v > max) return { value: max, problem: `${def.label} clamped to ${formatLimit(def, max)}` };
  return { value: v, problem: null };
}

function formatLimit(def: ParamDef, stored: number): string {
  return formatParamValue(def, stored, { unit: false });
}

/** The current value of a numeric param as a number (its default when absent or null). */
function numericStart(def: ParamDef, current: ParamValue | undefined): number {
  if (typeof current === 'number' && Number.isFinite(current)) return current;
  return typeof def.default === 'number' ? def.default : 0;
}

/**
 * Parses typed `text` for `def` against the field's `current` stored value (relative entries such as `+=0.1` and
 * `*=2` apply to it). Returns the stored value (radians, metres, fractions 0…1) with a problem string when it was
 * clamped, or an error when the text does not parse.
 */
export function parseParamInput(text: string, current: ParamValue | undefined, def: ParamDef): ParamInputResult {
  const raw = text.trim();
  if (def.nullable === true && (raw === '' || raw.toLowerCase() === 'auto')) return { value: null, problem: null };
  if (def.kind === 'bool') {
    const lower = raw.toLowerCase();
    if (['true', 'yes', 'on', '1'].includes(lower)) return { value: true, problem: null };
    if (['false', 'no', 'off', '0'].includes(lower)) return { value: false, problem: null };
    return { error: `${def.label}: type on or off` };
  }
  if (def.kind === 'enum' || def.kind === 'axis') {
    const lower = raw.toLowerCase();
    const option = def.options?.find(
      (candidate) => candidate.value.toLowerCase() === lower || candidate.label.toLowerCase() === lower,
    );
    return option === undefined
      ? { error: `${def.label}: one of ${(def.options ?? []).map((o) => o.label).join(', ')}` }
      : { value: option.value, problem: null };
  }
  if (!isNumericParam(def)) return { error: `${def.label} cannot be typed` };
  const refuse = { error: `${def.label}: type a number` } as const;
  if (raw === '') return refuse;
  const start = numericStart(def, current);
  // The shipped grammar reads `deg`/`rad`/`°` anywhere: only angles take them.
  if (def.kind !== 'angle' && ANGLE_UNIT.test(raw)) return refuse;
  let value: number | null;
  if (def.kind === 'angle') {
    const degrees = parseNumericInput(raw, start * RAD2DEG);
    value = degrees === null ? null : degrees * DEG2RAD;
  } else if (def.kind === 'fraction' && raw.endsWith('%')) {
    const percent = parseNumericInput(raw.slice(0, -1), start * 100);
    value = percent === null ? null : percent / 100;
  } else if (def.kind === 'distance') {
    const metres = raw.replace(
      LENGTH,
      (_all, n: string, unit: string) => `(${n}${LENGTH_DIVISOR[unit.toLowerCase()] ?? ''})`,
    );
    value = parseNumericInput(metres, start);
  } else {
    if (/[a-z%]/i.test(raw)) return refuse;
    value = parseNumericInput(raw, start);
  }
  if (value === null) return refuse;
  return clampParamValue(def, value);
}

const fixed3 = (value: number): string => {
  const text = value.toFixed(3);
  return /^-0\.0+$/.test(text) ? text.slice(1) : text;
};

/**
 * Display text of a stored value (§8.6): distances `0.500 m`, fractions as fractions `0.300` (Maya), angles in degrees
 * `30.000°`, plain numbers `1.000`, ints `2`, booleans on/off, enum and axis options by label, null "auto".
 * `unit: false` drops the unit suffix (editable field text).
 */
export function formatParamValue(
  def: ParamDef,
  value: ParamValue | undefined,
  opts?: { readonly unit?: boolean },
): string {
  const unit = opts?.unit !== false;
  if (value === null || value === undefined) return def.nullable === true ? 'auto' : '';
  if (def.kind === 'bool') return value === true ? 'on' : 'off';
  if (def.kind === 'enum' || def.kind === 'axis') {
    const option = def.options?.find((candidate) => candidate.value === value);
    return option?.label ?? (typeof value === 'string' ? value : JSON.stringify(value));
  }
  if (def.kind === 'data') return '';
  if (typeof value !== 'number') return typeof value === 'string' ? value : JSON.stringify(value);
  if (def.kind === 'int') return String(roundHalfAwayFromZero(value));
  if (def.kind === 'angle') return `${fixed3(value * RAD2DEG)}${unit ? '°' : ''}`;
  if (def.kind === 'distance') return `${fixed3(value)}${unit ? ' m' : ''}`;
  return fixed3(value);
}

/** The editable text of a field (no unit; angles in degrees; nullable null as empty). */
export function paramEditText(def: ParamDef, value: ParamValue | undefined): string {
  if (value === null || value === undefined) return '';
  return formatParamValue(def, value, { unit: false });
}

/**
 * The fields the Last-op card, INPUTS and option boxes show (§8.6): value-bound, not hidden, not `data`; the primary
 * field first, the others in list order.
 */
export function visibleParams(params: readonly ParamDef[] | undefined): readonly ParamDef[] {
  if (params === undefined) return [];
  const shown = params.filter((def) => def.hidden !== true && def.kind !== 'data' && def.bound === 'value');
  const primary = primaryParam(shown);
  return primary === null ? shown : [primary, ...shown.filter((def) => def !== primary)];
}

/** Fields the numeric capture moves through (Tab order): the visible numeric params, primary first. */
export function numericParams(params: readonly ParamDef[] | undefined): readonly ParamDef[] {
  return visibleParams(params).filter(isNumericParam);
}

/** The primary visible param, else null (operations without one never arm the capture window). */
export function primaryVisibleParam(params: readonly ParamDef[] | undefined): ParamDef | null {
  const shown = visibleParams(params);
  return primaryParam(shown);
}

/** Per-pixel rate of a card/INPUTS virtual slider in stored units (the shipped rates where one exists). */
export function paramSliderRate(
  def: ParamDef,
  rates: { readonly degPerPx: number; readonly metresPerPx: number; readonly unitsPerPx: number },
): number {
  if (def.kind === 'angle') return rates.degPerPx * DEG2RAD;
  if (def.kind === 'distance') return rates.metresPerPx;
  if (def.kind === 'int') return 0.1;
  const { min, max } = paramLimits(def);
  const softMin = def.softMin ?? min;
  const softMax = def.softMax ?? max;
  if (softMin !== undefined && softMax !== undefined && softMax > softMin) return (softMax - softMin) / 200;
  return rates.unitsPerPx;
}

/** Values of `params` that differ from their defaults (a "Reset ⟲" restores the defaults). */
export function nonDefaultParams(params: readonly ParamDef[], values: ParamValues): readonly string[] {
  return params.filter((def) => Object.hasOwn(values, def.name) && values[def.name] !== def.default).map((d) => d.name);
}
