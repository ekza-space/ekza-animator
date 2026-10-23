import type { Disposer } from '@ekza-studio/anim-core';
import { registerAgentPanel } from './agent';
import { registerAttributesPanel } from './attributes';
import { registerChannelBoxPanel } from './channel-box';
import { registerClipsPanel } from './clips';
import { registerDopeSheetPanel } from './dopesheet';
import { registerGraphPanel } from './graph';
import { registerMeshCheckPanel } from './meshcheck';
import { registerOutlinerPanel } from './outliner';
import { registerPalettePanel } from './palette';
import { registerTimelinePanel } from './timeline';
import { registerToolkitPanel } from './toolkit';
import type { PanelRegistry } from './types';
import { registerViewportPanel } from './viewport';
// M6b (M6B-SPEC §8, §0.4.7; C0 registers every MVP panel, each body is its owner's lazy chunk ./<id>/index.tsx).
import { PANEL } from '@ekza-studio/editor-core';
import { lazyPanelDef } from './lazyPanel';
import { registerModelStartOverlays } from './viewport/modelOverlays';

/** M6b: the Rig & Skin panel bodies, one lazy group (./rigPanels.ts). */
const loadRigPanels = () => import('./rigPanels');

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
    // M6a (B10): the Mesh Check panel (Model's bottom dock; a lazy body).
    registerMeshCheckPanel(registry),
    // M6a (M6A-SPEC §8.5, §8.6; B11): the Modeling Toolkit and B11's overlays (Last-op card, option box).
    registerToolkitPanel(registry),
    // M6a (B13): the Palette panel (Model's right dock; a lazy body).
    registerPalettePanel(registry),
    // M6a (B13): the Model start card and the Getting started card (pane overlay slots).
    registerModelStartOverlays(),
    // M6b (C0 registration lines; bodies: C12, C3, C7, C7, C6)
    registry.register(lazyPanelDef(PANEL.clipLibrary, 'Clip Library', () => import('./clipLibrary'))),
    registry.register(lazyPanelDef(PANEL.quickRig, 'Quick Rig', loadRigPanels)),
    registry.register(lazyPanelDef(PANEL.rigToolkit, 'Rig Toolkit', loadRigPanels)),
    registry.register(lazyPanelDef(PANEL.validation, 'Validation', loadRigPanels)),
    registry.register(lazyPanelDef(PANEL.paintWeights, 'Paint Weights', loadRigPanels)),
    // The Component Editor is not built in the MVP (M6B-INT-2; §0.3 C6 row, §0.4.5 "if built"): it is not registered,
    // so Windows never lists a panel that can show nothing (Q-MVP-15). Its stub body stays in ./componentEditor.
    // M-AI (MCP-SPEC §7.1): the Agent panel, a lazy chunk opened from Windows › Agent or the status pill
    registerAgentPanel(registry),
  ];
  return () => {
    for (const dispose of [...disposers].reverse()) dispose();
  };
}
