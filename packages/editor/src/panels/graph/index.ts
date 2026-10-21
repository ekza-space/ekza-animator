// WP-6 owns this directory: the Graph Editor panel (MVP-SPEC §3 convention 10, §7 WP-6).
import type { Disposer } from '@ekza-studio/anim-core';
import { PANEL } from '@ekza-studio/editor-core';
import type { PanelRegistry } from '../types';
import { GraphPanel } from './GraphPanel';

export { focusedGraphEditor, type GraphEditorHandle } from './focus';
export { GraphPanel } from './GraphPanel';
export { type GraphTestHooks, graphTestHooks } from './testHooks';

export function registerGraphPanel(registry: PanelRegistry): Disposer {
  return registry.register({
    id: PANEL.graph,
    kind: PANEL.graph,
    title: 'Graph Editor',
    component: GraphPanel,
    keyScope: PANEL.graph,
  });
}
