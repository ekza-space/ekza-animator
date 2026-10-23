// editor_connect (MCP-SPEC §5.10, §6.2 tool 1; B2): the server's bridge claims the pairing code and waits for the
// user's decision in the tab, so the tool never runs inside a tool runtime — the hub answers it before any project
// exists. A runtime that gets the call (a test harness, a future in-app assistant) answers `unsupported`.
import { AgentToolFailure, type AgentToolContext, type AgentToolResult } from '../../types';

export function runEditorConnect(
  _ctx: AgentToolContext,
  _args: { readonly code: string },
): Promise<AgentToolResult<never>> {
  return Promise.reject(
    new AgentToolFailure(
      'unsupported',
      'editor_connect is answered by the ekza-studio-mcp server, not inside a project.',
      'call editor_connect through the MCP server with the code the user gave you',
      { retryable: false },
    ),
  );
}
