// The character export of a model-sourced character (M6B-SPEC §5.22 as corrected by §0.4.6 and §0.4.8, §6.4; C10):
// `file.exportCharacter {CharacterExportRequest}` and `char.renderThumbnail`.
//
// - Request: every field optional (scripts and the test API pass what they care about); defaults: the Rig & Skin /
//   active character, profile `ekza/space-avatar-v1`, the profile's first format (VRM 1.0), clips 'slots', the stored
//   thumbnail for VRM, validation on, the file named after the character. Model-sourced characters only (asset
//   characters bake through `file.export`); profiles per `characterProfileProblem` (Space = VRM 1.0 only;
//   `local/generic` VRM or plain GLB; `ekza/omoba-humanoid-v1` not offered).
// - Pipeline (lazy: io's write path and the character-runtime chunk load on first use): the records → a fresh
//   `skeletonFromDoc` on the writer's vertex layout, the meshes (material override), the palettes with their swatch
//   shaders; every exported clip baked through the kernel at integer frames (`bakeClip`, raw target, self-contained
//   track sets, M2a's export-side reduction per the preference); `exportCharacterArtifact` writes, lints for the
//   profile and reads back on the joint subset; then the Validation rows of the profile (C7's service) and the record
//   rows of the VRM meta join the lints, glTF-Validator (when the host has one) adds its errors and three.js reads the
//   file back where a display loader exists. Errors block the download (the operator).
// - M6a's three skin lints never apply to a character export: `skin.influences`, `skin.weight-sum` and
//   `skin.unweighted-vertex` (C7's rows) are the one source.
// - Thumbnail: the software renderer of io (deterministic PNG), stored as an `AssetRecord` (role 'thumbnail', by hash)
//   and referenced by `CharacterRecord.vrm.thumbnail`; exports read the stored bytes.
import { EkzaError, type Frame } from '@ekza-studio/anim-core';
import {
  type AssetRecord,
  type CharacterId,
  type CharacterRecord,
  type CharacterVrmMeta,
  type ClipRecord,
  type DerivedFrom,
  makeVrmMeta,
  type PaletteId,
  type ReadView,
} from '@ekza-studio/doc';
import {
  type BakedClip,
  type CharacterExportRequest,
  type CharacterMeshIn,
  type CharacterReadBack,
  type CharacterWriteInput,
  characterFormats,
  characterProfileProblem,
  clipExportName,
  type ExportArtifact,
  type ExportProfileDef,
  exportFileName,
  type LintIssue,
  type LintSeverity,
  pngSize,
  ruleSeverity,
  SPACE_PROFILE_ID,
  type StaticSwatch,
} from '@ekza-studio/io';
import { computeStepSchedule, type TrackKey } from '@ekza-studio/rig';
import { loadCharacterRuntime } from '../characters/runtimeChunk';
import { loadMeshKernel } from '../mesh';
import type { EditorApp } from '../types';
import { clipMeta, influenceKeepFrames, inPlaceNode, loadWritePath } from './export';
import { threeReadBack } from './exportModel';
import { yieldToHost } from './host';
import { EDITOR_VERSION } from './samples';

/** A request with every field resolved. */
export type CharacterExportPlan = CharacterExportRequest & { readonly character: CharacterId };

/** M6a's skin lints, replaced by the `skin.*` rows in a character export (§5.21). */
const M6A_SKIN_LINTS = new Set(['mesh.influences', 'mesh.weights-unnormalized', 'mesh.unweighted-vertex']);

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The character a character operator works on: the argument, the Rig & Skin one, the active one, else the first model one. */
export function characterOf(app: EditorApp, explicit: unknown): CharacterId | null {
  if (typeof explicit === 'string') return explicit as CharacterId;
  const state = app.session.getState();
  for (const id of [state.rig.character, state.activeCharacter]) {
    if (id !== null && app.store.get('characters', id)?.source.kind === 'model') return id;
  }
  return app.store.list('characters').find((c) => c.source.kind === 'model' && c.deleted === null)?.id ?? null;
}

/** Whether a character is model-sourced and live. */
export function isModelCharacter(record: CharacterRecord | undefined): boolean {
  return record !== undefined && record.deleted === null && record.source.kind === 'model';
}

/** The request with its defaults (§6.4), or why it cannot be read. */
export function normalizeCharacterRequest(app: EditorApp, raw: unknown): CharacterExportPlan | string {
  const r: Readonly<Record<string, unknown>> = raw === undefined || raw === null ? {} : isRecord(raw) ? raw : {};
  if (raw !== undefined && raw !== null && !isRecord(raw)) return 'expects a character export request';
  const character = characterOf(app, r['character']);
  if (character === null) return 'Make a character from your model first (Rig & Skin › Quick Rig)';
  const record = app.store.get('characters', character);
  if (record === undefined) return `Character ${character} does not exist`;
  const profile = r['profile'] === undefined ? SPACE_PROFILE_ID : r['profile'];
  if (profile !== null && typeof profile !== 'string') return 'expects a profile id or null';
  const format = r['format'] === undefined ? (characterFormats(profile)[0] ?? 'vrm') : r['format'];
  if (format !== 'vrm' && format !== 'glb') return `Unknown format ${JSON.stringify(format)} (vrm or glb)`;
  const clips = r['clips'] === undefined ? 'slots' : r['clips'];
  if (clips !== 'slots' && !(Array.isArray(clips) && clips.every((id) => typeof id === 'string'))) {
    return "expects clips: 'slots' or a list of clip ids";
  }
  const material = r['material'] === undefined ? null : r['material'];
  if (material !== null && material !== 'unlit' && material !== 'lit')
    return `Unknown material ${JSON.stringify(material)}`;
  const thumbnail = r['thumbnail'] === undefined ? (format === 'vrm' ? 'stored' : 'none') : r['thumbnail'];
  if (thumbnail !== 'stored' && thumbnail !== 'none') return "expects thumbnail: 'stored' or 'none'";
  const includeProps = r['includeProps'] === undefined ? null : r['includeProps'];
  if (includeProps !== null && typeof includeProps !== 'boolean') return 'expects includeProps: boolean or null';
  const fileName =
    typeof r['fileName'] === 'string' && r['fileName'].trim() !== '' ? r['fileName'].trim() : record.name;
  return {
    character,
    fileName,
    format,
    profile,
    clips: clips as CharacterExportRequest['clips'],
    includeProps,
    material,
    thumbnail,
    validate: r['validate'] !== false,
  };
}

/** Why a request cannot run (synchronous: polls), or null. */
export function characterRequestProblem(app: EditorApp, raw: unknown): string | null {
  const plan = normalizeCharacterRequest(app, raw);
  if (typeof plan === 'string') return plan;
  const found = app.store.get('characters', plan.character);
  if (found === undefined || found.deleted !== null) return 'The character does not exist';
  if (!isModelCharacter(found)) {
    return `${found.name} is an imported avatar: export it with File › Export (bake into the model)`;
  }
  const record = found;
  if (plan.profile !== null && app.exportProfiles.get(plan.profile) === undefined) {
    return `Unknown export profile '${plan.profile}'`;
  }
  const routing = characterProfileProblem(plan.profile, plan.format);
  if (routing !== null) return routing;
  const skeleton = app.store.query.skeletonOfCharacter(plan.character);
  if (skeleton === undefined || app.store.query.jointsOfSkeleton(skeleton.id).length === 0) {
    return 'Create the skeleton first (Rig & Skin › Quick Rig)';
  }
  if (plan.clips !== 'slots') {
    for (const id of plan.clips) {
      const clip = app.store.get('clips', id);
      if (clip === undefined || clip.character !== plan.character || clip.deleted !== null) {
        return `Clip ${id} is not a clip of ${record.name}`;
      }
      if (clip.source.kind === 'test') return `${clip.name} is a test clip: test clips are never exported`;
    }
  }
  return null;
}

/** The clips a request exports: the listed ones, or every clip with an Ekza slot ('slots'); never test clips. */
export function exportedClips(view: ReadView, plan: CharacterExportPlan): readonly ClipRecord[] {
  if (plan.clips === 'slots') {
    return view.query
      .clipsOfCharacter(plan.character)
      .filter((clip) => clip.deleted === null && clip.source.kind !== 'test' && (clip.slot ?? '').trim() !== '');
  }
  return plan.clips.flatMap((id) => {
    const clip = view.get('clips', id);
    return clip === undefined || clip.source.kind === 'test' ? [] : [clip];
  });
}

/** A row of the character export (C7's Validation rows and the VRM meta rows of the record), as a lint. */
function lintOf(code: string, severity: LintSeverity, message: string): LintIssue {
  return { code, severity, message };
}

/**
 * The record rows of the VRM meta for a profile (§5.21: errors at a VRM export through the Space profile, none for
 * local/generic): name and authors, the licence choice, a square stored thumbnail.
 */
export function vrmMetaRows(
  app: EditorApp,
  character: CharacterRecord,
  profile: ExportProfileDef | null,
  format: 'vrm' | 'glb',
): LintIssue[] {
  if (format !== 'vrm') return [];
  const rows: LintIssue[] = [];
  const add = (code: string, message: string) => {
    const severity = ruleSeverity(code, profile);
    if (severity !== null) rows.push(lintOf(code, severity, message));
  };
  const meta = character.vrm;
  const authors = meta?.authors.filter((author) => author.trim() !== '') ?? [];
  if (meta === null || meta.name.trim() === '' || authors.length === 0) {
    add('vrm.meta-required', 'Set the VRM meta: a name and at least one author (File › VRM Meta…)');
  }
  if (meta === null || meta.licensePreset === null) add('vrm.licence-unset', 'Choose a licence for the VRM export');
  const thumbnail = meta?.thumbnail ?? null;
  if (thumbnail === null) add('vrm.thumbnail-square', 'Render a thumbnail for the VRM (File › Render Thumbnail)');
  else {
    const bytes = app.services.assets.peek(thumbnail);
    const size = bytes === undefined ? null : pngSize(bytes);
    if (size !== null && size.width !== size.height) {
      add('vrm.thumbnail-square', `The thumbnail is ${size.width} × ${size.height}; render a square one`);
    }
  }
  return rows;
}

/**
 * The rows that gate a character export for a profile (§5.21, §8.13): C7's Validation rows (empty until the rig
 * chunk has loaded) and the VRM meta rows, one row per code (the meta rows first).
 */
export function characterExportRows(
  app: EditorApp,
  character: CharacterId,
  profileId: string | null,
  format: 'vrm' | 'glb',
): LintIssue[] {
  const record = app.store.get('characters', character);
  if (record === undefined || !isModelCharacter(record)) return [];
  const profile = profileId === null ? null : (app.exportProfiles.get(profileId) ?? null);
  const rows = vrmMetaRows(app, record, profile, format);
  const seen = new Set(rows.map((row) => row.code));
  let validation: readonly { code: string; severity: LintSeverity; message: string }[] = [];
  try {
    validation = app.rig.loaded ? app.rig.validation.rows(character, profileId) : [];
  } catch {
    validation = [];
  }
  for (const row of validation) {
    if (seen.has(row.code) || M6A_SKIN_LINTS.has(row.code)) continue;
    seen.add(row.code);
    rows.push(lintOf(row.code, row.severity, row.message));
  }
  return rows;
}

/** The live swatches of a palette with their shaders (SHADING-SPEC §4; Lambert ones carry none). */
function swatchesWithShaders(view: ReadView, palette: PaletteId): StaticSwatch[] {
  const slots = [...new Set(view.query.swatchesOfPalette(palette).map((swatch) => swatch.slot))].sort((a, b) => a - b);
  return slots.flatMap((slot): StaticSwatch[] => {
    const swatch = view.query.swatchBySlot(palette, slot);
    if (swatch === undefined) return [];
    if (swatch.shader !== 'blinn') return [{ slot, srgb: swatch.srgb }];
    return [
      {
        slot,
        srgb: swatch.srgb,
        shader: { shader: 'blinn', glossiness: swatch.glossiness, specular: swatch.specular },
      },
    ];
  });
}

/** Root motion 'in-place' needs a node to remove the travel from; without one the clip exports as 'hips'. */
function rootMotionOf(clip: ClipRecord, node: number | null) {
  return clip.rootMotion === 'in-place' && node === null
    ? { rootMotion: 'hips' as const, inPlaceNode: null }
    : { rootMotion: clip.rootMotion, inPlaceNode: node };
}

/** Integer bake range of a clip (clip frames, inclusive). */
function bakeRange(clip: ClipRecord): { readonly start: Frame; readonly end: Frame } {
  const start = Math.round(clip.range.start);
  return { start, end: Math.max(start, Math.round(clip.range.end)) };
}

/** The writer input of a character plus its baked clips (the export's records at this document state). */
export async function characterWriteInput(
  app: EditorApp,
  plan: CharacterExportPlan,
): Promise<{
  readonly write: CharacterWriteInput;
  readonly baked: readonly BakedClip[];
  readonly derivedFrom: DerivedFrom[];
}> {
  const [chunk, kernel, write] = await Promise.all([loadCharacterRuntime(), loadMeshKernel(), loadWritePath()]);
  const meshIo = await write.loadMeshIo();
  await chunk.meshesSettled(app, plan.character);
  const parts = chunk.modelParts(app, plan.character);
  if (parts === null) throw new EkzaError('unsupported', 'Create the skeleton first (Rig & Skin › Quick Rig)');
  if (parts === 'loading') throw new EkzaError('mesh-not-ready', 'The meshes of the character are still loading');
  const meshes: CharacterMeshIn[] = chunk.characterMeshes(app.store, kernel, parts).map((mesh) =>
    plan.material === null
      ? mesh
      : {
          ...mesh,
          materials: mesh.materials.map((material) => ({ ...material, preset: plan.material as 'unlit' | 'lit' })),
        },
  );
  const palettes = new Map<string, readonly StaticSwatch[]>();
  for (const mesh of meshes) {
    if (mesh.paletteId !== null && !palettes.has(mesh.paletteId)) {
      palettes.set(mesh.paletteId, swatchesWithShaders(app.store, mesh.paletteId as PaletteId));
    }
  }
  const vertices = chunk.characterVertices(meshIo, meshes, palettes);
  const skeleton = chunk.skeletonFromDoc(chunk.docSkeletonInput(app.store, kernel, parts), { vertices });

  // Clips through the kernel (ADR 0005): the character's runtime program, integer frames, raw tracks on the joints.
  const clips = exportedClips(app.store, plan);
  for (const clip of clips) await app.store.open(`clip:${clip.id}`);
  const baked: BakedClip[] = [];
  if (clips.length > 0) {
    const runtime = app.characters.get(plan.character);
    if (runtime === undefined) throw new EkzaError('unsupported', 'The character is still loading');
    if (runtime.skeleton.fingerprint !== skeleton.fingerprint) {
      throw new EkzaError('unsupported', 'The character is still updating its skeleton; export again in a moment');
    }
    const program = runtime.program;
    const reducePref = app.prefs.getState().exportReduce;
    const leverArm = reducePref.enabled ? write.trackLeverArms(runtime.skeleton, 'raw') : null;
    const jobs = clips.map((clip, index) => {
      const range = bakeRange(clip);
      const sampler = runtime.sampler(clip.id);
      const name = clipExportName(clip);
      return {
        clip,
        options: {
          name,
          fps: clip.fps,
          range,
          target: 'raw' as const,
          closeLoop: clip.loop,
          loop: clip.loop,
          ...rootMotionOf(clip, inPlaceNode(app.store, program, clip)),
          stepSchedule: computeStepSchedule(program, sampler, range, 'raw'),
          meta: clipMeta(clip, index, name),
          ...(leverArm === null
            ? {}
            : {
                reduce: {
                  spec: reducePref,
                  height: runtime.skeleton.height,
                  leverArm,
                  keep: influenceKeepFrames(program, sampler, range, 'raw'),
                },
              }),
        },
      };
    });
    const bake = (job: (typeof jobs)[number], requiredTracks: ReadonlySet<TrackKey>): BakedClip =>
      write.bakeClip(
        {
          program,
          evaluate: (frame, out) =>
            app.evaluation.evaluateAt(plan.character, job.clip.id, frame, out, { withOverrides: false }),
        },
        { ...job.options, requiredTracks },
      );
    for (const job of jobs) {
      baked.push(bake(job, new Set()));
      await yieldToHost();
    }
    // Self-contained clips (ADR 0005 §3): every clip carries every track any of them animates.
    if (baked.length > 1) {
      const union = new Set<TrackKey>();
      for (const clip of baked) for (const track of clip.tracks) union.add(`${track.node}/${track.path}`);
      for (let i = 0; i < baked.length; i++) {
        const has = new Set((baked[i] as BakedClip).tracks.map((t): TrackKey => `${t.node}/${t.path}`));
        if ([...union].every((key) => has.has(key))) continue;
        baked[i] = bake(jobs[i] as (typeof jobs)[number], union);
        await yieldToHost();
      }
    }
  }

  let thumbnailPng: Uint8Array | null = null;
  const vrm: CharacterVrmMeta | null = parts.character.vrm;
  if (plan.format === 'vrm' && plan.thumbnail === 'stored' && vrm !== null && vrm.thumbnail !== null) {
    thumbnailPng = await app.services.assets.get(vrm.thumbnail);
  }
  const model = chunk.modelProvenance(parts, skeleton, EDITOR_VERSION);
  return {
    write: {
      skeleton,
      joints: parts.joints,
      meshes,
      palettes,
      clips: baked.map((clip) => ({
        name: clip.name,
        fps: clip.fps.num / clip.fps.den,
        loop: clip.meta.loop,
        tracks: clip.tracks,
      })),
      vrm: plan.format === 'vrm' ? (vrm ?? makeVrmMeta(parts.character.name)) : null,
      thumbnailPng,
      model,
      heightScale: null,
    },
    baked,
    derivedFrom: [...model.provenance.derivedFrom],
  };
}

/** Runs a character export (§6.4): one artifact; error lints block the download in the operator. */
export async function runExportCharacter(app: EditorApp, raw: unknown): Promise<ExportArtifact> {
  const problem = characterRequestProblem(app, raw);
  if (problem !== null) throw new EkzaError('unsupported', problem);
  const plan = normalizeCharacterRequest(app, raw) as CharacterExportPlan;
  const record = app.store.get('characters', plan.character) as CharacterRecord;
  await app.rig.load().catch(() => {});
  const profile = plan.profile === null ? null : (app.exportProfiles.get(plan.profile) ?? null);
  const write = await loadWritePath();
  const { write: input, baked, derivedFrom } = await characterWriteInput(app, plan);
  const fileName = exportFileName(
    plan.fileName.replace(/\.(vrm|glb)$/i, ''),
    { character: record.name, clip: '', fps: 30 },
    plan.format,
  );
  let artifact: ExportArtifact = await write.exportCharacterArtifact({
    write: input,
    baked,
    format: plan.format,
    fileName,
    profile,
    generator: `Ekza Studio ${EDITOR_VERSION}`,
    animationMeta: write.ekzaAnimationMeta(baked, 'vrm-humanoid', {
      toolVersion: EDITOR_VERSION,
      projectSha256: null,
      baseSha256: null,
    }),
    derivedFrom,
  });
  // The rows of the profile (Validation, VRM meta) join the byte lints; a byte lint with a row's code is that row.
  const rows = characterExportRows(app, plan.character, plan.profile, plan.format);
  const rowCodes = new Set(rows.map((row) => row.code));
  const lints = [
    ...rows,
    ...artifact.lints.filter((lint) => !rowCodes.has(lint.code) && !M6A_SKIN_LINTS.has(lint.code)),
  ];
  artifact = { ...artifact, lints };
  const readBack = artifact.readBack as CharacterReadBack;
  if (!readBack.ok) {
    artifact = {
      ...artifact,
      lints: [
        ...artifact.lints,
        lintOf('export.read-back', 'error', `Read-back check failed: ${readBack.problems.slice(0, 3).join('; ')}`),
      ],
    };
  }
  const three = await threeReadBack(app.services.models, artifact.bytes);
  if (three !== null) artifact = { ...artifact, readBack: { ...readBack, three } as CharacterReadBack };
  const validate = app.services.validate;
  if (plan.validate && validate !== null) {
    const report = await validate(artifact.bytes);
    const errors: LintIssue[] = report.issues
      .filter((issue) => issue.severity === 0)
      .map((issue) => ({
        code: `validator.${issue.code}`,
        severity: 'error',
        message: `glTF-Validator: ${issue.message}`,
        ...(issue.pointer === undefined ? {} : { pointer: issue.pointer }),
      }));
    artifact = { ...artifact, validation: report, lints: [...artifact.lints, ...errors] };
  }
  return artifact;
}

/** The thumbnail of a model character (§5.22): rendered by io, stored as a thumbnail asset. */
export async function renderThumbnailAsset(app: EditorApp, character: CharacterId): Promise<AssetRecord> {
  const record = app.store.get('characters', character);
  if (record === undefined || !isModelCharacter(record)) {
    throw new EkzaError('unsupported', 'Thumbnails are rendered for characters made from models');
  }
  const [chunk, kernel, write] = await Promise.all([loadCharacterRuntime(), loadMeshKernel(), loadWritePath()]);
  await chunk.meshesSettled(app, character);
  const parts = chunk.modelParts(app, character);
  if (parts === null) throw new EkzaError('unsupported', 'Create the skeleton first (Rig & Skin › Quick Rig)');
  if (parts === 'loading') throw new EkzaError('mesh-not-ready', 'The meshes of the character are still loading');
  const meshes = chunk.characterMeshes(app.store, kernel, parts);
  const palettes = chunk.characterPalettes(app.store, meshes);
  await yieldToHost();
  const png = write.renderCharacterThumbnail(meshes, palettes);
  const name = `${exportFileName(record.name, { character: record.name, clip: '', fps: 30 }, 'png').replace(/\.png$/, '')}-thumbnail.png`;
  return app.services.assets.put(png, { name, ext: 'png', role: 'thumbnail' });
}
