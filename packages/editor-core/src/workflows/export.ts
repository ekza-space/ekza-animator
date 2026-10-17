// Export pipeline (MVP-SPEC §4.11.10, ADR 0005): per clip a `PoseSource` over the character's runtime evaluates the
// clip without session overrides; io bakes integer frames (step schedule from rig), writes the file (surgeon,
// animation-only GLB or one VRMA per clip) with `ekza_animation_v1` metadata, lints it and reads it back. Async, no
// document writes; yields between clips.
import { EkzaError, type Frame } from '@ekza-animator/anim-core';
import type { CharacterRecord, ClipRecord, ControlId, ReadView } from '@ekza-animator/doc';
import {
  type BakedClip,
  type BakeOptions,
  bakeClip,
  bakeIntoModel,
  clipExportName,
  clipFramesToSeconds,
  compareValidation,
  type EkzaAnimationV1,
  type EkzaClipMetaV1,
  type ExportArtifact,
  type ExportProfileDef,
  type ExportRequest,
  ekzaAnimationMeta,
  exportFileName,
  type GlbContainer,
  type LintIssue,
  type LintSeverity,
  preexistingTracks,
  readVrmLicense,
  type ValidationReport,
  type VrmLicenseInfo,
  writeAnimationGlb,
  writeVrma,
} from '@ekza-animator/io';
import {
  computeStepSchedule,
  humanoidRestWorldPositions,
  isHumanoidProgram,
  nodeForControl,
  type RigProgram,
  type TrackKey,
} from '@ekza-animator/rig';
import type { CharacterRuntime, EditorApp, PollResult } from '../types';
import { yieldToHost } from './host';
import { nameKey } from './names';
import { isRestrictedLicense } from './provenance';
import { EDITOR_VERSION } from './samples';
import { fpsValue, isRecord } from './util';

/** Kinds of the built-in exporters (io `BUILTIN_EXPORT_KINDS`). */
export type BuiltinExportKind = 'bake-into-model' | 'animation-glb' | 'vrma';
export const DEFAULT_FILE_PATTERN = '{character}_{clip}';
export const GLTF_MIME = 'model/gltf-binary';
const EKZA_SLOT_NAME = /^[a-z][a-z0-9_]{0,31}$/;
/** Profile kind that applies to every exporter (io `ANY_EXPORT_KIND`). */
const ANY_KIND = '*';

/** What an export request resolves to. */
export interface ExportSubject {
  readonly character: CharacterRecord;
  readonly runtime: CharacterRuntime;
  readonly clips: readonly ClipRecord[];
  readonly profile: ExportProfileDef | null;
  readonly license: VrmLicenseInfo | null;
}

const licenses = new WeakMap<GlbContainer, VrmLicenseInfo | null>();

/** The VRM licence of a model, read once per container (export polls run often). */
function licenseOf(container: GlbContainer): VrmLicenseInfo | null {
  let license = licenses.get(container);
  if (license === undefined) {
    license = readVrmLicense(container);
    licenses.set(container, license);
  }
  return license;
}

/** Shape check of an untyped request (keymaps, menus and the test API call operators untyped). */
export function requestProblem(req: unknown): string | null {
  if (!isRecord(req)) return 'expects an export request';
  if (typeof req['kind'] !== 'string') return 'expects a kind';
  if (typeof req['character'] !== 'string') return 'expects a character';
  if (!Array.isArray(req['clips']) || !(req['clips'] as readonly unknown[]).every((c) => typeof c === 'string')) {
    return 'expects a list of clips';
  }
  if (typeof req['fileNamePattern'] !== 'string') return 'expects a file name pattern';
  for (const flag of ['closeLoop', 'includeConstantTracks', 'acknowledgeLicense'] as const) {
    if (typeof req[flag] !== 'boolean') return `expects ${flag}`;
  }
  if (req['profile'] !== null && typeof req['profile'] !== 'string') return 'expects a profile id or null';
  return null;
}

/** Resolves a request against the document, or says why it cannot be exported. */
export function resolveExport(
  app: EditorApp,
  req: ExportRequest,
  kind: BuiltinExportKind,
): ExportSubject | { readonly problem: string; readonly code: string } {
  const fail = (problem: string, code = 'unsupported') => ({ problem, code });
  const character = app.store.get('characters', req.character);
  if (character === undefined) return fail('The character does not exist');
  const runtime = app.characters.get(character.id);
  if (runtime === undefined) return fail(`${character.name} is still loading`);
  if (req.clips.length === 0) return fail('Choose at least one clip');
  const clips: ClipRecord[] = [];
  for (const id of req.clips) {
    const clip = app.store.get('clips', id);
    if (clip === undefined || clip.character !== character.id)
      return fail(`Clip ${id} is not a clip of ${character.name}`);
    if (!clips.includes(clip)) clips.push(clip);
  }
  if (kind === 'vrma' && (runtime.skeleton.humanoid?.hips === undefined || !isHumanoidProgram(runtime.program))) {
    return fail('VRMA needs a humanoid (VRM) character');
  }
  let profile: ExportProfileDef | null = null;
  if (req.profile !== null) {
    profile = app.exportProfiles.get(req.profile) ?? null;
    if (profile === null) return fail(`Unknown export profile '${req.profile}'`);
    if (profile.kind !== kind && profile.kind !== ANY_KIND) return fail(`${profile.label} is not a ${kind} profile`);
  }
  const license = character.format === 'gltf' ? null : licenseOf(runtime.container);
  if (kind === 'bake-into-model' && isRestrictedLicense(license) && !req.acknowledgeLicense) {
    return fail(
      "The avatar's licence forbids modification or redistribution; acknowledge the licence to bake into it",
      'license-ack-required',
    );
  }
  const problem = preflightProblem({ character, runtime, clips, profile, license }, kind);
  return problem === null ? { character, runtime, clips, profile, license } : fail(problem);
}

function severityOf(profile: ExportProfileDef | null, rule: string, local: LintSeverity, ekza: LintSeverity) {
  const override = profile?.rules.find((r) => r.id === rule)?.severity;
  return override ?? (profile?.ekza === true ? ekza : local);
}

/** Preflight lints that can fail before baking (§4.11.10 step 1); errors only, warnings come from `lintExport`. */
export function preflightProblem(subject: ExportSubject, kind: BuiltinExportKind): string | null {
  const { clips, profile } = subject;
  const names = clips.map((clip) => clipExportName(clip));
  const keys = names.map(nameKey);
  const duplicate = names.find((_, i) => keys.indexOf(keys[i] as string) !== i);
  if (duplicate !== undefined) return `Two clips export as '${duplicate}'; rename one or give it another slot`;
  if (profile === null) return null;
  if (severityOf(profile, 'ekza.slot-name', 'warning', 'error') === 'error') {
    const bad = names.find((name) => !EKZA_SLOT_NAME.test(name) || name === 'tpose');
    if (bad !== undefined) return `'${bad}' is not a valid Ekza clip name (set a slot or rename the clip)`;
  }
  if (severityOf(profile, 'ekza.non-redistributable', 'warning', 'error') === 'error') {
    const bad = clips.find((clip) => clip.provenance.redistributable === 'no');
    if (bad !== undefined) return `${bad.name} is not redistributable`;
  }
  const required = profile.requiredClips ?? [];
  if (required.length > 0 && severityOf(profile, 'rendition_animation', 'warning', 'error') === 'error') {
    const present = new Set(keys);
    if (kind === 'bake-into-model') for (const name of modelAnimationNames(subject.runtime)) present.add(nameKey(name));
    const missing = required.filter((name) => !present.has(nameKey(name)));
    if (missing.length > 0) return `${profile.label} needs the clips ${missing.join(', ')}`;
  }
  return null;
}

/** Animation names already in the character's source file (they stay in a surgeon output). */
function modelAnimationNames(runtime: CharacterRuntime): readonly string[] {
  const animations = runtime.container.json['animations'];
  if (!Array.isArray(animations)) return [];
  return (animations as readonly unknown[]).flatMap((a) =>
    isRecord(a) && typeof a['name'] === 'string' ? [a['name']] : [],
  );
}

export function pollExport(app: EditorApp, req: unknown, kind: BuiltinExportKind): PollResult {
  const shape = requestProblem(req);
  if (shape !== null) return { ok: false, reason: shape };
  const subject = resolveExport(app, req as ExportRequest, kind);
  return 'problem' in subject ? { ok: false, reason: subject.problem } : true;
}

/** File extension of an export: the model's own for bakes ('vrm' for VRM sources), 'glb' or 'vrma'. */
export function exportExtension(app: EditorApp, req: ExportRequest, kind: BuiltinExportKind): string {
  if (kind === 'vrma') return 'vrma';
  if (kind === 'animation-glb') return 'glb';
  const character = app.store.get('characters', req.character);
  return character !== undefined && character.format !== 'gltf' ? 'vrm' : 'glb';
}

/** Depth of a skeleton node (scene roots: 0). */
function depthOf(program: RigProgram, node: number): number {
  let depth = 0;
  for (let n = program.skeleton.nodes[node]?.parent ?? -1; n !== -1; n = program.skeleton.nodes[n]?.parent ?? -1) {
    depth++;
  }
  return depth;
}

/**
 * Node whose X/Z root motion 'in-place' locks (§4.11.10 step 3): hips on humanoids; on generic rigs the topmost
 * driven joint whose control has translation keys in the clip; null when there is none (the option is unavailable).
 */
export function inPlaceNode(view: ReadView, program: RigProgram, clip: ClipRecord): number | null {
  const hips = program.skeleton.humanoid?.hips;
  if (hips !== undefined && isHumanoidProgram(program)) return hips;
  const base = view.query.baseLayer(clip.id);
  if (base === undefined) return null;
  let best: { node: number; depth: number } | null = null;
  const seen = new Set<ControlId>();
  for (const curve of view.query.curvesOfClip(clip.id)) {
    if (curve.layer !== base.id || seen.has(curve.control)) continue;
    if (curve.channel !== 'tx' && curve.channel !== 'ty' && curve.channel !== 'tz') continue;
    if (view.query.keysOfCurve(curve.id).length === 0) continue;
    seen.add(curve.control);
    const node = nodeForControl(program, curve.control);
    if (node === -1) continue;
    const depth = depthOf(program, node);
    if (best === null || depth < best.depth || (depth === best.depth && node < best.node)) best = { node, depth };
  }
  return best?.node ?? null;
}

/** `ekza_animation_v1` clip entry of a clip (§4.11.10 step 4, ADR 0010 §2). */
export function clipMeta(clip: ClipRecord, index: number): EkzaClipMetaV1 {
  const fps = fpsValue(clip.fps);
  return {
    index,
    name: clipExportName(clip),
    slot: clip.slot,
    loop: clip.loop,
    fps,
    durationSeconds: clipFramesToSeconds(clip.range.end - clip.range.start, clip.fps),
    rootMotion: clip.rootMotion,
    contactSeconds: clip.contact === null ? null : clipFramesToSeconds(clip.contact - clip.range.start, clip.fps),
    tags: clip.tags,
    derivedFrom: clip.provenance.derivedFrom,
    redistributable: clip.provenance.redistributable,
  };
}

/** Integer bake range of a clip (clip frames, inclusive). */
function bakeRange(clip: ClipRecord): { readonly start: Frame; readonly end: Frame } {
  const start = Math.round(clip.range.start);
  return { start, end: Math.max(start, Math.round(clip.range.end)) };
}

function trackKeys(clip: BakedClip): Set<TrackKey> {
  return new Set(clip.tracks.map((track): TrackKey => `${track.node}/${track.path}`));
}

function containsAll(set: ReadonlySet<TrackKey>, required: ReadonlySet<TrackKey>): boolean {
  for (const key of required) if (!set.has(key)) return false;
  return true;
}

interface ClipBake {
  readonly clip: ClipRecord;
  readonly options: Omit<BakeOptions, 'requiredTracks'>;
}

function fileClipToken(clips: readonly ClipRecord[]): string {
  const names = clips.map((clip) => clipExportName(clip));
  if (names.length <= 3) return names.join('-');
  return `${names.length}_clips`;
}

/** Runs an export: bake every clip, write the file(s), validate when the host can. */
export async function runExport(
  app: EditorApp,
  req: ExportRequest,
  kind: BuiltinExportKind,
): Promise<readonly ExportArtifact[]> {
  const subject = resolveExport(app, req, kind);
  if ('problem' in subject) throw new EkzaError(subject.code, subject.problem);
  const { character, runtime, clips, profile } = subject;
  for (const clip of clips) await app.store.open(`clip:${clip.id}`);
  const program = runtime.program;
  const skeleton = runtime.skeleton;
  const target = kind === 'vrma' ? 'humanoid' : 'raw';
  const warnings: LintIssue[] = [];

  const bakes: ClipBake[] = clips.map((clip, index) => {
    const range = bakeRange(clip);
    let rootMotion = clip.rootMotion;
    const node = inPlaceNode(app.store, program, clip);
    if (rootMotion === 'in-place' && node === null && target === 'raw') {
      rootMotion = 'hips';
      warnings.push({
        code: 'export.in-place-unavailable',
        severity: 'warning',
        message: `${clip.name}: no joint with translation keys, so root motion 'in-place' was exported as 'hips'`,
      });
    }
    return {
      clip,
      options: {
        name: clipExportName(clip),
        fps: clip.fps,
        range,
        target,
        closeLoop: req.closeLoop && clip.loop,
        loop: clip.loop,
        rootMotion,
        inPlaceNode: node,
        stepSchedule: computeStepSchedule(program, runtime.sampler(clip.id), range, target),
        meta: clipMeta(clip, index),
      },
    };
  });

  const bake = (job: ClipBake, requiredTracks: ReadonlySet<TrackKey>): BakedClip => {
    return bakeClip(
      {
        program,
        evaluate: (frame, out) =>
          app.evaluation.evaluateAt(character.id, job.clip.id, frame, out, { withOverrides: false }),
      },
      { ...job.options, requiredTracks },
    );
  };

  const artifacts: ExportArtifact[] = [];
  const meta = (baked: readonly BakedClip[], rig: EkzaAnimationV1['rig']): EkzaAnimationV1 =>
    ekzaAnimationMeta(baked, rig, {
      toolVersion: EDITOR_VERSION,
      projectSha256: null,
      baseSha256: runtime.container.sha256,
    });
  const fps = fpsValue(clips[0]?.fps ?? { num: 30, den: 1 });
  const pattern = req.fileNamePattern.trim() === '' ? DEFAULT_FILE_PATTERN : req.fileNamePattern;

  if (kind === 'vrma') {
    const humanoidRestWorld = humanoidRestWorldPositions(skeleton);
    for (const job of bakes) {
      const baked = bake(job, new Set());
      await yieldToHost();
      const fileName = exportFileName(
        pattern,
        { character: character.name, clip: job.options.name, fps: fpsValue(job.clip.fps) },
        'vrma',
      );
      artifacts.push(
        await writeVrma(skeleton, baked, { meta: meta([baked], 'vrm-humanoid'), fileName, profile, humanoidRestWorld }),
      );
    }
  } else {
    const base: Set<TrackKey> =
      kind === 'bake-into-model' && req.includeConstantTracks
        ? new Set(
            preexistingTracks(
              runtime.container,
              skeleton,
              bakes.map((job) => job.options.name),
            ),
          )
        : new Set();
    const baked: BakedClip[] = [];
    for (const job of bakes) {
      baked.push(bake(job, base));
      await yieldToHost();
    }
    if (req.includeConstantTracks && baked.length > 1) {
      // Self-contained clips (ADR 0005 §3): every clip of the file carries every track any of them animates.
      const union = new Set(base);
      for (const clip of baked) for (const key of trackKeys(clip)) union.add(key);
      for (let i = 0; i < baked.length; i++) {
        if (containsAll(trackKeys(baked[i] as BakedClip), union)) continue;
        baked[i] = bake(bakes[i] as ClipBake, union);
        await yieldToHost();
      }
    }
    const rig: EkzaAnimationV1['rig'] =
      kind === 'bake-into-model' && character.format !== 'gltf' ? 'vrm-humanoid' : 'gltf-nodes';
    const fileName = exportFileName(
      pattern,
      { character: character.name, clip: fileClipToken(clips), fps },
      exportExtension(app, req, kind),
    );
    const opts = { meta: meta(baked, rig), fileName, profile };
    artifacts.push(
      kind === 'bake-into-model'
        ? await bakeIntoModel(runtime.container, skeleton, baked, opts)
        : await writeAnimationGlb(skeleton, baked, opts),
    );
  }

  const withWarnings = artifacts.map((artifact) =>
    withReadBackLint(warnings.length === 0 ? artifact : { ...artifact, lints: [...artifact.lints, ...warnings] }),
  );
  return validateArtifacts(app, withWarnings, kind === 'bake-into-model' ? runtime.container.bytes : null);
}

/** Lint code of a failed read-back check. */
export const READ_BACK_LINT = 'export.read-back';

/**
 * §4.11.10 step 5, ADR 0005 §9: a failed read-back check (the written file does not reproduce the baked samples within
 * 1e-4 rad / 1e-5 m) is an error lint, so it blocks the download like any other error. In the app the read-back is
 * the only check of the written bytes (no validator worker in the MVP). Idempotent; applied to every artifact,
 * whichever exporter wrote it.
 */
export function withReadBackLint(artifact: ExportArtifact): ExportArtifact {
  const report = artifact.readBack;
  if (report === null || report.ok || artifact.lints.some((lint) => lint.code === READ_BACK_LINT)) return artifact;
  const lint: LintIssue = {
    code: READ_BACK_LINT,
    severity: 'error',
    message:
      `Read-back check failed: max rotation error ${report.maxRotationErrorRad.toPrecision(3)} rad, ` +
      `max translation error ${report.maxTranslationErrorM.toPrecision(3)} m ` +
      `(${report.animations} animation${report.animations === 1 ? '' : 's'}, ${report.channels} channels read)`,
  };
  return { ...artifact, lints: [...artifact.lints, lint] };
}

/**
 * Adds the host's glTF-Validator report (`services.validate`, tests and the M1-stretch worker) to each artifact.
 * Policy §4.11.13: fresh writers must have no errors; surgeon outputs no error whose (code, pointer) is absent from
 * the source's report. Violations become error lints, which block the download.
 */
async function validateArtifacts(
  app: EditorApp,
  artifacts: readonly ExportArtifact[],
  source: Uint8Array | null,
): Promise<readonly ExportArtifact[]> {
  const validate = app.services.validate;
  if (validate === null) return artifacts;
  const sourceReport: ValidationReport | null = source === null ? null : await validate(source);
  const out: ExportArtifact[] = [];
  for (const artifact of artifacts) {
    const report = await validate(artifact.bytes);
    const issues =
      sourceReport === null
        ? report.issues.filter((issue) => issue.severity === 0)
        : compareValidation(sourceReport, report);
    const lints: LintIssue[] = issues.map((issue) => ({
      code: `validator.${issue.code}`,
      severity: 'error',
      message: `glTF-Validator: ${issue.message}`,
      ...(issue.pointer === undefined ? {} : { pointer: issue.pointer }),
    }));
    out.push({ ...artifact, validation: report, lints: [...artifact.lints, ...lints] });
  }
  return out;
}

/** Error lints block the download (§4.11.10 step 5). */
export function blockingLints(artifact: ExportArtifact): readonly LintIssue[] {
  return artifact.lints.filter((lint) => lint.severity === 'error');
}
