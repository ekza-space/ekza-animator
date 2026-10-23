// Character setup tools (MCP-SPEC §0.4.4; B4): model_inspect, model_fix, rig_create, library_list, library_use. They
// run the Auto-Rig compositions (AUTORIG-SPEC §4.5), so an agent's character equals the wizard's. Every inner step of
// a composition is its own `AI: …` history step.
import { z } from 'zod';
import { characterRef, clipRef, projectRef } from '../../schemas/common';
import type { AgentHostMode, ExtraGrant } from '../../types';
import { BUDGETS, defineTool } from '../define';
import { HEIGHT_LIMITS_M, MARKER_NAMES, MODEL_FIXES, modelReportOut } from './common';
import {
  LIBRARY_CLIP_IDS,
  libraryList as libraryListRun,
  libraryUse as libraryUseRun,
  modelFix as modelFixRun,
  modelInspect as modelInspectRun,
  rigCreate as rigCreateRun,
} from './run';

const meshRefs = z
  .array(z.string().min(1).max(200))
  .min(1)
  .max(64)
  .describe('Scene meshes of the model by name or id (default: every scene mesh, i.e. the whole model).');

export const modelInspect = defineTool({
  name: 'model_inspect',
  title: 'Inspect a model for rigging',
  description:
    'Check a static model in the scene before rigging it: height, triangles, pose (T or A) and whether it is ' +
    'centred, grounded, facing +Z, upright, 0.3–3 m tall and has arms the guess can find. fixes lists the ' +
    'model_fix calls to make, in order; readyToRig says rig_create will accept it. Changes nothing.',
  group: 'setup',
  input: z.strictObject({ project: projectRef.optional(), meshes: meshRefs.optional() }),
  output: modelReportOut,
  annotations: { readOnly: true, destructive: false, idempotent: true },
  access: 'read',
  hosts: ['live', 'headless'],
  alwaysLoad: false,
  stretch: false,
  kind: 'read',
  budget: BUDGETS.summary,
  example: {},
  ready: true,
  run: (ctx, args) => modelInspectRun(ctx, args) as never,
});

export const modelFix = defineTool({
  name: 'model_fix',
  title: 'Fix a model for rigging',
  description:
    'Apply one Auto-Rig fix to the model (one undo step) and return the inspection again. center: centre on the ' +
    'origin and stand on the ground; face_forward: turn to face +Z; stand_up: turn a model lying down upright; ' +
    'scale: uniform scale to heightM (default 1.7, 0.3–3 m; the rig refuses other heights); freeze: bake rotation ' +
    'and scale into the mesh. Apply the fixes model_inspect lists, in its order.',
  group: 'setup',
  input: z
    .strictObject({
      project: projectRef.optional(),
      fix: z.enum(MODEL_FIXES).describe('center, face_forward, stand_up, scale or freeze.'),
      meshes: meshRefs.optional(),
      heightM: z
        .number()
        .min(HEIGHT_LIMITS_M.min)
        .max(HEIGHT_LIMITS_M.max)
        .optional()
        .describe('With scale: the new height in metres (default 1.7).'),
    })
    .refine((value) => value.heightM === undefined || value.fix === 'scale', 'heightM goes with fix: scale only'),
  output: modelReportOut,
  annotations: { readOnly: false, destructive: true, idempotent: false },
  access: 'edit',
  hosts: ['live', 'headless'],
  alwaysLoad: false,
  stretch: false,
  kind: 'edit',
  budget: BUDGETS.summary,
  example: { fix: 'center' },
  ready: true,
  run: (ctx, args) => modelFixRun(ctx, args) as never,
});

/** rig_create changes the user's Rig & Skin session (Quick Rig, Skin mode) and the active character: live it needs
 *  Edit and View (§0.4.4, M-AI-MVP-16). */
function rigExtraGrants(_args: unknown, host: AgentHostMode): readonly ExtraGrant[] {
  return host === 'live' ? ['view'] : [];
}

export const rigCreate = defineTool({
  name: 'rig_create',
  title: 'Rig a model',
  description:
    'Rig a static humanoid model the way Auto-Rig does: place the Quick Rig markers (One-Click guess, or your ' +
    'markers), create the VRM skeleton, bind the skin and, for an A-pose, straighten it to a T-pose (2–3 undo ' +
    'steps, each AI: …). The model must pass model_inspect first: centred, grounded, facing +Z and 0.3–3 m tall ' +
    '(else model_fix). When the guess finds no arms, pass markers shoulder, elbow and wrist of the right arm. ' +
    "Markers are metres in character space (+Y up, +Z forward, +X the character's left): centre markers sit on " +
    "x = 0, side markers on the character's right side (x < 0). rigidParts binds separate parts rigidly (default on for a model of several meshes). In the user's " +
    'editor it needs the Edit and View grants and the user confirms; the new character becomes the active, ' +
    'selected one (as in Auto-Rig) and the playhead stays. The result names the new character and the ' +
    'Validation rows of the VRM profile.',
  group: 'setup',
  input: z.strictObject({
    project: projectRef.optional(),
    meshes: meshRefs.optional(),
    markers: z
      .array(
        z.strictObject({
          name: z
            .enum(MARKER_NAMES)
            .describe('Marker: headTop, chin, pelvis, shoulder, elbow, wrist, knee, ankle, toe.'),
          positionM: z
            .tuple([
              z.number().min(-10).max(10).describe('x'),
              z.number().min(-10).max(10).describe('y'),
              z.number().min(-10).max(10).describe('z'),
            ])
            .describe(
              "Position [x, y, z] in metres, character space (side markers on the character's right side, x < 0).",
            ),
        }),
      )
      .min(1)
      .max(9)
      .optional()
      .describe('Markers to place after the guess (omit to use the guess as it is).'),
    preset: z
      .enum(['standard', 'standard_fingers'])
      .optional()
      .describe('Skeleton: standard (33 joints, mitten hands; default) or standard_fingers (52, every finger).'),
    straightenToTPose: z
      .boolean()
      .optional()
      .describe('Straighten an A-posed model to a T-pose rest (default: true when the arms hang over 5°).'),
    rigidParts: z
      .boolean()
      .optional()
      .describe('Separate parts move rigidly with their limb (default: true for several meshes).'),
  }),
  output: z.object({
    character: z.string(),
    skeleton: z.string(),
    straightened: z.boolean(),
    joints: z.number(),
    steps: z.array(z.string()),
    validation: z.array(z.object({ code: z.string(), severity: z.string(), count: z.number() })),
  }),
  annotations: { readOnly: false, destructive: true, idempotent: false },
  access: 'edit',
  extraGrants: rigExtraGrants,
  hosts: ['live', 'headless'],
  alwaysLoad: true,
  stretch: false,
  kind: 'edit',
  budget: BUDGETS.write,
  example: {},
  confirm(ctx, args) {
    if (ctx.host.mode !== 'live') return null;
    const names = args.meshes ?? [];
    const subject =
      names.length === 1 ? (names[0] as string) : names.length > 1 ? `${names.length} meshes` : 'the model';
    return {
      title: `AI wants to rig ${subject.slice(0, 40)}`,
      detail: 'Creates a skeleton and binds the skin: 2–3 undo steps.',
      danger: false,
    };
  },
  ready: true,
  run: (ctx, args) => rigCreateRun(ctx, args) as never,
});

export const libraryList = defineTool({
  name: 'library_list',
  title: 'List library clips',
  description:
    'List the clips of the starter animation library (CC0, Quaternius): id, label, loop, length and what each is ' +
    'for. Add one to a rigged character with library_use.',
  group: 'setup',
  input: z.strictObject({ project: projectRef.optional() }),
  output: z.object({
    clips: z.array(
      z.object({
        id: z.string(),
        label: z.string(),
        loop: z.boolean(),
        seconds: z.number(),
        slot: z.string().nullable(),
        use: z.string(),
      }),
    ),
    license: z.string(),
    credit: z.string(),
  }),
  annotations: { readOnly: true, destructive: false, idempotent: true },
  access: 'read',
  hosts: ['live', 'headless'],
  alwaysLoad: false,
  stretch: false,
  kind: 'read',
  budget: BUDGETS.read,
  example: {},
  ready: true,
  run: (ctx) => libraryListRun(ctx) as never,
});

export const libraryUse = defineTool({
  name: 'library_use',
  title: 'Add a library clip',
  description:
    'Add a starter library clip (walk, idle, run, …) to a rigged humanoid character as a new editable clip, with ' +
    'the Auto-Rig parameters: speedFactor (0.25–3), mirror, inPlace (no root travel), armSpaceDeg (−10…30, arms ' +
    'further from the body), trimSeconds [start, end] of the source. One undo step (Use Clip); name renames it ' +
    "(one more step); replace swaps an existing clip keeping its name and slot. In the user's editor the clip stays " +
    'out of their view; pass clip on later edits.',
  group: 'setup',
  input: z
    .strictObject({
      project: projectRef.optional(),
      character: characterRef.optional(),
      clip: z.enum(LIBRARY_CLIP_IDS).describe('Library clip id (library_list).'),
      name: z
        .string()
        .regex(/^[A-Za-z0-9 _.-]{1,64}$/)
        .optional()
        .describe('Name of the new clip (default: the library label, made unique).'),
      speedFactor: z.number().min(0.25).max(3).optional().describe('Playback speed factor (default 1).'),
      mirror: z.boolean().optional().describe('Mirror left and right.'),
      inPlace: z.boolean().optional().describe('Remove the root travel (a treadmill walk).'),
      armSpaceDeg: z.number().min(-10).max(30).optional().describe('Upper-arm spread offset in degrees (default 0).'),
      trimSeconds: z
        .tuple([z.number().min(0).max(600).describe('start'), z.number().min(0).max(600).describe('end')])
        .optional()
        .describe('Use only [start, end] seconds of the source clip.'),
      replace: clipRef.optional().describe('A clip of the character to replace (keeps its name and slot).'),
    })
    .refine(
      (value) => value.trimSeconds === undefined || value.trimSeconds[0] < value.trimSeconds[1],
      'trimSeconds: start < end',
    ),
  output: z.object({
    clip: z.string(),
    source: z.string(),
    fps: z.number(),
    rangeFrames: z.tuple([z.number(), z.number()]),
    loop: z.boolean(),
    activated: z.boolean(),
  }),
  annotations: { readOnly: false, destructive: true, idempotent: false },
  access: 'edit',
  hosts: ['live', 'headless'],
  alwaysLoad: false,
  stretch: false,
  kind: 'edit',
  budget: BUDGETS.write,
  example: { clip: 'walk' },
  ready: true,
  run: (ctx, args) => libraryUseRun(ctx, args) as never,
});
