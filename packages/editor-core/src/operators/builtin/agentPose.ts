// M-AI explicit-target pose operators (MCP-SPEC §4.10): `pose.setAt`, `pose.goals`, `pose.transfer`. Stored units,
// explicit clip and frame; only `pose.setAt {mode: 'propose'}` reads the session (the user's current frame). D0
// registers them as stubs that poll-fail "not available yet" (§3 rule 1); P1 replaces the definitions in this file.
import type { AnyOperator } from './define';
import { stubOperator } from './stub';

const AGENT = { category: 'pose', undo: true, internal: true } as const;

export const AGENT_POSE_OPERATORS: readonly AnyOperator[] = [
  stubOperator('pose.setAt', 'Set Pose', {
    ...AGENT,
    description: 'Set channel values of controls at one clip frame and key them (or set static values, or propose).',
  }),
  stubOperator('pose.goals', 'Goal Pose', {
    ...AGENT,
    description: 'Aim FK bones in character-space directions and place IK effectors, keyed at one clip frame.',
  }),
  stubOperator('pose.transfer', 'Transfer Pose', {
    ...AGENT,
    description: 'Key the pose of one frame (optionally mirrored, optionally of another clip) at other frames.',
  }),
];
