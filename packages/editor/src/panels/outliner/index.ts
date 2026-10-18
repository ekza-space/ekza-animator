// WP-9 owns this directory (MVP-SPEC §7 WP-9; registered by panels/index.ts, §3 convention 10).
import type { Disposer } from '@ekza-animator/anim-core';
import { PANEL } from '@ekza-animator/editor-core';
import type { PanelDef, PanelRegistry } from '../types';
import { OutlinerPanel } from './OutlinerPanel';

export const OUTLINER_PANEL: PanelDef = {
  id: PANEL.outliner,
  kind: PANEL.outliner,
  title: 'Outliner',
  component: OutlinerPanel,
  keyScope: PANEL.outliner,
};

export function registerOutlinerPanel(registry: PanelRegistry): Disposer {
  return registry.register(OUTLINER_PANEL);
}
