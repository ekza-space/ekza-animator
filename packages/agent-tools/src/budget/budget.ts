// Token budgets (MCP-SPEC §5.5): 3.5 characters of minified JSON per token. The runtime enforces the hard cap: the
// declared lists of `data` (arrays with an item schema, records with a value schema) are cut, `truncated: true` is set
// in `data` (every tool's output declares it, see `defineTool`), and `next` explains how to page. A cut never breaks
// the output schema — tuples, `minItems`, required and enum-keyed records and opaque (`unknown`) values stay whole —
// and a result that cannot be cut below the cap fails with `limit` instead of going out over it.
import { z } from 'zod';

export const CHARS_PER_TOKEN = 3.5;
/** At most this many warnings, each at most this long (§5.3). */
export const MAX_WARNINGS = 10;
export const WARNING_MAX_CHARS = 200;
export const TRUNCATED_NEXT =
  'The result was cut to fit the budget: narrow it (rangeFrames, targets, bodyParts, limit) or page with cursor.';
/** The hint of the `limit` error for a result that cannot be cut below its cap. */
export const OVER_BUDGET_HINT =
  'narrow the call (rangeFrames, targets, bodyParts, detail: concise) or page with cursor';

/**
 * `data.truncated` of every tool's output (§5.5): `defineTool` adds it to an output that does not declare its own, so
 * a cut result always validates against the advertised closed `outputSchema` (§5.21).
 */
export const TRUNCATED_FIELD = z
  .boolean()
  .optional()
  .describe('true when the runtime cut lists to fit the hard token cap (§5.5); narrow the call or page.');

/** A JSON Schema node (draft 2020-12), as `z.toJSONSchema` writes it. */
export type JsonSchema = Readonly<Record<string, unknown>>;

/** Estimated tokens of a JSON value (minified). */
export function tokensOf(value: unknown): number {
  return Math.ceil(charsOf(value) / CHARS_PER_TOKEN);
}

function charsOf(value: unknown): number {
  return (JSON.stringify(value) ?? '').length;
}

const OUTPUT_SCHEMAS = new WeakMap<z.ZodType, JsonSchema>();

/** The JSON Schema (output side) of a tool's `data` schema, cached per schema: what the cut must keep valid. */
export function outputJsonSchemaOf(schema: z.ZodType): JsonSchema {
  let json = OUTPUT_SCHEMAS.get(schema);
  if (json === undefined) {
    json = z.toJSONSchema(schema, { io: 'output' });
    OUTPUT_SCHEMAS.set(schema, json);
  }
  return json;
}

type Owner = unknown[] | Record<string, unknown>;

interface Cuttable {
  readonly owner: Owner;
  readonly key: number | string;
  readonly kind: 'array' | 'record';
  readonly length: number;
  readonly min: number;
  readonly chars: number;
}

/** Keywords that do not constrain a value: a node with nothing else is opaque (`z.unknown()`). */
const ANNOTATIONS = new Set(['description', 'title', '$schema', '$comment', 'default', 'examples', 'id']);

function isRecordObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function typesOf(node: JsonSchema): readonly string[] {
  const type = node['type'];
  return Array.isArray(type) ? (type as string[]) : typeof type === 'string' ? [type] : [];
}

function jsonType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/** True when a node (or one of its `anyOf`/`oneOf` options) can describe a value of this JSON type. */
function admits(node: JsonSchema, value: unknown): boolean {
  const options = node['anyOf'] ?? node['oneOf'];
  if (Array.isArray(options)) return options.some((option) => isRecordObject(option) && admits(option, value));
  const types = typesOf(node);
  if (types.length === 0) return true;
  const type = jsonType(value);
  return types.includes(type) || (type === 'number' && types.includes('integer'));
}

/**
 * The node that describes `value`: `anyOf`/`oneOf` resolve to the first option that admits the value's JSON type.
 * `undefined` means "do not touch": no option fits, or the node uses `allOf`/`$ref`/`not` (never in tool outputs).
 */
function nodeFor(node: JsonSchema | undefined, value: unknown): JsonSchema | undefined {
  if (node === undefined) return undefined;
  const options = node['anyOf'] ?? node['oneOf'];
  if (Array.isArray(options)) {
    const fit = options.find((option): option is JsonSchema => isRecordObject(option) && admits(option, value));
    return nodeFor(fit, value);
  }
  if (node['allOf'] !== undefined || node['$ref'] !== undefined || node['not'] !== undefined) return undefined;
  return node;
}

function isOpaque(node: JsonSchema): boolean {
  return Object.keys(node).every((key) => ANNOTATIONS.has(key));
}

/** Every container below `value` that may lose entries without breaking `schema`. */
function collect(
  value: unknown,
  schema: JsonSchema | undefined,
  out: Cuttable[],
  owner?: Owner,
  key?: number | string,
) {
  if (value === null || typeof value !== 'object') return;
  const node = nodeFor(schema, value);
  if (node === undefined || isOpaque(node)) return; // opaque values (z.unknown()) stay whole
  if (Array.isArray(value)) {
    const prefix = node['prefixItems'];
    if (Array.isArray(prefix)) {
      // a tuple: never shortened; its items are walked with their own schemas
      const rest = isRecordObject(node['items']) ? (node['items'] as JsonSchema) : undefined;
      value.forEach((item, i) => collect(item, (prefix[i] as JsonSchema | undefined) ?? rest, out, value, i));
      return;
    }
    const items = isRecordObject(node['items']) ? (node['items'] as JsonSchema) : undefined;
    if (items === undefined) return;
    const min = typeof node['minItems'] === 'number' ? node['minItems'] : 0;
    if (owner !== undefined && key !== undefined && value.length > min) {
      out.push({ owner, key, kind: 'array', length: value.length, min, chars: charsOf(value) });
    }
    value.forEach((item, i) => collect(item, items, out, value, i));
    return;
  }
  const record = value as Record<string, unknown>;
  const properties = isRecordObject(node['properties']) ? (node['properties'] as Record<string, JsonSchema>) : null;
  const extra = isRecordObject(node['additionalProperties']) ? (node['additionalProperties'] as JsonSchema) : undefined;
  if (properties !== null) {
    for (const [name, inner] of Object.entries(record)) {
      collect(inner, Object.hasOwn(properties, name) ? properties[name] : extra, out, record, name);
    }
    return;
  }
  if (extra === undefined || isOpaque(extra)) return; // a record of opaque values (a JSON Schema, an example) stays
  const names = Object.keys(record);
  const exhaustive =
    (Array.isArray(node['required']) && node['required'].length > 0) ||
    (isRecordObject(node['propertyNames']) && node['propertyNames']['enum'] !== undefined);
  const min = typeof node['minProperties'] === 'number' ? node['minProperties'] : 0;
  if (!exhaustive && owner !== undefined && key !== undefined && names.length > min) {
    out.push({ owner, key, kind: 'record', length: names.length, min, chars: charsOf(record) });
  }
  for (const name of names) collect(record[name], extra, out, record, name);
}

function setEntry(owner: Owner, key: number | string, value: unknown): void {
  if (Array.isArray(owner)) owner[key as number] = value;
  else Object.defineProperty(owner, key, { value, enumerable: true, writable: true, configurable: true });
}

/** Keeps the first `keep` entries of the container at `owner[key]` (from its original entries). */
function keepFirst(owner: Owner, key: number | string, original: unknown, keep: number): void {
  if (Array.isArray(original)) {
    setEntry(owner, key, original.slice(0, keep));
    return;
  }
  const kept: Record<string, unknown> = {};
  for (const [name, inner] of Object.entries(original as Record<string, unknown>).slice(0, keep)) {
    setEntry(kept, name, inner);
  }
  setEntry(owner, key, kept);
}

export type BudgetOutcome =
  | { readonly data: unknown; readonly truncated: boolean; readonly over?: undefined }
  | { readonly data?: undefined; readonly truncated?: undefined; readonly over: { readonly tokens: number } };

/**
 * Cuts the declared lists of `data` (a deep copy) until it fits `maxTokens`: the largest list first, as few entries as
 * needed. `schema` is the JSON Schema of `data` (`outputJsonSchemaOf(tool.output)`); a cut keeps it valid and sets
 * `truncated: true` on the root object. A result that still exceeds the cap with every list at its minimum answers
 * `over` (the envelope turns it into a `limit` error).
 */
export function enforceBudget(data: unknown, maxTokens: number, schema: JsonSchema): BudgetOutcome {
  if (tokensOf(data) <= maxTokens) return { data, truncated: false };
  const capChars = maxTokens * CHARS_PER_TOKEN;
  const copy: unknown = JSON.parse(JSON.stringify(data) ?? 'null');
  if (isRecordObject(copy)) setEntry(copy, 'truncated', true);
  const fits = () => charsOf(copy) <= capChars;
  for (let guard = 0; guard < 10_000 && !fits(); guard++) {
    const candidates: Cuttable[] = [];
    collect(copy, schema, candidates);
    const largest = candidates.sort((a, b) => b.chars - a.chars)[0];
    if (largest === undefined) break;
    const original = Array.isArray(largest.owner)
      ? largest.owner[largest.key as number]
      : largest.owner[largest.key as string];
    keepFirst(largest.owner, largest.key, original, largest.min);
    if (!fits()) continue; // even at its minimum this list is not enough: cut the next largest too
    // The list alone makes the difference: keep as many entries as still fit (binary search).
    let low = largest.min; // fits
    let high = largest.length - 1; // the longest candidate cut
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      keepFirst(largest.owner, largest.key, original, mid);
      if (fits()) low = mid;
      else high = mid - 1;
    }
    keepFirst(largest.owner, largest.key, original, low);
  }
  if (!fits()) return { over: { tokens: tokensOf(copy) } };
  return { data: copy, truncated: true };
}
