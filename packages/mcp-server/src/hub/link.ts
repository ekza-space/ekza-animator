// The hub ↔ bridge contract (MCP-SPEC §4.6, §5.8, §5.10; MCP-SPEC §0.4.5: "B1's TabLink in hub.ts"). B1 implements
// the hub side (routing, projects_list, project_close of a `tab_…` handle), B2 implements both interfaces below in
// `bridge/` (the WebSocket server, pairing, the call relay, re-validation of tab results). The hub never sees a
// socket; the bridge never sees a headless project. Frozen for phase B: change it only by agreement of B1 and B2.
import type { AgentToolResult, Grants } from '@ekza-studio/agent-tools';

/** Options of one relayed call (the MCP request's signal and progress callback). */
export interface TabCallOptions {
  /** Aborted on MCP cancellation: the bridge sends `cancel {id}` (§5.8 8). */
  readonly signal: AbortSignal;
  /** `notifications/progress` for the call, when the client sent a token (§5.8 9). */
  readonly progress?: (done: number, total: number | null, message?: string) => void;
}

/** What the tab last reported (`tab`, `grants`, `paused` messages) — data from a page, already sanitised. */
export interface TabState {
  /** The tab's document title and project name (`tab {title, project}`), sanitised. */
  readonly title: string;
  readonly projectName: string;
  readonly grants: Grants;
  readonly paused: boolean;
  /** The tab's toolset version from `hello` (§5.21). */
  readonly toolset: string;
  /** Characters in the tab's scene and its dirty flag when known (from the last `scene_summary`/result), else null. */
  readonly characters: number | null;
  readonly dirty: boolean | null;
}

/** The paired editor tab as the hub sees it (one at a time, §5.10 "One tab per server"). */
export interface TabLink {
  /** `tab_` + 12 base62 characters; valid for the pairing (§5.1). */
  readonly handle: string;
  /** The tab's `Origin` as the browser sent it (reported by `editor_connect` and `projects_list`). */
  readonly origin: string;
  state(): TabState;
  /**
   * Relays one tool call (`call` → `result`, §4.5) and resolves with the **re-validated** envelope (§5.10 "Tab results":
   * the server's own output schema, sanitiser, budgets, images, workspace writes it derives from `args`). Never rejects:
   * a dropped socket answers `not_connected`, a deadline `timeout`, a cancellation `cancelled`.
   */
  call(tool: string, args: Readonly<Record<string, unknown>>, opts: TabCallOptions): Promise<AgentToolResult<unknown>>;
  /** Ends the pairing (`bye {reason}`); the handle answers `expired_handle` afterwards. */
  close(reason: 'server' | 'user'): Promise<void>;
}

/** The bridge server as the hub sees it (B2's `startBridgeServer(hub)` returns one). */
export interface HubBridge {
  /** `off` (all ports taken or `--no-bridge`), `listening` (no tab paired) or `paired`. */
  status(): { readonly status: 'off' | 'listening' | 'paired'; readonly port: number | null };
  /** The paired tab, or null. */
  tab(): TabLink | null;
  /**
   * `editor_connect {code}` (§5.10): claims the code, waits for the user's decision (≤ 50 s) and answers the tool's
   * envelope (`{project, grants, actor, origin, summary}` or `not_found` / `busy` / `declined` / `version_mismatch`).
   * Arguments arrive already validated with the tool's schema.
   */
  connect(args: { readonly code: string }, opts: TabCallOptions): Promise<AgentToolResult<unknown>>;
  /** Sends `bye {server}` to a paired tab and closes the sockets (process exit). */
  close(): Promise<void>;
}
