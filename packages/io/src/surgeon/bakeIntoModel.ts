// WP-4 stubs: final signatures (MVP-SPEC §7 WP-4, §4.11.11); bodies throw until the surgeon lands.
import { EkzaError } from '@ekza-animator/anim-core';
import type { SkeletonDesc, TrackKey } from '@ekza-animator/rig';
import type { BakedClip, EkzaAnimationV1, ExportArtifact, ExportProfileDef, GlbContainer } from '../types';

/** Node indices (SkeletonDesc) and paths animated by the original file's animations that stay after a re-bake. */
export function preexistingTracks(
  _original: GlbContainer,
  _skeleton: SkeletonDesc,
  _replacing: readonly string[],
): ReadonlySet<TrackKey> {
  throw new EkzaError('not-implemented', 'io.preexistingTracks');
}

export function bakeIntoModel(
  _original: GlbContainer,
  _skeleton: SkeletonDesc,
  _clips: readonly BakedClip[],
  _opts: { readonly meta: EkzaAnimationV1; readonly fileName: string; readonly profile: ExportProfileDef | null },
): Promise<ExportArtifact> {
  throw new EkzaError('not-implemented', 'io.bakeIntoModel');
}
