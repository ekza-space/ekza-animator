// M-AI explicit-target clip operator (MCP-SPEC §4.10): `clip.makeLoop` makes a clip loop seamlessly — match its ends,
// blend toward the start pose, or only cycle it — and reports the seam before and after (`workflows/loop.ts`). A dry
// run measures on scratch curves and writes nothing (an empty transaction records no step). The definition lives
// here; its poll and apply load on first use with the agent operators' implementation (`agentImpl.ts`).
import type { AnyOperator } from './define';
import { agentOperator } from './agentLoad';

export const AGENT_CLIP_OPERATORS: readonly AnyOperator[] = [
  agentOperator({
    id: 'clip.makeLoop',
    label: 'Make Loop',
    description: 'Make a clip loop seamlessly: match its ends, blend toward the start pose, or only cycle it.',
    category: 'clip',
    undoLabel: () => 'Make Loop',
    apply: ({ app, tx }, args, impl) => impl.makeLoop(app, tx, args),
  }),
];
