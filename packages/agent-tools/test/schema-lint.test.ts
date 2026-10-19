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
      }),
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
  });
});
