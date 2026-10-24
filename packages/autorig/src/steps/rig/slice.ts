// The `rig` slice's reducers and constants (AUTORIG-SPEC §4.3, §5.4; D4; lazy with ③'s view): the sub-tools and the
// rig mode each works in, the motion test's clips, and `paintedSinceBind`'s rule (fed by `./painted`; the clips and
// the rule are editor-core's `autorigFlow`, T5b).
import type { AutoRigRigSlice } from '../../types';

export type RigSub = AutoRigRigSlice['sub'];

/** The rig mode each sub-tool works in (§4.2: review in Object, Adjust in Skeleton, Paint in Skin). */
export const SUB_MODE: Readonly<Record<RigSub, 'object' | 'skeleton' | 'skin'>> = {
  review: 'object',
  adjust: 'skeleton',
  paint: 'skin',
};

/** The motion test's clips (starter-pack ids, §5.4): Walk, Sword attack, Dance (editor-core's `autorigFlow`). */
export { MOTION_CLIPS } from '@ekza-studio/editor-core';

/**
 * Reducer of `paintedSinceBind` (§4.3, §5.4; editor-core's `autorigFlow`): a weight edit sets it, a bind clears it;
 * `paintTracked` names the runs that can change it.
 */
export { paintedAfterRun, paintTracked } from '@ekza-studio/editor-core';

/** Reducer: a sub-tool (*Adjust joints* and *Paint weights* stop nothing else in the slice). */
export function withSub(slice: AutoRigRigSlice, sub: RigSub): Partial<AutoRigRigSlice> {
  return slice.sub === sub ? {} : { sub };
}

/** Reducer: the motion test's clip; picking one turns the test on. */
export function withMotionClip(slice: AutoRigRigSlice, clip: string): Partial<AutoRigRigSlice> {
  return slice.motionClip === clip && slice.motionTest ? {} : { motionClip: clip, motionTest: true };
}
