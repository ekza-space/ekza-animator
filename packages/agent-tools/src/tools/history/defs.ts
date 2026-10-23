// History tools (MCP-SPEC §6.9 and §5.13, tools 31–32; P2).
import { z } from 'zod';
import {
  actorKindOut,
  CHECKPOINT_HANDLE,
  COUNTER_MAX,
  confirmFlag,
  dryRun,
  exactlyOne,
  projectRef,
} from '../../schemas/common';
import { BUDGETS, defineTool } from '../define';
import { historyCheckpoint as historyCheckpointRun, historyRevert as historyRevertRun, revertConfirm } from './run';

export const historyCheckpoint = defineTool({
  name: 'history_checkpoint',
  title: 'Checkpoint or list history',
  description:
    'Mark the start of a user request with a short label so you (and the user) can undo it as a group, or list recent steps. ' +
    'Call it once per user request, before its first edit, with label = the request in ≤ 60 characters (Slow walk ' +
    '1.5×); it changes nothing and returns a checkpoint handle (cp_…, valid while this pairing or headless project ' +
    'lives) for history_revert {to}. list: true also returns the last limit steps of both stacks (label, actor: ' +
    'this_agent, other_agent or user, undone) and this session’s checkpoints.',
  group: 'history',
  input: z.strictObject({
    project: projectRef.optional(),
    label: z.string().min(1).max(60).optional().describe("The user's request in ≤ 60 characters (Slow walk 1.5×)."),
    list: z.boolean().default(false).describe('Also list the recent steps of both stacks and the checkpoints.'),
    limit: z.int().min(1).max(100).default(20).describe('Steps to list (default 20, ≤ 100).'),
  }),
  output: z.object({
    checkpoint: z.string(),
    step: z.number(),
    docVersion: z.number(),
    steps: z
      .array(z.object({ step: z.number(), label: z.string(), actor: actorKindOut, undone: z.boolean() }))
      .optional(),
    checkpoints: z
      .array(z.object({ checkpoint: z.string(), label: z.string().nullable(), step: z.number() }))
      .optional(),
  }),
  annotations: { readOnly: true, destructive: false, idempotent: false },
  access: 'read',
  hosts: ['live', 'headless'],
  alwaysLoad: true,
  stretch: false,
  kind: 'read',
  budget: { tokens: 600, maxTokens: 4_000 },
  example: { label: 'Slow walk 1.5×' },
  ready: true,
  run: (ctx, args) => historyCheckpointRun(ctx, args) as never,
});

export const historyRevert = defineTool({
  name: 'history_revert',
  title: 'Revert your AI steps',
  description:
    "Undo or revert your own AI steps since a checkpoint (or given steps) without touching the user's edits. " +
    'Pass exactly one of to (a checkpoint from history_checkpoint) or steps (your step ids). When your steps are the ' +
    'top of the undo stack they are undone (mode undo: the user can redo them); otherwise one new step "AI: Revert N ' +
    'steps" restores them (mode revert), keeping the user’s steps and skipping fields the user changed since ' +
    '(skippedFields). Steps that left the undo history are listed as unreachable. includeUserSteps: true undoes the ' +
    'user’s steps down to the checkpoint too (the editor asks the user; headless needs confirm: true). dryRun ' +
    'reports the mode and steps without changing anything.',
  group: 'history',
  input: z
    .strictObject({
      project: projectRef.optional(),
      to: z
        .string()
        .regex(CHECKPOINT_HANDLE)
        .optional()
        .describe('Revert your steps newer than this checkpoint (cp_…).'),
      steps: z
        .array(z.int().min(1).max(COUNTER_MAX))
        .min(1)
        .max(500)
        .optional()
        .describe('Revert these step ids (your own steps only).'),
      includeUserSteps: z
        .boolean()
        .default(false)
        .describe("Also undo the user's steps down to the checkpoint (the editor asks the user)."),
      dryRun,
      confirm: confirmFlag,
    })
    .refine((value) => exactlyOne(['to', 'steps'], value), 'pass exactly one of to or steps'),
  output: z.object({
    mode: z.enum(['undo', 'revert', 'none']),
    reverted: z.array(z.number()),
    alreadyUndone: z.array(z.number()),
    unreachable: z.array(z.number()),
    skippedFields: z.array(z.object({ record: z.string(), fields: z.array(z.string()).nullable() })),
    dryRun: z.boolean(),
  }),
  annotations: { readOnly: false, destructive: true, idempotent: false },
  access: 'edit',
  hosts: ['live', 'headless'],
  alwaysLoad: true,
  stretch: false,
  kind: 'edit',
  budget: BUDGETS.write,
  example: { to: 'cp_0123456789ab' },
  ready: true,
  confirm: (ctx, args) => revertConfirm(ctx, args),
  run: (ctx, args) => historyRevertRun(ctx, args) as never,
});
