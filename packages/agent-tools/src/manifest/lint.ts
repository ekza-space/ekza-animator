// The schema lint of MCP-SPEC §5.20.1 / §9.2 over every tool definition, ready or not: object roots without root
// combinators, `additionalProperties: false` on every object (records excepted), property names, descriptions,
// `required` without defaulted fields, strict nested objects (unknown keys rejected at every level), bounds on every
// number, unit suffixes on unit-bearing numeric fields, description length and first sentence, tool names, an
// object output schema whose `data` declares `truncated` (§5.5). The Ajv 2020-12 meta-schema check runs in the package's tests (Ajv is a dev dependency).
import type { z } from 'zod';
import type { AgentToolDef } from '../types';
import { manifestToolOf } from './manifest';

type Json = Readonly<Record<string, unknown>>;

export const TOOL_NAME = /^[a-z][a-z0-9_]{2,39}$/;
export const PROPERTY_NAME = /^[A-Za-z0-9_.-]{1,64}$/;
/** The fixed noun list of §6 (`<noun>_<verb>`). */
export const TOOL_NOUNS = [
  'editor',
  'project',
  'projects',
  'scene',
  'rig',
  'pose',
  'keys',
  'curves',
  'clip',
  'analyze',
  'view',
  'history',
  'operator',
  'operators',
  'recipe',
] as const;
/** Unit suffixes of §5.2 (field names end with one of them, or are the unit word itself). */
export const UNIT_SUFFIX = /(Deg|M|Cm|Mm|Factor|Percent|Frame|Frames|Seconds|Mps|DegPerFrame|Px)$/;
const UNIT_WORDS = new Set(['frame', 'frames', 'factor', 'seconds']);
/**
 * Numeric fields without a unit (counts, limits, weights, ids, 0…1 shares) and fields whose unit is stated per channel
 * in their description (`value`). x/y/z take the unit of their parent field.
 */
export const UNITLESS_NUMERIC_FIELDS = new Set([
  'value',
  // records whose values carry their own units (stated in the description): attributes, recipe parameters
  'attrs',
  'params',
  // normalised direction vectors
  'direction',
  'poleDirection',
  // the spec's name for a clip-frame range of view_set_time (§6.12)
  'playbackRange',
  'weight',
  'fps',
  'limit',
  'worst',
  'every',
  'neck',
  'head',
  'inWeight',
  'outWeight',
  'ifClipRevision',
  'steps',
  'contactFrame',
]);
const AXES = new Set(['x', 'y', 'z']);
export const DESCRIPTION_MAX = 1_500;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function types(node: Json): readonly string[] {
  const type = node['type'];
  return Array.isArray(type) ? (type as string[]) : typeof type === 'string' ? [type] : [];
}

/** First sentence: text up to the first '.', '!' or '?' followed by a space or the end, at least 10 characters. */
export function firstSentence(description: string): string | null {
  const match = /^(.{10,}?[.!?])(\s|$)/su.exec(description);
  return match === null ? null : (match[1] as string);
}

interface Walk {
  readonly violations: string[];
  readonly input: boolean;
}

/** The nearest named field a numeric node belongs to (array items and tuple items take their field's name). */
function unitOk(names: readonly string[]): boolean {
  const named = names.filter((name) => name !== '[]');
  const name = named.at(-1);
  if (name === undefined) return true;
  if (AXES.has(name)) return unitOk(named.slice(0, -1));
  return UNIT_SUFFIX.test(name) || UNIT_WORDS.has(name) || UNITLESS_NUMERIC_FIELDS.has(name);
}

function walk(node: unknown, path: string, names: readonly string[], w: Walk): void {
  if (!isObject(node)) return;
  for (const combinator of ['anyOf', 'oneOf', 'allOf'] as const) {
    const options = node[combinator];
    if (Array.isArray(options)) options.forEach((option, i) => walk(option, `${path}.${combinator}[${i}]`, names, w));
  }
  const kinds = types(node);
  if (w.input && (kinds.includes('number') || kinds.includes('integer'))) {
    const low = node['minimum'] ?? node['exclusiveMinimum'];
    const high = node['maximum'] ?? node['exclusiveMaximum'];
    if (typeof low !== 'number' || typeof high !== 'number') w.violations.push(`${path}: number without bounds`);
    if (!unitOk(names)) {
      const field = names.filter((name) => name !== '[]').at(-1);
      w.violations.push(`${path}: numeric field '${field}' has no unit suffix (§5.2)`);
    }
  }
  if (kinds.includes('object')) {
    const properties = node['properties'];
    const isRecord = node['propertyNames'] !== undefined || isObject(node['additionalProperties']);
    if (isObject(properties)) {
      if (node['additionalProperties'] !== false)
        w.violations.push(`${path}: object without additionalProperties: false`);
      const required = Array.isArray(node['required']) ? (node['required'] as string[]) : [];
      for (const [key, value] of Object.entries(properties)) {
        if (!PROPERTY_NAME.test(key))
          w.violations.push(`${path}.${key}: property name does not match ${PROPERTY_NAME}`);
        if (w.input && (!isObject(value) || typeof value['description'] !== 'string' || value['description'] === '')) {
          w.violations.push(`${path}.${key}: property without a description`);
        }
        if (isObject(value) && value['default'] !== undefined && required.includes(key)) {
          w.violations.push(`${path}.${key}: a defaulted field is required`);
        }
        walk(value, `${path}.${key}`, [...names, key], w);
      }
    } else if (!isRecord && w.input && node['additionalProperties'] !== false) {
      w.violations.push(`${path}: object without properties must be a record or closed`);
    }
    if (isObject(node['additionalProperties'])) walk(node['additionalProperties'], `${path}{}`, [...names, '[]'], w);
  }
  if (kinds.includes('array')) {
    if (Array.isArray(node['prefixItems'])) {
      (node['prefixItems'] as unknown[]).forEach((item, i) => walk(item, `${path}[${i}]`, [...names, '[]'], w));
    }
    if (isObject(node['items'])) walk(node['items'], `${path}[]`, [...names, '[]'], w);
  }
}

interface ZodDefLike {
  readonly type: string;
  readonly shape?: Readonly<Record<string, z.ZodType>>;
  readonly catchall?: z.ZodType;
  readonly innerType?: z.ZodType;
  readonly element?: z.ZodType;
  readonly options?: readonly z.ZodType[];
  readonly items?: readonly z.ZodType[];
  readonly rest?: z.ZodType | null;
  readonly valueType?: z.ZodType;
  readonly in?: z.ZodType;
  readonly out?: z.ZodType;
}

function defOf(schema: z.ZodType): ZodDefLike {
  return (schema as unknown as { readonly _zod: { readonly def: ZodDefLike } })._zod.def;
}

/** Every object node of an input schema is strict (`z.strictObject`): unknown keys are rejected at every level. */
function strictObjects(schema: z.ZodType, path: string, out: string[]): void {
  const def = defOf(schema);
  switch (def.type) {
    case 'object':
      if (def.catchall === undefined || defOf(def.catchall).type !== 'never') out.push(`${path}: not a z.strictObject`);
      for (const [key, value] of Object.entries(def.shape ?? {})) strictObjects(value, `${path}.${key}`, out);
      return;
    case 'optional':
    case 'nullable':
    case 'default':
    case 'prefault':
    case 'readonly':
    case 'nonoptional':
    case 'catch':
      if (def.innerType !== undefined) strictObjects(def.innerType, path, out);
      return;
    case 'array':
      if (def.element !== undefined) strictObjects(def.element, `${path}[]`, out);
      return;
    case 'union':
      (def.options ?? []).forEach((option, i) => strictObjects(option, `${path}|${i}`, out));
      return;
    case 'tuple':
      (def.items ?? []).forEach((item, i) => strictObjects(item, `${path}[${i}]`, out));
      if (def.rest) strictObjects(def.rest, `${path}[…]`, out);
      return;
    case 'record':
      if (def.valueType !== undefined) strictObjects(def.valueType, `${path}{}`, out);
      return;
    case 'pipe':
      if (def.in !== undefined) strictObjects(def.in, path, out);
      return;
    default:
      return;
  }
}

/** Lint violations of one tool definition (an empty list: the tool follows §5.20.1). */
export function lintTool(tool: AgentToolDef): string[] {
  const violations: string[] = [];
  const at = (message: string) => violations.push(`${tool.name}: ${message}`);
  if (!TOOL_NAME.test(tool.name)) at(`name does not match ${TOOL_NAME}`);
  const noun = tool.name.split('_')[0] ?? '';
  if (!(TOOL_NOUNS as readonly string[]).includes(noun) || !tool.name.includes('_')) {
    at(`name is not <noun>_<verb> with a noun of ${TOOL_NOUNS.join(', ')}`);
  }
  if (tool.description.length === 0 || tool.description.length > DESCRIPTION_MAX) {
    at(`description must have 1…${DESCRIPTION_MAX} characters`);
  }
  if (firstSentence(tool.description) === null) at('description has no first sentence');
  if (tool.title.length === 0 || tool.title.length > 80) at('title must have 1…80 characters');
  if (tool.budget.tokens <= 0 || tool.budget.maxTokens < tool.budget.tokens) at('budget: 0 < tokens ≤ maxTokens');
  if (tool.hosts.length === 0) at('no host');
  if (tool.annotations.readOnly && tool.annotations.destructive) at('a read-only tool cannot be destructive');
  const entry = manifestToolOf(tool);
  const input = entry.inputSchema;
  if (input['type'] !== 'object') at('inputSchema root is not an object');
  for (const combinator of ['anyOf', 'oneOf', 'allOf']) {
    if (input[combinator] !== undefined) at(`inputSchema root uses ${combinator}`);
  }
  if (input['additionalProperties'] !== false) at('inputSchema root allows additional properties');
  walk(input, 'input', [], { violations, input: true });
  const strict: string[] = [];
  strictObjects(tool.input, 'input', strict);
  for (const message of strict) at(message);
  const unknownKey = tool.input.safeParse({ __unknown_key__: 1 });
  if (unknownKey.success) at('the input accepts an unknown root key');
  const output = entry.outputSchema;
  if (output['type'] !== 'object') at('outputSchema is not an object');
  // §5.5: the runtime may cut any result and sets `data.truncated`; the closed `data` object must declare it.
  const data = isObject(output['properties']) ? output['properties']['data'] : undefined;
  const dataProperties = isObject(data) && isObject(data['properties']) ? data['properties'] : null;
  if (dataProperties === null) at('output data is not an object with properties');
  else {
    const truncated = dataProperties['truncated'];
    if (!isObject(truncated) || !types(truncated).includes('boolean')) {
      at('output data does not declare a boolean truncated field (§5.5; defineTool adds it)');
    }
  }
  walk(output, 'output', [], { violations, input: false });
  return violations.map((v) => (v.startsWith(`${tool.name}: `) ? v : `${tool.name}: ${v}`));
}

/** Lint violations of a whole tool set: each tool, unique names, the always-loaded profile flags. */
export function lintTools(tools: readonly AgentToolDef[]): string[] {
  const violations = tools.flatMap(lintTool);
  const seen = new Set<string>();
  for (const tool of tools) {
    if (seen.has(tool.name)) violations.push(`${tool.name}: duplicate name`);
    seen.add(tool.name);
    if (tool.requiresUserInteraction === true && tool.name !== 'editor_connect') {
      violations.push(`${tool.name}: only editor_connect requires user interaction (§5.20.1)`);
    }
  }
  return violations;
}
