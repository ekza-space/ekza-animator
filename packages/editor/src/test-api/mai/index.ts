// The M-AI slices of the e2e test API (MCP-SPEC §4.9, §8.1): each owner fills only its own file (D0 `history.ts`, P8
// `agent.ts`); createTestApi spreads this object into the API.
import type { EditorApp } from '@ekza-animator/editor-core';
import type { EkzaAnimatorTestApi } from '../types';
import { agentStateOf } from './agent';
import { historyStepsOf } from './history';

export function maiTestApi(app: EditorApp): Pick<EkzaAnimatorTestApi, 'agent' | 'historySteps'> {
  return {
    agent: () => agentStateOf(),
    historySteps: () => historyStepsOf(app),
  };
}
