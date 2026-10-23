// The runs of the file tools (MCP-SPEC §6.10, §5.17, §5.18, §0.4.4; tools 33–36; B1). One code path for both hosts:
// - headless (the server's projects): the bytes an operator "downloads" are captured and written into the workspace
//   through `ctx.host.files` (the sandbox), exports into `exports/` under derived names, overwrites only with
//   `overwrite: true` (the old file kept in `.ekza-trash/`);
// - live (the paired tab): `delivery: 'download'` (default) lets the editor's own save or export flow download after
//   the confirm card; `'workspace'` (Workspace grant) captures the bytes and hands them to the tab's file host, which
//   the server writes to the targets it derives from the call's own arguments (§5.10).
// `project_open` loads into the runtime's own app: headless the server made a fresh project for the call (its handle
// is the hub's, it patches `project`), live it replaces the user's project after the confirm card.
import { sha256Hex } from '@ekza-studio/anim-core';
import { type CharacterId, type ClipId, SCHEMA_VERSION } from '@ekza-studio/doc';
import type { EditorApp, ImportResult } from '@ekza-studio/editor-core';
import type { ExportArtifact } from '@ekza-studio/io';
import { sanitizeText } from '../../sanitize/sanitize';
import { valueOf } from '../../runtime/toolkit';
import { sceneSummaryData } from '../scene/summary';
import {
  AgentToolFailure,
  type AgentToolContext,
  type AgentToolResult,
  type ConfirmPrompt,
  type OperatorRun,
} from '../../types';
import { baseName, deriveFileName, EXPORTS_DIR, fileExtension } from './names';

export interface CapturedFile {
  readonly fileName: string;
  readonly bytes: Uint8Array;
  readonly mime: string;
}

/** Static Auto-Rig samples (§0.4.4): tool id → the autorig sample id and its file (fixtures/models). */
export const STATIC_SAMPLES = {
  cube_lad: { autorig: 'cube-lad', file: 'cube-lad.glb' },
  polybot_tpose: { autorig: 'polybot-tpose', file: 'polybot-unskinned-tpose.glb' },
  polybot_apose: { autorig: 'polybot-apose', file: 'polybot-unskinned.glb' },
} as const;
export type StaticSampleId = keyof typeof STATIC_SAMPLES;
export function isStaticSample(value: string): value is StaticSampleId {
  return Object.hasOwn(STATIC_SAMPLES, value);
}

/**
 * Runs `work` with `app.services.files.download` captured (§5.17.2 `onDownload`): the bytes come back to the tool
 * instead of a browser download. A files service that cannot be wrapped is left alone (nothing captured).
 */
export async function captureDownloads<T>(
  app: EditorApp,
  work: () => Promise<T>,
): Promise<{ readonly value: T; readonly files: readonly CapturedFile[] }> {
  const files: CapturedFile[] = [];
  const service: { download: EditorApp['services']['files']['download'] } = app.services.files;
  const original = service.download;
  const wrapped: typeof original = (fileName, bytes, mime) => {
    files.push({ fileName, bytes, mime });
  };
  let installed = false;
  try {
    service.download = wrapped;
    installed = service.download === wrapped;
  } catch {
    installed = false;
  }
  try {
    return { value: await work(), files };
  } finally {
    if (installed && service.download === wrapped) service.download = original;
  }
}

/** The delivery of a save or export (§6.10): headless always the workspace (a 'download' argument → a warning). */
export function deliveryOf(
  ctx: AgentToolContext,
  requested: 'download' | 'workspace' | undefined,
  warnings: string[],
): 'download' | 'workspace' {
  if (ctx.host.mode === 'headless') {
    if (requested === 'download') warnings.push('Headless projects save into the workspace folder; delivery ignored.');
    return 'workspace';
  }
  const delivery = requested ?? 'download';
  if (delivery === 'workspace' && !ctx.host.grants().workspace) {
    throw new AgentToolFailure(
      'not_granted',
      'Writing into your workspace folder needs the Workspace option of the Files grant.',
      'only the user can give it, in the Agent panel; or use delivery: download',
      { retryable: false, detail: { grant: 'files' } },
    );
  }
  return delivery;
}

function fileHost(ctx: AgentToolContext) {
  const files = ctx.host.files;
  if (files === null) {
    throw new AgentToolFailure('unsupported', 'This host cannot read or write files.', 'use the editor’s File menu', {
      retryable: false,
    });
  }
  return files;
}

/** Reads a workspace file through the host (sandboxed headless; pre-attached bytes live). */
export async function readWorkspace(ctx: AgentToolContext, path: string): Promise<{ name: string; bytes: Uint8Array }> {
  if (ctx.host.mode === 'live' && !ctx.host.grants().workspace) {
    throw new AgentToolFailure(
      'not_granted',
      'Reading files from your workspace folder needs the Workspace option of the Files grant.',
      'only the user can give it, in the Agent panel; or use a sample',
      { retryable: false, detail: { grant: 'files' } },
    );
  }
  const read = await fileHost(ctx).read(path);
  return { name: baseName(read.path), bytes: read.bytes };
}

/** Writes into the workspace; the result's `backup` when the host reports one (the sandbox does). */
export async function writeWorkspace(
  ctx: AgentToolContext,
  path: string,
  bytes: Uint8Array,
  overwrite: boolean,
): Promise<{ readonly path: string; readonly backup: string | null }> {
  const written = (await fileHost(ctx).write(path, bytes, { overwrite })) as {
    readonly path: string;
    readonly backup?: string | null;
  };
  return { path: written.path, backup: written.backup ?? null };
}

/** A sample's bytes are not on this server: `unsupported` with the hint of §5.17.2. */
function sampleMissing(error: unknown): never {
  if (error instanceof AgentToolFailure && error.detail?.['ekzaCode'] === 'asset-missing') {
    throw new AgentToolFailure(
      'unsupported',
      error.message,
      'this sample is not bundled; pass --samples-dir to the server or open a file',
      {
        retryable: false,
      },
    );
  }
  throw error;
}

function run(
  ctx: AgentToolContext,
  id: string,
  args: unknown,
  access: 'edit' | 'view' | 'files',
): Promise<OperatorRun> {
  return ctx.run(id, args, { access });
}

/** The scene summary in its concise form (`project_open`'s `summary`). */
export function conciseSummary(ctx: AgentToolContext) {
  return sceneSummaryData(
    ctx.app,
    { host: ctx.host, actor: ctx.actor, revision: (clip) => ctx.revisions.revision(clip) },
    'concise',
  );
}

/** How long a load waits for the characters' runtimes (rig programs are built asynchronously). */
export const RUNTIME_WAIT_MS = 30_000;

/**
 * Resolves once every character of the document has its runtime (rig program, skeleton), so the next call does not
 * answer `busy` "still loading"; gives up after `RUNTIME_WAIT_MS` or when the call is cancelled.
 */
export function charactersReady(app: EditorApp, signal: AbortSignal, maxMs = RUNTIME_WAIT_MS): Promise<boolean> {
  const missing = (): boolean =>
    [...app.store.list('characters')].some((record) => app.characters.get(record.id) === undefined);
  if (!missing()) return Promise.resolve(true);
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok: boolean): void => {
      if (done) return;
      done = true;
      off();
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      resolve(ok);
    };
    const off = app.characters.subscribe(() => {
      if (!missing()) finish(true);
    });
    const onAbort = (): void => finish(false);
    signal.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => finish(!missing()), maxMs);
    (timer as unknown as { unref?: () => void }).unref?.();
  });
}

const characterName = (app: EditorApp, id: CharacterId): string => app.store.get('characters', id)?.name ?? id;
const clipName = (app: EditorApp, id: ClipId): string => app.store.get('clips', id)?.name ?? id;

// ---------- project_open ----------
export interface ProjectOpenArgs {
  readonly path?: string | undefined;
  readonly sample?: 'seed-san' | 'polybot' | 'quaternius-ual' | undefined;
  readonly name?: string | undefined;
}

export function projectOpenConfirm(ctx: AgentToolContext): ConfirmPrompt | null {
  if (ctx.host.mode === 'headless') return null;
  return {
    title: 'AI wants to open another project',
    detail: 'Unsaved changes in the editor are lost; save first if you want to keep them.',
    danger: true,
  };
}

export async function projectOpenRun(ctx: AgentToolContext, args: ProjectOpenArgs) {
  const warnings: string[] = [];
  const live = ctx.host.mode === 'live';
  let readOnly = false;
  let migratedFrom: number | null = null;
  if (args.path !== undefined) {
    const ext = fileExtension(args.path);
    if (ext === '.vrma') {
      throw new AgentToolFailure(
        'invalid_args',
        'A .vrma clip needs a character to play on.',
        'open or import a character first, then project_import the .vrma',
        { detail: { path: 'path' } },
      );
    }
    const file = await readWorkspace(ctx, args.path);
    if (ext === '.ekzanim' || ext === '.ekzanim.json') {
      const opened = valueOf<{ readonly readOnly: boolean; readonly migratedFrom: number }>(
        'file.openProject',
        await run(ctx, 'file.openProject', { name: file.name, bytes: file.bytes }, 'view'),
      );
      readOnly = opened.readOnly;
      migratedFrom = opened.migratedFrom < SCHEMA_VERSION ? opened.migratedFrom : null;
    } else {
      if (live) valueOf('file.new', await run(ctx, 'file.new', undefined, 'view'));
      const imported = valueOf<ImportResult>(
        'file.importModel',
        await run(ctx, 'file.importModel', { name: file.name, bytes: file.bytes, activate: true }, 'view'),
      );
      warnings.push(...imported.warnings);
    }
  } else if (args.sample !== undefined) {
    if (live) valueOf('file.new', await run(ctx, 'file.new', undefined, 'view'));
    try {
      const imported = valueOf<ImportResult>(
        'file.loadSample',
        await run(ctx, 'file.loadSample', { sample: args.sample, activate: true }, 'view'),
      );
      warnings.push(...imported.warnings);
    } catch (error) {
      sampleMissing(error);
    }
  } else if (live) {
    valueOf('file.new', await run(ctx, 'file.new', undefined, 'view'));
  }
  if (!(await charactersReady(ctx.app, ctx.signal)))
    warnings.push('A character is still loading; retry its tools in a moment.');
  return {
    ok: true as const,
    data: { project: '', readOnly, migratedFrom, summary: conciseSummary(ctx), warnings },
  };
}

// ---------- project_import ----------
export interface ProjectImportArgs {
  readonly path?: string | undefined;
  readonly sample?: string | undefined;
  readonly character?: string | undefined;
}

/** True when the document has a character or a scene mesh (live: importing then asks, §0.4.4). */
function sceneHasContent(app: EditorApp): boolean {
  return [...app.store.list('characters')].length > 0 || [...app.store.list('meshes')].length > 0;
}

export function projectImportConfirm(ctx: AgentToolContext, args: ProjectImportArgs): ConfirmPrompt | null {
  if (ctx.host.mode === 'headless') return null;
  if (args.path !== undefined) {
    return {
      title: `AI wants to import ${sanitizeText(baseName(args.path), { maxChars: 64, kind: 'name' })}`,
      detail: 'Adds it to your project as one undo step.',
      danger: false,
    };
  }
  if (args.sample !== undefined && isStaticSample(args.sample) && sceneHasContent(ctx.app)) {
    return {
      title: 'AI wants to add a sample model to your scene',
      detail: 'Adds the model as one undo step.',
      danger: false,
    };
  }
  return null;
}

// ---------- the character setup hooks (MCP-SPEC §0.4.4; B4's `tools/setup/files.ts`) ----------
/**
 * A setup kind of project_import or project_export (static models, the Auto-Rig samples; VRM, GLB and OMOBA kit
 * exports) is run by the character setup module (B4, M-AI-B1-6): it registers its hooks here, and the file tools hand
 * it every call it `handles`. Without a registered hook those kinds answer `unsupported`.
 */
export interface FileToolHook<A> {
  handles(args: A): boolean;
  run(ctx: AgentToolContext, args: A): Promise<AgentToolResult<unknown>>;
}
const HOOKS: {
  import: FileToolHook<ProjectImportArgs> | null;
  export: FileToolHook<ProjectExportArgs> | null;
} = { import: null, export: null };

/** Registers the character setup hooks (INT: `registerFileToolHooks({import: SETUP_IMPORT, export: SETUP_EXPORT})`). */
export function registerFileToolHooks(hooks: {
  readonly import?: FileToolHook<ProjectImportArgs> | null;
  readonly export?: FileToolHook<ProjectExportArgs> | null;
}): void {
  if (hooks.import !== undefined) HOOKS.import = hooks.import;
  if (hooks.export !== undefined) HOOKS.export = hooks.export;
}

function setupMissing(what: string): AgentToolFailure {
  return new AgentToolFailure(
    'unsupported',
    `${what} is not available in this build.`,
    'import a .vrm character or a character sample (polybot, seed-san) instead',
    { retryable: false },
  );
}

/** Activation (§6.10): live with an active character the import leaves the user's active character and clip alone. */
function activation(ctx: AgentToolContext): { readonly activate: boolean; readonly access: 'edit' | 'view' } {
  const userHasActive = ctx.host.capabilities.has('user') && ctx.app.session.getState().activeCharacter !== null;
  return userHasActive ? { activate: false, access: 'edit' } : { activate: true, access: 'view' };
}

export async function projectImportRun(ctx: AgentToolContext, args: ProjectImportArgs) {
  const hook = HOOKS.import;
  if (hook !== null && hook.handles(args)) return hook.run(ctx, args);
  const { activate, access } = activation(ctx);
  const warnings: string[] = [];
  let character: string | null = null;
  let clips: string[] = [];
  let last: OperatorRun | null = null;
  const model = async (name: string, bytes: Uint8Array): Promise<void> => {
    last = await run(ctx, 'file.importModel', { name, bytes, activate }, access);
    const result = valueOf<ImportResult>('file.importModel', last);
    character = characterName(ctx.app, result.character);
    clips = result.clips.map((clip) => clipName(ctx.app, clip));
    warnings.push(...result.warnings);
  };
  if (args.path !== undefined) {
    const ext = fileExtension(args.path);
    if (ext === '.ekzanim' || ext === '.ekzanim.json') {
      throw new AgentToolFailure(
        'invalid_args',
        'A project file cannot be imported into another project.',
        'open it with project_open instead',
        { detail: { path: 'path' } },
      );
    }
    const file = await readWorkspace(ctx, args.path);
    if (ext === '.vrma') {
      const target = args.character === undefined ? undefined : ctx.resolve.character(args.character).id;
      last = await run(
        ctx,
        'file.importAnimation',
        { name: file.name, bytes: file.bytes, activate, ...(target === undefined ? {} : { character: target }) },
        access,
      );
      const result = valueOf<{ readonly clips: readonly ClipId[]; readonly warnings: readonly string[] }>(
        'file.importAnimation',
        last,
      );
      clips = result.clips.map((clip) => clipName(ctx.app, clip));
      const first = result.clips[0];
      const owner = first === undefined ? undefined : ctx.app.store.get('clips', first)?.character;
      character = owner === undefined ? null : characterName(ctx.app, owner);
      warnings.push(...result.warnings);
    } else {
      // .vrm, or a .glb character (a static .glb is the setup hook's)
      await model(file.name, file.bytes);
    }
  } else if (args.sample !== undefined) {
    if (isStaticSample(args.sample)) throw setupMissing(`The static sample ${args.sample}`);
    last = await run(ctx, 'file.loadSample', { sample: args.sample, activate }, access);
    let result: ImportResult;
    try {
      result = valueOf<ImportResult>('file.loadSample', last);
    } catch (error) {
      sampleMissing(error);
    }
    character = characterName(ctx.app, result.character);
    clips = result.clips.map((clip) => clipName(ctx.app, clip));
    warnings.push(...result.warnings);
  }
  if (!(await charactersReady(ctx.app, ctx.signal))) {
    warnings.push('A character is still loading; retry its tools in a moment.');
  }
  const step = last?.step ?? null;
  return {
    ok: true as const,
    data: { character, clips, warnings, model: null },
    ...(step === null ? {} : { undo: { step: step.id, label: step.label } }),
  };
}

// ---------- project_save ----------
export interface ProjectSaveArgs {
  readonly path?: string | undefined;
  readonly delivery?: 'download' | 'workspace' | undefined;
  readonly overwrite: boolean;
}

export function projectSaveConfirm(ctx: AgentToolContext, args: ProjectSaveArgs): ConfirmPrompt | null {
  if (ctx.host.mode === 'headless') return null;
  const delivery = args.delivery ?? 'download';
  if (delivery === 'download') {
    return {
      title: 'AI wants to save the project',
      detail: 'Downloads the project as an .ekzanim file.',
      danger: false,
    };
  }
  return args.overwrite
    ? {
        title: 'AI wants to replace a file in your workspace',
        detail: 'The old file is kept in .ekza-trash/.',
        danger: true,
      }
    : null;
}

export async function projectSaveRun(ctx: AgentToolContext, args: ProjectSaveArgs) {
  const warnings: string[] = [];
  const delivery = deliveryOf(ctx, args.delivery, warnings);
  const projectName = ctx.app.session.getState().projectName;
  const path = args.path ?? deriveFileName(projectName, '.ekzanim');
  const ext = fileExtension(path);
  if (ext !== '.ekzanim' && ext !== '.ekzanim.json') {
    throw new AgentToolFailure(
      'sandbox',
      'Projects are saved as .ekzanim (or .ekzanim.json).',
      'end path with .ekzanim',
      {
        retryable: false,
        detail: { allowed: ['.ekzanim', '.ekzanim.json'] },
      },
    );
  }
  const json = ext === '.ekzanim.json';
  const op = json ? 'file.saveJson' : 'file.save';
  const opArgs = json ? undefined : { fileName: baseName(path) };
  if (delivery === 'download') {
    const saved = valueOf<{ readonly fileName: string; readonly bytes: number }>(
      op,
      await run(ctx, op, opArgs, 'files'),
    );
    return {
      ok: true as const,
      data: { fileName: saved.fileName, path: null, bytes: saved.bytes, delivered: 'download' as const, backup: null },
      ...(warnings.length === 0 ? {} : { warnings }),
    };
  }
  const { value, files } = await captureDownloads(ctx.app, async () =>
    valueOf(op, await run(ctx, op, opArgs, 'files')),
  );
  void value;
  const file = files[0];
  if (file === undefined) {
    throw new AgentToolFailure('internal', 'The save produced no file.', 'report this; nothing was written', {
      retryable: false,
    });
  }
  const written = await writeWorkspace(ctx, path, file.bytes, args.overwrite);
  return {
    ok: true as const,
    data: {
      fileName: baseName(written.path),
      path: written.path,
      bytes: file.bytes.byteLength,
      delivered: 'workspace' as const,
      backup: written.backup,
    },
    ...(warnings.length === 0 ? {} : { warnings }),
  };
}

// ---------- project_export ----------
export type ExportKindArg = 'vrma' | 'animation_glb' | 'bake_into_model' | 'vrm' | 'glb' | 'omoba_kit';
export interface ProjectExportArgs {
  readonly character?: string | undefined;
  readonly clips?: readonly string[] | undefined;
  readonly kind: ExportKindArg;
  readonly fileName?: string | undefined;
  readonly profile?: string | undefined;
  readonly reduce: boolean;
  readonly rootMotion?: 'keep' | 'in_place' | undefined;
  readonly acknowledgeLicense: boolean;
  readonly delivery?: 'download' | 'workspace' | undefined;
  readonly overwrite: boolean;
  /** VRM meta of the setup kinds (B4's hook applies it). */
  readonly meta?: Readonly<Record<string, unknown>> | undefined;
}

const IO_KIND = { vrma: 'vrma', animation_glb: 'animation-glb', bake_into_model: 'bake-into-model' } as const;
const EXTENSION: Readonly<Record<ExportKindArg, string>> = {
  vrma: '.vrma',
  animation_glb: '.glb',
  bake_into_model: '.vrm',
  vrm: '.vrm',
  glb: '.glb',
  omoba_kit: '.zip',
};

export function projectExportConfirm(ctx: AgentToolContext, args: ProjectExportArgs): ConfirmPrompt | null {
  if (ctx.host.mode === 'headless') return null;
  const delivery = args.delivery ?? 'download';
  if (delivery === 'download') {
    return { title: 'AI wants to export and download files', detail: `Exports ${args.kind} files.`, danger: false };
  }
  return args.overwrite
    ? {
        title: 'AI wants to replace files in your workspace',
        detail: 'Old files are kept in .ekza-trash/.',
        danger: true,
      }
    : null;
}

type ArtifactRow = {
  fileName: string;
  path: string | null;
  bytes: number;
  sha256: string;
  backup: string | null;
  lints: { id: string; severity: 'error' | 'warning' | 'info'; message: string }[];
  readBack: { ok: boolean; maxRotErrorRad: number; maxPosErrorM: number };
};

function lintsOf(artifact: ExportArtifact | undefined): ArtifactRow['lints'] {
  return (artifact?.lints ?? []).slice(0, 20).map((lint) => ({
    id: lint.code,
    severity: lint.severity,
    message: sanitizeText(lint.message, { maxChars: 200, kind: 'prose' }),
  }));
}
function readBackOf(artifact: ExportArtifact | undefined): ArtifactRow['readBack'] {
  const report = artifact?.readBack ?? null;
  return report === null
    ? { ok: false, maxRotErrorRad: 0, maxPosErrorM: 0 }
    : { ok: report.ok, maxRotErrorRad: report.maxRotationErrorRad, maxPosErrorM: report.maxTranslationErrorM };
}

export async function projectExportRun(ctx: AgentToolContext, args: ProjectExportArgs) {
  const hook = HOOKS.export;
  if (hook !== null && hook.handles(args)) return hook.run(ctx, args);
  if (args.kind === 'vrm' || args.kind === 'glb' || args.kind === 'omoba_kit') {
    throw setupMissing(`Exporting a character as ${args.kind}`);
  }
  const warnings: string[] = [];
  const delivery = deliveryOf(ctx, args.delivery, warnings);
  const character = ctx.resolve.character(args.character);
  const extension = EXTENSION[args.kind];
  if (args.rootMotion !== undefined) {
    warnings.push('rootMotion is a clip setting here: set it with clip_update; the export used the clip’s own.');
  }
  // the artifacts the operator produced and the files it downloaded
  let artifacts: readonly ExportArtifact[];
  const kind = args.kind;
  const operator = 'file.export';
  const clipIds = (args.clips ?? [undefined]).map((ref) => ctx.resolve.clip(character.id, ref).id);
  const stem = args.fileName === undefined ? null : deriveFileName(args.fileName, '').replace(/\.$/, '');
  const pattern =
    kind === 'bake_into_model'
      ? (stem ?? '{character}-baked')
      : kind === 'vrma'
        ? stem === null
          ? '{clip}'
          : clipIds.length > 1
            ? `${stem}-{clip}`
            : stem
        : (stem ?? '{clip}.anim');
  const reduce = ctx.app.prefs.getState().exportReduce;
  const request = {
    kind: IO_KIND[kind],
    character: character.id,
    clips: clipIds,
    fileNamePattern: pattern,
    closeLoop: clipIds.every((clip) => ctx.app.store.get('clips', clip)?.loop === true),
    includeConstantTracks: true,
    acknowledgeLicense: args.acknowledgeLicense,
    profile: args.profile ?? null,
    reduce: args.reduce
      ? {
          positionM: reduce.positionM,
          rotationCapRad: reduce.rotationCapRad,
          minLeverM: reduce.minLeverM,
          scaleRel: reduce.scaleRel,
        }
      : null,
  };
  const operation = (): Promise<OperatorRun> => run(ctx, 'file.export', request, 'files');

  const rows: ArtifactRow[] = [];
  if (delivery === 'download') {
    const value = valueOf<unknown>(operator, await operation());
    artifacts = artifactsOf(value);
    for (const artifact of artifacts) {
      rows.push({
        fileName: artifact.fileName,
        path: null,
        bytes: artifact.bytes.byteLength,
        sha256: artifact.sha256,
        backup: null,
        lints: lintsOf(artifact),
        readBack: readBackOf(artifact),
      });
    }
    return finishExport(rows, warnings);
  }
  const { value, files } = await captureDownloads(ctx.app, async () => valueOf<unknown>(operator, await operation()));
  artifacts = artifactsOf(value);
  for (const artifact of artifacts) {
    const file = files.find(
      (candidate) => candidate.bytes === artifact.bytes || candidate.fileName === artifact.fileName,
    );
    if (file === undefined) {
      // blocked by an error lint: nothing written (the lints say why)
      rows.push({
        fileName: artifact.fileName,
        path: null,
        bytes: artifact.bytes.byteLength,
        sha256: artifact.sha256,
        backup: null,
        lints: lintsOf(artifact),
        readBack: readBackOf(artifact),
      });
      warnings.push(
        `${sanitizeText(artifact.fileName, { maxChars: 80, kind: 'name' })} was not written: an export check failed.`,
      );
    }
  }
  for (const file of files) {
    const artifact = artifacts.find(
      (candidate) => candidate.bytes === file.bytes || candidate.fileName === file.fileName,
    );
    const name = deriveFileName(file.fileName, extension);
    const written = await writeWorkspace(ctx, `${EXPORTS_DIR}/${name}`, file.bytes, args.overwrite);
    rows.push({
      fileName: baseName(written.path),
      path: written.path,
      bytes: file.bytes.byteLength,
      sha256: artifact !== undefined && artifact.bytes === file.bytes ? artifact.sha256 : sha256Hex(file.bytes),
      backup: written.backup,
      lints: lintsOf(artifact),
      readBack: readBackOf(artifact),
    });
  }
  return finishExport(rows, warnings);
}

function artifactsOf(value: unknown): readonly ExportArtifact[] {
  if (Array.isArray(value)) return value as readonly ExportArtifact[];
  const record = value as { readonly artifacts?: readonly ExportArtifact[] } | null;
  return record?.artifacts ?? [];
}

function finishExport(rows: ArtifactRow[], warnings: string[]) {
  if (rows.length === 0) {
    throw new AgentToolFailure('internal', 'The export produced no file.', 'check the clips and the character', {
      retryable: false,
    });
  }
  return {
    ok: true as const,
    data: { artifacts: rows },
    ...(warnings.length === 0 ? {} : { warnings }),
  };
}
