// Shared argument and result shapes of the tool catalogue (MCP-SPEC §6.1, §5.1–§5.3, §5.5): strict objects, bounded
// numbers, units in field names and descriptions. Every input object (root and nested) is a `z.strictObject`, so an
// unknown key is an `invalid_args` error; results use plain `z.object` so a server parsing a tab result strips the
// fields it does not know (§5.21).
import { z } from 'zod';

// ---------- bounds (§5.5) ----------
/** Every frame field: −100,000…100,000 clip frames. */
export const FRAME_MAX = 100_000;
/** Offsets: ±3,600° and ±1,000 m. */
export const DEG_MAX = 3_600;
export const M_MAX = 1_000;
/** Factors: 0.01…100 (scale factors of retime/adjust); channel scale values: −100…100. */
export const FACTOR_MIN = 0.01;
export const FACTOR_MAX = 100;
/** Revisions and step ids: non-negative integers. */
export const COUNTER_MAX = 1_000_000_000_000;

/** Handles are random: `tab_`/`prj_`/`cp_`/`cur_` + 12 base62 characters (§5.1). */
export const HANDLE_BODY = '[0-9A-Za-z]{12}';
export const PROJECT_HANDLE = new RegExp(`^(tab|prj)_${HANDLE_BODY}$`);
export const CHECKPOINT_HANDLE = new RegExp(`^cp_${HANDLE_BODY}$`);
export const CURSOR_HANDLE = new RegExp(`^cur_${HANDLE_BODY}$`);

// ---------- scalars ----------
export const frame = (description: string) => z.number().min(-FRAME_MAX).max(FRAME_MAX).describe(description);
export const frameList = (description: string, max: number) =>
  z.array(z.number().min(-FRAME_MAX).max(FRAME_MAX)).min(1).max(max).describe(description);
/** `[start, end]` clip frames, inclusive. */
export const rangeFrames = (description = '[start, end] in clip frames, inclusive (start ≤ end).') =>
  z.tuple([z.number().min(-FRAME_MAX).max(FRAME_MAX), z.number().min(-FRAME_MAX).max(FRAME_MAX)]).describe(description);
export const deg = (description: string, max = DEG_MAX) => z.number().min(-max).max(max).describe(description);
export const metres = (description: string, max = M_MAX) => z.number().min(-max).max(max).describe(description);
export const count = (description: string, min: number, max: number) => z.int().min(min).max(max).describe(description);

export const projectRef = z
  .string()
  .regex(PROJECT_HANDLE)
  .describe('Project handle (tab_… for the paired editor tab, prj_… for a headless project); omit when one is open.');
export const characterRef = z
  .string()
  .min(1)
  .max(200)
  .describe('Character name (case-insensitive) or id; omit when the project has one character.');
export const clipRef = z
  .string()
  .min(1)
  .max(200)
  .describe("Clip name (unique per character) or id; in the user's editor every edit must pass it.");
export const controlRef = z
  .string()
  .min(1)
  .max(200)
  .describe('Control: template key (fk.upperArm.L, ik.leg.R, cog), display name (L Upper Arm), VRM bone or id.');
export const boneRef = z
  .string()
  .min(1)
  .max(200)
  .describe('Bone: VRM humanoid name (leftHand, leftToes, head), else the glTF node name.');
export const BODY_PARTS = [
  'root',
  'torso',
  'head',
  'arm.L',
  'arm.R',
  'fingers.L',
  'fingers.R',
  'leg.L',
  'leg.R',
  'all',
] as const;
export const bodyPartName = z.enum(BODY_PARTS).describe('Body part of a humanoid rig, or all.');
/** Channel Box channels: translate (metres), rotate (degrees at the tool boundary), scale (factor), @attributes. */
export const CHANNEL_PATTERN = /^(tx|ty|tz|rx|ry|rz|sx|sy|sz|@[A-Za-z_][A-Za-z0-9_]{0,63})$/;
export const channelName = z
  .string()
  .regex(CHANNEL_PATTERN)
  .describe(
    'Channel: tx ty tz (metres), rx ry rz (degrees), sx sy sz (factor) or @attribute (angle attributes: degrees).',
  );
export const TANGENTS = ['auto', 'spline', 'clamped', 'linear', 'flat', 'step', 'plateau'] as const;
export const tangentName = z.enum(TANGENTS).describe('Tangent type.');
export const INFINITIES = ['constant', 'linear', 'cycle', 'cycle_offset', 'oscillate'] as const;
export const infinityName = z.enum(INFINITIES).describe('Curve behaviour outside its keys.');
export const detail = z
  .enum(['concise', 'detailed'])
  .default('concise')
  .describe('concise (default) keeps the result small; detailed lists everything.');
export const LIMBS = ['leg.L', 'leg.R', 'arm.L', 'arm.R'] as const;
export const limbName = z.enum(LIMBS).describe('Limb: leg.L, leg.R, arm.L or arm.R (L = the character’s left).');

/** A vector in character space: +Y up, +Z forward (the character faces +Z), +X the character's left. */
export const vec3M = (description: string, max = M_MAX) =>
  z
    .tuple([z.number().min(-max).max(max), z.number().min(-max).max(max), z.number().min(-max).max(max)])
    .describe(description);
const NAMED_DIRECTION = /^(up|down|forward|back|left|right)(\+(up|down|forward|back|left|right)){0,2}$/;
/** Named directions of the character (and `+` sums), or a vector (normalised). */
export const direction = (description: string) =>
  z
    .union([
      z
        .string()
        .regex(NAMED_DIRECTION)
        .describe('up, down, forward, back, left, right (the character’s) or a sum such as up+left.'),
      z
        .tuple([
          z.number().min(-1_000).max(1_000),
          z.number().min(-1_000).max(1_000),
          z.number().min(-1_000).max(1_000),
        ])
        .describe('[x, y, z] in character space (+X the character’s left, +Y up, +Z forward); normalised.'),
    ])
    .describe(description);

/** x/y/z values of one Channel Box group, in the parent field's unit. */
export const valueXYZ = (unit: string, min: number, max: number) =>
  z
    .strictObject({
      x: z.number().min(min).max(max).optional().describe(`X value (${unit}).`),
      y: z.number().min(min).max(max).optional().describe(`Y value (${unit}).`),
      z: z.number().min(min).max(max).optional().describe(`Z value (${unit}).`),
    })
    .describe(`Values per axis in ${unit}; omitted axes stay.`);

// ---------- shared argument groups (§6.1) ----------
/** Every project-scoped tool. With a user session, edit tools require `clip` (§5.1). */
export const scoped = {
  project: projectRef.optional(),
  character: characterRef.optional(),
  clip: clipRef.optional(),
};
/** Every edit tool. */
export const writes = {
  ifClipRevision: z
    .int()
    .min(0)
    .max(COUNTER_MAX)
    .optional()
    .describe('Strict stale check: the clip revision you last read; the call fails with stale if the clip changed.'),
  intent: z
    .string()
    .min(1)
    .max(60)
    .optional()
    .describe('Why, for the user, in ≤ 60 characters (Slow walk 1.5×); shown in the undo label.'),
};
export const targets = z
  .strictObject({
    controls: z.array(controlRef).min(1).max(100).optional().describe('Controls (≤ 100).'),
    bodyParts: z.array(bodyPartName).min(1).max(10).optional().describe('Body parts (humanoid rigs).'),
    channels: z.array(channelName).min(1).max(64).optional().describe('Channels; default: every keyable channel.'),
  })
  .describe('What to act on: at least one of controls or bodyParts, optionally narrowed to channels.');
export const optionalExtendRange = z
  .boolean()
  .default(false)
  .describe('Grow the clip range to include frames outside it (else out_of_range).');
export const confirmFlag = z
  .boolean()
  .optional()
  .describe('Headless: pass true for a consequential call (the editor asks the user instead).');
export const dryRun = z.boolean().default(false).describe('Report what would happen; change nothing.');

/** Refinement: `at least one of` a set of fields. */
export function atLeastOne(fields: readonly string[], value: Readonly<Record<string, unknown>>): boolean {
  return fields.some((field) => value[field] !== undefined);
}
/** Refinement: `exactly one of` a set of fields. */
export function exactlyOne(fields: readonly string[], value: Readonly<Record<string, unknown>>): boolean {
  return fields.filter((field) => value[field] !== undefined).length === 1;
}

// ---------- shared result shapes ----------
export const grantsOut = z.object({
  read: z.literal(true),
  edit: z.boolean(),
  files: z.boolean(),
  view: z.boolean(),
  workspace: z.boolean(),
});
export const clipInfoOut = z.object({
  character: z.string(),
  name: z.string(),
  fps: z.number(),
  rangeFrames: z.tuple([z.number(), z.number()]),
  loop: z.boolean(),
  revision: z.number(),
});
export const undoInfoOut = z.object({ step: z.number(), label: z.string() });
export const vec3Out = z.tuple([z.number(), z.number(), z.number()]);
export const actorKindOut = z.enum(['this_agent', 'other_agent', 'user']);

/** `scene_summary` data (also inside `editor_connect` and `project_open` results). */
export const sceneSummaryOut = z.object({
  host: z.object({
    mode: z.enum(['live', 'headless']),
    fidelity: z.array(z.enum(['shaded', 'schematic'])),
    files: z.array(z.enum(['download', 'workspace'])),
    grants: grantsOut,
    paused: z.boolean(),
    toolset: z.string(),
    previewActive: z.boolean(),
  }),
  project: z.object({ name: z.string(), dirty: z.boolean(), readOnly: z.boolean(), docVersion: z.number() }),
  characters: z.array(
    z.object({
      name: z.string(),
      id: z.string(),
      format: z.enum(['vrm0', 'vrm1', 'glb']),
      humanoid: z.boolean(),
      heightM: z.number(),
      limbs: z.record(z.string(), z.enum(['ik', 'fk', 'blend'])),
      clips: z.array(
        z.object({
          name: z.string(),
          id: z.string(),
          fps: z.number(),
          rangeFrames: z.tuple([z.number(), z.number()]),
          loop: z.boolean(),
          keyCount: z.number(),
          revision: z.number(),
          active: z.boolean(),
        }),
      ),
      meta: z
        .object({ title: z.string(), author: z.string(), license: z.string(), allowRedistribution: z.string() })
        .optional(),
    }),
  ),
  user: z
    .object({
      activeCharacter: z.string().nullable(),
      activeClip: z.string().nullable(),
      frame: z.number().nullable(),
      playing: z.boolean(),
      band: z.tuple([z.number(), z.number()]).nullable(),
      selection: z.object({
        controls: z.array(z.string()),
        keys: z.array(z.object({ control: z.string(), channel: z.string(), frames: z.array(z.number()) })),
        keyCount: z.number(),
        truncated: z.boolean(),
        channels: z.array(z.string()),
      }),
      overrides: z.number(),
    })
    .optional(),
  history: z.array(z.object({ step: z.number(), label: z.string(), actor: actorKindOut })),
});

/** The success envelope of a tool (§5.3) around its `data` schema: the manifest's `outputSchema`. */
export function successEnvelope<O extends z.ZodType>(data: O) {
  return z.object({
    ok: z.literal(true),
    clip: clipInfoOut.optional(),
    data,
    undo: undoInfoOut.optional(),
    warnings: z.array(z.string()).max(10).optional(),
    next: z.string().optional(),
  });
}
