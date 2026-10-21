// The Palette panel directory (M6A-SPEC §5.19, §8.8; B13): Model's right-dock Palette tab. Registered by
// panels/index.ts; the body is a lazy chunk.
import type { Disposer } from '@ekza-studio/anim-core';
import { MODEL_PANEL } from '../../shell/layout';
import type { PanelDef, PanelRegistry } from '../types';
import { PalettePanel } from './PalettePanel';

export const PALETTE_PANEL: PanelDef = {
  id: MODEL_PANEL.palette,
  kind: MODEL_PANEL.palette,
  title: 'Palette',
  component: PalettePanel,
  keyScope: MODEL_PANEL.palette,
};

export function registerPalettePanel(registry: PanelRegistry): Disposer {
  return registry.register(PALETTE_PANEL);
}
