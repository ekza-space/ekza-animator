// Agent URL parameters (MCP-SPEC §4.9), moved out of `params.ts` by B2 (M-AI-B2-13): only lazy chunks (the e2e test
// API, the Agent panel) read them, so they must not live in an eager module.

/** The bridge ports an editor outside e2e mode accepts from `agentPort` (§5.10). */
export const AGENT_PORT_RANGE = { first: 47_821, last: 47_830 } as const;
/** At most this many ports in `agentPort`. */
export const AGENT_PORTS_MAX = 10;

/**
 * Agent URL parameters (MCP-SPEC §4.9). Their header promise holds: no URL switches a user's editor into test mode or
 * makes it connect anywhere by itself. `agentPort=<port>[,<port>…]`: in e2e builds opened with `?e2e=1` any loopback
 * ports 1024…65535 (at most ten), and the panel connects at start; in every other build only ports inside 47821–47830
 * are accepted (others are ignored) and the parameter only opens the Agent panel with those ports preselected —
 * nothing is sent before the user clicks [Connect]. `agentGestureWaitMs` and `agentConfirmTimeoutMs` only in e2e
 * builds opened with `?e2e=1`.
 */
export interface AgentParams {
  readonly agentPorts: readonly number[];
  /** Open the Agent panel at start (a valid `agentPort` was given). */
  readonly openPanel: boolean;
  /** Connect at start without a click (e2e builds opened with `?e2e=1` only). */
  readonly connectAtStart: boolean;
  readonly gestureWaitMs: number | null;
  readonly confirmTimeoutMs: number | null;
}

export const DEFAULT_AGENT_PARAMS: AgentParams = {
  agentPorts: [],
  openPanel: false,
  connectAtStart: false,
  gestureWaitMs: null,
  confirmTimeoutMs: null,
};

function msParam(value: string | null): number | null {
  if (value === null || !/^\d{1,7}$/.test(value)) return null;
  const ms = Number(value);
  return ms <= 600_000 ? ms : null;
}

export function parseAgentParams(search: string, buildAllowsE2e: boolean): AgentParams {
  const query = new URLSearchParams(search);
  const e2e = buildAllowsE2e && query.get('e2e') === '1';
  const raw = query.get('agentPort');
  const ports: number[] = [];
  for (const part of (raw ?? '').split(',')) {
    if (!/^\d{1,5}$/.test(part)) continue;
    const port = Number(part);
    const allowed = e2e
      ? port >= 1_024 && port <= 65_535
      : port >= AGENT_PORT_RANGE.first && port <= AGENT_PORT_RANGE.last;
    if (allowed && !ports.includes(port)) ports.push(port);
    if (ports.length === AGENT_PORTS_MAX) break;
  }
  return {
    agentPorts: ports,
    openPanel: ports.length > 0,
    connectAtStart: e2e && ports.length > 0,
    gestureWaitMs: e2e ? msParam(query.get('agentGestureWaitMs')) : null,
    confirmTimeoutMs: e2e ? msParam(query.get('agentConfirmTimeoutMs')) : null,
  };
}
