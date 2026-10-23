// The `rig` slice's reducers and constants (AUTORIG-SPEC §4.3, §5.4; D4; lazy with ③'s view): the sub-tools and the
// rig mode each works in, the motion test's clips, and `paintedSinceBind`'s rule (fed by `./painted`).
import type { AutoRigRigSlice } from '../../types';

export type RigSub = AutoRigRigSlice['sub'];

/** The rig mode each sub-tool works in (§4.2: review in Object, Adjust in Skeleton, Paint in Skin). */
export const SUB_MODE: Readonly<Record<RigSub, 'object' | 'skeleton' | 'skin'>> = {
  review: 'object',
  adjust: 'skeleton',
  paint: 'skin',
};

/** The motion test's clips (starter-pack ids, §5.4): Walk, Sword attack, Dance. */
export const MOTION_CLIPS = ['walk', 'sword-attack', 'dance'] as const;

/**
 * Reducer of `paintedSinceBind` (§4.3, §5.4): a finished document run with a history step sets it when it was a weight
 * edit (`skin.weights.*`) and clears it when it was a bind (`skin.bind`, or Create Skeleton / its refit, which binds
 * a bound skeleton again); any other run leaves it. Conservative: an undone stroke still counts.
 */
export function paintedAfterRun(id: string, painted: boolean): boolean {
  if (id.startsWith('skin.weights.')) return true;
  if (id === 'skin.bind' || id === 'skel.quickRig.commit') return false;
  return painted;
}

/** Whether a run can change `paintedSinceBind` (the listener watches only these). */
export const paintTracked = (id: string): boolean =>
  id.startsWith('skin.weights.') || id === 'skin.bind' || id === 'skel.quickRig.commit';

/** Reducer: a sub-tool (*Adjust joints* and *Paint weights* stop nothing else in the slice). */
export function withSub(slice: AutoRigRigSlice, sub: RigSub): Partial<AutoRigRigSlice> {
  return slice.sub === sub ? {} : { sub };
}

/** Reducer: the motion test's clip; picking one turns the test on. */
export function withMotionClip(slice: AutoRigRigSlice, clip: string): Partial<AutoRigRigSlice> {
  return slice.motionClip === clip && slice.motionTest ? {} : { motionClip: clip, motionTest: true };
}
