// The Dope Sheet panel directory (M2A-SPEC §4.8, §8.1: A0 placeholder, then A3; registered by panels/index.ts,
// MVP-SPEC §3 convention 10). Key scope 'dopeSheet' (§6 scope D).
import type { Disposer } from '@ekza-animator/anim-core';
import { PANEL } from '@ekza-animator/editor-core';
import type { PanelDef, PanelRegistry } from '../types';
import { DopeSheetPanel } from './DopeSheetPanel';

export const DOPE_SHEET_PANEL: PanelDef = {
  id: PANEL.dopeSheet,
  kind: PANEL.dopeSheet,
  title: 'Dope Sheet',
  component: DopeSheetPanel,
  keyScope: PANEL.dopeSheet,
};

export function registerDopeSheetPanel(registry: PanelRegistry): Disposer {
  return registry.register(DOPE_SHEET_PANEL);
}
