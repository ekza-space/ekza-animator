// MCP-SPEC §5.5, §5.21 (D0): the runtime's hard cap. Every tool's output declares `data.truncated`, a cut result of
// every tool validates against its own advertised `outputSchema` (Ajv 2020-12) and its zod output schema (what the
// server re-parses a tab result with), and a result that cannot be cut below its cap fails with `limit` — never goes
// out over the cap.
import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  allTools,
  enforceBudget,
  finishResult,
  type JsonSchema,
  manifestToolOf,
  outputJsonSchemaOf,
  schemas,
  tokensOf,
  TRUNCATED_NEXT,
} from '../src';

type Json = Readonly<Record<string, unknown>>;

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function typesOf(node: Json): readonly string[] {
  const type = node['type'];
  return Array.isArray(type) ? (type as string[]) : typeof type === 'string' ? [type] : [];
}

/**
 * A schema-valid value of a tool output's JSON Schema with long lists and records (`n` entries near the root, fewer
 * deeper), every optional field present: the worst case the cut has to handle.
 */
function sample(node: Json, n: number, depth = 0): unknown {
  if (node['const'] !== undefined) return node['const'];
  if (Array.isArray(node['enum'])) return node['enum'][0];
  const options = (node['anyOf'] ?? node['oneOf']) as Json[] | undefined;
  if (Array.isArray(options)) {
    return sample(options.find((option) => !typesOf(option).includes('null')) ?? (options[0] as Json), n, depth);
  }
  const width = depth < 2 ? n : 3;
  const types = typesOf(node);
  if (types.includes('object')) {
    const out: Record<string, unknown> = {};
    if (isObject(node['properties'])) {
      for (const [key, inner] of Object.entries(node['properties'])) out[key] = sample(inner as Json, n, depth + 1);
      return out;
    }
    if (isObject(node['additionalProperties'])) {
      for (let i = 0; i < width; i++) out[`entry${i}`] = sample(node['additionalProperties'], n, depth + 1);
    }
    return out;
  }
  if (types.includes('array')) {
    if (Array.isArray(node['prefixItems']))
      return node['prefixItems'].map((item) => sample(item as Json, n, depth + 1));
    const min = typeof node['minItems'] === 'number' ? node['minItems'] : 0;
    const max = typeof node['maxItems'] === 'number' ? node['maxItems'] : Number.POSITIVE_INFINITY;
    const length = Math.min(max, Math.max(min, width));
    return Array.from({ length }, () => sample(node['items'] as Json, n, depth + 1));
  }
  if (types.includes('string')) return 'sample value';
  if (types.includes('integer') || types.includes('number')) {
    const low = typeof node['minimum'] === 'number' ? node['minimum'] : 0;
    const high = typeof node['maximum'] === 'number' ? node['maximum'] : low + 10;
    return Math.min(high, Math.max(low, 1));
  }
  if (types.includes('boolean')) return false;
  if (types.includes('null')) return null;
  return { opaque: ['an', 'unknown', 'value'] };
}

/**
 * What the runtime's cut makes of `data` under `maxTokens`: 'limit' (refused), 'cut' (within the cap, `truncated`,
 * `next`, valid against the advertised envelope schema and the zod output schema), else the problems found.
 */
function verdict(output: z.ZodType, data: unknown, maxTokens: number, validate: ValidateFunction): string {
  const result = finishResult({ ok: true, data }, { maxTokens, schema: outputJsonSchemaOf(output) });
  if (!result.ok) return result.error.code === 'limit' ? 'limit' : `error ${result.error.code}`;
  const problems: string[] = [];
  if (tokensOf(result.data) > maxTokens) problems.push(`over the cap: ${tokensOf(result.data)} > ${maxTokens}`);
  if ((result.data as Json)['truncated'] !== true) problems.push('truncated is not set');
  if (result.next !== TRUNCATED_NEXT) problems.push('next does not explain the cut');
  if (!validate(result)) problems.push(`outputSchema: ${JSON.stringify(validate.errors)}`);
  if (!schemas.successEnvelope(output).safeParse(result).success) problems.push('zod output schema refuses it');
  return problems.length === 0 ? 'cut' : problems.join('; ');
}

/** Tools whose results are list-heavy: their cut must succeed (§5.5's "an over-long `data` list is cut"). */
const LIST_HEAVY = [
  'scene_summary',
  'rig_describe',
  'keys_read',
  'curves_summary',
  'pose_read',
  'analyze_motion',
  'history_checkpoint',
  'operators_list',
];

describe('every tool output declares data.truncated (MCP-SPEC §5.5, §5.21)', () => {
  it('advertises an optional boolean truncated in every data object', () => {
    for (const tool of allTools()) {
      const data = (manifestToolOf(tool).outputSchema['properties'] as Json)['data'] as Json;
      const truncated = (data['properties'] as Json)['truncated'] as Json | undefined;
      expect([tool.name, truncated?.['type']]).toEqual([tool.name, 'boolean']);
    }
  });

  it('cuts a long result of every tool to its cap and keeps it valid against its own output schema', () => {
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    const verdicts = allTools().map((tool) => {
      const schema = outputJsonSchemaOf(tool.output);
      const data = sample(schema, 60);
      const maxTokens = Math.max(1, Math.floor(tokensOf(data) / 3));
      const validate = ajv.compile(manifestToolOf(tool).outputSchema);
      return [tool.name, tool.output.safeParse(data).success, verdict(tool.output, data, maxTokens, validate)] as const;
    });
    // every sample is valid (else this test would prove nothing) and every result is cut validly or refused
    for (const [name, sampleValid, outcome] of verdicts) {
      expect([name, sampleValid, outcome]).toEqual([name, true, expect.stringMatching(/^(cut|limit)$/)]);
    }
    const cut = verdicts.filter(([, , outcome]) => outcome === 'cut').map(([name]) => name);
    expect(cut).toEqual(expect.arrayContaining(LIST_HEAVY));
  });

  it('keeps every tool within its cap or fails with limit, whatever the cap', () => {
    for (const tool of allTools()) {
      const schema = outputJsonSchemaOf(tool.output);
      const data = sample(schema, 200);
      for (const maxTokens of [1, 50, 400, 2_000]) {
        const result = finishResult({ ok: true, data }, { maxTokens, schema });
        const outcome = result.ok ? (tokensOf(result.data) <= maxTokens ? 'within' : 'over') : result.error.code;
        expect([tool.name, maxTokens, outcome]).toEqual([
          tool.name,
          maxTokens,
          expect.stringMatching(/^(within|limit)$/),
        ]);
      }
    }
  });
});

describe('enforceBudget (MCP-SPEC §5.5)', () => {
  const schemaOf = (output: z.ZodType): JsonSchema => outputJsonSchemaOf(output);

  it('leaves a result within its cap alone', () => {
    const data = { items: ['a', 'b'] };
    expect(enforceBudget(data, 100, schemaOf(z.object({ items: z.array(z.string()) })))).toEqual({
      data,
      truncated: false,
    });
  });

  it('keeps as many entries as fit, the largest list first', () => {
    const output = z.object({
      big: z.array(z.string()),
      small: z.array(z.string()),
      truncated: z.boolean().optional(),
    });
    const data = { big: Array.from({ length: 500 }, (_, i) => `entry ${i}`), small: ['x', 'y'] };
    const outcome = enforceBudget(data, 300, schemaOf(output));
    expect(outcome.over).toBeUndefined();
    const cut = outcome.data as { big: string[]; small: string[]; truncated: boolean };
    expect(cut.small).toEqual(['x', 'y']);
    expect(cut.truncated).toBe(true);
    expect(tokensOf(cut)).toBeLessThanOrEqual(300);
    // tight: one more entry would not fit
    expect(tokensOf({ ...cut, big: data.big.slice(0, cut.big.length + 1) })).toBeGreaterThan(300);
    expect(data.big).toHaveLength(500); // the input is not changed
  });

  it('never shortens a tuple or a list below minItems, and never cuts inside opaque values', () => {
    const output = z.object({
      span: z.tuple([z.string(), z.string()]),
      atLeast: z.array(z.string()).min(3),
      opaque: z.unknown(),
      schema: z.record(z.string(), z.unknown()),
      truncated: z.boolean().optional(),
    });
    const long = 'w'.repeat(200);
    const short = 's'.repeat(20);
    const data = {
      span: [short, short],
      atLeast: [long, long, long, long, long, long],
      opaque: { list: [short, short, short] },
      schema: { a: short, b: short },
    };
    const outcome = enforceBudget(data, 300, schemaOf(output));
    expect(outcome.over).toBeUndefined();
    const cut = outcome.data as typeof data;
    expect(cut.atLeast.length).toBeGreaterThanOrEqual(3);
    expect(cut.atLeast.length).toBeLessThan(6);
    expect(cut).toEqual({ ...data, atLeast: data.atLeast.slice(0, cut.atLeast.length), truncated: true });
    expect(tokensOf(cut)).toBeLessThanOrEqual(300);
    // below what a tuple, three long entries and the opaque values need: limit, not a broken schema
    expect(enforceBudget(data, 150, schemaOf(output)).over).toBeDefined();
  });

  it('trims records with a declared value schema, but not exhaustive (enum-keyed) records', () => {
    const output = z.object({
      byBone: z.record(z.string(), z.object({ note: z.string() })),
      limbs: z.record(z.enum(['leg.L', 'leg.R']), z.string()),
      truncated: z.boolean().optional(),
    });
    const data = {
      byBone: Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`bone${i}`, { note: 'n'.repeat(40) }])),
      limbs: { 'leg.L': 'x'.repeat(300), 'leg.R': 'y'.repeat(300) },
    };
    const outcome = enforceBudget(data, 400, schemaOf(output));
    const cut = outcome.data as typeof data;
    expect(Object.keys(cut.limbs)).toEqual(['leg.L', 'leg.R']);
    expect(Object.keys(cut.byBone).length).toBeLessThan(100);
    expect(output.safeParse(cut).success).toBe(true);
    expect(tokensOf(cut)).toBeLessThanOrEqual(400);
  });

  it('keeps a __proto__ entry an own entry through the cut', () => {
    const output = z.object({ byName: z.record(z.string(), z.string()), truncated: z.boolean().optional() });
    const data = JSON.parse(
      `{"byName":{"__proto__":"first",${Array.from({ length: 50 }, (_, i) => `"k${i}":"${'v'.repeat(30)}"`).join(',')}}}`,
    ) as { byName: Record<string, string> };
    const cut = enforceBudget(data, 200, schemaOf(output)).data as { byName: Record<string, string> };
    expect(Object.hasOwn(cut.byName, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(cut.byName)).toBe(Object.prototype);
  });

  it('fails a result made of long strings and records that no cut can bring under the cap', () => {
    const output = z.object({
      rows: z.tuple([z.string(), z.string()]),
      note: z.string(),
      truncated: z.boolean().optional(),
    });
    const result = finishResult(
      { ok: true, data: { rows: ['r'.repeat(300), 's'.repeat(300)], note: 'n'.repeat(300) } },
      { maxTokens: 50, schema: schemaOf(output) },
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'limit', retryable: true } });
  });
});
