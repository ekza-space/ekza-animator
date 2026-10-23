// ③ Rig step (AUTORIG-SPEC §5.4, §6.1, §8.1–§8.3; D4): the progress sheet of `autorig.rig`, review with the motion
// test, *Adjust joints* (front │ side │ persp, the M6b joint tools, Done rebinds), *Paint weights* (C6's tool with the
// reduced controls), the Validation summary and the `rig` slice. This module is in `/autorig`'s first visit (the
// frame's step registry and the session store import it), so it holds only the slice's default, the pane grid and the
// progress sheet's key guard (`./exclusive`, installed here, at import, so it runs before the frame's key scope, §4.5);
// the slice's reducers (`./slice`), the view (`./RigStep`), the step's start (`./enter`) and the runners are lazy chunks.
import type { WizardContext } from '../../shell/context';
import type { StepPane, StepViewProps } from '../../shell/steps';
import type { AutoRigRigSlice, AutoRigSession } from '../../types';
import { markerPanes, MARKER_PANE_IDS, screenClass } from '../markers';
import type { ComponentType } from 'react';
import { installExclusiveKeys } from './exclusive';

// §4.5: before the frame mounts (and adds its own capture listener), so the sheet's guard runs first
installExclusiveKeys();

export const RIG_SLICE: AutoRigRigSlice = {
  sub: 'review',
  motionTest: true,
  motionClip: 'walk',
  paintedSinceBind: false,
  rigidParts: null,
  straightened: null,
};

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
