// The eager core of the M-AI explicit-target operators (MCP-SPEC §4.10, §5.5): the bounds and the frame checks the
// shipped operators' agent paths share (tween, graph, ik), and the loader of the implementation (`agentImpl.ts`). The
// definitions (`agentLoad.ts` and the files it serves) are a lazy chunk of their own (`agentChunk.ts`).
import type * as AgentImplModule from './agentImpl';
import { isFiniteNumber } from './define';

export type AgentImpl = typeof AgentImplModule;
/** The operators whose polls and applies live in the implementation. */
export type AgentOperatorId = keyof AgentImpl['AGENT_POLLS'];

/** Frames of every frame argument lie in −100,000…100,000 (MCP-SPEC §5.5). */
export const AGENT_FRAME_LIMIT = 100_000;
/** An agent-grown clip range, and the frame span an operator loops over under an actor, stay ≤ 100,000 frames. */
export const AGENT_SPAN_LIMIT = 100_000;
/** Key records one call writes or deletes at most (§5.5). */
export const AGENT_WRITE_LIMIT = 50_000;

/** Why a frame value is not a frame of §5.5 (finite, −100,000…100,000), or null. */
export function frameProblem(value: unknown, name: string): string | null {
  if (!isFiniteNumber(value)) return `${name} must be a finite frame`;
  return Math.abs(value) > AGENT_FRAME_LIMIT ? `${name} must lie within ±${AGENT_FRAME_LIMIT} frames` : null;
}

/** Why a list of frames is malformed (empty, too long, a bad frame), or null. */
export function framesProblem(value: unknown, name: string, max = AGENT_WRITE_LIMIT): string | null {
  if (!Array.isArray(value)) return `${name} must be a list of frames`;
  const list = value as readonly unknown[];
  if (list.length === 0) return `${name} is empty`;
  if (list.length > max) return `${name} has more than ${max} frames`;
  for (const frame of list) {
    const problem = frameProblem(frame, name);
    if (problem !== null) return problem;
  }
  return null;
}

let loading: Promise<AgentImpl> | null = null;
let loaded: AgentImpl | null = null;

/** Loads the implementation once; a failed load is retried by the next call. Hosts may call it to prefetch. */
export function loadAgentImpl(): Promise<AgentImpl> {
  if (loading === null) {
    loading = import('./agentImpl').then((impl) => {
      loaded = impl;
      return impl;
    });
    loading.catch(() => {
      loading = null;
    });
  }
  return loading;
}

/** The implementation once it has loaded, else null. */
export function loadedAgentImpl(): AgentImpl | null {
  return loaded;
}
