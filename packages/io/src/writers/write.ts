// WP-4 stubs: final signatures (MVP-SPEC §7 WP-4, §4.11.12); bodies throw until the writers land.
import { EkzaError } from '@ekza-animator/anim-core';
import type { ClipRecord, HumanBoneName } from '@ekza-animator/doc';
import type { SkeletonDesc } from '@ekza-animator/rig';
import type { BakedClip, EkzaAnimationV1, ExportArtifact, ExportProfileDef } from '../types';

export function writeAnimationGlb(
  _skeleton: SkeletonDesc,
  _clips: readonly BakedClip[],
  _opts: { readonly meta: EkzaAnimationV1; readonly fileName: string; readonly profile: ExportProfileDef | null },
): Promise<ExportArtifact> {
  throw new EkzaError('not-implemented', 'io.writeAnimationGlb');
}

export function writeVrma(
  _skeleton: SkeletonDesc,
  _clip: BakedClip,
  _opts: {
    readonly meta: EkzaAnimationV1;
    readonly fileName: string;
    readonly profile: ExportProfileDef | null;
    readonly humanoidRestWorld: Readonly<Partial<Record<HumanBoneName, readonly [number, number, number]>>>;
  },
): Promise<ExportArtifact> {
  throw new EkzaError('not-implemented', 'io.writeVrma');
}

/** slot ?? sanitized name. */
export function clipExportName(_clip: ClipRecord): string {
  throw new EkzaError('not-implemented', 'io.clipExportName');
}

export function exportFileName(
  _pattern: string,
  _tokens: { readonly character: string; readonly clip: string; readonly fps: number },
  _ext: string,
): string {
  throw new EkzaError('not-implemented', 'io.exportFileName');
}
