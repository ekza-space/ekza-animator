import type { Disposer } from '@ekza-animator/anim-core';
import { registerAttributesPanel } from './attributes';
import { registerChannelBoxPanel } from './channel-box';
import { registerClipsPanel } from './clips';
import { registerDopeSheetPanel } from './dopesheet';
import { registerGraphPanel } from './graph';
import { registerOutlinerPanel } from './outliner';
import { registerPalettePanel } from './palette';
import { registerTimelinePanel } from './timeline';
import type { PanelRegistry } from './types';
import { registerViewportPanel } from './viewport';

/**
 * Registers every built-in panel. Each panel directory exports `register<Name>Panel`; panel owners edit only their
 * directory and the shell never edits panel directories (MVP-SPEC §3 convention 10).
 */
export function registerBuiltinPanels(registry: PanelRegistry): Disposer {
  const disposers: readonly Disposer[] = [
    registerViewportPanel(registry),
    registerGraphPanel(registry),
    registerTimelinePanel(registry),
    registerOutlinerPanel(registry),
    registerClipsPanel(registry),
    registerChannelBoxPanel(registry),
    registerAttributesPanel(registry),
    registerDopeSheetPanel(registry),
    // M6a (B13): the Palette panel (Model's right dock; a lazy body).
    registerPalettePanel(registry),
  ];
  return () => {
    for (const dispose of [...disposers].reverse()) dispose();
  };
}
