// M-AI explicit-target pose operators (MCP-SPEC §4.10): `pose.setAt`, `pose.goals`, `pose.transfer`. Stored units,
// explicit clip and frame; only `pose.setAt {mode: 'propose'}` reads the session (the user's current frame) and writes
// it (unkeyed overrides, View access). One transaction each; `internal`. The definitions live here; their polls
// (`agentPoseChecks.ts`) and applies (`agentImpl.ts`) load on first use (`agentLoad.ts`).
import type { AnyOperator } from './define';
import { agentOperator, labelOf } from './agentLoad';

export const AGENT_POSE_OPERATORS: readonly AnyOperator[] = [
  agentOperator({
    id: 'pose.setAt',
    label: 'Set Pose',
    description: 'Set channel values of controls at one clip frame and key them (or set static values, or propose).',
    category: 'pose',
    undoLabel: (args) => labelOf(args, args.mode === 'propose' ? 'Propose Pose' : 'Set Pose'),
    apply: (ctx, args, impl) => impl.poseSetAt(ctx, args),
  }),
  agentOperator({
    id: 'pose.goals',
    label: 'Goal Pose',
    description: 'Aim FK bones in character-space directions and place IK effectors, keyed at one clip frame.',
    category: 'pose',
    apply: ({ app, tx }, args, impl) => impl.poseGoals(app, tx, args),
  }),
  agentOperator({
    id: 'pose.transfer',
    label: 'Transfer Pose',
    description: 'Key the pose of one frame (optionally mirrored, optionally of another clip) at other frames.',
    category: 'pose',
    apply: ({ app, tx }, args, impl) => impl.poseTransfer(app, tx, args),
  }),
];
