// MCP-SPEC §5.20.1 / §9.2 (D0): the schema lint over every tool definition, ready or not, plus the Ajv draft 2020-12
// meta-schema check of every input and output schema, the catalogue order, the always-loaded profile and the
// annotation rule of §6.0.
import Ajv2020 from 'ajv/dist/2020';
import { describe, expect, it } from 'vitest';
import { allTools, CORE_TOOL_COUNT, lintTools, manifestToolOf, STRETCH_TOOL_COUNT } from '../src';

const CATALOGUE = [
  'editor_connect',
  'projects_list',
  'project_close',
  'scene_summary',
  'rig_describe',
  'keys_read',
  'curves_summary',
  'pose_read',
  'pose_set',
  'pose_aim',
  'pose_ik_target',
  'pose_transfer',
  'pose_reset',
  'keys_set',
  'keys_delete',
  'keys_adjust',
  'keys_retime',
  'keys_tween',
  'curves_set_interpolation',
  'curves_euler_filter',
  'curves_simplify',
  'clip_create',
  'clip_update',
  'clip_make_loop',
  'clip_delete',
  'analyze_contacts',
  'analyze_loop',
  'analyze_motion',
  'view_capture',
  'view_plot_curves',
  'history_checkpoint',
  'history_revert',
  'project_open',
  'project_import',
  'project_save',
  'project_export',
  'operators_list',
  'operator_describe',
  'operator_run',
];
const STRETCH = ['pose_plant_feet', 'analyze_diff', 'view_set_time', 'recipe_apply'];
const ALWAYS_LOADED = [
  'editor_connect',
  'scene_summary',
  'rig_describe',
  'pose_read',
  'pose_set',
  'pose_aim',
  'pose_ik_target',
  'keys_set',
  'view_capture',
  'history_checkpoint',
  'history_revert',
];
const IDEMPOTENT = [
  'projects_list',
  'scene_summary',
  'rig_describe',
  'keys_read',
  'curves_summary',
  'pose_read',
  'pose_reset',
  'curves_set_interpolation',
  'curves_euler_filter',
  'analyze_contacts',
  'analyze_loop',
  'analyze_motion',
  'view_capture',
  'view_plot_curves',
  'operators_list',
  'operator_describe',
  'analyze_diff',
  'view_set_time',
];
const READ_ONLY = [
  'projects_list',
  'scene_summary',
  'rig_describe',
  'keys_read',
  'curves_summary',
  'pose_read',
  'analyze_contacts',
  'analyze_loop',
  'analyze_motion',
  'view_capture',
  'view_plot_curves',
  'history_checkpoint',
  'operators_list',
  'operator_describe',
  'analyze_diff',
];

describe('tool catalogue (MCP-SPEC §6.0)', () => {
  it('lists the 39 core tools then the 4 stretch tools, in tools/list order', () => {
    const tools = allTools();
    expect(tools.map((tool) => tool.name)).toEqual([...CATALOGUE, ...STRETCH]);
    expect(CORE_TOOL_COUNT + STRETCH_TOOL_COUNT).toBe(tools.length);
    expect(tools.filter((tool) => tool.stretch).map((tool) => tool.name)).toEqual(STRETCH);
  });

  it('marks exactly the always-loaded profile and only editor_connect as requiring user interaction', () => {
    const tools = allTools();
    expect(tools.filter((tool) => tool.alwaysLoad).map((tool) => tool.name)).toEqual(ALWAYS_LOADED);
    expect(tools.filter((tool) => tool.requiresUserInteraction === true).map((tool) => tool.name)).toEqual([
      'editor_connect',
    ]);
  });

  it('follows the annotation rule: destructive unless read-only, except clip_create and project_import', () => {
    for (const tool of allTools()) {
      const { readOnly, destructive, idempotent } = tool.annotations;
      expect([tool.name, readOnly]).toEqual([tool.name, READ_ONLY.includes(tool.name)]);
      expect([tool.name, idempotent]).toEqual([tool.name, IDEMPOTENT.includes(tool.name)]);
      const additive = tool.name === 'clip_create' || tool.name === 'project_import';
      expect([tool.name, destructive]).toEqual([tool.name, !readOnly && !additive]);
    }
  });

  it('gives every read tool the read kind and every tool a budget within §5.5', () => {
    for (const tool of allTools()) {
      expect([tool.name, tool.budget.maxTokens <= 8_000]).toEqual([tool.name, true]);
      expect([tool.name, tool.annotations.readOnly ? tool.kind : 'read']).toEqual([tool.name, 'read']);
    }
  });
});

describe('schema lint (MCP-SPEC §5.20.1)', () => {
  it('finds no violation in any definition, ready or not', () => {
    expect(lintTools(allTools())).toEqual([]);
  });

  it('validates every input and output schema against the draft 2020-12 meta-schema', () => {
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    for (const tool of allTools()) {
      const entry = manifestToolOf(tool);
      for (const [which, schema] of [
        ['input', entry.inputSchema],
        ['output', entry.outputSchema],
      ] as const) {
        const valid = ajv.validateSchema(schema);
        expect([tool.name, which, valid, ajv.errorsText(ajv.errors)]).toEqual([tool.name, which, true, 'No errors']);
      }
    }
  });

  it('does not list a defaulted field as required, and rejects an unknown key at the root', () => {
    for (const tool of allTools()) {
      const input = manifestToolOf(tool).inputSchema as {
        readonly required?: readonly string[];
        readonly properties: Readonly<Record<string, { readonly default?: unknown }>>;
      };
      for (const field of input.required ?? []) {
        expect([tool.name, field, input.properties[field]?.default]).toEqual([tool.name, field, undefined]);
      }
      expect([tool.name, tool.input.safeParse({ ifClipRevison: 3 }).success]).toEqual([tool.name, false]);
    }
  });

  it('catches the mistakes it exists for', async () => {
    const { z } = await import('zod');
    const { defineTool, lintTool } = await import('../src');
    const sloppy = defineTool({
      name: 'pose_wrong',
      title: 'Sloppy',
      description: 'A sloppy tool used by the lint test.',
      group: 'pose',
      input: z.strictObject({
        angle: z.number().describe('No unit, no bounds'),
        nested: z.object({ x: z.number().min(0).max(1).describe('x') }).describe('Not strict'),
        flag: z.boolean().default(true),
        attrs: z.record(z.string(), z.number().min(0).max(1)).optional().describe('Unbounded record'),
      }),
      example: { angle: 'not a number' },
      output: z.object({}),
      annotations: { readOnly: false, destructive: true, idempotent: false },
      access: 'edit',
      hosts: ['headless'],
      alwaysLoad: false,
      stretch: false,
      kind: 'edit',
      budget: { tokens: 400, maxTokens: 1_500 },
    });
    const violations = lintTool(sloppy).join('\n');
    expect(violations).toContain('input.angle: number without bounds');
    expect(violations).toContain("numeric field 'angle' has no unit suffix");
    expect(violations).toContain('input.nested: object without additionalProperties: false');
    expect(violations).toContain('input.nested: not a z.strictObject');
    expect(violations).toContain('input.flag: property without a description');
    expect(violations).toContain('input.attrs: record without maxProperties');
    expect(violations).toContain('example does not parse against the input schema');
  });
});

describe('final input schemas (MCP-SPEC §6.1, §5.5)', () => {
  const byName = new Map(allTools().map((tool) => [tool.name, tool]));
  const parse = (name: string, args: unknown) => {
    const tool = byName.get(name);
    if (tool === undefined) throw new Error(`no tool ${name}`);
    return tool.input.safeParse(args);
  };
  const paths = (result: {
    readonly success: boolean;
    readonly error?: { readonly issues: readonly { readonly path: readonly PropertyKey[] }[] };
  }) => (result.error?.issues ?? []).map((issue) => issue.path.join('.'));

  it('requires controls or bodyParts in every Targets, absent targets staying valid where optional', () => {
    const cases: readonly [string, Record<string, unknown>][] = [
      ['keys_read', { clip: 'a' }],
      ['keys_delete', { clip: 'a', frames: [1] }],
      ['keys_adjust', { clip: 'a' }],
      ['keys_retime', { clip: 'a' }],
      ['keys_tween', { clip: 'a' }],
      ['curves_set_interpolation', { clip: 'a' }],
      ['view_plot_curves', { clip: 'a' }],
      ['curves_summary', { clip: 'a' }],
      ['pose_read', { clip: 'a' }],
    ];
    for (const [name, base] of cases) {
      for (const targets of [{}, { channels: ['rx'] }]) {
        const result = parse(name, { ...base, targets });
        const onTargets = paths(result).filter((path) => path.startsWith('targets'));
        expect([name, targets, result.success, onTargets]).toEqual([name, targets, false, ['targets']]);
      }
      const named = parse(name, { ...base, targets: { controls: ['cog'] } });
      expect([name, named.error?.issues.some((issue) => issue.path[0] === 'targets') ?? false]).toEqual([name, false]);
    }
  });

  it('bounds every input record: pose_set attrs ≤ 64, recipe params ≤ 32, operator_run args ≤ 64', () => {
    const many = (n: number, value: unknown) =>
      Object.fromEntries(Array.from({ length: n }, (_, i) => [`a${i}`, value] as const));
    const pose = (n: number) =>
      parse('pose_set', { clip: 'a', frame: 0, set: [{ control: 'cog', attrs: many(n, 1) }] });
    expect(pose(64).error?.issues.some((issue) => issue.path.includes('attrs')) ?? false).toBe(false);
    expect(paths(pose(65))).toEqual(['set.0.attrs']);
    expect(paths(pose(50_000))).toEqual(['set.0.attrs']);
    expect(paths(parse('recipe_apply', { clip: 'a', recipe: 'wave', params: many(33, 1) }))).toEqual(['params']);
    expect(parse('recipe_apply', { clip: 'a', recipe: 'wave', params: many(32, 1) }).success).toBe(true);
    expect(paths(parse('operator_run', { id: 'key.tween', args: many(65, 1) }))).toEqual(['args']);
    expect(parse('operator_run', { id: 'key.tween', args: many(64, 1) }).success).toBe(true);
  });
});
