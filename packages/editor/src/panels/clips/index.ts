// WP-9 owns this directory (MVP-SPEC §7 WP-9; registered by panels/index.ts, §3 convention 10).
import type { Disposer } from '@ekza-studio/anim-core';
import { PANEL } from '@ekza-studio/editor-core';
import type { PanelDef, PanelRegistry } from '../types';
import { ClipsPanel } from './ClipsPanel';

export const CLIPS_PANEL: PanelDef = {
  id: PANEL.clips,
  kind: PANEL.clips,
  title: 'Clips',
  component: ClipsPanel,
  keyScope: PANEL.clips,
};

export function registerClipsPanel(registry: PanelRegistry): Disposer {
  return registry.register(CLIPS_PANEL);
}
