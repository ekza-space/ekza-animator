// The AgentHost of headless projects (MCP-SPEC §4.6, §5.9): grants { read, edit, files: true, view: false,
// workspace: true }, files through the workspace sandbox, confirmations through `confirm: true` arguments. D0 stub;
// P6 implements.
import type { AgentHost } from '@ekza-animator/agent-tools';
import { EkzaError } from '@ekza-animator/anim-core';

export function createHeadlessHost(): AgentHost {
  throw new EkzaError('not-implemented', 'ekza-animator-mcp.createHeadlessHost');
}
