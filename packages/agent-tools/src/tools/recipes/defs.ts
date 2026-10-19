// The stretch recipe_apply (MCP-SPEC §6.12, S4; operator `pose.recipe`). D0 lands the final schema with
// `ready: false`; the MCP prompts of §5.20.4 plan the same motions with the core tools.
import { z } from 'zod';
import { frame, scoped, writes } from '../../schemas/common';
import { BUDGETS, defineTool } from '../define';

export const RECIPES = ['wave', 'nod', 'head_shake', 'breathe', 'idle_sway', 'look_at', 'walk_cycle_block'] as const;

export const recipeApply = defineTool({
  name: 'recipe_apply',
  title: 'Apply a motion recipe',
  description:
    'Write a parametric motion (wave, nod, head shake, breathe, idle sway, look at, walk-cycle block) as keys.',
  group: 'recipes',
  input: z.strictObject({
    ...scoped,
    ...writes,
    recipe: z.enum(RECIPES).describe('The motion to write.'),
    startFrame: frame('Clip frame where the motion starts (default: the clip start).').optional(),
    params: z
      .record(
        z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,31}$/),
        z.union([z.number().min(-100_000).max(100_000), z.string().max(64), z.boolean()]),
      )
      .optional()
      .describe('Recipe parameters (see the recipe guide resource).'),
  }),
  output: z.object({ keyed: z.number(), rangeFrames: z.tuple([z.number(), z.number()]) }),
  annotations: { readOnly: false, destructive: true, idempotent: false },
  access: 'edit',
  hosts: ['live', 'headless'],
  alwaysLoad: false,
  stretch: true,
  kind: 'edit',
  budget: BUDGETS.write,
});
