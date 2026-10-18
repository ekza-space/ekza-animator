// Shared tail of every exporter: lints for the chosen profile, the read-back check, SHA-256 and stats.
import type { SkeletonDesc } from '@ekza-animator/rig';
import { sha256Hex } from '../hash/sha256';
import { type LintContext, lintExportWithContext } from '../lint/lintExport';
import type { BakedClip, ExportArtifact, ExportKind, ExportProfileDef, LintIssue, ReductionStats } from '../types';
import { readBackCheck } from '../validate/readBack';

export interface ArtifactInput {
  readonly kind: ExportKind;
  readonly fileName: string;
  readonly bytes: Uint8Array;
  readonly clips: readonly BakedClip[];
  readonly skeleton: SkeletonDesc;
  readonly profile: ExportProfileDef | null;
  /** Issues found while writing (skipped tracks, surgeon warnings). */
  readonly writerLints: readonly LintIssue[];
  readonly stats: ExportArtifact['stats'];
  readonly context?: LintContext;
}

/** The export-side reduction of the clips of one file (M2a §5.16): summed counts, worst errors; undefined if none. */
export function reductionOf(clips: readonly BakedClip[]): ReductionStats | undefined {
  let found = false;
  let samplesBefore = 0;
  let samplesAfter = 0;
  let maxRotationErrorRad = 0;
  let maxTranslationErrorM = 0;
  for (const clip of clips) {
    const r = clip.reduction;
    if (r === undefined) continue;
    found = true;
    samplesBefore += r.samplesBefore;
    samplesAfter += r.samplesAfter;
    maxRotationErrorRad = Math.max(maxRotationErrorRad, r.maxRotationErrorRad);
    maxTranslationErrorM = Math.max(maxTranslationErrorM, r.maxTranslationErrorM);
  }
  return found ? { samplesBefore, samplesAfter, maxRotationErrorRad, maxTranslationErrorM } : undefined;
}

export async function finalizeArtifact(input: ArtifactInput): Promise<ExportArtifact> {
  const reduction = reductionOf(input.clips);
  const lints = [
    ...input.clips.flatMap((clip) => clip.warnings),
    ...input.writerLints,
    ...(await lintExportWithContext(input.kind, input.bytes, input.profile, input.context ?? {})),
  ];
  return {
    kind: input.kind,
    fileName: input.fileName,
    mime: 'model/gltf-binary',
    bytes: input.bytes,
    sha256: await sha256Hex(input.bytes),
    lints,
    readBack: await readBackCheck(input.kind, input.bytes, input.clips, input.skeleton),
    validation: null,
    stats: reduction === undefined ? input.stats : { ...input.stats, reduction },
  };
}
