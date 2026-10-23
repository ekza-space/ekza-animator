// What the hub sends over the bridge (MCP-SPEC §5.1, §5.8 step 1): `editor_connect`, `project_close` of the tab's
// handle, and every call addressed to the paired tab — `project: 'tab_…'`, or no `project` while the tab is paired (B1's
// router decides between the tab and headless projects when both exist; until then the tab wins). The server validates
// the arguments with the tool's own schema first (cheap rejection); the tab parses them again. Returns null when the
// call is not the bridge's.
import { type AgentToolDef, type AgentToolResult, finishResult, invalidArgs } from '@ekza-studio/agent-tools';
import type { TabCallOptions, TabLink } from './link';

const failure = (
  code: 'not_connected' | 'expired_handle',
  message: string,
  hint: string,
): AgentToolResult<unknown> => ({
  ok: false,
  error: { code, message, hint, retryable: true },
});

export function routeToTab(
  link: TabLink | null,
  tool: AgentToolDef,
  args: unknown,
  opts: TabCallOptions,
): Promise<AgentToolResult<unknown>> | null {
  if (tool.name === 'editor_connect') {
    const parsed = tool.input.safeParse(args);
    if (!parsed.success)
      return Promise.resolve(finishResult({ ok: false, error: invalidArgs(tool, parsed.error).toError() }, null));
    if (link === null) {
      return Promise.resolve(
        failure(
          'not_connected',
          'The editor bridge is off in this server (started with --no-bridge, or its ports are taken).',
          'restart the server without --no-bridge, or work headless with project_open',
        ),
      );
    }
    return link.claim((parsed.data as { readonly code: string }).code, opts);
  }
  const project =
    typeof args === 'object' && args !== null && !Array.isArray(args)
      ? (args as { readonly project?: unknown }).project
      : undefined;
  const tab = link?.tab() ?? null;
  if (typeof project === 'string' && project.startsWith('tab_')) {
    if (tab === null || tab.handle !== project) {
      return Promise.resolve(
        failure(
          'expired_handle',
          'That editor tab is no longer paired.',
          'call projects_list; ask the user for a new code to pair again',
        ),
      );
    }
    if (tool.name === 'project_close') {
      (link as TabLink).unpair(project);
      return Promise.resolve({ ok: true, data: { closed: project, discarded: false } });
    }
  } else if (project !== undefined || tab === null) {
    return null;
  }
  // projects_list and the rest of the connection group are the hub's own (B1).
  if (tool.group === 'connection' || !tool.hosts.includes('live')) return null;
  const parsed = tool.input.safeParse(args);
  if (!parsed.success)
    return Promise.resolve(finishResult({ ok: false, error: invalidArgs(tool, parsed.error).toError() }, null));
  return (link as TabLink).call(tool, args, opts);
}
