// A wizard pane (AUTORIG-SPEC §4.1, §5.1; D3, decision AR-D3-1 in docs/wp-notes/ar-wizard-shell.md): a DOM surface
// registered with the page's ViewportManager exactly as the shipped `PaneView` registers its own (`paneSetup` —
// what the pane showed in this workspace, else the workspace's defaults — then `registerPane`, `unregisterPane` on
// unmount), tagged as a viewport pane for the host's hover tracking (`data-ekza-panel`, `data-ekza-pane`: the
// viewport key scope, `F`). The shared canvas draws behind it and the viewport tools (Quick Rig markers, joints, the
// paint brush) work in it unchanged. No header: Auto-Rig shows no camera menu or display toggles (§5.1). Importing
// `PaneView` itself from `/autorig` breaks Turbopack's scope hoisting of PaneView's subtree in `/editor` and costs
// `/editor` +1,444 B gzip, over the AR-B1 limit on its own (measured; AR-D3-1).
import { PANEL } from '@ekza-studio/editor-core';
import type { ViewportManager } from '@ekza-studio/viewport';
import { type JSX, useLayoutEffect, useRef } from 'react';

export function WizardPane(props: { readonly vm: ViewportManager | null; readonly paneId: string }): JSX.Element {
  const { vm, paneId } = props;
  const surface = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = surface.current;
    if (vm === null || element === null) return undefined;
    const setup = vm.paneSetup(paneId);
    vm.registerPane({ id: paneId, element, camera: setup.camera, display: setup.display });
    return () => vm.unregisterPane(paneId);
  }, [vm, paneId]);
  return (
    <div
      ref={surface}
      className="relative h-full min-h-0 w-full min-w-0 overflow-hidden outline-none"
      data-testid={`pane-${paneId}`}
      data-ekza-panel={PANEL.viewport}
      data-ekza-pane={paneId}
    />
  );
}
