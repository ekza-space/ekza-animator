// M2A-SPEC §5.16 export-side key reduction (FR-EXP-12): contract stubs landed by A0 (§3 rule 1), implemented by A5.
// Nothing calls them while `ExportRequest.reduce` is absent or null (the M1 export path).
import { EkzaError, type Frame } from '@ekza-animator/anim-core';
import type { SkeletonDesc, TrackKey } from '@ekza-animator/rig';
import type { BakedClip, ExportReduceSpec, ReductionStats } from '../types';

/** §5.16: error-bounded reduction of a baked clip's sampled tracks (A5). */
export function reduceBakedClip(
  _clip: BakedClip,
  _opts: {
    readonly spec: ExportReduceSpec;
    readonly height: number;
    readonly leverArm: ReadonlyMap<number, number>;
    readonly keep: ReadonlyMap<TrackKey, readonly Frame[]>;
  },
): { readonly clip: BakedClip; readonly stats: ReductionStats } {
  throw new EkzaError('not-implemented', 'io.reduceBakedClip');
}

/** L_j of R02 §6.4 per SkeletonDesc node (raw) or HUMAN_BONE_NAMES index (humanoid) (A5). */
export function trackLeverArms(_skeleton: SkeletonDesc, _target: 'raw' | 'humanoid'): ReadonlyMap<number, number> {
  throw new EkzaError('not-implemented', 'io.trackLeverArms');
}
