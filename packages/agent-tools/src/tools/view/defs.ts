// See tools (MCP-SPEC §6.8, tools 29–30; P5) and the stretch view_set_time (S3; P8). D0 lands the final schemas with
// `ready: false`.
import { z } from 'zod';
import {
  boneRef,
  CHECKPOINT_HANDLE,
  confirmFlag,
  FRAME_MAX,
  frame,
  frameList,
  projectRef,
  rangeFrames,
  scoped,
  targets,
  vec3Out,
} from '../../schemas/common';
import { BUDGETS, defineTool } from '../define';

export const CAPTURE_VIEWS = [
  'front',
  'back',
  'left',
  'right',
  'top',
  'three_quarter_left',
  'three_quarter_right',
  'shot',
  'follow',
  'user',
] as const;

export const viewCapture = defineTool({
  name: 'view_capture',
  title: 'Look at the animation',
  description:
    "Look at the animation: one image with a still or a contact sheet of up to 16 frames from preset cameras or the user's view, optionally with bone trails.",
  group: 'view',
  input: z.strictObject({
    ...scoped,
    frames: z
      .union([
        frameList('Clip frames (≤ 16).', 16),
        z.enum(['keys', 'extremes']).describe('keys: the key frames; extremes: the extreme poses.'),
        z
          .strictObject({ every: z.number().min(1).max(FRAME_MAX).describe('Every this many frames over the clip.') })
          .describe('Frames at a regular step.'),
      ])
      .describe('Which frames: a list (≤ 16), keys, extremes or {every}.'),
    views: z
      .array(z.enum(CAPTURE_VIEWS))
      .min(1)
      .max(3)
      .default(['front'])
      .describe(
        "Cameras (1…3): front, back, left/right (the character's), top, three-quarter, shot, follow, or user (live).",
      ),
    crop: z.enum(['body', 'upper_body', 'legs', 'hands', 'head']).default('body').describe('Framing (default body).'),
    overlays: z
      .strictObject({
        grid: z.boolean().default(true).describe('Floor grid, 10 cm (default true).'),
        controls: z.boolean().default(false).describe('Control shapes (shaded only).'),
        contacts: z.boolean().default(false).describe('Mark foot contacts.'),
        trails: z.array(boneRef).min(1).max(4).optional().describe('Bone paths with a tick per frame (≤ 4 bones).'),
      })
      .optional()
      .describe('Overlays drawn on the tiles.'),
    withUserOverrides: z
      .boolean()
      .default(false)
      .describe("Live: show the user's unkeyed pose; only for the user's current frame of the active clip."),
    fidelity: z
      .enum(['auto', 'shaded', 'schematic'])
      .default('auto')
      .describe('auto: shaded in the editor, schematic headless.'),
    tilePx: z.int().min(64).max(768).optional().describe('Tile long edge in pixels (64…768).'),
    maxEdgePx: z
      .int()
      .min(256)
      .max(1_568)
      .default(1_024)
      .describe('Image long edge in pixels (256…1,568, default 1,024).'),
    format: z.enum(['png', 'webp']).default('png').describe('png (default) or webp (shaded only).'),
  }),
  output: z.object({
    widthPx: z.number(),
    heightPx: z.number(),
    fidelity: z.enum(['shaded', 'schematic']),
    fallbackReason: z.string().nullable(),
    visualTokens: z.number(),
    tiles: z.array(
      z.object({
        frame: z.number(),
        view: z.string(),
        rectPx: z.tuple([z.number(), z.number(), z.number(), z.number()]),
      }),
    ),
    cameras: z.record(z.string(), z.object({ projection: z.string(), positionM: vec3Out, targetM: vec3Out })),
  }),
  annotations: { readOnly: true, destructive: false, idempotent: true },
  access: 'read',
  hosts: ['live', 'headless'],
  alwaysLoad: true,
  stretch: false,
  kind: 'read',
  budget: BUDGETS.image,
});

export const viewPlotCurves = defineTool({
  name: 'view_plot_curves',
  title: 'Plot curves',
  description: 'Plot up to 6 curves (value against frame) as an image with a numeric summary.',
  group: 'view',
  input: z.strictObject({
    ...scoped,
    targets: targets.describe('Curves to plot: ≤ 6 after resolution.'),
    rangeFrames: rangeFrames().optional(),
    normalized: z.boolean().default(false).describe('Scale every curve to −1…1 (compare shapes).'),
    overlayCheckpoint: z
      .string()
      .regex(CHECKPOINT_HANDLE)
      .optional()
      .describe('Overlay the curves as they were at this checkpoint (cp_…), dashed.'),
    widthPx: z.int().min(128).max(1_568).optional().describe('Image width in pixels.'),
    heightPx: z.int().min(128).max(1_568).optional().describe('Image height in pixels.'),
  }),
  output: z.object({
    widthPx: z.number(),
    heightPx: z.number(),
    visualTokens: z.number(),
    curves: z.array(
      z.object({
        control: z.string(),
        channel: z.string(),
        unit: z.string(),
        min: z.tuple([z.number(), z.number()]),
        max: z.tuple([z.number(), z.number()]),
        overshootFrames: z.array(z.number()),
        flipFrames: z.array(z.number()),
        keyCount: z.number(),
      }),
    ),
  }),
  annotations: { readOnly: true, destructive: false, idempotent: true },
  access: 'read',
  hosts: ['live', 'headless'],
  alwaysLoad: false,
  stretch: false,
  kind: 'read',
  budget: BUDGETS.image,
});

export const viewSetTime = defineTool({
  name: 'view_set_time',
  title: "Move the user's playhead",
  description: 'Show the user something: move their playhead, set the playback range, play or stop.',
  group: 'view',
  input: z.strictObject({
    project: projectRef.optional(),
    frame: frame("Clip frame to move the user's playhead to.").optional(),
    playbackRange: rangeFrames()
      .nullable()
      .optional()
      .describe('Playback range [start, end] in clip frames, or null for the whole clip.'),
    play: z.boolean().optional().describe('Start (true) or stop (false) playback.'),
    confirm: confirmFlag,
  }),
  output: z.object({
    frame: z.number().nullable(),
    playbackRange: z.tuple([z.number(), z.number()]).nullable(),
    playing: z.boolean(),
  }),
  annotations: { readOnly: false, destructive: true, idempotent: true },
  access: 'view',
  hosts: ['live'],
  needs: ['view', 'user'],
  alwaysLoad: false,
  stretch: true,
  kind: 'edit',
  budget: BUDGETS.write,
});
