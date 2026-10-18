// WP-5 owns this directory: the viewport dock panel (MVP-SPEC §3 convention 10, §7 WP-5).
import type { Disposer } from '@ekza-animator/anim-core';
import { PANEL } from '@ekza-animator/editor-core';
import type { PanelRegistry } from '../types';
import { ViewportPanel } from './ViewportPanel';

export { useViewportManager } from './hooks';
export { ViewportPanel } from './ViewportPanel';

export function registerViewportPanel(registry: PanelRegistry): Disposer {
  return registry.register({
    id: PANEL.viewport,
    kind: PANEL.viewport,
    title: 'Viewport',
    component: ViewportPanel,
    keyScope: PANEL.viewport,
  });
}
