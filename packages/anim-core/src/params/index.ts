// Parameter descriptions (M6A-SPEC §4.1, ADR 0016 D6): one `ParamDef` list describes an operation's arguments for
// the kernel (JSON args, defaults, validation), the editor (Last-op card, Channel Box INPUTS, option boxes, command
// palette prompts, numeric capture) and, later, scripting and agent schemas. Every function here is pure,
// deterministic and Node-safe; `coerceArgs` never throws.
import { EkzaError } from '../errors';
import type { JsonValue, ParamBound, ParamDef, ParamKind, ParamValue, ParamValues } from './types';

export type { JsonValue, ParamBound, ParamDef, ParamKind, ParamValue, ParamValues } from './types';

const NUMERIC_KINDS: ReadonlySet<ParamKind> = new Set(['number', 'int', 'distance', 'angle', 'fraction']);
const AXIS_VALUES: readonly string[] = ['x', 'y', 'z'];
const JSON_SCHEMA_DRAFT = 'https://json-schema.org/draft/2020-12/schema';

const isObject = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** True for numeric kinds ('number', 'int', 'distance', 'angle', 'fraction'). */
export function isNumericParam(param: ParamDef): boolean {
  return NUMERIC_KINDS.has(param.kind);
}

/** Hard limits of a numeric param: its `min`/`max`, and 0…1 for fractions without their own limits. */
export function paramLimits(param: ParamDef): { readonly min: number | undefined; readonly max: number | undefined } {
  if (param.kind === 'fraction') return { min: param.min ?? 0, max: param.max ?? 1 };
  return { min: param.min, max: param.max };
}

/** The allowed string values of an 'enum' or 'axis' param ('axis' without options: x, y, z). */
export function paramOptionValues(param: ParamDef): readonly string[] {
  if (param.options !== undefined) return param.options.map((option) => option.value);
  return param.kind === 'axis' ? AXIS_VALUES : [];
}

/** Defaults of every param (nullable params: null). */
export function paramDefaults(params: readonly ParamDef[]): ParamValues {
  const out: Record<string, ParamValue> = {};
  for (const param of params)
    out[param.name] = param.nullable === true && param.default === null ? null : param.default;
  return Object.freeze(out);
}

/** JSON schema (draft 2020-12) of the args object: one property per param; required = none (defaults fill). */
export function paramSchema(params: readonly ParamDef[], opts?: { readonly title?: string }): JsonValue {
  const properties: Record<string, JsonValue> = {};
  for (const param of params) properties[param.name] = propertySchema(param);
  return {
    $schema: JSON_SCHEMA_DRAFT,
    ...(opts?.title === undefined ? {} : { title: opts.title }),
    type: 'object',
    properties,
  };
}

function propertySchema(param: ParamDef): JsonValue {
  const common: Record<string, JsonValue> = { title: param.label };
  if (param.description !== undefined) common['description'] = param.description;
  common['default'] = param.default;
  const nullable = param.nullable === true;
  if (isNumericParam(param)) {
    const type = param.kind === 'int' ? 'integer' : 'number';
    const { min, max } = paramLimits(param);
    return {
      ...common,
      type: nullable ? [type, 'null'] : type,
      ...(min === undefined ? {} : { minimum: min }),
      ...(max === undefined ? {} : { maximum: max }),
    };
  }
  switch (param.kind) {
    case 'bool':
      return { ...common, type: nullable ? ['boolean', 'null'] : 'boolean' };
    case 'enum':
    case 'axis': {
      const values: JsonValue[] = [...paramOptionValues(param)];
      if (nullable) values.push(null);
      return { ...common, type: nullable ? ['string', 'null'] : 'string', enum: values };
    }
    case 'data': {
      const schema = param.schema ?? {};
      return { ...common, ...(nullable ? { anyOf: [schema, { type: 'null' }] } : { allOf: [schema] }) };
    }
    case 'number':
    case 'int':
    case 'distance':
    case 'angle':
    case 'fraction':
      return common; // handled above
  }
}

/** Rounds half away from zero (2.5 → 3, −2.5 → −3). */
function roundHalfAwayFromZero(value: number): number {
  const rounded = Math.sign(value) * Math.round(Math.abs(value));
  return rounded === 0 ? 0 : rounded;
}

/** True when `value` is a JSON value: null, booleans, finite numbers, strings, arrays and plain objects of them. */
export function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (!isObject(value)) return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  if (proto !== Object.prototype && proto !== null) return false;
  return Object.values(value).every(isJsonValue);
}

function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((item, i) => jsonEqual(item, b[i]));
  if (isObject(a) && isObject(b)) {
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((key) => key in b && jsonEqual(a[key], b[key]));
  }
  return false;
}

function typeMatches(value: unknown, type: unknown): boolean {
  switch (type) {
    case 'null':
      return value === null;
    case 'boolean':
      return typeof value === 'boolean';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'string':
      return typeof value === 'string';
    case 'array':
      return Array.isArray(value);
    case 'object':
      return isObject(value);
    default:
      return false;
  }
}

/**
 * Validates `value` against the JSON-schema subset of `ParamDef.schema` (draft 2020-12: type, properties, items,
 * required, enum, minimum, maximum; other keywords are ignored). Returns the first problem's path, or null.
 */
export function checkJsonSchema(value: unknown, schema: JsonValue | undefined, path = ''): string | null {
  if (schema === undefined || schema === true || !isObject(schema)) return schema === false ? path || '(value)' : null;
  const where = path === '' ? '(value)' : path;
  const type = schema['type'];
  if (type !== undefined) {
    const types = Array.isArray(type) ? type : [type];
    if (!types.some((t) => typeMatches(value, t))) return `${where}: expected ${types.map(String).join(' or ')}`;
  }
  const allowed = schema['enum'];
  if (Array.isArray(allowed) && !allowed.some((option) => jsonEqual(option, value))) {
    return `${where}: not one of the allowed values`;
  }
  if (typeof value === 'number') {
    const minimum = schema['minimum'];
    const maximum = schema['maximum'];
    if (typeof minimum === 'number' && value < minimum) return `${where}: below ${minimum}`;
    if (typeof maximum === 'number' && value > maximum) return `${where}: above ${maximum}`;
  }
  if (Array.isArray(value) && schema['items'] !== undefined) {
    for (let i = 0; i < value.length; i++) {
      const problem = checkJsonSchema(value[i], schema['items'], `${path}[${i}]`);
      if (problem !== null) return problem;
    }
  }
  if (isObject(value)) {
    const required = schema['required'];
    if (Array.isArray(required)) {
      for (const key of required) {
        if (typeof key === 'string' && !(key in value)) return `${path === '' ? '' : `${path}.`}${key}: required`;
      }
    }
    const properties = schema['properties'];
    if (isObject(properties)) {
      for (const [key, sub] of Object.entries(properties)) {
        if (!(key in value)) continue;
        const problem = checkJsonSchema(value[key], sub, path === '' ? key : `${path}.${key}`);
        if (problem !== null) return problem;
      }
    }
  }
  return null;
}

const show = (value: unknown): string => {
  if (typeof value === 'string') return `'${value}'`;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
};

/** One param's value from a raw arg (present and not undefined); `problems` collects what was changed. */
function coerceOne(param: ParamDef, raw: unknown, problems: string[]): ParamValue {
  const name = param.name;
  const fallback = (why: string): ParamValue => {
    problems.push(`${name}: ${why}; using the default`);
    return param.default;
  };
  if (raw === null) return param.nullable === true ? null : fallback('null is not allowed');
  if (isNumericParam(param)) {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return fallback(`expected a number, got ${show(raw)}`);
    let value = raw === 0 ? 0 : raw;
    if (param.kind === 'int') {
      const rounded = roundHalfAwayFromZero(value);
      if (rounded !== value) problems.push(`${name} rounded to ${rounded}`);
      value = rounded;
    }
    const { min, max } = paramLimits(param);
    if (min !== undefined && value < min) {
      problems.push(`${name} clamped to ${min}`);
      value = min;
    } else if (max !== undefined && value > max) {
      problems.push(`${name} clamped to ${max}`);
      value = max;
    }
    return value;
  }
  switch (param.kind) {
    case 'bool':
      return typeof raw === 'boolean' ? raw : fallback(`expected true or false, got ${show(raw)}`);
    case 'enum':
    case 'axis': {
      const values = paramOptionValues(param);
      if (typeof raw === 'string' && values.includes(raw)) return raw;
      return fallback(`${show(raw)} is not one of ${values.map((v) => `'${v}'`).join(', ')}`);
    }
    case 'data': {
      if (!isJsonValue(raw)) return fallback('expected JSON data');
      const problem = checkJsonSchema(raw, param.schema);
      return problem === null ? raw : fallback(`invalid data (${problem})`);
    }
    case 'number':
    case 'int':
    case 'distance':
    case 'angle':
    case 'fraction':
      return fallback('unreachable numeric kind'); // handled above
    default:
      return fallback(`unknown parameter kind '${String(param.kind)}'`);
  }
}

/**
 * Fills defaults, clamps numbers into [min, max], rounds ints (half away from zero), checks enum/axis membership and
 * 'data' params against their schema. Keys named in `opts.passThrough` (an operator's declared non-param args: the
 * target list `meshes`, the component `kind`, operator-specific ids such as `mesh`, `template`, `bytes`, `palette`)
 * are copied into `args` untouched and unvalidated (the operator validates them); every other unknown key is dropped.
 * Never throws; `problems` lists what was changed or dropped ('divisions clamped to 32'). Pure and deterministic.
 */
export function coerceArgs(
  params: readonly ParamDef[],
  raw: unknown,
  opts?: { readonly passThrough?: readonly string[] },
): { readonly args: ParamValues; readonly problems: readonly string[] } {
  const problems: string[] = [];
  let input: Readonly<Record<string, unknown>> = {};
  if (isObject(raw)) input = raw;
  else if (raw !== undefined && raw !== null)
    problems.push(`arguments: expected an object, got ${show(raw)}; using the defaults`);
  const args: Record<string, ParamValue> = {};
  const known = new Set<string>();
  for (const param of params) {
    known.add(param.name);
    const value = Object.hasOwn(input, param.name) ? input[param.name] : undefined;
    args[param.name] = value === undefined ? param.default : coerceOne(param, value, problems);
  }
  for (const key of opts?.passThrough ?? []) {
    if (known.has(key)) continue;
    known.add(key);
    const value = Object.hasOwn(input, key) ? input[key] : undefined;
    if (value !== undefined) args[key] = value as ParamValue;
  }
  for (const key of Object.keys(input)) {
    if (known.has(key) || input[key] === undefined) continue;
    problems.push(`unknown argument '${key}' dropped`);
  }
  return { args: Object.freeze(args), problems: Object.freeze(problems) };
}

/** Copy of `args` without the params of the given bounds (Repeat Last: `['pointer', 'selection']`). */
export function stripBound(params: readonly ParamDef[], args: ParamValues, bounds: readonly ParamBound[]): ParamValues {
  const drop = new Set<string>();
  for (const param of params) if (bounds.includes(param.bound)) drop.add(param.name);
  const out: Record<string, ParamValue> = {};
  for (const [key, value] of Object.entries(args)) if (!drop.has(key)) out[key] = value;
  return Object.freeze(out);
}

/** The primary param, or null. Lists with more than one `primary` are rejected by `assertParams` (tests). */
export function primaryParam(params: readonly ParamDef[]): ParamDef | null {
  return params.find((param) => param.primary === true) ?? null;
}

const KINDS: ReadonlySet<string> = new Set([
  'number',
  'int',
  'distance',
  'angle',
  'fraction',
  'bool',
  'enum',
  'axis',
  'data',
]);
const BOUNDS: ReadonlySet<string> = new Set(['selection', 'pointer', 'value']);

/**
 * EkzaError('invalid-params') on duplicates or 2 primaries. Also rejects what would make a list unusable: an empty
 * name, an unknown kind or bound, a primary 'data' param, an enum without options, `min > max`, and a default that
 * `coerceArgs` would change (out of range, not an option, null without `nullable`, data failing its schema).
 */
export function assertParams(params: readonly ParamDef[]): void {
  const fail = (message: string): never => {
    throw new EkzaError('invalid-params', message);
  };
  const names = new Set<string>();
  let primaries = 0;
  for (const param of params) {
    if (typeof param.name !== 'string' || param.name.length === 0) fail('a param needs a non-empty name');
    if (names.has(param.name)) fail(`duplicate param '${param.name}'`);
    names.add(param.name);
    if (!KINDS.has(param.kind)) fail(`param '${param.name}': unknown kind '${String(param.kind)}'`);
    if (!BOUNDS.has(param.bound)) fail(`param '${param.name}': unknown bound '${String(param.bound)}'`);
    if (param.primary === true) {
      primaries++;
      if (param.kind === 'data') fail(`param '${param.name}': a 'data' param cannot be primary`);
    }
    if (param.kind === 'enum' && (param.options === undefined || param.options.length === 0)) {
      fail(`param '${param.name}': an enum needs options`);
    }
    if (param.min !== undefined && param.max !== undefined && param.min > param.max) {
      fail(`param '${param.name}': min ${param.min} > max ${param.max}`);
    }
    if (param.default === null && param.nullable !== true) fail(`param '${param.name}': null default without nullable`);
    if (param.default !== null) {
      const problems: string[] = [];
      const value = coerceOne(param, param.default, problems);
      if (problems.length > 0 || !jsonEqual(value, param.default)) {
        fail(`param '${param.name}': invalid default ${show(param.default)} (${problems.join('; ')})`);
      }
    }
  }
  if (primaries > 1) fail(`${primaries} primary params (at most one)`);
}
