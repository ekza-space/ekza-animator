// Posing tools (MCP-SPEC §6.2 pose_read and §6.3, tools 8–13; P2) and the stretch pose_plant_feet (S1). D0 lands the
// final schemas with `ready: false`.
import { z } from 'zod';
import {
  bodyPartName,
  boneRef,
  clipRef,
  controlRef,
  DEG_MAX,
  direction,
  exactlyOne,
  FACTOR_MAX,
  frame,
  frameList,
  limbName,
  M_MAX,
  optionalExtendRange,
  rangeFrames,
  scoped,
  tangentName,
  targets,
  valueXYZ,
  vec3M,
  vec3Out,
  writes,
} from '../../schemas/common';
import { BUDGETS, defineTool } from '../define';

export const ROTATE_ORDERS = ['xyz', 'yzx', 'zxy', 'xzy', 'yxz', 'zyx'] as const;
const xyzOut = z.object({ x: z.number().optional(), y: z.number().optional(), z: z.number().optional() });
/** Attribute values: degrees for angle attributes, metres for distances, plain numbers otherwise. */
const ATTR_MAX = 100_000;

export const poseRead = defineTool({
  name: 'pose_read',
  title: 'Read the pose',
  description:
    'Read the pose at frames or sampled over a range, as Channel Box values (in pose_set’s shape) or as bone positions and orientations in character space.',
  group: 'pose',
  input: z
    .strictObject({
      ...scoped,
      frames: frameList('Clip frames to read (≤ 8); exclusive with rangeFrames.', 8).optional(),
      rangeFrames: rangeFrames('Sample [start, end] clip frames (≤ 64 samples).').optional(),
      stepFrames: z.number().min(0.001).max(100_000).optional().describe('Sampling step in frames over rangeFrames.'),
      space: z
        .enum(['channels', 'world', 'both'])
        .default('channels')
        .describe('channels: Channel Box values; world: bone positions and orientations in character space.'),
      targets: targets.optional().describe('Default: every control (channels) / the humanoid bones (world).'),
      bones: z.array(boneRef).min(1).max(64).optional().describe('world: which bones (default: the targets’ bones).'),
      withUserOverrides: z
        .boolean()
        .default(false)
        .describe('Read what the user sees (their unkeyed edits) instead of the keyed animation.'),
    })
    .refine(
      (value) => value.frames === undefined || value.rangeFrames === undefined,
      'pass frames or rangeFrames, not both',
    ),
  output: z.object({
    frames: z.array(
      z.object({
        frame: z.number(),
        controls: z
          .array(
            z.object({
              control: z.string(),
              rotateDeg: xyzOut.optional(),
              translateM: xyzOut.optional(),
              scaleFactor: xyzOut.optional(),
              attrs: z.record(z.string(), z.number()).optional(),
              rotateOrder: z.string(),
            }),
          )
          .optional(),
        bones: z
          .record(
            z.string(),
            z.object({
              positionM: vec3Out,
              direction: vec3Out,
              orientDeg: z.object({ pitchDeg: z.number(), yawDeg: z.number(), rollDeg: z.number() }),
            }),
          )
          .optional(),
      }),
    ),
    userOverrides: z.number(),
    truncated: z.boolean().optional(),
  }),
  annotations: { readOnly: true, destructive: false, idempotent: true },
  access: 'read',
  hosts: ['live', 'headless'],
  alwaysLoad: true,
  stretch: false,
  kind: 'read',
  budget: BUDGETS.read,
});

const poseSetItem = z.strictObject({
  control: controlRef,
  rotateDeg: valueXYZ('degrees', -DEG_MAX, DEG_MAX).optional(),
  translateM: valueXYZ('metres', -M_MAX, M_MAX).optional(),
  scaleFactor: valueXYZ('factor', -FACTOR_MAX, FACTOR_MAX).optional(),
  attrs: z
    .record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/), z.number().min(-ATTR_MAX).max(ATTR_MAX))
    .optional()
    .describe('Custom attributes by name without @ (angle attributes in degrees).'),
  rotateOrder: z
    .enum(ROTATE_ORDERS)
    .optional()
    .describe("Optional echo of pose_read: must match the control's rotate order."),
});

export const poseSet = defineTool({
  name: 'pose_set',
  title: 'Set a pose',
  description:
    'Set Channel Box values (degrees, metres) of one or more controls at one clip frame and key them (pose-to-pose blocking).',
  group: 'pose',
  input: z.strictObject({
    ...scoped,
    ...writes,
    frame: frame('Clip frame to key.'),
    set: z.array(poseSetItem).min(1).max(100).describe('Controls and their values (1…100), in pose_read’s shape.'),
    mode: z
      .enum(['absolute', 'relative'])
      .default('absolute')
      .describe('absolute (default) sets the values; relative adds them to the keyed values at that frame.'),
    key: z
      .enum(['key', 'static', 'pose_only'])
      .default('key')
      .describe(
        "key (default) always keys; static sets clip-wide values on unkeyed channels; pose_only proposes at the user's frame (View).",
      ),
    syncRotation: z
      .boolean()
      .default(true)
      .describe('Also key the other rotation axes of each control, like Maya’s S.'),
    tangent: tangentName.optional(),
    extendRange: optionalExtendRange,
  }),
  output: z.object({
    frame: z.number(),
    changed: z.array(
      z.object({
        control: z.string(),
        channel: z.string(),
        before: z.number(),
        after: z.number(),
        unit: z.enum(['deg', 'm', 'factor']),
      }),
    ),
    changedCount: z.number(),
    keyed: z.number(),
    synced: z.number(),
    statics: z.number(),
    skipped: z.array(
      z.object({ control: z.string(), channel: z.string(), reason: z.enum(['locked', 'not_keyable', 'animated']) }),
    ),
  }),
  annotations: { readOnly: false, destructive: true, idempotent: false },
  access: (args: { readonly key?: string | undefined }) => (args.key === 'pose_only' ? 'view' : 'edit'),
  hosts: ['live', 'headless'],
  alwaysLoad: true,
  stretch: false,
  kind: 'edit',
  budget: BUDGETS.write,
});

const aimItem = z
  .strictObject({
    bone: boneRef,
    direction: direction('Aim the bone along this character-space direction.').optional(),
    towardBone: boneRef.optional().describe('Aim the bone toward this bone’s position at that frame.'),
    towardPointM: vec3M('Aim the bone toward this point, character space, metres.').optional(),
    keepTwist: z.boolean().default(true).describe('Keep the bone’s twist (default true).'),
    weight: z.number().min(0).max(1).default(1).describe('Blend between the current (0) and the aimed (1) direction.'),
    split: z
      .strictObject({
        neck: z.number().min(0).max(1).describe('Share of a head aim the neck takes (0…1).'),
        head: z.number().min(0).max(1).describe('Share of a head aim the head takes (0…1).'),
      })
      .optional()
      .describe('Head aims only: distribute over neck and head (default neck 0.4, head 0.6).'),
  })
  .refine(
    (value) => exactlyOne(['direction', 'towardBone', 'towardPointM'], value),
    'pass exactly one of direction, towardBone or towardPointM',
  );

export const poseAim = defineTool({
  name: 'pose_aim',
  title: 'Aim bones',
  description: 'Point bones of FK chains in a character-space direction or toward a point or bone, keyed at one frame.',
  group: 'pose',
  input: z.strictObject({
    ...scoped,
    ...writes,
    frame: frame('Clip frame to key.'),
    aims: z.array(aimItem).min(1).max(12).describe('Bones and their targets (≤ 12), processed parents first.'),
    extendRange: optionalExtendRange,
  }),
  output: z.object({
    frame: z.number(),
    aims: z.array(
      z.object({ bone: z.string(), control: z.string(), achievedDirection: vec3Out, errorDeg: z.number() }),
    ),
    keyed: z.number(),
  }),
  annotations: { readOnly: false, destructive: true, idempotent: false },
  access: 'edit',
  hosts: ['live', 'headless'],
  alwaysLoad: true,
  stretch: false,
  kind: 'edit',
  budget: BUDGETS.write,
});

export const poseIkTarget = defineTool({
  name: 'pose_ik_target',
  title: 'Place an IK hand or foot',
  description:
    'Place an IK hand or foot at a position in character space, keyed at one frame (an FK limb switches to IK only over a range you give).',
  group: 'pose',
  input: z
    .strictObject({
      ...scoped,
      ...writes,
      frame: frame('Clip frame to key.'),
      limb: limbName,
      positionM: vec3M('Absolute effector position, character space, metres.').optional(),
      offsetM: vec3M('Move the effector by this offset from its position at that frame, metres.').optional(),
      nearBone: z
        .strictObject({
          bone: boneRef,
          offsetM: vec3M('Offset from that bone, character space, metres.').optional(),
        })
        .optional()
        .describe('Place the effector at a bone’s position (plus an offset).'),
      orientDeg: z
        .strictObject({
          pitchDeg: z.number().min(-360).max(360).optional().describe('Toes, fingers or palm up (+) in degrees.'),
          yawDeg: z
            .number()
            .min(-360)
            .max(360)
            .optional()
            .describe('Turned toward the character’s left (+) in degrees.'),
          rollDeg: z.number().min(-360).max(360).optional().describe('The character’s-left side up (+) in degrees.'),
        })
        .optional()
        .describe('Effector orientation relative to rest (toes up 20°: {pitchDeg: 20}).'),
      poleDirection: direction('Where the knee or elbow points.').optional(),
      ensureIk: z
        .enum(['never', 'auto'])
        .default('never')
        .describe('never (default): an FK limb answers limb_mode; auto switches to IK over switchRangeFrames only.'),
      switchRangeFrames: rangeFrames('With ensureIk auto: the frames to switch to IK (contains frame).').optional(),
      extendRange: optionalExtendRange,
    })
    .refine(
      (value) => exactlyOne(['positionM', 'offsetM', 'nearBone'], value),
      'pass exactly one of positionM, offsetM or nearBone',
    )
    .refine((value) => value.ensureIk !== 'auto' || value.switchRangeFrames !== undefined, {
      message: 'ensureIk auto needs switchRangeFrames',
      path: ['switchRangeFrames'],
    }),
  output: z.object({
    limb: z.string(),
    reached: z.boolean(),
    errorM: z.number(),
    switchedToIk: z.object({ rangeFrames: z.tuple([z.number(), z.number()]) }).nullable(),
    keyed: z.number(),
  }),
  annotations: { readOnly: false, destructive: true, idempotent: false },
  access: 'edit',
  hosts: ['live', 'headless'],
  alwaysLoad: true,
  stretch: false,
  kind: 'edit',
  budget: BUDGETS.write,
});

export const poseTransfer = defineTool({
  name: 'pose_transfer',
  title: 'Copy or mirror a pose',
  description:
    'Copy or mirror a pose from one frame or clip to other frames (holds, mirrored poses) without the clipboard.',
  group: 'pose',
  input: z.strictObject({
    ...scoped,
    ...writes,
    fromFrame: frame('Clip frame to copy the pose from.'),
    fromClip: clipRef.optional().describe('Copy from this clip of the same character (default: clip).'),
    toFrames: frameList('Clip frames to key the pose at (1…64).', 64),
    controls: z.array(controlRef).min(1).max(100).optional().describe('Controls to copy (default: all).'),
    bodyParts: z.array(bodyPartName).min(1).max(10).optional().describe('Body parts to copy (default: all).'),
    mirror: z
      .enum(['none', 'flip', 'left_to_right', 'right_to_left'])
      .default('none')
      .describe('Mirror the pose: flip both sides, or copy one side onto the other.'),
    extendRange: optionalExtendRange,
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

export const poseReset = defineTool({
  name: 'pose_reset',
  title: 'Reset to rest',
  description: 'Key controls back to their rest pose at frames.',
  group: 'pose',
  input: z.strictObject({
    ...scoped,
    ...writes,
    frames: frameList('Clip frames to key the rest pose at (1…64).', 64),
    controls: z.array(controlRef).min(1).max(100).optional().describe('Controls to reset (default: all).'),
    bodyParts: z.array(bodyPartName).min(1).max(10).optional().describe('Body parts to reset (default: all).'),
  }),
  output: z.object({ keyed: z.number(), frames: z.array(z.number()) }),
  annotations: { readOnly: false, destructive: true, idempotent: true },
  access: 'edit',
  hosts: ['live', 'headless'],
  alwaysLoad: false,
  stretch: false,
  kind: 'edit',
  budget: BUDGETS.write,
});

export const posePlantFeet = defineTool({
  name: 'pose_plant_feet',
  title: 'Plant feet',
  description: 'Remove foot sliding by locking feet over their contacts.',
  group: 'pose',
  input: z.strictObject({
    ...scoped,
    ...writes,
    feet: z
      .array(z.enum(['L', 'R']))
      .min(1)
      .max(2)
      .optional()
      .describe('Feet to plant (default both).'),
    contacts: z
      .array(
        z.strictObject({ foot: z.enum(['L', 'R']).describe('Foot.'), rangeFrames: rangeFrames('Contact frames.') }),
      )
      .min(1)
      .max(64)
      .optional()
      .describe('Contact intervals (default: detected by analyze_contacts).'),
    blendFrames: z.number().min(0).max(100).optional().describe('Blend in and out over this many frames.'),
  }),
  output: z.object({ contacts: z.number(), keyed: z.number(), maxSlideAfterCm: z.number() }),
  annotations: { readOnly: false, destructive: true, idempotent: false },
  access: 'edit',
  hosts: ['live', 'headless'],
  alwaysLoad: false,
  stretch: true,
  kind: 'edit',
  budget: BUDGETS.write,
});
