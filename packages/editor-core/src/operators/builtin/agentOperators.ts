// M-AI (MCP-SPEC §4.10): the ten explicit-target operators, one lazy chunk (`agentChunk.ts` registers them on the
// first run of one of their ids or when an agent runtime attaches).
import { AGENT_CLIP_OPERATORS } from './agentClip';
import { AGENT_KEY_OPERATORS } from './agentKeys';
import { AGENT_POSE_OPERATORS } from './agentPose';
import type { AnyOperator } from './define';
import { REVERT_OPERATORS } from './revert';

export const AGENT_OPERATORS: readonly AnyOperator[] = [
  ...AGENT_KEY_OPERATORS,
  ...AGENT_POSE_OPERATORS,
  ...AGENT_CLIP_OPERATORS,
  ...REVERT_OPERATORS,
];
