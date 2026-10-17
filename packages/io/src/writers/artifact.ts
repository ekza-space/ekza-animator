// Shared tail of every exporter: lints for the chosen profile, the read-back check, SHA-256 and stats.
import type { SkeletonDesc } from '@ekza-animator/rig';
import { sha256Hex } from '../hash/sha256';
import { type LintContext, lintExportWithContext } from '../lint/lintExport';
import type { BakedClip, ExportArtifact, ExportKind, ExportProfileDef, LintIssue } from '../types';
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

export async function finalizeArtifact(input: ArtifactInput): Promise<ExportArtifact> {
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
    stats: input.stats,
  };
}
