// A wizard pane (AUTORIG-SPEC §4.1, §5.1; D3, decision AR-D3-1 in docs/wp-notes/ar-wizard-shell.md): a DOM surface
// registered with the page's ViewportManager exactly as the shipped `PaneView` registers its own (`paneSetup` —
// what the pane showed in this workspace, else the workspace's defaults — then `registerPane`, `unregisterPane` on
// unmount), tagged as a viewport pane for the host's hover tracking (`data-ekza-panel`, `data-ekza-pane`: the
// viewport key scope, `F`). The shared canvas draws behind it and the viewport tools (Quick Rig markers, joints, the
// paint brush) work in it unchanged. No header: Auto-Rig shows no camera menu or display toggles (§5.1). Importing
// `PaneView` itself from `/autorig` breaks Turbopack's scope hoisting of PaneView's subtree in `/editor` and costs
// `/editor` +1,444 B gzip, over the AR-B1 limit on its own (measured; AR-D3-1). What a step needs of PaneView's HUD
// it gets here: from ③ on the pose view and the library preview badges (`./PaneBadges`, a lazy chunk); the modal
// readout of ③'s joint tools is D4's (AR-D3-1 in DECISIONS-OPEN §M).
import type { EditorApp } from '@ekza-studio/editor-core';
import { PANEL } from '@ekza-studio/editor-core';
import type { ViewportManager } from '@ekza-studio/viewport';
import { type JSX, lazy, Suspense, useLayoutEffect, useRef } from 'react';
import type { AutoRigStep } from '../types';

const PaneBadges = lazy(() => import('./PaneBadges'));

/** The steps whose panes show the pose and preview badges (Rig & Skin's pose view, a playing library preview). */
const BADGE_STEPS: ReadonlySet<AutoRigStep> = new Set(['rig', 'animations', 'export']);

export function WizardPane(props: {
  readonly vm: ViewportManager | null;
  readonly app: EditorApp;
  readonly paneId: string;
  readonly step: AutoRigStep;
}): JSX.Element {
  const { vm, app, paneId, step } = props;
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
    >
      {BADGE_STEPS.has(step) ? (
        <Suspense fallback={null}>
          <PaneBadges app={app} paneId={paneId} step={step} />
        </Suspense>
      ) : null}
    </div>
  );
}
