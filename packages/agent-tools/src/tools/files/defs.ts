// File tools (MCP-SPEC §6.10, §5.18, tools 33–36; D0 schemas, B1 runs, MCP-SPEC §0.4.4 kinds). The runs live in
// ./run.ts; headless the server's hub opens projects and routes the rest by `project`.
import { z } from 'zod';
import { modelReportOut } from '../setup/common';
import { characterRef, clipRef, confirmFlag, exactlyOne, projectRef, sceneSummaryOut } from '../../schemas/common';
import type { AgentHostMode, ExtraGrant } from '../../types';
import { BUDGETS, defineTool } from '../define';
import {
  projectExportConfirm,
  projectExportRun,
  projectImportConfirm,
  projectImportRun,
  projectOpenConfirm,
  projectOpenRun,
  projectSaveConfirm,
  projectSaveRun,
} from './run';

export const SAMPLE_IDS = ['seed-san', 'polybot', 'quaternius-ual'] as const;
/** `project_import` also takes the static Auto-Rig samples (MCP-SPEC §0.4.4). */
export const IMPORT_SAMPLE_IDS = [...SAMPLE_IDS, 'cube_lad', 'polybot_tpose', 'polybot_apose'] as const;
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
    "Open a project file, model or bundled sample: a new headless project, or (live, confirmed) the editor's project. " +
    'Headless (default): path (an .ekzanim, .ekzanim.json, .vrm or .glb in the workspace folder), sample, or neither ' +
    'for an empty project; the result is a new project handle (prj_…) to pass as project. At most 4 headless ' +
    'projects stay open; one without calls for 30 minutes is closed and its unsaved changes are lost, so save with ' +
    'project_save. Pass project: tab_… to replace the paired editor’s project instead (the user confirms). A .vrma ' +
    'needs a character: project_import it.',
  group: 'files',
  input: z
    .strictObject({
      project: projectRef
        .optional()
        .describe('tab_… replaces the paired editor’s project (confirmed); omit for a new headless project.'),
      path: workspacePath('An .ekzanim, .ekzanim.json, .vrm or .glb file.').optional(),
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
  ready: true,
  confirm: (ctx) => projectOpenConfirm(ctx),
  run: (ctx, args) => projectOpenRun(ctx, args),
});

/** The static-model kinds of project_import (the setup hook's): an Auto-Rig sample or a .glb path, live it selects
 *  the new meshes (View) and a path needs Edit too (B4's `importExtraGrants`). */
const STATIC_SAMPLE_IDS: readonly string[] = ['cube_lad', 'polybot_tpose', 'polybot_apose'];
function importExtraGrants(
  args: { readonly path?: string | undefined; readonly sample?: string | undefined },
  host: AgentHostMode,
): readonly ExtraGrant[] {
  if (host !== 'live') return [];
  const staticModel =
    (args.sample !== undefined && STATIC_SAMPLE_IDS.includes(args.sample)) ||
    (args.path !== undefined && /\.glb$/i.test(args.path));
  if (!staticModel) return [];
  return args.path === undefined ? ['view'] : ['edit', 'view'];
}
const VRM_LICENSES = ['cc0', 'cc-by-4.0', 'personal'] as const;

export const projectImport = defineTool({
  name: 'project_import',
  title: 'Import a character or clip',
  description:
    'Add a character (VRM/GLB or a bundled sample) or a VRMA clip to the open project. ' +
    'path: a .vrm (character), .vrma (clip onto character, default the active one) or .glb (a VRM, a humanoid ' +
    'skinned model or a static model, by content) in the workspace folder; sample: seed-san, polybot or ' +
    'quaternius-ual (characters), or the static models cube_lad, polybot_tpose and polybot_apose to rig with ' +
    'rig_create. One undo step; a static model answers model (meshes, triangles, heightM and the start checks).',
  group: 'files',
  input: z
    .strictObject({
      project: projectRef.optional(),
      path: workspacePath('A .vrm, .glb or .vrma file.').optional(),
      sample: z
        .enum(IMPORT_SAMPLE_IDS)
        .optional()
        .describe(
          'A bundled sample: seed-san, polybot, quaternius-ual, or a static model: cube_lad, polybot_tpose, polybot_apose.',
        ),
      character: characterRef.optional().describe('Target character for a .vrma (default: the active character).'),
      confirm: confirmFlag,
    })
    .refine((value) => exactlyOne(['path', 'sample'], value), 'pass exactly one of path or sample'),
  output: z.object({
    character: z.string().nullable(),
    clips: z.array(z.string()),
    warnings: z.array(z.string()),
    model: modelReportOut.nullable().describe('The model report of a static model; null for characters and clips.'),
  }),
  annotations: { readOnly: false, destructive: false, idempotent: false },
  access: (args: { readonly path?: string | undefined }) => (args.path === undefined ? 'edit' : 'files'),
  extraGrants: importExtraGrants,
  hosts: ['live', 'headless'],
  alwaysLoad: false,
  stretch: false,
  kind: 'files',
  budget: BUDGETS.write,
  example: { sample: 'polybot' },
  ready: true,
  confirm: (ctx, args) => projectImportConfirm(ctx, args),
  run: (ctx, args) => projectImportRun(ctx, args) as never,
});

export const projectSave = defineTool({
  name: 'project_save',
  title: 'Save the project',
  description:
    'Save the project as .ekzanim (headless: into the workspace; live: download or workspace). ' +
    'path defaults to <project name>.ekzanim (.ekzanim.json saves the debug JSON without models). An existing file ' +
    'is replaced only with overwrite: true; the old one is kept in .ekza-trash/ and the result names it as backup.',
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
  ready: true,
  confirm: (ctx, args) => projectSaveConfirm(ctx, args),
  run: (ctx, args) => projectSaveRun(ctx, args),
});

export const projectExport = defineTool({
  name: 'project_export',
  title: 'Export clips',
  description:
    'Export clips as VRMA, animation-only GLB or baked into the model, with lints and a read-back check. ' +
    'kind: vrma (one file per clip), animation_glb, bake_into_model, or a whole character for games: vrm (VRM 1.0), ' +
    'glb, omoba_kit (a .zip test kit). clips default to the active clip. Headless files go to exports/ in the ' +
    'workspace (overwrite: true replaces, the old file kept in .ekza-trash/); each artifact reports bytes, sha256, ' +
    'lints and readBack (maxRotErrorRad, maxPosErrorM).',
  group: 'files',
  input: z.strictObject({
    project: projectRef.optional(),
    character: characterRef.optional(),
    clips: z.array(clipRef).min(1).max(64).optional().describe('Clips to export (default: the active clip).'),
    kind: z
      .enum(['vrma', 'animation_glb', 'bake_into_model', 'vrm', 'glb', 'omoba_kit'])
      .describe('vrma (one file per clip), animation_glb, bake_into_model, or a character: vrm, glb, omoba_kit.'),
    fileName: z
      .string()
      .regex(/^[^/\\:*?"<>|\p{Cc}]{1,128}$/u)
      .optional()
      .describe('File name without folders (default: from the character and clip names).'),
    profile: z.string().min(1).max(64).optional().describe('Export profile id (e.g. ekza/space-avatar-v1).'),
    reduce: z.boolean().default(true).describe('Reduce keys within the profile tolerance (default true).'),
    rootMotion: z.enum(['keep', 'in_place']).optional().describe('Root motion on export.'),
    acknowledgeLicense: z.boolean().default(false).describe('Bake a model whose licence needs acknowledging.'),
    meta: z
      .strictObject({
        name: z
          .string()
          .min(1)
          .max(64)
          .optional()
          .describe('Avatar name saved in the VRM (default: the character name).'),
        authors: z
          .array(z.string().min(1).max(64))
          .min(1)
          .max(8)
          .optional()
          .describe('Authors saved in the VRM (at least one is required).'),
        license: z.enum(VRM_LICENSES).optional().describe('Licence: cc0, cc-by-4.0 or personal (required once).'),
      })
      .optional()
      .describe('vrm, glb, omoba_kit: VRM meta to set first (one undo step).'),
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
        backup: z.string().nullable().optional(),
        delivered: z.enum(['download', 'workspace', 'none']).optional(),
        lints: z.array(
          z.object({ id: z.string(), severity: z.enum(['error', 'warning', 'info']), message: z.string() }),
        ),
        // clips: the animation read-back; characters (vrm, glb, omoba_kit): the model read-back of the setup hook
        readBack: z.union([
          z.object({ ok: z.boolean(), maxRotErrorRad: z.number(), maxPosErrorM: z.number() }),
          z.object({
            format: z.enum(['vrm1', 'vrm0', 'glb']),
            humanoidBones: z.number(),
            joints: z.number(),
            triangles: z.number(),
            animations: z.number(),
          }),
        ]),
      }),
    ),
    character: z.string().optional(),
  }),
  annotations: { readOnly: false, destructive: true, idempotent: false },
  access: 'files',
  hosts: ['live', 'headless'],
  alwaysLoad: false,
  stretch: false,
  kind: 'files',
  budget: BUDGETS.summary,
  extraGrants: (args: { readonly meta?: unknown }) => (args.meta === undefined ? [] : ['edit']),
  example: { clips: ['walk'], kind: 'vrma' },
  ready: true,
  confirm: (ctx, args) => projectExportConfirm(ctx, args),
  run: (ctx, args) => projectExportRun(ctx, args) as never,
});
