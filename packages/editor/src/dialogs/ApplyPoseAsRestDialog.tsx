// The Apply Pose as Rest dialog (M6B-SPEC §5.7; AUTORIG-SPEC §10 A0): the confirm "Clips authored on the old rest
// shift by the pose delta (n clips). Do this before animating." before `skel.pose.applyAsRest` on a character with
// clips. D0 stub: renders today's placeholder; A0 replaces this file (its loader line in ./DialogHost.tsx is D0's).
import type { JSX } from 'react';
import { PendingRigDialog } from './PendingRigDialog';

export function ApplyPoseAsRestDialog(): JSX.Element {
  return <PendingRigDialog />;
}
