// Connection tools (MCP-SPEC §6.2, tools 1–3): editor_connect (P7), projects_list and project_close (P6). D0 landed the
// final schemas with `ready: false`; P2 wrote the full descriptions (§5.20.1); their owners make them ready.
import { z } from 'zod';
import { grantsOut, projectRef, sceneSummaryOut } from '../../schemas/common';
import { AgentToolFailure } from '../../types';
import { BUDGETS, defineTool } from '../define';
import { runEditorConnect } from './editor_connect';

/**
 * projects_list and project_close are answered by the server's hub (B1, MCP-SPEC §4.6): it owns the headless projects
 * and the pairing. A runtime that receives one (a tab, an in-app assistant) has no view of either.
 */
function serverSide(name: string) {
  return () =>
    Promise.reject(
      new AgentToolFailure('unsupported', `${name} is answered by the MCP server.`, 'call it through the MCP server', {
        retryable: false,
      }),
    );
}

/** Pairing codes: 6 characters of the server's alphabet, with or without the dash (§5.10). */
export const PAIRING_CODE = /^[A-HJKMNP-Z2-9]{3}-?[A-HJKMNP-Z2-9]{3}$/i;

export const editorConnect = defineTool({
  name: 'editor_connect',
  title: 'Connect to the editor',
  description:
    "Connect to the user's open Ekza Studio editor with the pairing code the user gave you in this " +
    'conversation. Only call it when the user gave you a code here (the editor shows it under Windows › ' +
    'Agent, e.g. K7Q-M4P); never guess or reuse one. It waits up to 50 s while the user allows the ' +
    'connection and picks what you may do (Read, Edit, Files, View). The result names the project handle ' +
    "(tab_…), the grants, and the editor's origin: tell the user the origin, and say so when it is not " +
    'the editor address they expect.',
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
  example: { code: 'K7Q-M4P' },
  ready: true,
  run: runEditorConnect,
});

export const projectsList = defineTool({
  name: 'projects_list',
  title: 'List open projects',
  description:
    'List the open projects: the paired editor tab (with its origin) and headless project files, with ' +
    'their handles and grants. Pass a handle as project when several are open. Headless projects show ' +
    'unsaved changes (dirty) and how long they were idle; idle projects close after 30 minutes.',
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
  example: {},
  ready: true,
  run: serverSide('projects_list'),
});

export const projectClose = defineTool({
  name: 'project_close',
  title: 'Close a project',
  description:
    'Close a headless project, or end the pairing with the editor tab. A headless project with unsaved ' +
    "changes needs discardChanges: true (save it first with project_save). Closing the tab's handle ends " +
    'the pairing; the user can pair again.',
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
  example: { project: 'prj_0123456789ab' },
  ready: true,
  run: serverSide('project_close'),
});
