// Auto-Rig ⑤ Export composition (AUTORIG-SPEC §4.5, §5.6, AR-D16, AR-D24; D6): `autorig.export {character, target,
// fileName}` — one download, no undo step, no document change. Every target writes through the code Studio's export
// operators run, so the bytes are Studio's by construction (FR-AR-12):
//
// - `ekza-vrm` (model character): `runExportCharacter` (the function `file.exportCharacter`'s `prepare` runs) with
//   `{format: 'vrm', profile: 'ekza/space-avatar-v1', clips: 'slots', includeProps: null, material: null, thumbnail:
//   'stored', validate: true}`; `blockingLints` refuse the download as `file.exportCharacter`'s `apply` does.
// - `glb` (model character): the same with `{format: 'glb', profile: 'local/generic', clips: <every non-test clip, in
//   order>, thumbnail: 'none'}`.
// - `vrma`: the shipped exporter of kind `vrma` (what `file.export`'s `prepare` runs, with its read-back lint), one
//   artifact per clip over every non-test clip of the character; one file is saved as it is, several as
//   `<name>-animations.zip` (io's `zipFiles`). Available only where the exporter's poll accepts the character.
// - `omoba-kit`: the `ekza-vrm` bytes packed by io's `packOmobaKit` (`<slug>.glb`, `<slug>.png`, `manifest-entry.json`,
//   `README.txt`) as `<slug>-omoba-kit.zip`; blocked whenever the VRM is.
//
// Asset-sourced characters (an uploaded VRM or rigged GLB) cannot run `file.exportCharacter` (model characters only);
// their targets are the bake Studio's Export dialog offers (§5.6.1): `ekza-vrm` = `file.export` kind `bake-into-model`
// through `ekza/space-avatar-v1` (VRM sources), `glb` = the same through `local/generic` (glTF sources), `vrma` as
// above, `omoba-kit` from the baked VRM. A target a character cannot use fails its poll (the step hides it).
//
// `fileName` is the base name of the saved file (`''` = the slug of the avatar's name, `omobaSlug`); the extension is
// the target's. Returns every artifact and their lints (errors first), whether saved or not.
import { EkzaError } from '@ekza-studio/anim-core';
import { type CharacterId, type CharacterRecord, type ClipRecord, makeVrmMeta, type ReadView } from '@ekza-studio/doc';
import {
  type CharacterExportRequest,
  type ExportArtifact,
  type ExportRequest,
  exportFileName,
  LOCAL_PROFILE_ID,
  type LintIssue,
  type OmobaKitMeta,
  omobaKitFileName,
  omobaLicense,
  omobaSlug,
  packOmobaKit,
  readVrmLicense,
  SPACE_PROFILE_ID,
  zipFiles,
} from '@ekza-studio/io';
import {
  type AutoRigExportResult,
  type AutoRigExportTarget,
  type EditorApp,
  GLOBAL_SCOPE,
  type PollResult,
} from '../../../../types';
import { blockingLints, pollExport, withReadBackLint } from '../../../../workflows/export';
import { characterRequestProblem, isModelCharacter, runExportCharacter } from '../../../../workflows/exportCharacter';
import { isRecord } from '../../../../workflows/util';
import { type AnyOperator, defineOperator, fail, OK } from '../../define';

/** The targets in the order the step offers them (§5.6.1). */
export const EXPORT_TARGETS: readonly AutoRigExportTarget[] = ['ekza-vrm', 'glb', 'vrma', 'omoba-kit'];

/** The busy label of a running export (the progress line and the footer). */
export const EXPORT_BUSY = 'Exporting the character…';

/** The zip MIME type of the kit and the VRMA bundle. */
export const ZIP_MIME = 'application/zip';

/** What one `autorig.export` saves: the file and the result the operator returns. */
export interface ExportPlanned {
  readonly result: AutoRigExportResult;
  /** The file to save, or null when an error lint blocks it. */
  readonly file: { readonly name: string; readonly bytes: Uint8Array; readonly mime: string } | null;
}

const EXPECTS = `expects { character, target: ${EXPORT_TARGETS.map((t) => `'${t}'`).join(' | ')}, fileName }`;

const ORDER = { error: 0, warning: 1, info: 2 } as const;

/** The live character of an export, or null. */
function characterOf(app: EditorApp, id: unknown): CharacterRecord | null {
  if (typeof id !== 'string') return null;
  const record = app.store.get('characters', id as CharacterId);
  return record === undefined || record.deleted !== null ? null : record;
}

/**
 * The exportable clips of a character, in the document's order: every live clip that is not a test clip and holds
 * motion — brought in (Use Clip, an import) or a new clip with curves, as the wizard's progress counts clips (an
 * import's or a character's empty default clip is not exported).
 */
export function characterClips(view: ReadView, character: CharacterId): readonly ClipRecord[] {
  const curves = new Set(view.list('curves').map((curve) => curve.clip));
  return view.query
    .clipsOfCharacter(character)
    .filter(
      (clip) =>
        clip.deleted === null &&
        clip.character === character &&
        clip.source.kind !== 'test' &&
        (clip.source.kind !== 'new' || curves.has(clip.id)),
    );
}

/** The avatar's display name: the VRM meta's name of a model character, else the character's name. */
export function avatarName(record: CharacterRecord): string {
  const name = isModelCharacter(record) ? (record.vrm?.name ?? '').trim() : '';
  return name === '' ? record.name : name;
}

/** The file base of an export: the given name without a known extension, else the slug of the avatar's name. */
export function exportBase(record: CharacterRecord, fileName: string): string {
  const base = fileName.trim().replace(/\.(vrm|glb|vrma|zip)$/i, '');
  return base === '' ? omobaSlug(avatarName(record)) : base;
}

/** The character export request of a model-character target (§5.6.1). */
export function characterRequest(
  app: EditorApp,
  record: CharacterRecord,
  target: 'ekza-vrm' | 'glb' | 'omoba-kit',
  fileName: string,
): CharacterExportRequest {
  const base = exportBase(record, fileName);
  if (target === 'glb') {
    return {
      character: record.id,
      fileName: base,
      format: 'glb',
      profile: LOCAL_PROFILE_ID,
      clips: characterClips(app.store, record.id).map((clip) => clip.id),
      includeProps: null,
      material: null,
      thumbnail: 'none',
      validate: true,
    };
  }
  return {
    character: record.id,
    fileName: base,
    format: 'vrm',
    profile: SPACE_PROFILE_ID,
    clips: 'slots',
    includeProps: null,
    material: null,
    thumbnail: 'stored',
    validate: true,
  };
}

/**
 * The `file.export` request of a VRMA target or of an asset character's bake (§5.6.1): every exportable clip, the
 * Export dialog's defaults (close the loop when every clip loops, constant tracks kept, the reduction preference).
 */
export function fileExportRequest(
  app: EditorApp,
  record: CharacterRecord,
  kind: 'vrma' | 'bake-into-model',
  profile: string | null,
  fileName: string,
): ExportRequest {
  const clips = characterClips(app.store, record.id);
  const reduce = app.prefs.getState().exportReduce;
  const base = exportBase(record, fileName);
  return {
    kind,
    character: record.id,
    clips: clips.map((clip) => clip.id),
    fileNamePattern: kind === 'vrma' ? `${base}-{clip}` : base,
    closeLoop: clips.length > 0 && clips.every((clip) => clip.loop),
    includeConstantTracks: true,
    acknowledgeLicense: false,
    profile,
    reduce: reduce.enabled
      ? {
          positionM: reduce.positionM,
          rotationCapRad: reduce.rotationCapRad,
          minLeverM: reduce.minLeverM,
          scaleRel: reduce.scaleRel,
        }
      : null,
  };
}

/** The bake profile of an asset character's target, or null when the target does not apply to it. */
function assetBakeProfile(record: CharacterRecord, target: 'ekza-vrm' | 'glb' | 'omoba-kit'): string | null {
  const vrm = record.format !== 'gltf';
  if (target === 'glb') return vrm ? null : LOCAL_PROFILE_ID;
  return vrm ? SPACE_PROFILE_ID : null;
}

const NO_CLIPS = 'Add an animation first: this target exports the character’s clips';

/** Why a target cannot export a character (synchronous: the step's availability and the poll), or null. */
export function exportTargetProblem(
  app: EditorApp,
  character: CharacterId,
  target: AutoRigExportTarget,
  fileName = '',
): string | null {
  const record = characterOf(app, character);
  if (record === null) return `Character ${character} does not exist`;
  if (target === 'vrma') {
    if (characterClips(app.store, record.id).length === 0) return NO_CLIPS;
    const poll = pollExport(app, fileExportRequest(app, record, 'vrma', null, fileName), 'vrma');
    return poll === true ? null : poll.reason;
  }
  if (isModelCharacter(record)) return characterRequestProblem(app, characterRequest(app, record, target, fileName));
  const profile = assetBakeProfile(record, target);
  if (profile === null) {
    return target === 'glb'
      ? `${record.name} is a VRM: export it as the Ekza avatar (VRM) or as animations`
      : `${record.name} is not a VRM: export it as a GLB or as animations`;
  }
  if (characterClips(app.store, record.id).length === 0) {
    return 'An imported avatar exports with its clips baked in: add an animation first';
  }
  const poll = pollExport(app, fileExportRequest(app, record, 'bake-into-model', profile, fileName), 'bake-into-model');
  return poll === true ? null : poll.reason;
}

/** The targets a character can export to now, in the step's order. */
export function availableTargets(app: EditorApp, character: CharacterId): readonly AutoRigExportTarget[] {
  return EXPORT_TARGETS.filter((target) => exportTargetProblem(app, character, target) === null);
}

/** Runs the shipped exporter of a `file.export` kind as `file.export`'s `prepare` does (with the read-back lint). */
async function runFileExport(
  app: EditorApp,
  req: ExportRequest,
  kind: 'vrma' | 'bake-into-model',
): Promise<readonly ExportArtifact[]> {
  const exporter = app.exporters.get(kind);
  if (exporter === undefined) throw new EkzaError('unsupported', `Unknown export kind '${kind}'`);
  return (await exporter.run(app, req)).map(withReadBackLint);
}

/** The kit's meta: the VRM meta of a model character, the licence of an imported VRM. */
function kitMeta(app: EditorApp, record: CharacterRecord, slug: string): OmobaKitMeta {
  if (isModelCharacter(record)) {
    const vrm = record.vrm ?? makeVrmMeta(record.name);
    return { displayName: avatarName(record), authors: vrm.authors, license: omobaLicense(vrm.licensePreset), slug };
  }
  const runtime = app.characters.get(record.id);
  const license = runtime === undefined ? null : readVrmLicense(runtime.container);
  return {
    displayName: license?.title?.trim() || record.name,
    authors: license?.authors ?? [],
    license: license?.licenseName ?? (license?.licenseUrl === null ? 'See the VRM meta' : (license?.licenseUrl ?? '')),
    slug,
  };
}

/** The stored thumbnail of a model character (the VRM's own), or null. */
async function thumbnailOf(app: EditorApp, record: CharacterRecord): Promise<Uint8Array | null> {
  const id = isModelCharacter(record) ? (record.vrm?.thumbnail ?? null) : null;
  if (id === null) return null;
  try {
    return await app.services.assets.get(id);
  } catch {
    return null;
  }
}

/** Every artifact's lints, errors first (stable within a severity). */
function sortedLints(artifacts: readonly ExportArtifact[]): readonly LintIssue[] {
  return artifacts.flatMap((artifact) => artifact.lints).sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
}

/** The artifacts and the file of a target (no download; the operator's `apply` saves it). */
export async function planExport(
  app: EditorApp,
  character: CharacterId,
  target: AutoRigExportTarget,
  fileName: string,
): Promise<ExportPlanned> {
  const problem = exportTargetProblem(app, character, target, fileName);
  if (problem !== null) throw new EkzaError('unsupported', problem);
  const record = characterOf(app, character) as CharacterRecord;
  const base = exportBase(record, fileName);
  const done = (
    artifacts: readonly ExportArtifact[],
    name: string,
    file: () => { readonly bytes: Uint8Array; readonly mime: string },
  ): ExportPlanned => {
    const blocked = artifacts.some((artifact) => blockingLints(artifact).length > 0);
    return {
      result: { target, fileName: name, artifacts, lints: sortedLints(artifacts) },
      file: blocked ? null : { name, ...file() },
    };
  };

  if (target === 'vrma') {
    const artifacts = await runFileExport(app, fileExportRequest(app, record, 'vrma', null, fileName), 'vrma');
    if (artifacts.length === 1) {
      const only = artifacts[0] as ExportArtifact;
      return done(artifacts, only.fileName, () => ({ bytes: only.bytes, mime: only.mime }));
    }
    const name = exportFileName(`${base}-animations`, { character: record.name, clip: '', fps: 30 }, 'zip');
    return done(artifacts, name, () => ({
      bytes: zipFiles(artifacts.map((artifact) => ({ path: artifact.fileName, bytes: artifact.bytes }))),
      mime: ZIP_MIME,
    }));
  }

  // ekza-vrm, glb, omoba-kit: the character export (model characters) or the bake (imported avatars)
  let vrm: ExportArtifact;
  if (isModelCharacter(record)) {
    vrm = await runExportCharacter(app, characterRequest(app, record, target, fileName));
  } else {
    const profile = assetBakeProfile(record, target) as string;
    const artifacts = await runFileExport(
      app,
      fileExportRequest(app, record, 'bake-into-model', profile, fileName),
      'bake-into-model',
    );
    if (artifacts.length !== 1) throw new EkzaError('internal', 'The bake wrote no single file');
    vrm = artifacts[0] as ExportArtifact;
  }
  if (target !== 'omoba-kit') return done([vrm], vrm.fileName, () => ({ bytes: vrm.bytes, mime: vrm.mime }));
  const meta = kitMeta(app, record, omobaSlug(base));
  const thumbnail = await thumbnailOf(app, record);
  return done([vrm], omobaKitFileName(meta), () => ({
    bytes: packOmobaKit({ vrm: vrm.bytes, thumbnail, meta }),
    mime: ZIP_MIME,
  }));
}

/** The poll of `autorig.export` (synchronous). */
export function pollAutoRigExport(app: EditorApp, args: unknown): PollResult {
  if (!isRecord(args) || typeof args['character'] !== 'string') return fail(EXPECTS);
  if (!(EXPORT_TARGETS as readonly unknown[]).includes(args['target'])) return fail(EXPECTS);
  if (args['fileName'] !== undefined && typeof args['fileName'] !== 'string') return fail('fileName must be a string');
  const fileName = args['fileName'];
  const problem = exportTargetProblem(
    app,
    args['character'] as CharacterId,
    args['target'] as AutoRigExportTarget,
    typeof fileName === 'string' ? fileName : '',
  );
  return problem === null ? OK : fail(problem);
}

const exportOperator = defineOperator<'autorig.export', ExportPlanned>({
  id: 'autorig.export',
  label: 'Download Character',
  description:
    'Exports the character for OMOBA and Ekza Space (VRM 1.0), as a GLB with its animations, as VRMA clips or as an ' +
    'OMOBA local test kit, with the bytes Studio’s export writes.',
  category: 'autorig',
  scope: GLOBAL_SCOPE,
  poll: ({ app }, args) => pollAutoRigExport(app, args),
  async prepare({ app }, args) {
    app.session.setState({ busy: { label: EXPORT_BUSY, progress: null } });
    try {
      return await planExport(app, args.character, args.target, args.fileName ?? '');
    } finally {
      if (app.session.getState().busy?.label === EXPORT_BUSY) app.session.setState({ busy: null });
    }
  },
  apply({ app }, _args, planned) {
    const { result, file } = planned;
    if (file === null) {
      const errors = result.lints.filter((lint) => lint.severity === 'error');
      app.services.notify.toast({
        kind: 'error',
        text: `${result.fileName} was not saved: ${errors[0]?.message ?? 'export check failed'}${
          errors.length > 1 ? ` (+${errors.length - 1} more)` : ''
        }`,
      });
      return result;
    }
    app.services.files.download(file.name, file.bytes, file.mime);
    const warnings = result.lints.filter((lint) => lint.severity === 'warning').length;
    app.services.notify.toast({
      kind: warnings > 0 ? 'warning' : 'success',
      text: `Exported ${file.name}${warnings > 0 ? ` with ${warnings} warning${warnings === 1 ? '' : 's'}` : ''}`,
    });
    return result;
  },
});

export const WIZARD_EXPORT_OPERATORS: readonly AnyOperator[] = [exportOperator];
