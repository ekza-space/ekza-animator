// The §5.7 state table (M6B-SPEC §5.7, §0.4.3; C3): one rule per gesture on selected joints in Skeleton mode and the
// skeleton's state. Pure; the joint input runs the action it returns.
//
// | Gesture   | not bound                  | bound, Bind view                 | bound, Test or Clip view |
// |-----------|----------------------------|----------------------------------|--------------------------|
// | W         | rest move, with subtrees   | rest move (Move Skinned Joints)  | refused                  |
// | D + W     | rest move, joint only      | same                             | refused                  |
// | E         | rest rotate of the subtree | test pose (IK limbs → FK)        | test pose continues      |
// | D + E     | re-orient the joint only   | same                             | refused                  |
// | R         | disabled                   | disabled                         | disabled                 |

export type JointGesture = 'W' | 'D+W' | 'E' | 'D+E' | 'R';
export type JointSkeletonState = 'unbound' | 'bound' | 'posed';

export type JointAction =
  | { readonly kind: 'rest-move'; readonly mode: 'subtree' | 'joint' }
  | { readonly kind: 'rest-rotate'; readonly mode: 'subtree' | 'joint' }
  | { readonly kind: 'test-pose' }
  | { readonly kind: 'refused'; readonly reason: string };

/** §5.7: a moved or re-oriented joint of a posed skeleton. */
export const JOINT_POSED_REFUSAL = 'Joints are posed for testing — Go to Bind Pose to move them';
/** §5.7: `R` on joints. */
export const JOINT_SCALE_REFUSAL = 'Joints keep scale 1 (VRM/glTF)';

/** The skeleton state of the table: posed (Test or Clip view of a bound skeleton), bound, or not bound. */
export function jointSkeletonState(bound: boolean, poseView: string): JointSkeletonState {
  if (!bound) return 'unbound';
  return poseView === 'bind' ? 'bound' : 'posed';
}

/** The action of a gesture in a state (§5.7 table). */
export function jointAction(gesture: JointGesture, state: JointSkeletonState): JointAction {
  if (gesture === 'R') return { kind: 'refused', reason: JOINT_SCALE_REFUSAL };
  if (gesture === 'E') return state === 'unbound' ? { kind: 'rest-rotate', mode: 'subtree' } : { kind: 'test-pose' };
  if (state === 'posed') return { kind: 'refused', reason: JOINT_POSED_REFUSAL };
  if (gesture === 'W') return { kind: 'rest-move', mode: 'subtree' };
  if (gesture === 'D+W') return { kind: 'rest-move', mode: 'joint' };
  return { kind: 'rest-rotate', mode: 'joint' };
}

/** The gesture of a viewport tool with `D` held or not; null for tools that do not transform joints. */
export function jointGestureOf(tool: string, dHeld: boolean): JointGesture | null {
  if (tool === 'move') return dHeld ? 'D+W' : 'W';
  if (tool === 'rotate') return dHeld ? 'D+E' : 'E';
  if (tool === 'scale') return 'R';
  return null;
}
