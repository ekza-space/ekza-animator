// The `agent` extra panel (MCP-SPEC §7.1: Windows › Agent; not part of the default layout). Its component is a
// React.lazy boundary, so the first-visit route loads nothing of the agent module. D0 registers it; P8 owns the
// directory and the panel.
import type { Disposer } from '@ekza-studio/anim-core';
import type { PanelDef, PanelRegistry } from '../types';
import { AgentPanelLazy } from './AgentPanelLazy';

/** The agent panel kind (`workspace.showPanel {panel: 'agent'}`). */
export const AGENT_PANEL_KIND = 'agent';

export const AGENT_PANEL: PanelDef = {
  id: AGENT_PANEL_KIND,
  kind: AGENT_PANEL_KIND,
  title: 'Agent',
  component: AgentPanelLazy,
  keyScope: AGENT_PANEL_KIND,
};

export function registerAgentPanel(registry: PanelRegistry): Disposer {
  return registry.register(AGENT_PANEL);
}
