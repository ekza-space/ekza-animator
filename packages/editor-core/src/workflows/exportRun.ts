// The export pipeline behind `runExport` (MVP-SPEC §4.11.10, ADR 0005), loaded with a dynamic import on the first
// export (M2A-SPEC §5.21.2): per clip a `PoseSource` over the character's runtime evaluates the clip without session
// overrides; io bakes integer frames (step schedule from rig), optionally reduces the sampled tracks (§5.16), writes
// the file(s), lints and reads them back; the host's validator report is added when it has one. Async, no document
// writes; yields between clips.
import { EkzaError, type Frame } from '@ekza-animator/anim-core';
import type { ClipRecord } from '@ekza-animator/doc';
import {
  type BakedClip,
  type BakeOptions,
  clipExportName,
  type EkzaAnimationV1,
  type ExportArtifact,
  type ExportReduceSpec,
  type ExportRequest,
  exportFileName,
  type LintIssue,
  type ValidationReport,
} from '@ekza-animator/io';
import { computeStepSchedule, humanoidRestWorldPositions, type TrackKey } from '@ekza-animator/rig';
import type { EditorApp } from '../types';
import {
  type BuiltinExportKind,
  clipMeta,
  DEFAULT_FILE_PATTERN,
  exportExtension,
  exportNameOf,
  inPlaceNode,
  influenceKeepFrames,
  loadWritePath,
  resolveExport,
  withReadBackLint,
  type WritePath,
} from './export';
import { yieldToHost } from './host';
import { characterEdits } from './meshDisplay';
import { EDITOR_VERSION } from './samples';
import { fpsValue } from './util';

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
export async function runExportPipeline(
  app: EditorApp,
  req: ExportRequest,
  kind: BuiltinExportKind,
): Promise<readonly ExportArtifact[]> {
  const subject = resolveExport(app, req, kind);
  if ('problem' in subject) throw new EkzaError(subject.code, subject.problem);
  const { character, runtime, clips, profile } = subject;
  const io = await loadWritePath();
  for (const clip of clips) await app.store.open(`clip:${clip.id}`);
  const program = runtime.program;
  const skeleton = runtime.skeleton;
  const target = kind === 'vrma' ? 'humanoid' : 'raw';
  const warnings: LintIssue[] = [];
  const reduceSpec: ExportReduceSpec | null = req.reduce ?? null;
  const leverArm = reduceSpec === null ? null : io.trackLeverArms(skeleton, target);

  const bakes: ClipBake[] = clips.map((clip, index) => {
    const name = exportNameOf(clip, kind, character, runtime.container);
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
    const sampler = runtime.sampler(clip.id);
    return {
      clip,
      options: {
        name,
        fps: clip.fps,
        range,
        target,
        closeLoop: req.closeLoop && clip.loop,
        loop: clip.loop,
        rootMotion,
        inPlaceNode: node,
        stepSchedule: computeStepSchedule(program, sampler, range, target),
        meta: clipMeta(clip, index, name),
        ...(reduceSpec === null || leverArm === null
          ? {}
          : {
              reduce: {
                spec: reduceSpec,
                height: skeleton.height,
                leverArm,
                keep: influenceKeepFrames(program, sampler, range, target),
              },
            }),
      },
    };
  });

  const bake = (job: ClipBake, requiredTracks: ReadonlySet<TrackKey>): BakedClip => {
    return io.bakeClip(
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
    io.ekzaAnimationMeta(baked, rig, {
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
        await io.writeVrma(skeleton, baked, {
          meta: meta([baked], 'vrm-humanoid'),
          fileName,
          profile,
          humanoidRestWorld,
        }),
      );
    }
  } else {
    const base: Set<TrackKey> =
      kind === 'bake-into-model' && req.includeConstantTracks
        ? new Set(
            io.preexistingTracks(
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
    // M6a (M6A-SPEC §5.22, B8): the character's edited meshes go in through the surgeon's geometry step (marker v2).
    const geometry =
      kind === 'bake-into-model'
        ? await characterEdits(app, character.id, {
            dropTangents: (req as { dropTangents?: unknown }).dropTangents === true,
          })
        : [];
    artifacts.push(
      kind === 'bake-into-model'
        ? await io.bakeIntoModel(runtime.container, skeleton, baked, geometry.length > 0 ? { ...opts, geometry } : opts)
        : await io.writeAnimationGlb(skeleton, baked, opts),
    );
  }

  const withWarnings = artifacts.map((artifact) =>
    withReadBackLint(warnings.length === 0 ? artifact : { ...artifact, lints: [...artifact.lints, ...warnings] }),
  );
  return validateArtifacts(app, io, withWarnings, kind === 'bake-into-model' ? runtime.container.bytes : null);
}

/**
 * Adds the host's glTF-Validator report (`services.validate`, tests and the M1-stretch worker) to each artifact.
 * Policy §4.11.13: fresh writers must have no errors; surgeon outputs no error whose (code, pointer) is absent from
 * the source's report. Violations become error lints, which block the download.
 */
async function validateArtifacts(
  app: EditorApp,
  io: WritePath,
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
        : io.compareValidation(sourceReport, report);
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
