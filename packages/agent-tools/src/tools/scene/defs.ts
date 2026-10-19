// scene_summary (MCP-SPEC §6.2, tool 4; P2). D0 lands the final schema with `ready: false`.
import { z } from 'zod';
import { detail, projectRef, sceneSummaryOut } from '../../schemas/common';
import { BUDGETS, defineTool } from '../define';

export const sceneSummary = defineTool({
  name: 'scene_summary',
  title: 'Scene summary',
  description:
    "Start here: characters, clips (fps, range, loop), the user's selection, selected keys, time band and frame (live), recent history and what this host can do.",
  group: 'scene',
  input: z.strictObject({ project: projectRef.optional(), detail }),
  output: sceneSummaryOut,
  annotations: { readOnly: true, destructive: false, idempotent: true },
  access: 'read',
  hosts: ['live', 'headless'],
  alwaysLoad: true,
  stretch: false,
  kind: 'read',
  budget: BUDGETS.summary,
});
