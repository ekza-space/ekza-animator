// `@ekza-studio/editor/agent` (STUDIO-TOUCH-SPEC §14, §20.1; T5c): the Agent panel body (connection, pairing, grants,
// the audit log with Show, Undo and Revert) that Halo's Ask sheet shows at touch density. It takes the panel props
// (`{app, instanceId}`); loading it also puts the live pill in the status line, as in Pro. A lazy chunk in Pro, so a
// Halo import costs `/editor` 0 B (measured); ≈ 139 kB gzip with its runtime, so Halo imports it with `import()` only
// (§20.6: Ask is lazy).
export { default as AgentPanel } from './agent/panel/AgentPanel';
export type { PanelProps as AgentPanelProps } from './panels/types';
