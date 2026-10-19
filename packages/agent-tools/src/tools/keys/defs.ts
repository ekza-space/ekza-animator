// Keys and timing tools (MCP-SPEC §6.2 keys_read and §6.4, tools 6 and 14–18; P2). D0 lands the final schemas with
// `ready: false`.
import { z } from 'zod';
import {
  atLeastOne,
  bodyPartName,
  CURSOR_HANDLE,
  channelName,
  controlRef,
  count,
  DEG_MAX,
  exactlyOne,
  FACTOR_MAX,
  FACTOR_MIN,
  FRAME_MAX,
  frame,
  frameList,
  confirmFlag,
  M_MAX,
  optionalExtendRange,
  rangeFrames,
  scoped,
  tangentName,
  targets,
  writes,
} from '../../schemas/common';
import { BUDGETS, defineTool } from '../define';

const unitOut = z.enum(['deg', 'm', 'factor', 'none']);
const infinityOut = z.enum(['constant', 'linear', 'cycle', 'cycle_offset', 'oscillate']);
/** Values written by the tools: the channel's unit, bounded by the widest unit (degrees). */
const VALUE_MAX = 100_000;

export const keysRead = defineTool({
  name: 'keys_read',
  title: 'Read keys',
  description: 'Read raw keys (frame, value, tangents) of controls in a frame range, paged.',
  group: 'keys',
  input: z.strictObject({
    ...scoped,
    targets,
    rangeFrames: rangeFrames().optional(),
    precision: z
      .enum(['display', 'full'])
      .default('display')
      .describe('display (default) rounds values (0.01°, 0.1 mm); full returns stored values in the field unit.'),
    cursor: z.string().regex(CURSOR_HANDLE).optional().describe('The cursor of the previous page (cur_…).'),
    limit: count('Keys per page (default 200).', 1, 500).default(200),
  }),
  output: z.object({
    curves: z.array(
      z.object({
        control: z.string(),
        channel: z.string(),
        unit: unitOut,
        pre: infinityOut,
        post: infinityOut,
        keys: z.array(z.tuple([z.number(), z.number(), z.string(), z.string(), z.string()])),
      }),
    ),
    cursor: z.string().nullable(),
    truncated: z.boolean(),
  }),
  annotations: { readOnly: true, destructive: false, idempotent: true },
  access: 'read',
  hosts: ['live', 'headless'],
  alwaysLoad: false,
  stretch: false,
  kind: 'read',
  budget: BUDGETS.rawKeys,
});

const keyItem = z.strictObject({
  control: controlRef,
  channel: channelName,
  frame: frame('Clip frame of the key.'),
  value: z
    .number()
    .min(-VALUE_MAX)
    .max(VALUE_MAX)
    .describe("Value in the channel's unit: degrees (rotations, angle attributes), metres, factor (scale)."),
  tangent: tangentName.optional(),
  breakdown: z.boolean().optional().describe('Mark the key as a breakdown.'),
});

export const keysSet = defineTool({
  name: 'keys_set',
  title: 'Set keys',
  description: 'Write keys on control channels at clip frames, or key the current keyed pose of controls at frames.',
  group: 'keys',
  input: z
    .strictObject({
      ...scoped,
      ...writes,
      keys: z
        .array(keyItem)
        .min(1)
        .max(2_000)
        .optional()
        .describe('Keys to write (≤ 2,000); exclusive with keyPoseAt.'),
      keyPoseAt: z
        .strictObject({
          controls: z.array(controlRef).min(1).max(100).optional().describe('Controls to key.'),
          bodyParts: z.array(bodyPartName).min(1).max(10).optional().describe('Body parts to key.'),
          frames: frameList('Clip frames to key the keyed pose at (≤ 64).', 64),
        })
        .refine((value) => atLeastOne(['controls', 'bodyParts'], value), 'pass controls or bodyParts')
        .optional()
        .describe('Key the evaluated keyed pose of controls at frames; exclusive with keys.'),
      extendRange: optionalExtendRange,
    })
    .refine((value) => exactlyOne(['keys', 'keyPoseAt'], value), 'pass exactly one of keys or keyPoseAt'),
  output: z.object({
    written: z.number(),
    curvesCreated: z.number(),
    rangeExtended: z.boolean(),
    hiddenByOverrides: z.array(z.string()),
  }),
  annotations: { readOnly: false, destructive: true, idempotent: false },
  access: 'edit',
  hosts: ['live', 'headless'],
  alwaysLoad: true,
  stretch: false,
  kind: 'edit',
  budget: BUDGETS.write,
});

export const keysDelete = defineTool({
  name: 'keys_delete',
  title: 'Delete keys',
  description: 'Delete keys of control channels at frames or in a range.',
  group: 'keys',
  input: z
    .strictObject({
      ...scoped,
      ...writes,
      targets,
      frames: frameList(
        'Delete the keys at these clip frames (≤ 1,000); exclusive with rangeFrames.',
        1_000,
      ).optional(),
      rangeFrames: rangeFrames('Delete the keys inside [start, end] clip frames, inclusive.').optional(),
      confirm: confirmFlag,
    })
    .refine((value) => exactlyOne(['frames', 'rangeFrames'], value), 'pass exactly one of frames or rangeFrames'),
  output: z.object({ deleted: z.number() }),
  annotations: { readOnly: false, destructive: true, idempotent: false },
  access: 'edit',
  hosts: ['live', 'headless'],
  alwaysLoad: false,
  stretch: false,
  kind: 'edit',
  budget: BUDGETS.write,
});

const amplitudeOut = z.array(
  z.object({ control: z.string(), channel: z.string(), peakToPeak: z.number(), unit: z.string() }),
);

export const keysAdjust = defineTool({
  name: 'keys_adjust',
  title: 'Adjust key values',
  description:
    'Change animation values over a frame range: scale them ("25 % bigger") about a pivot or offset them ("hips 3 cm lower"), keeping tangent shapes.',
  group: 'keys',
  input: z
    .strictObject({
      ...scoped,
      ...writes,
      targets,
      rangeFrames: rangeFrames('Keys inside [start, end] clip frames (default: the clip range).').optional(),
      frames: frameList('Only the keys at these clip frames (≤ 1,000); exclusive with rangeFrames.', 1_000).optional(),
      scalePercent: z
        .number()
        .min(1)
        .max(10_000)
        .optional()
        .describe('Scale values about the pivot in percent: 125 = 25 % bigger, 80 = 20 % smaller.'),
      pivot: z
        .union([
          z.enum(['rest', 'mean', 'range_start']),
          z.strictObject({ frame: frame('The pivot is each curve’s value at this clip frame.') }),
        ])
        .default('rest')
        .describe('Scale pivot per curve: rest (0°, 0 m, factor 1), mean, range_start or {frame}.'),
      offsetDeg: z
        .number()
        .min(-DEG_MAX)
        .max(DEG_MAX)
        .optional()
        .describe('Degrees added to rotation channels and angle attributes.'),
      offsetM: z.number().min(-M_MAX).max(M_MAX).optional().describe('Metres added to translation channels.'),
      offsetFactor: z.number().min(-FACTOR_MAX).max(FACTOR_MAX).optional().describe('Factor added to scale channels.'),
      falloffFrames: z
        .number()
        .min(0)
        .max(FRAME_MAX)
        .default(0)
        .describe('Fade the change out linearly over this many frames outside the range.'),
    })
    .refine(
      (value) => atLeastOne(['scalePercent', 'offsetDeg', 'offsetM', 'offsetFactor'], value),
      'pass scalePercent or an offset (offsetDeg, offsetM, offsetFactor)',
    )
    .refine(
      (value) => value.frames === undefined || value.rangeFrames === undefined,
      'pass frames or rangeFrames, not both',
    ),
  output: z.object({
    keys: z.number(),
    curves: z.number(),
    skipped: z.array(z.object({ control: z.string(), channel: z.string(), reason: z.enum(['locked', 'no_keys']) })),
    amplitudeBefore: amplitudeOut,
    amplitudeAfter: amplitudeOut,
  }),
  annotations: { readOnly: false, destructive: true, idempotent: false },
  access: 'edit',
  hosts: ['live', 'headless'],
  alwaysLoad: false,
  stretch: false,
  kind: 'edit',
  budget: BUDGETS.write,
});

export const keysRetime = defineTool({
  name: 'keys_retime',
  title: 'Retime keys',
  description:
    'Shift, scale, insert or remove time on keys (offset with wrap-around for loops, scale about a pivot, snapped to frames).',
  group: 'keys',
  input: z
    .strictObject({
      ...scoped,
      ...writes,
      targets,
      mode: z.enum(['offset', 'scale', 'insert_time', 'delete_time']).describe('What to do with the key times.'),
      offsetFrames: z
        .number()
        .min(-FRAME_MAX)
        .max(FRAME_MAX)
        .optional()
        .describe('offset: move the keys by this many frames.'),
      wrap: z.boolean().default(false).describe('offset on a loop clip: keys leaving the range wrap to the other end.'),
      factor: z.number().min(FACTOR_MIN).max(FACTOR_MAX).optional().describe('scale: time factor (2 = twice as slow).'),
      pivotFrame: frame('scale: the clip frame that stays put (default: the range start).').optional(),
      atFrame: frame('insert_time / delete_time: where time is inserted or removed.').optional(),
      frames: z.number().min(0).max(FRAME_MAX).optional().describe('insert_time / delete_time: how many frames.'),
      ripple: z.boolean().default(false).describe('Shift every later key of the curves by the same amount.'),
      retimeBreakdowns: z.boolean().default(true).describe('Breakdowns keep their relative timing between keys.'),
      snapToFrames: z.boolean().default(true).describe('Scaled keys land on whole frames (collisions merge).'),
    })
    .superRefine((value, ctx) => {
      const need: Record<string, readonly string[]> = {
        offset: ['offsetFrames'],
        scale: ['factor'],
        insert_time: ['atFrame', 'frames'],
        delete_time: ['atFrame', 'frames'],
      };
      for (const field of need[value.mode] ?? []) {
        if ((value as Record<string, unknown>)[field] === undefined) {
          ctx.addIssue({ code: 'custom', path: [field], message: `mode ${value.mode} needs ${field}` });
        }
      }
    }),
  output: z.object({
    moved: z.number(),
    merged: z.number(),
    clamped: z.number(),
    snapped: z.number(),
    contactFrame: z.number().nullable(),
  }),
  annotations: { readOnly: false, destructive: true, idempotent: false },
  access: 'edit',
  hosts: ['live', 'headless'],
  alwaysLoad: false,
  stretch: false,
  kind: 'edit',
  budget: BUDGETS.write,
});

export const keysTween = defineTool({
  name: 'keys_tween',
  title: 'Key tweens and breakdowns',
  description:
    'Key tweens and breakdowns at frames between neighbouring keys (tween, toward a neighbour, ease, push/pull, toward default).',
  group: 'keys',
  input: z.strictObject({
    ...scoped,
    ...writes,
    targets,
    frames: frameList('Clip frames to key (≤ 64).', 64),
    mode: z
      .enum(['tween', 'neighbor', 'ease', 'push_pull', 'to_default'])
      .describe('tween between neighbours, toward a neighbour, ease, push/pull, or toward the default value.'),
    amountPercent: z.number().min(-150).max(150).describe('Amount in percent, −150…150 (50 = halfway).'),
    breakdown: z.boolean().default(true).describe('Mark the new keys as breakdowns.'),
  }),
  output: z.object({ keyed: z.number(), frames: z.array(z.number()) }),
  annotations: { readOnly: false, destructive: true, idempotent: false },
  access: 'edit',
  hosts: ['live', 'headless'],
  alwaysLoad: false,
  stretch: false,
  kind: 'edit',
  budget: BUDGETS.write,
});
