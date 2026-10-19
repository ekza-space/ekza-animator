// Contract file: the agent module's session state (MCP-SPEC §4.9). `editor/src/agent/**` is a React.lazy boundary
// loaded when the Agent panel opens or `?agentPort=` is present, so the first-visit route imports nothing of
// agent-tools (type imports only here). P7 implements the session (discovery, pairing, call execution); P8 the panel.
import type { ClientInfo, ConfirmPrompt, Grants, ServerInfo, ToolsetInfo } from '@ekza-animator/agent-tools';
import type { CharacterId, ClipId, ControlId } from '@ekza-animator/doc';
import type { RunActor } from '@ekza-animator/editor-core';

export type AgentStatus = 'off' | 'probing' | 'choosing' | 'offering' | 'claimed' | 'paired' | 'paused' | 'error';
export interface AgentServerEntry {
  readonly port: number;
  readonly server: ServerInfo;
  readonly client: ClientInfo | null;
  readonly toolset: ToolsetInfo;
  readonly busy: boolean;
}
export interface AgentAuditRow {
  readonly n: number; // 1-based within the pairing
  readonly at: number;
  readonly tool: string;
  readonly digest: string; // ≤ 120 characters: 'pose_set wave f12 (3 controls)'
  readonly status: 'running' | 'waiting' | 'ok' | 'error' | 'cancelled' | 'denied';
  readonly code: string | null; // error code
  readonly ms: number | null;
  readonly step: { readonly id: number; readonly label: string } | null;
  readonly reverted: boolean;
  readonly unreachable: boolean; // the step left the undo stack (§5.13)
  readonly group: string | null; // the checkpoint (`cp_…`) open when the call ran (§5.11)
  /** What [Show] switches to (§5.11): the call's resolved character, clip, focus frame and controls. */
  readonly show: {
    readonly character: CharacterId;
    readonly clip: ClipId;
    readonly frame: number | null;
    readonly controls: readonly ControlId[];
  } | null;
}
export interface AgentCheckpoint {
  readonly id: string;
  readonly label: string | null;
  readonly at: number;
  readonly stepId: number;
}
export interface AgentSessionState {
  readonly status: AgentStatus;
  readonly servers: readonly AgentServerEntry[];
  readonly server: AgentServerEntry | null;
  readonly code: { readonly text: string; readonly expiresAt: number } | null;
  readonly grants: Grants;
  readonly actor: RunActor | null;
  readonly queue: {
    readonly running: string | null;
    readonly waiting: number;
    readonly waitingFor: 'gesture' | 'redo' | 'confirm' | null;
  };
  readonly confirm: { readonly id: string; readonly prompt: ConfirmPrompt; readonly expiresAt: number } | null;
  readonly audit: readonly AgentAuditRow[]; // newest last, ≤ 500 rows
  readonly checkpoints: readonly AgentCheckpoint[]; // this pairing's, oldest first
  /** The in-memory document snapshot taken before the agent's first edit of this pairing (§5.13), or null. */
  readonly beforeAgent: { readonly at: number; readonly approxBytes: number } | null;
  readonly error: {
    readonly kind: 'no_server' | 'lna_denied' | 'version' | 'closed';
    readonly message: string;
  } | null;
}
