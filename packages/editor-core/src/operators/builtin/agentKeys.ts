// M-AI explicit-target key operators (MCP-SPEC §4.10): `key.write`, `key.delete`, `key.adjust`, `key.retime`. They take
// stored units and explicit targets (never the session's selection, playhead or overrides) and their `label` argument
// is set by the tool layer. D0 registers them as stubs that poll-fail "not available yet" (§3 rule 1); P1 replaces the
// definitions in this file.
import type { AnyOperator } from './define';
import { stubOperator } from './stub';

const AGENT = { category: 'key', undo: true, internal: true } as const;

export const AGENT_KEY_OPERATORS: readonly AnyOperator[] = [
  stubOperator('key.write', 'Set Keys', {
    ...AGENT,
    description: 'Write keys on explicit control channels at clip frames, or key the keyed pose of controls at frames.',
  }),
  stubOperator('key.delete', 'Delete Keys', {
    ...AGENT,
    description: 'Delete keys of explicit control channels at frames or inside a frame range.',
  }),
  stubOperator('key.adjust', 'Adjust Keys', {
    ...AGENT,
    description: 'Scale key values about a pivot or offset them over a frame range, keeping tangent shapes.',
  }),
  stubOperator('key.retime', 'Retime Keys', {
    ...AGENT,
    description: 'Offset, scale, insert or delete time on the keys of explicit control channels.',
  }),
];
