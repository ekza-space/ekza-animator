// History tools (MCP-SPEC §6.9 and §5.13, tools 31–32; P2). D0 lands the final schemas with `ready: false`.
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

export const historyCheckpoint = defineTool({
  name: 'history_checkpoint',
  title: 'Checkpoint or list history',
  description:
    'Mark the start of a user request with a short label so you (and the user) can undo it as a group, or list recent steps.',
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
});

export const historyRevert = defineTool({
  name: 'history_revert',
  title: 'Revert your AI steps',
  description:
    "Undo or revert your own AI steps since a checkpoint (or given steps) without touching the user's edits.",
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
});
