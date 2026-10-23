// The character setup kinds of project_import and project_export (MCP-SPEC §0.4.4; B4). B1 owns the file tools
// (`tools/files/**`): this module is the clearly separated hook B1 calls (see docs/wp-notes/mai-b4.md, MAI-B4-1):
//
// - `SETUP_IMPORT.samples` / `SETUP_IMPORT.handles(args)` / `SETUP_IMPORT.run(ctx, args)`: a static model by path
//   (GLB; the bytes from the host's workspace) or an Auto-Rig sample (`cube_lad`, `polybot_tpose`, `polybot_apose`)
//   through `autorig.intake` (the wizard's ① import: one "Import Static Model" step), answering the intake report.
// - `SETUP_EXPORT.kinds` / `SETUP_EXPORT.handles(args)` / `SETUP_EXPORT.run(ctx, args)`: a rigged character as VRM 1.0
//   (`ekza-vrm`, the profile ekza/space-avatar-v1 with every vrm.* lint), GLB with its animations, or the OMOBA local
//   test kit (zip) through `autorig.export` — Studio's bytes by construction — with an optional VRM meta patch first
//   (`char.setVrmMeta`, one step). The file is delivered like every other export: headless (or `delivery:
//   'workspace'`) into the workspace folder, live as a download the user confirms.
//
// `projectImportSetup` and `projectExportSetup` are complete definitions of the two tools restricted to these kinds:
// the reference for the merge into B1's definitions (same names, so never both in one tool set) and the tool set of
// the B4 tests.
import { sha256Hex } from '@ekza-studio/anim-core';
import type { AutoRigExportResult, EditorApp, IntakeReport, SampleDef } from '@ekza-studio/editor-core';
import { parseGlb } from '@ekza-studio/io';
import { z } from 'zod';
import { characterRef, confirmFlag, exactlyOne, projectRef } from '../../schemas/common';
import type { AgentHostMode, AgentToolContext, AgentToolResult, ExtraGrant, ToolAccess } from '../../types';
import { AgentToolFailure } from '../../types';
import { BUDGETS, defineTool } from '../define';
import { lastUndo, modelReport, modelReportOut, sceneMeshRecords, setupValue, stepsSince, topStep } from './common';

// ---------------------------------------------------------------------------------------------------------------------
// import

export const SETUP_SAMPLES = ['cube_lad', 'polybot_tpose', 'polybot_apose'] as const;
export type SetupSample = (typeof SETUP_SAMPLES)[number];
/** The Auto-Rig sample ids and fixture files (`autorig.sample`, AUTORIG-SPEC §4.5; `fixtures/models/`). */
export const SETUP_SAMPLE_FILES: Readonly<Record<SetupSample, { readonly id: string; readonly file: string }>> = {
  cube_lad: { id: 'cube-lad', file: 'cube-lad.glb' },
  polybot_tpose: { id: 'polybot-tpose', file: 'polybot-unskinned-tpose.glb' },
  polybot_apose: { id: 'polybot-apose', file: 'polybot-unskinned.glb' },
};
/** Static model files the import takes by path (AUTORIG-SPEC §5.2: Auto-Rig reads GLB; .gltf/.obj are not read). */
export const STATIC_MODEL_PATH = /\.glb$/i;

export interface SetupImportArgs {
  readonly path?: string | undefined;
  readonly sample?: string | undefined;
  readonly confirm?: boolean | undefined;
}

export const setupImportOut = z.object({
  character: z.string().nullable(),
  clips: z.array(z.string()),
  warnings: z.array(z.string()),
  model: modelReportOut.nullable(),
});
export type SetupImportData = z.output<typeof setupImportOut>;

function isSetupSample(value: unknown): value is SetupSample {
  return typeof value === 'string' && (SETUP_SAMPLES as readonly string[]).includes(value);
}

/** The bytes of an Auto-Rig sample: the host's `readSample` (headless: the bundled fixtures), else null. */
async function sampleBytes(app: EditorApp, sample: SetupSample): Promise<Uint8Array | null> {
  const read = app.services.readSample;
  if (read === null || read === undefined) return null;
  const { id, file } = SETUP_SAMPLE_FILES[sample];
  const def = { id, file, license: 'CC0-1.0', defaultClip: null } as unknown as SampleDef;
  try {
    return await read(def);
  } catch {
    throw new AgentToolFailure(
      'io_error',
      `The sample ${file} is not available here.`,
      'import a model by path instead',
      {
        retryable: false,
      },
    );
  }
}

async function runSetupImport(ctx: AgentToolContext, args: SetupImportArgs): Promise<AgentToolResult<SetupImportData>> {
  const { app } = ctx;
  const before = topStep(app);
  const characters = new Set(app.store.list('characters').map((record) => record.id));
  let run;
  if (args.sample !== undefined) {
    if (!isSetupSample(args.sample)) {
      throw new AgentToolFailure(
        'invalid_args',
        `Unknown sample "${args.sample}".`,
        `use one of ${SETUP_SAMPLES.join(', ')}`,
      );
    }
    const bytes = await sampleBytes(app, args.sample);
    const { id, file } = SETUP_SAMPLE_FILES[args.sample];
    // The import selects the new meshes (the wizard's behaviour): an Edit + View run (§0.4.4 policy of autorig.sample).
    run =
      bytes === null
        ? await ctx.run('autorig.sample', { sample: id }, { access: 'view' })
        : await ctx.run('autorig.intake', { bytes, name: file }, { access: 'view' });
  } else {
    const path = args.path ?? '';
    if (!STATIC_MODEL_PATH.test(path)) {
      throw new AgentToolFailure(
        'unsupported',
        'Static models are read as .glb.',
        'In Blender: File › Export › glTF 2.0 (.glb)',
        {
          retryable: false,
        },
      );
    }
    const files = ctx.host.files;
    if (files === null) {
      throw new AgentToolFailure(
        'unsupported',
        'This host reads no files.',
        'use a sample, or the headless server with a workspace',
        {
          retryable: false,
        },
      );
    }
    const read = await files.read(path);
    const name = read.path.split(/[\\/]/).at(-1) ?? 'model.glb';
    run = await ctx.run('autorig.intake', { bytes: read.bytes, name }, { access: 'view' });
  }
  const report = setupValue<IntakeReport>(args.sample === undefined ? 'autorig.intake' : 'autorig.sample', run);
  const added = app.store.list('characters').find((record) => !characters.has(record.id));
  const ids = new Set<string>(report.meshes);
  const names = sceneMeshRecords(app)
    .filter((mesh) => ids.has(mesh.id))
    .map((mesh) => mesh.name);
  const steps = stepsSince(ctx, before);
  const model = report.kind === 'static' || report.kind === 'project' ? modelReport(report, names) : null;
  return {
    ok: true,
    data: {
      character: added?.name ?? null,
      clips: added === undefined ? [] : app.store.query.clipsOfCharacter(added.id).map((clip) => clip.name),
      warnings: [...new Set(run.warnings)],
      model,
    },
    ...lastUndo(steps),
    next:
      model === null ? 'scene_summary' : model.readyToRig ? 'rig_create' : (model.fixes[0]?.hint ?? 'model_inspect'),
  };
}

/** The import hook for B1's project_import. */
export const SETUP_IMPORT = {
  samples: SETUP_SAMPLES,
  /** True when this module imports the call: an Auto-Rig sample, or a static model path (.glb). */
  handles(args: SetupImportArgs): boolean {
    return isSetupSample(args.sample) || (args.path !== undefined && STATIC_MODEL_PATH.test(args.path));
  },
  run: runSetupImport,
} as const;

// ---------------------------------------------------------------------------------------------------------------------
// export

export const SETUP_EXPORT_KINDS = ['vrm', 'glb', 'omoba_kit'] as const;
export type SetupExportKind = (typeof SETUP_EXPORT_KINDS)[number];
const TARGET: Readonly<Record<SetupExportKind, 'ekza-vrm' | 'glb' | 'omoba-kit'>> = {
  vrm: 'ekza-vrm',
  glb: 'glb',
  omoba_kit: 'omoba-kit',
};
export const VRM_LICENSES = ['cc0', 'cc-by-4.0', 'personal'] as const;

export interface SetupExportArgs {
  readonly character?: string | undefined;
  readonly kind: string;
  readonly fileName?: string | undefined;
  readonly meta?:
    | {
        readonly name?: string | undefined;
        readonly authors?: readonly string[] | undefined;
        readonly license?: (typeof VRM_LICENSES)[number] | undefined;
      }
    | undefined;
  readonly delivery?: 'download' | 'workspace' | undefined;
  readonly overwrite?: boolean | undefined;
}

export const setupExportOut = z.object({
  character: z.string(),
  artifacts: z.array(
    z.object({
      fileName: z.string(),
      path: z.string().nullable(),
      bytes: z.number(),
      sha256: z.string(),
      delivered: z.enum(['download', 'workspace', 'none']),
      lints: z.array(z.object({ id: z.string(), severity: z.enum(['error', 'warning', 'info']), message: z.string() })),
      readBack: z.object({
        format: z.enum(['vrm1', 'vrm0', 'glb']),
        humanoidBones: z.number(),
        joints: z.number(),
        triangles: z.number(),
        animations: z.number(),
      }),
    }),
  ),
});
export type SetupExportData = z.output<typeof setupExportOut>;

interface GltfJson {
  readonly extensions?: Readonly<Record<string, unknown>>;
  readonly skins?: readonly { readonly joints?: readonly number[] }[];
  readonly nodes?: readonly { readonly mesh?: number }[];
  readonly meshes?: readonly {
    readonly primitives?: readonly {
      readonly mode?: number;
      readonly indices?: number;
      readonly attributes?: Readonly<Record<string, number>>;
    }[];
  }[];
  readonly accessors?: readonly { readonly count?: number }[];
  readonly animations?: readonly unknown[];
}

/** The read-back of an exported model: its VRM humanoid bones, skin joints, triangles and animations. */
export async function readBackModel(bytes: Uint8Array): Promise<SetupExportData['artifacts'][number]['readBack']> {
  const json = (await parseGlb(bytes)).json as GltfJson;
  const ext = json.extensions ?? {};
  const vrm1 = ext['VRMC_vrm'] as
    | { readonly humanoid?: { readonly humanBones?: Readonly<Record<string, unknown>> } }
    | undefined;
  const vrm0 = ext['VRM'] as { readonly humanoid?: { readonly humanBones?: readonly unknown[] } } | undefined;
  const humanoidBones =
    vrm1 !== undefined
      ? Object.keys(vrm1.humanoid?.humanBones ?? {}).length
      : (vrm0?.humanoid?.humanBones ?? []).length;
  const joints = new Set<number>();
  for (const skin of json.skins ?? []) for (const joint of skin.joints ?? []) joints.add(joint);
  const accessors = json.accessors ?? [];
  let triangles = 0;
  for (const node of json.nodes ?? []) {
    if (typeof node.mesh !== 'number') continue;
    for (const primitive of json.meshes?.[node.mesh]?.primitives ?? []) {
      const position = primitive.attributes?.['POSITION'];
      const count =
        (primitive.indices === undefined ? undefined : accessors[primitive.indices]?.count) ??
        (position === undefined ? 0 : (accessors[position]?.count ?? 0));
      const mode = primitive.mode ?? 4;
      triangles += mode === 4 ? Math.floor(count / 3) : mode === 5 || mode === 6 ? Math.max(0, count - 2) : 0;
    }
  }
  return {
    format: vrm1 !== undefined ? 'vrm1' : vrm0 !== undefined ? 'vrm0' : 'glb',
    humanoidBones,
    joints: joints.size,
    triangles,
    animations: (json.animations ?? []).length,
  };
}

/** Runs `run` with `services.files.download` captured (the tool delivers the bytes itself). */
async function capturingDownload<T>(
  app: EditorApp,
  run: () => Promise<T>,
): Promise<{ readonly value: T; readonly file: { name: string; bytes: Uint8Array; mime: string } | null }> {
  const files: { download: EditorApp['services']['files']['download'] } = app.services.files;
  const original = files.download;
  let file: { name: string; bytes: Uint8Array; mime: string } | null = null;
  files.download = (name, bytes, mime) => {
    file = { name, bytes, mime };
  };
  try {
    const value = await run();
    return { value, file };
  } finally {
    files.download = original;
  }
}

const META_LINTS = new Set(['vrm.meta-required', 'vrm.licence-unset']);

function blockedFailure(result: AutoRigExportResult): AgentToolFailure {
  const errors = result.lints.filter((lint) => lint.severity === 'error');
  const meta = errors.some((lint) => META_LINTS.has(lint.code));
  return new AgentToolFailure(
    'poll_failed',
    `${result.fileName} was not saved: ${errors.map((lint) => lint.message).join('; ')}.`,
    meta
      ? "pass meta: {authors: ['…'], license: 'cc0' | 'cc-by-4.0' | 'personal'} (ask the user which licence and author)"
      : "fix what the lints name (rig_create's validation rows) and export again",
    { detail: { lints: errors.map((lint) => ({ id: lint.code, message: lint.message })) } },
  );
}

async function runSetupExport(ctx: AgentToolContext, args: SetupExportArgs): Promise<AgentToolResult<SetupExportData>> {
  const { app } = ctx;
  if (!(SETUP_EXPORT_KINDS as readonly string[]).includes(args.kind)) {
    throw new AgentToolFailure(
      'invalid_args',
      `Unknown export kind "${args.kind}".`,
      `use ${SETUP_EXPORT_KINDS.join(', ')}`,
    );
  }
  const kind = args.kind as SetupExportKind;
  const character = ctx.resolve.character(args.character);
  await app.rig.load();
  const before = topStep(app);
  if (args.meta !== undefined) {
    const { name, authors, license } = args.meta;
    const patch = {
      ...(name === undefined ? {} : { name }),
      ...(authors === undefined ? {} : { authors: [...authors] }),
      ...(license === undefined ? {} : { licensePreset: license }),
    };
    if (Object.keys(patch).length > 0) {
      setupValue('char.setVrmMeta', await ctx.run('char.setVrmMeta', { character: character.id, patch }));
    }
  }
  const captured = await capturingDownload(app, () =>
    ctx.run('autorig.export', {
      character: character.id,
      target: TARGET[kind],
      fileName: args.fileName ?? '',
    }),
  );
  const result = setupValue<AutoRigExportResult>('autorig.export', captured.value);
  const file = captured.file;
  if (file === null) throw blockedFailure(result);
  const model = result.artifacts[0];
  const readBack = await readBackModel(model?.bytes ?? file.bytes);
  const files = ctx.host.files;
  let path: string | null = null;
  let delivered: 'download' | 'workspace' | 'none' = 'none';
  const toWorkspace = ctx.host.mode === 'headless' || args.delivery === 'workspace';
  if (files !== null && toWorkspace) {
    path = (await files.write(file.name, file.bytes, { overwrite: args.overwrite ?? false })).path;
    delivered = 'workspace';
  } else if (files?.download !== undefined && !toWorkspace) {
    const answer = await files.download(file.name, file.bytes, file.mime, ctx.signal);
    if (!answer.accepted) {
      throw new AgentToolFailure(
        'declined',
        `The user did not accept the download of ${file.name}.`,
        'do not retry without asking the user',
        {
          retryable: false,
        },
      );
    }
    delivered = 'download';
  }
  const steps = stepsSince(ctx, before);
  return {
    ok: true,
    data: {
      character: character.name,
      artifacts: [
        {
          fileName: file.name,
          path,
          bytes: file.bytes.byteLength,
          sha256: sha256Hex(file.bytes),
          delivered,
          lints: result.lints.map((lint) => ({ id: lint.code, severity: lint.severity, message: lint.message })),
          readBack,
        },
      ],
    },
    ...lastUndo(steps),
    ...(delivered === 'none'
      ? { warnings: ['The file was made but not delivered: this host has no file access.'] }
      : {}),
  };
}

/** The export hook for B1's project_export. */
export const SETUP_EXPORT = {
  kinds: SETUP_EXPORT_KINDS,
  handles(args: { readonly kind?: unknown }): boolean {
    return (SETUP_EXPORT_KINDS as readonly unknown[]).includes(args.kind);
  },
  run: runSetupExport,
} as const;

// ---------------------------------------------------------------------------------------------------------------------
// the two tools restricted to the setup kinds (reference definitions; B1 merges them into tools/files/defs.ts)

const workspacePath = (description: string) =>
  z.string().min(1).max(1_024).describe(`${description} Relative to the server's workspace folder.`);

function importAccess(args: { readonly path?: string | undefined }): ToolAccess {
  return args.path === undefined ? 'edit' : 'files';
}
/** The import selects the new meshes in the user's scene: live it needs View too (and Edit for a path). */
function importExtraGrants(args: { readonly path?: string | undefined }, host: AgentHostMode): readonly ExtraGrant[] {
  if (host !== 'live') return [];
  return args.path === undefined ? ['view'] : ['edit', 'view'];
}

export const projectImportSetup = defineTool({
  name: 'project_import',
  title: 'Import a model',
  description:
    'Add a static model to the scene for rigging: a .glb from the workspace or an Auto-Rig sample (cube_lad, ' +
    'polybot_tpose, polybot_apose). Answers the model inspection (as model_inspect); then model_fix and rig_create.',
  group: 'files',
  input: z
    .strictObject({
      project: projectRef.optional(),
      path: workspacePath('A static .glb model.').optional(),
      sample: z
        .enum(SETUP_SAMPLES)
        .optional()
        .describe('An Auto-Rig sample: cube_lad, polybot_tpose or polybot_apose.'),
      confirm: confirmFlag,
    })
    .refine((value) => exactlyOne(['path', 'sample'], value), 'pass exactly one of path or sample'),
  output: setupImportOut,
  annotations: { readOnly: false, destructive: false, idempotent: false },
  access: importAccess,
  extraGrants: importExtraGrants,
  hosts: ['live', 'headless'],
  alwaysLoad: false,
  stretch: false,
  kind: 'files',
  budget: BUDGETS.summary,
  example: { sample: 'polybot_tpose' },
  confirm(ctx) {
    if (ctx.host.mode !== 'live' || sceneMeshRecords(ctx.app).length + ctx.app.store.list('characters').length === 0) {
      return null;
    }
    return { title: 'AI wants to add a model to your scene', detail: 'Undo removes it.', danger: false };
  },
  ready: true,
  run: (ctx, args) => runSetupImport(ctx, args) as never,
});

function exportExtraGrants(args: { readonly meta?: unknown }): readonly ExtraGrant[] {
  return args.meta === undefined ? [] : ['edit'];
}

export const projectExportSetup = defineTool({
  name: 'project_export',
  title: 'Export a character',
  description:
    'Export a rigged character with its clips: vrm (VRM 1.0 for OMOBA and Ekza Space, checked by every vrm.* ' +
    'lint), glb (GLB with animations) or omoba_kit (the VRM in an OMOBA local test kit zip). A VRM needs a name, an ' +
    'author and a licence: pass meta (ask the user which licence). Headless the file goes to the workspace; in the ' +
    "user's editor it downloads after they confirm.",
  group: 'files',
  input: z.strictObject({
    project: projectRef.optional(),
    character: characterRef.optional(),
    kind: z.enum(SETUP_EXPORT_KINDS).describe('vrm, glb or omoba_kit.'),
    fileName: z
      .string()
      .regex(/^[^/\\:*?"<>|\p{Cc}]{1,128}$/u)
      .optional()
      .describe('File name without folders or extension (default: from the avatar name).'),
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
      .describe('VRM meta to set first (one undo step).'),
    delivery: z
      .enum(['download', 'workspace'])
      .optional()
      .describe(
        "Live: download (default, the user confirms) or the agent's workspace folder; headless: always the workspace.",
      ),
    overwrite: z.boolean().default(false).describe('Replace an existing file (the old one goes to .ekza-trash/).'),
  }),
  output: setupExportOut,
  annotations: { readOnly: false, destructive: true, idempotent: false },
  access: 'files',
  extraGrants: exportExtraGrants,
  hosts: ['live', 'headless'],
  alwaysLoad: false,
  stretch: false,
  kind: 'files',
  budget: BUDGETS.summary,
  example: { kind: 'vrm', meta: { authors: ['Ekza'], license: 'cc0' } },
  ready: true,
  run: (ctx, args) => runSetupExport(ctx, args) as never,
});
