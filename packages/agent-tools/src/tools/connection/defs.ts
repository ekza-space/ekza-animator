// Connection tools (MCP-SPEC §6.2, tools 1–3): editor_connect (P7), projects_list and project_close (P6). D0 lands the
// final schemas with `ready: false`.
import { z } from 'zod';
import { grantsOut, projectRef, sceneSummaryOut } from '../../schemas/common';
import { BUDGETS, defineTool } from '../define';

/** Pairing codes: 6 characters of the server's alphabet, with or without the dash (§5.10). */
export const PAIRING_CODE = /^[A-HJKMNP-Z2-9]{3}-?[A-HJKMNP-Z2-9]{3}$/i;

export const editorConnect = defineTool({
  name: 'editor_connect',
  title: 'Connect to the editor',
  description:
    "Connect to the user's open Ekza Animator editor with the pairing code the user gave you in this conversation.",
  group: 'connection',
  input: z.strictObject({
    code: z
      .string()
      .regex(PAIRING_CODE)
      .describe('The pairing code the user read from Windows › Agent (K7Q-M4P or K7QM4P).'),
  }),
  output: z.object({
    project: z.string(),
    grants: grantsOut,
    actor: z.object({ name: z.string() }),
    origin: z.string(),
    summary: sceneSummaryOut,
  }),
  annotations: { readOnly: false, destructive: true, idempotent: false },
  access: 'pairing',
  hosts: ['live'],
  alwaysLoad: true,
  requiresUserInteraction: true,
  stretch: false,
  kind: 'read',
  budget: BUDGETS.summary,
});

export const projectsList = defineTool({
  name: 'projects_list',
  title: 'List open projects',
  description:
    'List the open projects: the paired editor tab (with its origin) and headless project files, with their handles and grants.',
  group: 'connection',
  input: z.strictObject({}),
  output: z.object({
    bridge: z.object({ status: z.enum(['off', 'listening', 'paired']), port: z.number().nullable() }),
    projects: z.array(
      z.object({
        project: z.string(),
        kind: z.enum(['tab', 'headless']),
        name: z.string(),
        dirty: z.boolean(),
        readOnly: z.boolean(),
        characters: z.number(),
        grants: grantsOut,
        toolset: z.string(),
        idleMs: z.number().nullable(),
        origin: z.string().nullable(),
      }),
    ),
  }),
  annotations: { readOnly: true, destructive: false, idempotent: true },
  access: 'read',
  hosts: ['live', 'headless'],
  alwaysLoad: false,
  stretch: false,
  kind: 'read',
  budget: BUDGETS.summary,
});

export const projectClose = defineTool({
  name: 'project_close',
  title: 'Close a project',
  description: 'Close a headless project, or end the pairing with the editor tab.',
  group: 'connection',
  input: z.strictObject({
    project: projectRef.describe('The project to close (prj_… headless, tab_… ends the pairing).'),
    discardChanges: z
      .boolean()
      .default(false)
      .describe('Close a headless project with unsaved changes (else confirm_required).'),
  }),
  output: z.object({ closed: z.string(), discarded: z.boolean() }),
  annotations: { readOnly: false, destructive: true, idempotent: false },
  access: 'read',
  hosts: ['live', 'headless'],
  alwaysLoad: false,
  stretch: false,
  kind: 'read',
  budget: BUDGETS.write,
});
