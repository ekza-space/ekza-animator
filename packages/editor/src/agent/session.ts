// The agent session of the open tab (MCP-SPEC §4.9): discovery over the bridge ports, pairing, grants, the call queue
// and execution through the shared tool runtime, the audit log and checkpoints. D0 stub; P7 implements it.
import { EkzaError } from '@ekza-studio/anim-core';
import type { EditorApp } from '@ekza-studio/editor-core';
import type { ViewportManager } from '@ekza-studio/viewport';
import type { StoreApi } from 'zustand/vanilla';
import type { AgentSessionState } from './types';

export interface AgentSessionDeps {
  readonly viewport: () => ViewportManager | null;
  readonly params: {
    readonly agentPorts: readonly number[];
    readonly gestureWaitMs?: number;
    readonly confirmTimeoutMs?: number;
  }; // [] = probe 47821–47830
}

export interface AgentSession {
  readonly store: StoreApi<AgentSessionState>;
  connect(): Promise<void>;
  disconnect(): void;
  dispose(): void;
}

export function createAgentSession(_app: EditorApp, _deps: AgentSessionDeps): AgentSession {
  throw new EkzaError('not-implemented', 'editor.createAgentSession');
}
