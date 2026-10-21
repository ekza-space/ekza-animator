// WP-9 owns this directory (MVP-SPEC §7 WP-9; registered by panels/index.ts, §3 convention 10).
import type { Disposer } from '@ekza-studio/anim-core';
import { PANEL } from '@ekza-studio/editor-core';
import type { PanelDef, PanelRegistry } from '../types';
import { AttributesPanel } from './AttributesPanel';

export const ATTRIBUTES_PANEL: PanelDef = {
  id: PANEL.attributes,
  kind: PANEL.attributes,
  title: 'Attributes',
  component: AttributesPanel,
  keyScope: PANEL.attributes,
};

export function registerAttributesPanel(registry: PanelRegistry): Disposer {
  return registry.register(ATTRIBUTES_PANEL);
}
