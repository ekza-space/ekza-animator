// The implementation of the M-AI explicit-target operators (`agentImpl.ts`: the applies and the goal, loop, retime and
// adjust workflows) loads on first use, in the operators' `prepare` step, so the editor's first visit does not carry
// it (MCP-SPEC §9.2 `check:size`). Polls stay eager: they answer from the definitions alone.
import type * as AgentImplModule from './agentImpl';

export type AgentImpl = typeof AgentImplModule;

let loading: Promise<AgentImpl> | null = null;

/** Loads the implementation once; a failed load is retried by the next call. Hosts may call it to prefetch. */
export function loadAgentImpl(): Promise<AgentImpl> {
  if (loading === null) {
    loading = import('./agentImpl');
    loading.catch(() => {
      loading = null;
    });
  }
  return loading;
}
