// `@ekza-studio/editor/agent` (STUDIO-TOUCH-SPEC §14, §20.1; T5c, widened in T10): the agent module that Halo's Ask
// sheet and History ribbon read at touch density — the page's agent runtime and session (connection, pairing code,
// grants, pause, the confirm prompts, the audit rows), the pill's words for the live activity line, and `agent.show`;
// and the Agent panel body (`{app, instanceId}`), as in Pro. A lazy chunk in Pro, so a Halo import costs `/editor`
// 0 B (measured); ≈ 139 kB gzip with its runtime, so Halo imports it with `import()` only (§20.6: Ask is lazy).
export { default as AgentPanel } from './agent/panel/AgentPanel';
export type { AgentAuditRow, AgentSessionState, AgentStatus } from './agent/types';
export { pillView } from './agent/ui/model';
export {
  type AgentRuntime,
  type AgentRuntimeState,
  type AgentSessionHandle,
  agentRuntimeOf,
  existingAgentRuntime,
} from './agent/ui/runtime';
export { AGENT_SHOW } from './agent/ui/show';
export type { PanelProps as AgentPanelProps } from './panels/types';
