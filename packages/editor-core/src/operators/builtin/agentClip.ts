// M-AI explicit-target clip operator (MCP-SPEC §4.10): `clip.makeLoop`. D0 registers it as a stub that poll-fails
// "not available yet" (§3 rule 1); P1 replaces the definition in this file.
import type { AnyOperator } from './define';
import { stubOperator } from './stub';

export const AGENT_CLIP_OPERATORS: readonly AnyOperator[] = [
  stubOperator('clip.makeLoop', 'Make Loop', {
    category: 'clip',
    undo: true,
    internal: true,
    description: 'Make a clip loop seamlessly: match its ends, blend toward the start pose, or only cycle it.',
  }),
];
