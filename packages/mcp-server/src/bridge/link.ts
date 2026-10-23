// The tab link (MCP-SPEC §4.6, §0.4.5 B1/B2 seam): what the hub sees of the live bridge. The hub routes
// `editor_connect` to `claim`, every call addressed to the paired tab (`tab_…`, or no `project` while only the tab is
// open) to `call`, `project_close {project: 'tab_…'}` to `unpair`, and reads `tab()` for `projects_list`. The bridge
// server implements it (`bridge/server.ts`); nothing else of the bridge is visible to the hub.
// D0 named this interface (`TabLink`) without landing it; B2 defines it here (M-AI-B2-1).
import type { AgentToolDef, AgentToolResult, Grants } from '@ekza-studio/agent-tools';

/** The paired tab as the hub lists it (`projects_list`, `editor_connect`). Strings are sanitised. */
export interface TabInfo {
  /** `tab_` + 12 base62 characters; a new one for every pairing. */
  readonly handle: string;
  /** The page's `Origin` as the browser sent it at the upgrade. */
  readonly origin: string;
  /** The tab's title and project name (reported by the tab after `pair.ok`). */
  readonly title: string;
  readonly project: string;
  /** The grants and pause state the tab reported last (the tab enforces them; the server uses them for files). */
  readonly grants: Grants;
  readonly paused: boolean;
  /** The editor's toolset version (from `hello`). */
  readonly toolset: string;
  readonly pairedAt: number;
}

/** Workspace transfers of live calls (§5.10, §5.18): B1's sandbox supplies them; without it none happen. */
export interface TabFileHooks {
  /** Bytes to pre-attach to a call: only paths taken from this call's own arguments (the hook decides which). */
  attach(tool: AgentToolDef, args: unknown): Promise<readonly { readonly path: string; readonly bytes: Uint8Array }[]>;
  /** Performs the tab's workspace writes to targets the server derives from the call's own arguments; an error
   *  envelope replaces the tab's result, null keeps it. */
  write(
    tool: AgentToolDef,
    args: unknown,
    writes: readonly { readonly name: string; readonly bytes: Uint8Array }[],
  ): Promise<AgentToolResult<unknown> | null>;
}

export interface TabCallOptions {
  readonly signal: AbortSignal;
  readonly progress?: (done: number, total: number | null, message?: string) => void;
}

export interface TabLink {
  /** The loopback port the bridge listens on. */
  readonly port: number;
  status(): 'listening' | 'paired';
  /** The paired tab, or null. */
  tab(): TabInfo | null;
  /** `editor_connect {code}` (§5.10): waits ≤ 50 s for the user's decision; the result is the tool's envelope. */
  claim(code: string, opts: TabCallOptions): Promise<AgentToolResult<unknown>>;
  /** Relays a call to the paired tab and re-validates its result (§5.8, §5.10); `not_connected` when none. */
  call(tool: AgentToolDef, args: unknown, opts: TabCallOptions): Promise<AgentToolResult<unknown>>;
  /** Ends the pairing (`project_close` of the tab's handle, or the server stopping); false when none matched. */
  unpair(handle: string): boolean;
  close(): Promise<void>;
}
