// Keys and timing tools (MCP-SPEC §6.2 keys_read and §6.4, tools 6 and 14–18; P2).
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
import { keysRead as keysReadRun } from './read';
import {
  keysAdjust as keysAdjustRun,
  keysDelete as keysDeleteRun,
  keysDeleteConfirm,
  keysRetime as keysRetimeRun,
  keysSet as keysSetRun,
  keysTween as keysTweenRun,
} from './write';

const unitOut = z.enum(['deg', 'm', 'factor', 'none']);
const infinityOut = z.enum(['constant', 'linear', 'cycle', 'cycle_offset', 'oscillate']);
/** Values written by the tools: the channel's unit, bounded by the widest unit (degrees). */
const VALUE_MAX = 100_000;

export const keysRead = defineTool({
  name: 'keys_read',
  title: 'Read keys',
  description:
    'Read raw keys (frame, value, tangents) of controls in a frame range, paged. ' +
    'Use curves_summary first to see which curves matter. Each curve lists its unit (deg for rotations and angle ' +
    'attributes, m for translations, factor for scale) and infinities, and keys as [frame, value, inType, outType, ' +
    'flags] (flags: b breakdown, k broken tangents, w weighted curve); frames are clip frames. precision: full returns ' +
    'unrounded values (display rounds to 0.01°, 0.1 mm). At most limit keys per page (default 200, ≤ 500): when ' +
    'cursor is not null, call again with the same arguments plus cursor for the next page.',
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
  example: { clip: 'walk', targets: { controls: ['fk.upperArm.L'], channels: ['rz'] } },
  ready: true,
  run: (ctx, args) => keysReadRun(ctx, args) as never,
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
  description:
    'Write keys on control channels at clip frames, or key the current keyed pose of controls at frames. ' +
    "keys: [{control, channel, frame, value, tangent?, breakdown?}] with value in the channel's unit (rx " +
    'ry rz and angle attributes in degrees, tx ty tz in metres, sx sy sz as factor), ≤ 2,000 keys; or ' +
    "keyPoseAt {controls or bodyParts, frames} keys the evaluated keyed pose (not the user's unkeyed " +
    "edits) at those frames. Frames outside the clip range fail unless extendRange: true. In the user's " +
    "editor pass clip. One call = one undo step; a key behind the user's unkeyed edit at that frame is " +
    'reported in hiddenByOverrides.',
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
  example: { clip: 'wave', keys: [{ control: 'fk.upperArm.L', channel: 'rz', frame: 10, value: 45 }] },
  ready: true,
  run: (ctx, args) => keysSetRun(ctx, args) as never,
});

export const keysDelete = defineTool({
  name: 'keys_delete',
  title: 'Delete keys',
  description:
    'Delete keys of control channels at frames or in a range. targets {controls or bodyParts, channels?} ' +
    '(default: every keyable channel), and exactly one of frames (exact clip frames) or rangeFrames ' +
    '[start, end] (inclusive). Deleting more than 500 keys asks the user first (headless: pass confirm: ' +
    'true). One undo step.',
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
  example: { clip: 'walk', targets: { controls: ['ik.leg.L'] }, rangeFrames: [12, 18] },
  ready: true,
  confirm: (ctx, args) => keysDeleteConfirm(ctx, args),
  run: (ctx, args) => keysDeleteRun(ctx, args) as never,
});

const amplitudeOut = z.array(
  z.object({ control: z.string(), channel: z.string(), peakToPeak: z.number(), unit: z.string() }),
);

export const keysAdjust = defineTool({
  name: 'keys_adjust',
  title: 'Adjust key values',
  description:
    'Change animation values over a frame range: scale them ("25 % bigger") about a pivot or offset them ' +
    '("hips 3 cm lower"), keeping tangent shapes. scalePercent 125 makes every key inside rangeFrames ' +
    '(default: the clip range) or at frames 25 % bigger about the pivot (rest: 0°, 0 m, factor 1; mean; ' +
    'range_start; {frame}); offsetDeg, offsetM and offsetFactor add to rotation, translation and scale ' +
    'channels. falloffFrames fades the change out outside the range. Tangent handles keep their shape; ' +
    'locked channels and channels without keys are skipped and listed. Reports the peak-to-peak ' +
    'amplitude before and after. ≤ 200 curves per call.',
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
  example: { clip: 'wave', targets: { bodyParts: ['arm.L'] }, scalePercent: 125 },
  ready: true,
  run: (ctx, args) => keysAdjustRun(ctx, args) as never,
});

export const keysRetime = defineTool({
  name: 'keys_retime',
  title: 'Retime keys',
  description:
    'Shift, scale, insert or remove time on keys (offset with wrap-around for loops, scale about a ' +
    'pivot, snapped to frames). mode offset moves keys by offsetFrames (wrap: true on loop clips moves ' +
    'keys leaving the range to the other end); scale multiplies key times about pivotFrame by factor (2 ' +
    '= twice as slow); insert_time / delete_time insert or remove frames at atFrame. snapToFrames ' +
    '(default true) lands keys on whole frames and merges collisions (merged, snapped); ripple shifts ' +
    'later keys too. To slow a whole clip, retime every body part and grow its range with clip_update.',
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
  example: { clip: 'walk', targets: { bodyParts: ['arm.L'] }, mode: 'offset', offsetFrames: 2, wrap: true },
  ready: true,
  run: (ctx, args) => keysRetimeRun(ctx, args) as never,
});

export const keysTween = defineTool({
  name: 'keys_tween',
  title: 'Key tweens and breakdowns',
  description:
    'Key tweens and breakdowns at frames between neighbouring keys (tween, toward a neighbour, ease, ' +
    'push/pull, toward default). For each frame (≤ 64) and each target channel keyed before and after ' +
    'it, keys a value between the previous and the next key (a key at the frame itself is replaced). ' +
    'amountPercent is the Tween slider: tween −100 = the previous key, 0 = halfway, +100 = the next key ' +
    '(30 % of the way from the previous key = −40); neighbor moves toward the nearer key, ease eases, ' +
    "push_pull exaggerates, to_default goes toward rest; −150…150, beyond ±100 only with the user's " +
    'overshoot preference. breakdown (default true) marks the new keys as breakdowns. To tween the ' +
    "user's selected keys, read them with scene_summary and pass their controls and frames.",
  group: 'keys',
  input: z.strictObject({
    ...scoped,
    ...writes,
    targets,
    frames: frameList('Clip frames to key (≤ 64).', 64),
    mode: z
      .enum(['tween', 'neighbor', 'ease', 'push_pull', 'to_default'])
      .describe('tween between neighbours, toward a neighbour, ease, push/pull, or toward the default value.'),
    amountPercent: z
      .number()
      .min(-150)
      .max(150)
      .describe('Tween slider amount, −150…150: tween −100 = previous key, 0 = halfway, +100 = next key.'),
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
  example: { clip: 'walk', targets: { bodyParts: ['arm.L'] }, frames: [5], mode: 'tween', amountPercent: 0 },
  ready: true,
  run: (ctx, args) => keysTweenRun(ctx, args) as never,
});
