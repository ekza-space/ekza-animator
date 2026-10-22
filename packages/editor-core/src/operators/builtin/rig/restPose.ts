// The rest-pose operators of Rig & Skin (M6B-SPEC §5.7, §5.17; AUTORIG-SPEC §10 A0): `skel.pose.tStance {character?}`
// (T-Stance as a test pose) and `skel.pose.applyAsRest {character?, pose?: 'test' | 'tStance'}` (Apply Pose as Rest;
// `pose: 'tStance'` = "Straighten to T-Pose", one undo step). D0 moved their M6b stubs here out of ./skeleton.ts; A0
// replaces them with the real definitions.
import type { AnyOperator } from '../define';
import { rigStub } from './stub';

export const REST_POSE_OPERATORS: readonly AnyOperator[] = [
  rigStub('skel.pose.tStance', 'T-Stance', { deferred: true }),
  rigStub('skel.pose.applyAsRest', 'Apply Pose as Rest', { undo: true, deferred: true }),
];
