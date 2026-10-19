// Operator escape hatch (MCP-SPEC §6.11 and §5.14, tools 37–39; P3). D0 lands the final schemas with `ready: false`.
import { z } from 'zod';
import { tablePolicyOf } from '../../policy';
import {
  boundedRecord,
  channelName,
  characterRef,
  clipRef,
  controlRef,
  CURSOR_HANDLE,
  confirmFlag,
  dryRun,
  frameList,
  projectRef,
  writes,
} from '../../schemas/common';
import type { AgentHostMode, ExtraGrant, ToolAccess } from '../../types';
import { BUDGETS, defineTool } from '../define';

/** Operator ids: `<category>.<name>` (dots allowed after the category). */
export const OPERATOR_ID = /^[A-Za-z][A-Za-z0-9]*(\.[A-Za-z][A-Za-z0-9]*)+$/;
const operatorId = z.string().regex(OPERATOR_ID).max(80).describe('Operator id (key.tween, graph.tangent.set).');
const agentAccessOut = z.enum(['edit', 'view', 'files']).nullable();

export const operatorsList = defineTool({
  name: 'operators_list',
  title: 'Search operators',
  description: "Search the editor's operators (the long tail beyond these tools) with availability and policy.",
  group: 'operators',
  input: z.strictObject({
    project: projectRef.optional(),
    query: z.string().min(1).max(100).optional().describe('Words to search in ids, labels and descriptions.'),
    category: z
      .string()
      .regex(/^[a-z][A-Za-z]*$/)
      .max(32)
      .optional()
      .describe('Only this category (graph, key, clip…).'),
    ids: z.array(operatorId).min(1).max(100).optional().describe('Only these operator ids.'),
    includeDenied: z
      .boolean()
      .default(false)
      .describe('Also list denied operators (default: allowed and confirm only).'),
    cursor: z.string().regex(CURSOR_HANDLE).optional().describe('The cursor of the previous page (cur_…).'),
  }),
  output: z.object({
    operators: z.array(
      z.object({
        id: z.string(),
        label: z.string(),
        category: z.string(),
        policy: z.enum(['allowed', 'confirm', 'denied']),
        access: agentAccessOut,
        undoable: z.boolean(),
        context: z.boolean(),
        available: z.boolean(),
        reason: z.string().nullable(),
        argsSummary: z.string(),
      }),
    ),
    cursor: z.string().nullable(),
  }),
  annotations: { readOnly: true, destructive: false, idempotent: true },
  access: 'read',
  hosts: ['live', 'headless'],
  alwaysLoad: false,
  stretch: false,
  kind: 'read',
  budget: BUDGETS.rawKeys,
});

export const operatorDescribe = defineTool({
  name: 'operator_describe',
  title: 'Describe an operator',
  description: "Get one operator's argument schema (its own units), policy and an example.",
  group: 'operators',
  input: z.strictObject({ project: projectRef.optional(), id: operatorId }),
  output: z.object({
    id: z.string(),
    label: z.string(),
    description: z.string(),
    policy: z.string(),
    access: agentAccessOut,
    undoable: z.boolean(),
    context: z.boolean(),
    unitsNote: z.string(),
    inputSchema: z.record(z.string(), z.unknown()),
    example: z.record(z.string(), z.unknown()),
  }),
  annotations: { readOnly: true, destructive: false, idempotent: true },
  access: 'read',
  hosts: ['live', 'headless'],
  alwaysLoad: false,
  stretch: false,
  kind: 'read',
  budget: BUDGETS.read,
});

/** operator_run's access is the operator's policy access (`by_operator` in the manifest); unknown → edit. */
function operatorAccess(args: { readonly id: string }): ToolAccess {
  return tablePolicyOf(args.id)?.access ?? 'edit';
}

/** Operators that create a clip and, with `activate: true`, also switch the user's active clip. */
const ACTIVATING_CREATIONS: ReadonlySet<string> = new Set(['clip.new', 'clip.duplicate']);

/**
 * Live, `clip.new`/`clip.duplicate {activate: true}` edit the document and change what the user sees: Edit (their
 * policy access) and View (§5.9, Q-AI-38). P3 runs them with `access: 'view'` (runner rule 6).
 */
function operatorExtraGrants(
  args: { readonly id: string; readonly args?: Readonly<Record<string, unknown>> | undefined },
  host: AgentHostMode,
): readonly ExtraGrant[] {
  return host === 'live' && ACTIVATING_CREATIONS.has(args.id) && args.args?.['activate'] === true ? ['view'] : [];
}

export const operatorRun = defineTool({
  name: 'operator_run',
  title: 'Run an operator',
  description: 'Run one allowed editor operator by id with arguments, as one undo step.',
  group: 'operators',
  input: z.strictObject({
    project: projectRef.optional(),
    id: operatorId,
    args: boundedRecord(z.string().max(64), z.unknown(), 64)
      .optional()
      .describe(
        "The operator's arguments in its own units (≤ 64 fields; see operator_describe); P3's wire schema checks them.",
      ),
    context: z
      .strictObject({
        character: characterRef.optional(),
        clip: clipRef.optional(),
        controls: z.array(controlRef).min(1).max(100).optional().describe('Controls to act on.'),
        keys: z
          .array(
            z.strictObject({
              control: controlRef,
              channel: channelName,
              frames: frameList('Clip frames of the keys.', 1_000),
            }),
          )
          .min(1)
          .max(200)
          .optional()
          .describe('Keys to act on (control, channel, frames).'),
        channels: z
          .array(z.strictObject({ control: controlRef, channel: channelName }))
          .min(1)
          .max(200)
          .optional()
          .describe('Channels to act on.'),
      })
      .optional()
      .describe('Targets of a scope-ready operator in place of a selection; with a user session it needs clip.'),
    dryRun,
    confirm: confirmFlag,
    ifClipRevision: writes.ifClipRevision,
    intent: writes.intent,
  }),
  output: z.object({ status: z.enum(['finished', 'available']), value: z.unknown() }),
  annotations: { readOnly: false, destructive: true, idempotent: false },
  access: operatorAccess,
  extraGrants: operatorExtraGrants,
  hosts: ['live', 'headless'],
  alwaysLoad: false,
  stretch: false,
  kind: 'edit',
  budget: { tokens: 600, maxTokens: 2_000 },
});
