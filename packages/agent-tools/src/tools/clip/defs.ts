// Clip tools (MCP-SPEC §6.6, tools 22–25; P2). D0 lands the final schemas with `ready: false`.
import { z } from 'zod';
import {
  characterRef,
  clipInfoOut,
  clipRef,
  confirmFlag,
  dryRun,
  FRAME_MAX,
  projectRef,
  rangeFrames,
  scoped,
  writes,
} from '../../schemas/common';
import type { AgentHostMode, ExtraGrant } from '../../types';
import { BUDGETS, defineTool } from '../define';

/** Clip names: ≤ 64 characters of [A-Za-z0-9 _.-] (doc ClipRecord). */
const clipName = z
  .string()
  .regex(/^[A-Za-z0-9 _.-]{1,64}$/)
  .describe('Clip name: 1…64 characters of letters, digits, space, _ . -');
const fps = z
  .number()
  .min(1)
  .max(240)
  .describe('Frames per second: 24, 25, 30, 60; 23.976, 29.97 and 59.94 mean the NTSC rates.');

/**
 * clip_update: live, an activation-only call (`activate: true`; the refine allows one change kind per call) changes
 * only what the user sees and needs the View grant (§5.9); headless it is an ordinary edit.
 */
function activationAccess(args: { readonly activate?: boolean | undefined }, host: AgentHostMode): 'view' | 'edit' {
  return args.activate === true && host === 'live' ? 'view' : 'edit';
}

/**
 * clip_create always edits the document (Edit); live, `activate: true` also changes what the user sees, so the call
 * needs Edit **and** View (§5.9, Q-AI-38) — View alone never creates a clip. Its run (P2) passes `access: 'view'` to
 * `ctx.run` for an activating create (runner rule 6 lets the run change the active clip), else `'edit'`.
 */
function creationExtraGrants(
  args: { readonly activate?: boolean | undefined },
  host: AgentHostMode,
): readonly ExtraGrant[] {
  return args.activate === true && host === 'live' ? ['view'] : [];
}

export const clipCreate = defineTool({
  name: 'clip_create',
  title: 'Create a clip',
  description: 'Create a new clip (or duplicate one) with a name, fps and duration.',
  group: 'clip',
  input: z
    .strictObject({
      project: projectRef.optional(),
      character: characterRef.optional(),
      name: clipName,
      fps: fps.optional(),
      durationFrames: z.number().min(1).max(FRAME_MAX).optional().describe('Length in frames (≤ 100,000).'),
      durationSeconds: z.number().min(0.01).max(10_000).optional().describe('Length in seconds (default 2).'),
      loop: z.boolean().default(false).describe('A looping clip (cycle infinities).'),
      duplicateOf: clipRef.optional().describe('Duplicate this clip instead of creating an empty one.'),
      intent: writes.intent,
      activate: z
        .boolean()
        .optional()
        .describe('Make it the active clip: headless default true; live default false (true needs Edit and View).'),
    })
    .refine(
      (value) => value.durationFrames === undefined || value.durationSeconds === undefined,
      'pass durationFrames or durationSeconds, not both',
    ),
  output: z.object({ clip: clipInfoOut, activated: z.boolean() }),
  annotations: { readOnly: false, destructive: false, idempotent: false },
  access: 'edit',
  extraGrants: creationExtraGrants,
  hosts: ['live', 'headless'],
  alwaysLoad: false,
  stretch: false,
  kind: 'edit',
  budget: BUDGETS.write,
});

const SETTINGS = ['fps', 'fpsMode', 'rangeFrames', 'loop', 'rootMotion', 'slot', 'tags', 'contactFrame'] as const;
/** The change kinds of a clip_update call: rename, activate or settings — exactly one per call (§6.6). */
function updateKinds(value: Readonly<Record<string, unknown>>): string[] {
  const kinds: string[] = [];
  if (value['name'] !== undefined) kinds.push('rename');
  if (value['activate'] !== undefined) kinds.push('activate');
  if (SETTINGS.some((field) => value[field] !== undefined)) kinds.push('settings');
  return kinds;
}

export const clipUpdate = defineTool({
  name: 'clip_update',
  title: 'Update a clip',
  description: 'Rename a clip or change its fps, range, loop flag, root motion, slot, tags or contact frame.',
  group: 'clip',
  input: z
    .strictObject({
      ...scoped,
      ...writes,
      name: clipName.optional().describe('New name (a rename-only call).'),
      fps: fps.optional(),
      fpsMode: z
        .enum(['keep_seconds', 'keep_frames'])
        .optional()
        .describe('With fps: keep_seconds retimes the keys, keep_frames keeps their frames.'),
      rangeFrames: rangeFrames('New clip range [start, end] in clip frames (≤ 100,000 frames long).').optional(),
      loop: z.boolean().optional().describe('Loop flag.'),
      rootMotion: z.enum(['keep', 'in_place']).optional().describe('Root motion on export.'),
      slot: z.string().min(1).max(64).optional().describe('Ekza slot name (ADR 0010 vocabulary).'),
      tags: z
        .array(z.string().regex(/^[a-z0-9_-]{1,32}$/))
        .max(8)
        .optional()
        .describe('Tags: lowercase a-z 0-9 _ - (≤ 8).'),
      contactFrame: z
        .number()
        .min(-FRAME_MAX)
        .max(FRAME_MAX)
        .nullable()
        .optional()
        .describe('Impact pose clip frame (attacks, casts), or null to clear.'),
      activate: z.boolean().optional().describe('Make it the active clip (live: needs the View grant).'),
      confirm: confirmFlag,
    })
    .refine(
      (value) => updateKinds(value).length === 1,
      'one change kind per call: a rename, an activation, or settings',
    ),
  output: z.object({ clip: clipInfoOut, overridesDropped: z.number(), activated: z.boolean() }),
  annotations: { readOnly: false, destructive: true, idempotent: false },
  access: activationAccess,
  hosts: ['live', 'headless'],
  alwaysLoad: false,
  stretch: false,
  kind: 'edit',
  budget: BUDGETS.write,
});

const seamSummaryOut = z.object({
  verdict: z.enum(['seamless', 'pops', 'hitches', 'not_a_loop']),
  maxC0: z.number(),
  maxC1PerFrame: z.number(),
  worst: z.array(z.string()),
});

export const clipMakeLoop = defineTool({
  name: 'clip_make_loop',
  title: 'Make a clip loop',
  description:
    'Make a clip loop seamlessly (match the ends, blend or only cycle), reporting the seam before and after.',
  group: 'clip',
  input: z.strictObject({
    ...scoped,
    ...writes,
    method: z
      .enum(['match_ends', 'blend', 'cycle_only'])
      .default('match_ends')
      .describe(
        'match_ends (default) sets the end keys to the start; blend cross-fades; cycle_only sets cycling only.',
      ),
    blendFrames: z.number().min(1).max(10_000).default(6).describe('blend: frames to cross-fade (default 6).'),
    rootTravel: z
      .enum(['cycle_offset', 'in_place', 'keep'])
      .default('cycle_offset')
      .describe('Root translation: keep the travel with cycle offset (default), remove it, or leave the root alone.'),
    dryRun,
  }),
  output: z.object({ before: seamSummaryOut, after: seamSummaryOut, curvesChanged: z.number(), dryRun: z.boolean() }),
  annotations: { readOnly: false, destructive: true, idempotent: false },
  access: 'edit',
  hosts: ['live', 'headless'],
  alwaysLoad: false,
  stretch: false,
  kind: 'edit',
  budget: BUDGETS.write,
});

export const clipDelete = defineTool({
  name: 'clip_delete',
  title: 'Delete a clip',
  description: 'Delete a clip (undoable).',
  group: 'clip',
  input: z.strictObject({
    project: projectRef.optional(),
    character: characterRef.optional(),
    clip: clipRef.describe('The clip to delete (name or id).'),
    confirm: confirmFlag,
    intent: writes.intent,
  }),
  output: z.object({ deleted: z.string(), userNowSees: z.string().nullable() }),
  annotations: { readOnly: false, destructive: true, idempotent: false },
  access: 'edit',
  hosts: ['live', 'headless'],
  alwaysLoad: false,
  stretch: false,
  kind: 'edit',
  budget: BUDGETS.write,
});
