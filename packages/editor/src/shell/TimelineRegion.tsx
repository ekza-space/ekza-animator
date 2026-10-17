// Fixed chrome below the docks (research 09 §9.1): the time slider and range/playback row are not dockable in M1.
// The region renders the registered timeline panel (WP-6t) or a placeholder of the same height.
import { PANEL } from '@ekza-animator/editor-core';
import type { JSX } from 'react';
import { useShell } from './context';
import { PanelFrame, RegisteredPanel } from './PanelFrame';
import { panelDefOfKind } from './workspace';

export const TIMELINE_INSTANCE = 'timeline';

export function TimelineRegion(): JSX.Element {
  const shell = useShell();
  const def = panelDefOfKind(shell.panels, PANEL.timeline);
  return (
    <section
      className="h-[calc(var(--size-timeline)+var(--size-rangebar))] shrink-0 border-t border-line bg-panel"
      aria-label="Time slider"
      data-testid="timeline-region"
    >
      {def === undefined ? (
        <PanelFrame kind={PANEL.timeline} scope={PANEL.timeline} instanceId={TIMELINE_INSTANCE} title="Time Slider">
          <div className="grid h-full place-items-center text-ui text-fg-3" data-testid="placeholder-timeline">
            The time slider is not available in this build.
          </div>
        </PanelFrame>
      ) : (
        <RegisteredPanel def={def} app={shell.app} instanceId={TIMELINE_INSTANCE} />
      )}
    </section>
  );
}
