// Export pipeline (MVP-SPEC §4.11.10, ADR 0005): per clip a `PoseSource` over the character's runtime evaluates the
// clip without session overrides; io bakes integer frames (step schedule from rig), optionally reduces the sampled
// tracks (M2A-SPEC §5.16), writes the file (surgeon, animation-only GLB or one VRMA per clip) with
// `ekza_animation_v1` metadata, lints it and reads it back. Async, no document writes; yields between clips.
//
// This module holds the request checks, polls and helpers the editor needs before an export; the pipeline itself is
// `exportRun.ts`, and the bake, writers, surgeon, lints and read-back come from `@ekza-animator/io/write`. Both load
// by a dynamic import the first time an export runs (M2A-SPEC §4.4, §5.21.2: glTF Transform and the pipeline stay
// off the editor's initial route).
import type { Frame } from '@ekza-animator/anim-core';
import type { CharacterRecord, ClipRecord, ControlId, ReadView } from '@ekza-animator/doc';
import {
  clipExportName,
  clipFramesToSeconds,
  type EkzaClipMetaV1,
  type ExportArtifact,
  type ExportProfileDef,
  type ExportRequest,
  type GlbContainer,
  type LintIssue,
  type LintSeverity,
  readVrmLicense,
  type VrmLicenseInfo,
} from '@ekza-animator/io';
import type * as WriteModule from '@ekza-animator/io/write';
import {
  type ClipSampler,
  computeInfluenceKeyTimes,
  isHumanoidProgram,
  nodeForControl,
  type RigProgram,
  type TrackKey,
} from '@ekza-animator/rig';
import type { CharacterRuntime, EditorApp, PollResult } from '../types';
import { nameKey, sanitizeClipName } from './names';
import { isRestrictedLicense } from './provenance';
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

/** The export path module (`@ekza-animator/io/write`), imported once on first use. */
export type WritePath = typeof WriteModule;
let writePath: Promise<WritePath> | null = null;

/**
 * Loads `@ekza-animator/io/write` (bake, writers, surgeon, lints, read-back; M2A-SPEC §4.4). The first call starts
 * the dynamic import, later calls share it; a failed load is retried by the next call. Hosts call it on intent (the
 * Export dialog opening) so the first export does not wait for the chunk.
 */
export function loadWritePath(): Promise<WritePath> {
  if (writePath === null) {
    writePath = import('@ekza-animator/io/write');
    writePath.catch(() => {
      writePath = null;
    });
  }
  return writePath;
}

/**
 * Intent prefetch of everything the first export needs: the pipeline (`exportRun.ts`) and the io write path. The
 * Export dialog and an open File menu call it (M2A-SPEC §5.21.2).
 */
export function preloadExportPath(): Promise<void> {
  return Promise.all([import('./exportRun'), loadWritePath()]).then(() => undefined);
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
  if (req['reduce'] !== undefined && req['reduce'] !== null && reduceSpecProblem(req['reduce']) !== null) {
    return reduceSpecProblem(req['reduce']);
  }
  return null;
}

/** Shape check of `ExportRequest.reduce` (M2A-SPEC §4.4): four finite tolerances, none negative. */
export function reduceSpecProblem(spec: unknown): string | null {
  if (!isRecord(spec)) return 'expects reduce: { positionM, rotationCapRad, minLeverM, scaleRel } or null';
  for (const field of ['positionM', 'rotationCapRad', 'minLeverM', 'scaleRel'] as const) {
    const value = spec[field];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      return `reduce.${field} must be a finite number ≥ 0`;
    }
  }
  return null;
}

/**
 * Per-track keep frames of the §5.16 keep set from the influencing curves' key times (`computeInfluenceKeyTimes`,
 * rig A1); the first, last, loop-closure, contact and step-discontinuity samples are kept by the reducer itself
 * (M2A-SPEC §8 A5). Since integration a rig without the function is an error, not an empty term (§3 rule 4).
 */
export function influenceKeepFrames(
  program: RigProgram,
  sampler: ClipSampler,
  range: { readonly start: Frame; readonly end: Frame },
  target: 'raw' | 'humanoid',
): ReadonlyMap<TrackKey, readonly Frame[]> {
  return computeInfluenceKeyTimes(program, sampler, range, target);
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

/**
 * The animation name a clip is written under (§4.11.10 step 6, §4.11.11 rule 6). In a bake into the model, a clip
 * imported from one of that model's own animations and not renamed or given a slot since keeps the animation's
 * original name, so the bake replaces its source in place even when import had to sanitize the name (`a:b|c` →
 * `a_b_c`; acceptance round 2). Everywhere else: the slot or the sanitized clip name (`clipExportName`).
 */
export function exportNameOf(
  clip: ClipRecord,
  kind: BuiltinExportKind,
  character: CharacterRecord,
  container: GlbContainer,
): string {
  const fallback = clipExportName(clip);
  if (kind !== 'bake-into-model' || (clip.slot !== null && clip.slot.trim() !== '')) return fallback;
  const source = clip.source;
  if (source.kind !== 'embedded' || source.asset !== character.asset) return fallback;
  if (nameKey(clip.name) !== nameKey(sanitizeClipName(source.animationName))) return fallback; // renamed since
  const animations = container.json['animations'];
  const original = Array.isArray(animations) ? (animations as readonly unknown[])[source.animationIndex] : undefined;
  if (!isRecord(original) || original['name'] !== source.animationName || source.animationName.trim() === '') {
    return fallback;
  }
  return source.animationName;
}

/** Preflight lints that can fail before baking (§4.11.10 step 1); errors only, warnings come from `lintExport`. */
export function preflightProblem(subject: ExportSubject, kind: BuiltinExportKind): string | null {
  const { clips, profile } = subject;
  const names = clips.map((clip) => exportNameOf(clip, kind, subject.character, subject.runtime.container));
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

/** `ekza_animation_v1` clip entry of a clip (§4.11.10 step 4, ADR 0010 §2); `name` is its animation's name. */
export function clipMeta(clip: ClipRecord, index: number, name: string = clipExportName(clip)): EkzaClipMetaV1 {
  const fps = fpsValue(clip.fps);
  return {
    index,
    name,
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

/**
 * Runs an export: bake every clip, write the file(s), validate when the host can. The pipeline itself
 * (`exportRun.ts`) is a lazy chunk like the io/write path it drives (M2A-SPEC §5.21.2).
 */
export async function runExport(
  app: EditorApp,
  req: ExportRequest,
  kind: BuiltinExportKind,
): Promise<readonly ExportArtifact[]> {
  const { runExportPipeline } = await import('./exportRun');
  return runExportPipeline(app, req, kind);
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
      `(${report.animations} animation${report.animations === 1 ? '' : 's'}, ` +
      `${report.channels} channel${report.channels === 1 ? '' : 's'} read)`,
  };
  return { ...artifact, lints: [...artifact.lints, lint] };
}

/** Error lints block the download (§4.11.10 step 5). */
export function blockingLints(artifact: ExportArtifact): readonly LintIssue[] {
  return artifact.lints.filter((lint) => lint.severity === 'error');
}
