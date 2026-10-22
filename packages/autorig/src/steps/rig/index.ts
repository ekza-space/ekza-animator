// ③ Rig step (AUTORIG-SPEC §5.4; D0 stub, D4 owns it): the progress sheet, review with the motion test, Adjust
// joints, Paint weights, the Validation summary, the `rig` slice, its reducers and the `paintedSinceBind` listener.
// D0 lands only the slice's default.
import type { AutoRigRigSlice } from '../../types';

export const RIG_SLICE: AutoRigRigSlice = {
  sub: 'review',
  motionTest: true,
  motionClip: 'walk',
  paintedSinceBind: false,
};
