// File tools (MCP-SPEC §6.10, §5.18, tools 33–36; P6). D0 lands the final schemas with `ready: false`.
import { z } from 'zod';
import { characterRef, clipRef, confirmFlag, exactlyOne, projectRef, sceneSummaryOut } from '../../schemas/common';
import { BUDGETS, defineTool } from '../define';

export const SAMPLE_IDS = ['seed-san', 'polybot', 'quaternius-ual'] as const;
const workspacePath = (description: string) =>
  z.string().min(1).max(1_024).describe(`${description} Relative to the server's workspace folder.`);
const sample = z.enum(SAMPLE_IDS).describe('A bundled sample: seed-san, polybot or quaternius-ual.');
const delivery = z
  .enum(['download', 'workspace'])
  .optional()
  .describe(
    "Live: download (default, the user confirms) or the agent's workspace folder; headless: always the workspace.",
  );
const overwrite = z.boolean().default(false).describe('Replace an existing file (the old one goes to .ekza-trash/).');

export const projectOpen = defineTool({
  name: 'project_open',
  title: 'Open a project',
  description:
    "Open a project file, model or bundled sample: a new headless project, or (live, confirmed) the editor's project.",
  group: 'files',
  input: z
    .strictObject({
      path: workspacePath('An .ekzanim, .vrm or .glb file.').optional(),
      sample: sample.optional(),
      name: z.string().min(1).max(64).optional().describe('Project name (default: the file name).'),
      confirm: confirmFlag,
    })
    .refine((value) => value.path === undefined || value.sample === undefined, 'pass path or sample, not both'),
  output: z.object({
    project: z.string(),
    readOnly: z.boolean(),
    migratedFrom: z.number().nullable(),
    summary: sceneSummaryOut,
    warnings: z.array(z.string()),
  }),
  annotations: { readOnly: false, destructive: true, idempotent: false },
  access: 'files',
  hosts: ['live', 'headless'],
  alwaysLoad: false,
  stretch: false,
  kind: 'files',
  budget: BUDGETS.summary,
  example: { sample: 'polybot' },
});

export const projectImport = defineTool({
  name: 'project_import',
  title: 'Import a character or clip',
  description: 'Add a character (VRM/GLB or a bundled sample) or a VRMA clip to the open project.',
  group: 'files',
  input: z
    .strictObject({
      project: projectRef.optional(),
      path: workspacePath('A .vrm, .glb or .vrma file.').optional(),
      sample: sample.optional(),
      character: characterRef.optional().describe('Target character for a .vrma (default: the active character).'),
      confirm: confirmFlag,
    })
    .refine((value) => exactlyOne(['path', 'sample'], value), 'pass exactly one of path or sample'),
  output: z.object({ character: z.string().nullable(), clips: z.array(z.string()), warnings: z.array(z.string()) }),
  annotations: { readOnly: false, destructive: false, idempotent: false },
  access: (args: { readonly path?: string | undefined }) => (args.path === undefined ? 'edit' : 'files'),
  hosts: ['live', 'headless'],
  alwaysLoad: false,
  stretch: false,
  kind: 'files',
  budget: BUDGETS.write,
  example: { sample: 'polybot' },
});

export const projectSave = defineTool({
  name: 'project_save',
  title: 'Save the project',
  description: 'Save the project as .ekzanim (headless: into the workspace; live: download or workspace).',
  group: 'files',
  input: z.strictObject({
    project: projectRef.optional(),
    path: workspacePath('Where to save (an .ekzanim name).').optional(),
    delivery,
    overwrite,
  }),
  output: z.object({
    fileName: z.string(),
    path: z.string().nullable(),
    bytes: z.number(),
    delivered: z.enum(['download', 'workspace']),
    backup: z.string().nullable(),
  }),
  annotations: { readOnly: false, destructive: true, idempotent: false },
  access: 'files',
  hosts: ['live', 'headless'],
  alwaysLoad: false,
  stretch: false,
  kind: 'files',
  budget: BUDGETS.write,
  example: { path: 'walk.ekzanim' },
});

export const projectExport = defineTool({
  name: 'project_export',
  title: 'Export clips',
  description: 'Export clips as VRMA, animation-only GLB or baked into the model, with lints and a read-back check.',
  group: 'files',
  input: z.strictObject({
    project: projectRef.optional(),
    character: characterRef.optional(),
    clips: z.array(clipRef).min(1).max(64).optional().describe('Clips to export (default: the active clip).'),
    kind: z
      .enum(['vrma', 'animation_glb', 'bake_into_model'])
      .describe('vrma (one file per clip), animation_glb, or bake_into_model.'),
    fileName: z
      .string()
      .regex(/^[^/\\:*?"<>|\p{Cc}]{1,128}$/u)
      .optional()
      .describe('File name without folders (default: from the character and clip names).'),
    profile: z.string().min(1).max(64).optional().describe('Export profile id (e.g. ekza/space-avatar-v1).'),
    reduce: z.boolean().default(true).describe('Reduce keys within the profile tolerance (default true).'),
    rootMotion: z.enum(['keep', 'in_place']).optional().describe('Root motion on export.'),
    acknowledgeLicense: z.boolean().default(false).describe('Bake a model whose licence needs acknowledging.'),
    delivery,
    overwrite,
  }),
  output: z.object({
    artifacts: z.array(
      z.object({
        fileName: z.string(),
        path: z.string().nullable(),
        bytes: z.number(),
        sha256: z.string(),
        backup: z.string().nullable(),
        lints: z.array(
          z.object({ id: z.string(), severity: z.enum(['error', 'warning', 'info']), message: z.string() }),
        ),
        readBack: z.object({ ok: z.boolean(), maxRotErrorRad: z.number(), maxPosErrorM: z.number() }),
      }),
    ),
  }),
  annotations: { readOnly: false, destructive: true, idempotent: false },
  access: 'files',
  hosts: ['live', 'headless'],
  alwaysLoad: false,
  stretch: false,
  kind: 'files',
  budget: BUDGETS.summary,
  example: { clips: ['walk'], kind: 'vrma' },
});
