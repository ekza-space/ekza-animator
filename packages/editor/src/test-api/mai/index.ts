// The M-AI slices of the e2e test API (MCP-SPEC §4.9, §8.1): each owner fills only its own file (D0 `history.ts`, B2
// `agent.ts`); createTestApi spreads this object into the API.
import type { EditorApp } from '@ekza-studio/editor-core';
import type { HostShell } from '../../host/types';
import type { EkzaStudioTestApi } from '../types';
import { agentActOf, agentStateOf, startAgentFromParams } from './agent';
import { historyStepsOf } from './history';

export function maiTestApi(
  app: EditorApp,
  host?: HostShell,
): Pick<EkzaStudioTestApi, 'agent' | 'historySteps' | 'agentAct'> {
  if (host !== undefined) startAgentFromParams(app, host);
  return {
    agent: () => agentStateOf(app),
    historySteps: () => historyStepsOf(app),
    agentAct: (action, grants) => agentActOf(app, host ?? null, action, grants),
  };
}
