// Strict JSON reading for contract documents (GAME-PROTOCOL-SPEC §3.3, §3.5): every check of the JSON Schema in code
// (no schema library in the bundle), each failure an `EkzaError('invalid-input')` naming the field. A reader context
// carries the strictness: unknown keys are errors, unless the document is a newer minor this reader may read, when they
// are skipped and recorded (`ignored`).
import { EkzaError } from '@ekza-studio/anim-core';

export type Json = Readonly<Record<string, unknown>>;

export interface ReadContext {
  /** Skip unknown keys (a newer minor, §3.3) instead of refusing them. */
  readonly lenient: boolean;
  /** The unknown keys skipped, by path. */
  readonly ignored: string[];
}

export function fail(field: string, expected: string): never {
  throw new EkzaError('invalid-input', `game contract: ${field} must be ${expected}`, { field });
}

export function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** An object with exactly `keys` (plus `optional`); unknown keys refuse (or are skipped when lenient). */
export function record(
  ctx: ReadContext,
  value: unknown,
  field: string,
  keys: readonly string[],
  optional: readonly string[] = [],
): Json {
  if (!isObject(value)) fail(field, 'an object');
  for (const key of Object.keys(value)) {
    if (keys.includes(key) || optional.includes(key)) continue;
    if (ctx.lenient) ctx.ignored.push(`${field}.${key}`);
    else fail(`${field}.${key}`, 'absent (unknown key)');
  }
  for (const key of keys) if (!(key in value)) fail(`${field}.${key}`, 'present');
  return value;
}

/** A map object whose keys match `pattern` (at most `max` entries). */
export function map(value: unknown, field: string, pattern: RegExp, max = 4096): Json {
  if (!isObject(value)) fail(field, 'an object');
  const keys = Object.keys(value);
  if (keys.length > max) fail(field, `at most ${max} entries`);
  for (const key of keys) if (!pattern.test(key)) fail(`${field}['${key}']`, `keyed by ${pattern.source}`);
  return value;
}

export function str(json: Json, key: string, field: string, pattern?: RegExp, max = Number.POSITIVE_INFINITY): string {
  const value = json[key];
  if (typeof value !== 'string') fail(`${field}.${key}`, 'a string');
  if (value.length > max) fail(`${field}.${key}`, `at most ${max} characters`);
  if (pattern !== undefined && !pattern.test(value)) fail(`${field}.${key}`, `a string matching ${pattern.source}`);
  return value;
}

export function text(json: Json, key: string, field: string, min: number, max: number): string {
  const value = str(json, key, field, undefined, max);
  if (value.length < min) fail(`${field}.${key}`, `at least ${min} character(s)`);
  return value;
}

export function nullableStr(json: Json, key: string, field: string, pattern?: RegExp, max?: number): string | null {
  return json[key] === null ? null : str(json, key, field, pattern, max);
}

export function oneOf<T extends string>(json: Json, key: string, field: string, values: readonly T[]): T {
  const value = json[key];
  if (!values.includes(value as T)) fail(`${field}.${key}`, `one of ${values.map((v) => `'${v}'`).join(', ')}`);
  return value as T;
}

export function exactly<T extends string | number>(json: Json, key: string, field: string, expected: T): T {
  if (json[key] !== expected) fail(`${field}.${key}`, JSON.stringify(expected));
  return expected;
}

export function bool(json: Json, key: string, field: string): boolean {
  const value = json[key];
  if (typeof value !== 'boolean') fail(`${field}.${key}`, 'a boolean');
  return value;
}

export interface NumberRule {
  readonly integer?: boolean;
  readonly min?: number;
  readonly exclusiveMin?: number;
  readonly max?: number;
}

export function numberAt(value: unknown, field: string, rule: NumberRule = {}): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(field, 'a finite number');
  if (rule.integer === true && !Number.isInteger(value)) fail(field, 'an integer');
  if (rule.min !== undefined && value < rule.min) fail(field, `≥ ${rule.min}`);
  if (rule.exclusiveMin !== undefined && value <= rule.exclusiveMin) fail(field, `> ${rule.exclusiveMin}`);
  if (rule.max !== undefined && value > rule.max) fail(field, `≤ ${rule.max}`);
  return value;
}

export function num(json: Json, key: string, field: string, rule: NumberRule = {}): number {
  return numberAt(json[key], `${field}.${key}`, rule);
}

export function nullableNum(json: Json, key: string, field: string, rule: NumberRule = {}): number | null {
  return json[key] === null ? null : num(json, key, field, rule);
}

export function list(
  json: Json,
  key: string,
  field: string,
  opts: { readonly min?: number; readonly max?: number; readonly unique?: boolean } = {},
): readonly unknown[] {
  const value = json[key];
  if (!Array.isArray(value)) fail(`${field}.${key}`, 'an array');
  const items = value as readonly unknown[];
  if (opts.min !== undefined && items.length < opts.min) fail(`${field}.${key}`, `at least ${opts.min} item(s)`);
  if (opts.max !== undefined && items.length > opts.max) fail(`${field}.${key}`, `at most ${opts.max} item(s)`);
  if (opts.unique === true) {
    const seen = new Set<string>();
    for (const item of items) {
      const k = JSON.stringify(item);
      if (seen.has(k)) fail(`${field}.${key}`, `unique (${k} repeats)`);
      seen.add(k);
    }
  }
  return items;
}

export function strings(
  json: Json,
  key: string,
  field: string,
  pattern: RegExp,
  opts: { readonly min?: number; readonly max?: number; readonly unique?: boolean } = {},
): string[] {
  return list(json, key, field, opts).map((item, i) => {
    if (typeof item !== 'string' || !pattern.test(item)) {
      fail(`${field}.${key}[${i}]`, `a string matching ${pattern.source}`);
    }
    return item;
  });
}

export function enums<T extends string>(json: Json, key: string, field: string, values: readonly T[], min = 0): T[] {
  return list(json, key, field, { min, unique: true }).map((item, i) => {
    if (!values.includes(item as T)) fail(`${field}.${key}[${i}]`, `one of ${values.join(', ')}`);
    return item as T;
  });
}

export function range(json: Json, key: string, field: string): readonly [number, number] {
  const items = list(json, key, field, { min: 2, max: 2 });
  return [numberAt(items[0], `${field}.${key}[0]`), numberAt(items[1], `${field}.${key}[1]`)];
}

export function vec3(value: unknown, field: string, limit = 100): readonly [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3) fail(field, 'three numbers');
  const items = value as readonly unknown[];
  const rule = { min: -limit, max: limit };
  return [
    numberAt(items[0], `${field}[0]`, rule),
    numberAt(items[1], `${field}[1]`, rule),
    numberAt(items[2], `${field}[2]`, rule),
  ];
}

export function stringMap(json: Json, key: string, field: string, pattern?: RegExp): Readonly<Record<string, string>> {
  const value = json[key];
  if (!isObject(value)) fail(`${field}.${key}`, 'an object');
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof v !== 'string' || (pattern !== undefined && !pattern.test(v))) {
      fail(`${field}.${key}.${k}`, pattern === undefined ? 'a string' : `a string matching ${pattern.source}`);
    }
    out[k] = v;
  }
  return out;
}
