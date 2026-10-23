// The Agent panel (MCP-SPEC §7.2): connect, server list, pairing code, grants, Pause/Disconnect, the audit log grouped
// by checkpoints, Revert all and Restore before the agent. D0 lands an empty panel in the lazy agent chunk; P8 builds
// it.
import type { JSX } from 'react';
import type { PanelProps } from '../../panels/types';

export default function AgentPanel(_props: PanelProps): JSX.Element {
  return (
    <div className="flex h-full flex-col gap-2 p-3 text-ui" data-testid="agent-panel">
      <p className="text-fg-3">No agent connected.</p>
      <p className="text-fg-3">AI agents connect through the ekza-studio-mcp server (docs/agents.md).</p>
    </div>
  );
}
