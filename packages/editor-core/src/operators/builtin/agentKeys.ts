// M-AI explicit-target key operators (MCP-SPEC §4.10): `key.write`, `key.delete`, `key.adjust`, `key.retime`. They take
// stored units and explicit targets (never the session's selection, playhead or overrides) and their `label` argument
// is set by the tool layer. One transaction each; `internal` (hidden from menus, palette and keymaps). The definitions
// live here; their polls (`agentKeyChecks.ts`) and applies (`agentImpl.ts`) load on first use (`agentLoad.ts`).
import type { AnyOperator } from './define';
import { agentOperator } from './agentLoad';

export const AGENT_KEY_OPERATORS: readonly AnyOperator[] = [
  agentOperator({
    id: 'key.write',
    label: 'Set Keys',
    description: 'Write keys on explicit control channels at clip frames, or key the keyed pose of controls at frames.',
    category: 'key',
    apply: ({ app, tx }, args, impl) => impl.keyWrite(app, tx, args),
  }),
  agentOperator({
    id: 'key.delete',
    label: 'Delete Keys',
    description: 'Delete keys of explicit control channels at frames or inside a frame range.',
    category: 'key',
    apply: ({ app, tx }, args, impl) => impl.keyDelete(app, tx, args),
  }),
  agentOperator({
    id: 'key.adjust',
    label: 'Adjust Keys',
    description: 'Scale key values about a pivot or offset them over a frame range, keeping tangent shapes.',
    category: 'key',
    apply: ({ app, tx }, args, impl) => impl.keyAdjust(app, tx, args),
  }),
  agentOperator({
    id: 'key.retime',
    label: 'Retime Keys',
    description: 'Offset, scale, insert or delete time on the keys of explicit control channels.',
    category: 'key',
    apply: ({ app, tx }, args, impl) => impl.keyRetime(app, tx, args),
  }),
];
