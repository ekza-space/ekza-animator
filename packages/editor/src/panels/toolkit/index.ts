// B11 owns this directory (M6A-SPEC §9 B11: the Modeling Tools panel, the Last-op card's view, the option box view and
// the parameter fields they share). `registerToolkitPanel` registers the Toolkit panel (kind `toolkit`, §8.2/§8.5)
// and B11's overlays in B9's slots: the Last-op card (`lastOpCard` pane slot, §8.6) and the shell overlay with the
// option box, the capture-window bridge and the marking menus (`optionBox` shell slot, §8.4, §8.5, §5.10; mounted
// lazily on the first Model entry, ./ModelOpsSlot.tsx). Called by `registerBuiltinPanels` (MVP-SPEC §3 convention 10:
// owners register their panels there).
import type { Disposer } from '@ekza-studio/anim-core';
import { PANEL, type PanelKind } from '@ekza-studio/editor-core';
import { registerPaneOverlay, registerShellOverlay } from '../../overlays/slots';
import type { PanelDef, PanelRegistry } from '../types';
import { LastOpCard } from '../viewport/LastOpCard';
import { ModelOpsSlot } from './ModelOpsSlot';
import { ToolkitPanel } from './ToolkitPanel';

/** The Toolkit's panel kind (`PANEL.toolkit` since INT, M6A-B9-13). */
export const TOOLKIT_KIND: PanelKind = PANEL.toolkit;

export const TOOLKIT_PANEL: PanelDef = {
  id: TOOLKIT_KIND,
  kind: TOOLKIT_KIND,
  title: 'Toolkit',
  component: ToolkitPanel,
  keyScope: 'toolkit',
};

export function registerToolkitPanel(registry: PanelRegistry): Disposer {
  const disposers: readonly Disposer[] = [
    registry.register(TOOLKIT_PANEL),
    registerPaneOverlay('lastOpCard', LastOpCard),
    registerShellOverlay('optionBox', ModelOpsSlot),
  ];
  return () => {
    for (const dispose of [...disposers].reverse()) dispose();
  };
}
