// Curve tools (MCP-SPEC §6.2 curves_summary and §6.5, tools 7 and 19–21; P2).
import { z } from 'zod';
import {
  dryRun,
  frameList,
  infinityName,
  rangeFrames,
  scoped,
  tangentName,
  targets,
  writes,
} from '../../schemas/common';
import { BUDGETS, defineTool } from '../define';
import { curvesSummary as curvesSummaryRun } from './summary';
import {
  curvesEulerFilter as curvesEulerFilterRun,
  curvesSetInterpolation as curvesSetInterpolationRun,
  curvesSimplify as curvesSimplifyRun,
} from './write';

export const curvesSummary = defineTool({
  name: 'curves_summary',
  title: 'Summarise curves',
  description:
    'Summarise animation curves before reading keys: key counts, extremes, overshoot, Euler flips, tangent types, subframe keys. ' +
    'Default: every curve of the clip (≤ 120 rows); targets narrows it. min and max are [frame, value] in the ' +
    'curve’s unit (degrees, metres, factor) over rangeFrames (default: the clip range); overshootFrames are frames ' +
    'where the curve leaves the span of its two neighbouring keys (spline overshoot); flipFrames are rotation jumps ' +
    'above 90° per frame (fix them with curves_euler_filter); subframeKeys counts keys off whole frames.',
  group: 'curves',
  input: z.strictObject({
    ...scoped,
    targets: targets.optional(),
    rangeFrames: rangeFrames().optional(),
  }),
  output: z.object({
    curves: z.array(
      z.object({
        control: z.string(),
        channel: z.string(),
        unit: z.string(),
        keyCount: z.number(),
        min: z.tuple([z.number(), z.number()]),
        max: z.tuple([z.number(), z.number()]),
        overshootFrames: z.array(z.number()),
        flipFrames: z.array(z.number()),
        tangents: z.record(z.string(), z.number()),
        pre: z.string(),
        post: z.string(),
        staticValue: z.number().nullable(),
        subframeKeys: z.number(),
      }),
    ),
    subframeKeys: z.number(),
    truncated: z.boolean().optional(),
  }),
  annotations: { readOnly: true, destructive: false, idempotent: true },
  access: 'read',
  hosts: ['live', 'headless'],
  alwaysLoad: false,
  stretch: false,
  kind: 'read',
  budget: BUDGETS.read,
  example: { clip: 'walk' },
  ready: true,
  run: (ctx, args) => curvesSummaryRun(ctx, args) as never,
});

const CHANGE_KINDS = ['tangent', 'handles', 'broken', 'weighted', 'infinity'] as const;
/** The change kind of a curves_set_interpolation call (exactly one per call, §6.5). */
function changeKinds(value: Readonly<Record<string, unknown>>): string[] {
  const kinds: string[] = [];
  if (value['tangent'] !== undefined) kinds.push('tangent');
  if (value['handles'] !== undefined) kinds.push('handles');
  if (value['broken'] !== undefined) kinds.push('broken');
  if (value['weighted'] !== undefined) kinds.push('weighted');
  if (value['preInfinity'] !== undefined || value['postInfinity'] !== undefined) kinds.push('infinity');
  return kinds;
}

export const curvesSetInterpolation = defineTool({
  name: 'curves_set_interpolation',
  title: 'Set tangents and infinity',
  description:
    'Set tangent types, tangent handle angles and weights, broken or weighted tangents, or pre/post ' +
    'infinity on curves. One change kind per call: tangent (auto, spline, clamped, linear, flat, step, ' +
    'plateau; side in/out/both), handles {inAngleDeg, outAngleDeg, inWeight, outWeight} (angles in ' +
    'degrees as the Graph Editor shows them; setting an angle makes the tangent fixed), broken, ' +
    'weighted, or preInfinity/postInfinity. Acts on the keys of the targets at frames or inside ' +
    'rangeFrames (default: every key). Use it for easing (flat or clamped tangents) and overshoot polish.',
  group: 'curves',
  input: z
    .strictObject({
      ...scoped,
      ...writes,
      targets,
      frames: frameList('Only the keys at these clip frames (≤ 1,000).', 1_000).optional(),
      rangeFrames: rangeFrames('Only the keys inside [start, end] clip frames.').optional(),
      tangent: tangentName.optional(),
      side: z.enum(['both', 'in', 'out']).default('both').describe('Which tangent side a tangent change sets.'),
      handles: z
        .strictObject({
          inAngleDeg: z
            .number()
            .min(-90)
            .max(90)
            .optional()
            .describe('In-tangent angle in degrees, as the Graph Editor shows it.'),
          outAngleDeg: z
            .number()
            .min(-90)
            .max(90)
            .optional()
            .describe('Out-tangent angle in degrees, as the Graph Editor shows it.'),
          inWeight: z.number().min(0.0001).max(1_000).optional().describe('In-tangent weight (weighted curves), > 0.'),
          outWeight: z
            .number()
            .min(0.0001)
            .max(1_000)
            .optional()
            .describe('Out-tangent weight (weighted curves), > 0.'),
        })
        .optional()
        .describe('Tangent handle angles (degrees) and weights; setting an angle makes the tangent fixed.'),
      broken: z.boolean().optional().describe('true breaks the tangents (in and out move apart), false unifies them.'),
      weighted: z.boolean().optional().describe('Make the curves weighted (true) or non-weighted (false).'),
      preInfinity: infinityName.optional(),
      postInfinity: infinityName.optional(),
    })
    .refine((value) => changeKinds(value).length === 1, {
      message: `one change kind per call: ${CHANGE_KINDS.join(' | ')}`,
    }),
  output: z.object({ keys: z.number(), curves: z.number() }),
  annotations: { readOnly: false, destructive: true, idempotent: true },
  access: 'edit',
  hosts: ['live', 'headless'],
  alwaysLoad: false,
  stretch: false,
  kind: 'edit',
  budget: BUDGETS.write,
  example: { clip: 'wave', targets: { controls: ['fk.upperArm.L'] }, frames: [10], tangent: 'flat' },
  ready: true,
  run: (ctx, args) => curvesSetInterpolationRun(ctx, args) as never,
});

export const curvesEulerFilter = defineTool({
  name: 'curves_euler_filter',
  title: 'Euler filter',
  description:
    'Remove rotation flips (360° jumps and alternate Euler solutions) from rotation curves. Default: ' +
    'every rotation curve of the clip; targets narrows it. The orientation at every key stays the same; ' +
    'reports how many keys changed per curve.',
  group: 'curves',
  input: z.strictObject({
    ...scoped,
    ...writes,
    targets: targets.optional().describe('Default: every rotation curve of the clip.'),
  }),
  output: z.object({
    flipsFixed: z.array(z.object({ control: z.string(), channel: z.string(), count: z.number() })),
    total: z.number(),
  }),
  annotations: { readOnly: false, destructive: true, idempotent: true },
  access: 'edit',
  hosts: ['live', 'headless'],
  alwaysLoad: false,
  stretch: false,
  kind: 'edit',
  budget: BUDGETS.write,
  example: { clip: 'walk' },
  ready: true,
  run: (ctx, args) => curvesEulerFilterRun(ctx, args) as never,
});

export const curvesSimplify = defineTool({
  name: 'curves_simplify',
  title: 'Simplify curves',
  description:
    'Reduce keys within a tolerance (degrees, metres) without visibly changing the motion. Default: ' +
    'every curve of the clip. Keeps the first and last keys and removes keys while the curve stays ' +
    'within toleranceDeg (rotations, default 0.1°) and toleranceM (translations, default 0.5 mm) of its ' +
    'shape. dryRun reports the key counts and the error without changing anything.',
  group: 'curves',
  input: z.strictObject({
    ...scoped,
    ...writes,
    targets: targets.optional().describe('Default: every curve of the clip.'),
    toleranceDeg: z.number().min(0.001).max(45).default(0.1).describe('Rotation tolerance in degrees (default 0.1).'),
    toleranceM: z
      .number()
      .min(0.000_01)
      .max(1)
      .default(0.0005)
      .describe('Translation tolerance in metres (default 0.0005).'),
    dryRun,
  }),
  output: z.object({
    before: z.number(),
    after: z.number(),
    maxErrorDeg: z.number(),
    maxErrorM: z.number(),
    dryRun: z.boolean(),
  }),
  annotations: { readOnly: false, destructive: true, idempotent: false },
  access: 'edit',
  hosts: ['live', 'headless'],
  alwaysLoad: false,
  stretch: false,
  kind: 'edit',
  budget: BUDGETS.write,
  example: { clip: 'mocap', toleranceDeg: 0.2, dryRun: true },
  ready: true,
  run: (ctx, args) => curvesSimplifyRun(ctx, args) as never,
});
