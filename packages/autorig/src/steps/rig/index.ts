// ③ Rig step (AUTORIG-SPEC §5.4, §6.1, §8.1–§8.3; D4): the progress sheet of `autorig.rig`, review with the motion
// test, *Adjust joints* (front │ side │ persp, the M6b joint tools, Done rebinds), *Paint weights* (C6's tool with the
// reduced controls), the Validation summary and the `rig` slice. This module is in `/autorig`'s first visit (the
// frame's step registry and the session store import it), so it holds only the slice, its reducers and the pane grid;
// the view (`./RigStep`), the step's start (`./enter`) and the runners are lazy chunks.
import type { WizardContext } from '../../shell/context';
import type { StepPane, StepViewProps } from '../../shell/steps';
import type { AutoRigRigSlice, AutoRigSession } from '../../types';
import { markerPanes, MARKER_PANE_IDS, screenClass } from '../markers';
import type { ComponentType } from 'react';

export const RIG_SLICE: AutoRigRigSlice = {
  sub: 'review',
  motionTest: true,
  motionClip: 'walk',
  paintedSinceBind: false,
};

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

/** The ③ pane grid (§4.2): *Adjust joints* in front │ side │ persp (a phone shows the 3D pane), else one persp pane. */
export function rigPanes(session: Pick<AutoRigSession, 'rig' | 'markers'>, width: number): readonly StepPane[] {
  const screen = screenClass(width);
  if (session.rig.sub !== 'adjust' || screen === 'phone') return [{ id: MARKER_PANE_IDS.persp }];
  return markerPanes(session.markers, screen);
}

export const stepPanes = (session: AutoRigSession): readonly StepPane[] =>
  rigPanes(session, typeof window === 'undefined' ? 1440 : window.innerWidth);

/** §4.2's step start: the sub-tool's rig mode (a lazy chunk). */
export const stepEnter = (ctx: WizardContext): Promise<void> =>
  import('./enter').then((module) => module.enterRig(ctx));

export const stepView = (): Promise<{ readonly default: ComponentType<StepViewProps> }> => import('./RigStep');
