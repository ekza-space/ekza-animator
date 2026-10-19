// The hub (MCP-SPEC §4.6): the process-wide state — one per process, outside the per-request server factory — the
// bridge, the headless projects, the actor, the last client info, the connection tools and the routing. D0 lands the
// shape with the tool listing working (no tool is ready, so tools/list is empty); P6 fills projects and routing, P7
// the bridge.
import {
  type AgentToolResult,
  AgentToolFailure,
  allTools,
  type ClientInfo,
  finishResult,
  type ManifestTool,
  manifestToolOf,
  readyTools,
} from '@ekza-animator/agent-tools';
import type { McpServerConfig } from '../config';
import type { Logger } from '../log';

export interface AgentHub {
  readonly config: McpServerConfig;
  readonly log: Logger;
  /** The ready tools in catalogue order (the same static list on every connection, §5.20.1). */
  listTools(): readonly ManifestTool[];
  /** True when `name` is a ready tool (unknown names are protocol errors, §5.20.2). */
  hasTool(name: string): boolean;
  /** Routes a call to the paired tab or a headless project (§5.8). */
  callTool(
    name: string,
    args: unknown,
    opts: {
      readonly signal: AbortSignal;
      readonly progress?: (done: number, total: number | null, message?: string) => void;
    },
  ): Promise<AgentToolResult<unknown>>;
  /** The MCP client's name and version as reported (sanitised), for the bridge's `hello.ok`. */
  clientInfo(): ClientInfo | null;
  setClientInfo(info: ClientInfo | null): void;
  close(): Promise<void>;
}

export function createAgentHub(config: McpServerConfig, log: Logger): AgentHub {
  const tools = readyTools(allTools());
  const listed = tools.map(manifestToolOf);
  const names = new Set(tools.map((tool) => tool.name));
  let client: ClientInfo | null = null;
  return {
    config,
    log,
    listTools: () => listed,
    hasTool: (name) => names.has(name),
    callTool(name) {
      // P6 routes to a headless project or the paired tab (§5.8); until then no project exists.
      const failure = new AgentToolFailure(
        'not_connected',
        `${name}: no editor is paired and no project is open.`,
        'call project_open {path} with a .ekzanim, .vrm or .glb in the workspace folder',
      );
      return Promise.resolve(finishResult({ ok: false, error: failure.toError() }, null));
    },
    clientInfo: () => client,
    setClientInfo(info) {
      client = info;
    },
    close: () => Promise.resolve(),
  };
}
