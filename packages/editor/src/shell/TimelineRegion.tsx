// Fixed chrome below the docks (research 09 §9.1): the time slider and range/playback row are not dockable in M1.
// The region renders the registered timeline panel (WP-6t) or a placeholder of the same height.
import { PANEL } from '@ekza-animator/editor-core';
import type { JSX } from 'react';
import { useSession } from '../hooks';
import { useRegistryList } from '../hooks/useRegistry';
import { useShell, useShellUi } from './context';
import type { ChromePart } from './layout';
import { PanelFrame, RegisteredPanel } from './PanelFrame';
import { panelDefOfKind } from './workspace';

export const TIMELINE_INSTANCE = 'timeline';

/** Whether a piece of chrome shows in the active workspace (its toggle, else its default: the time slider as the
 *  workspace definition says, M6a §8.2; the tool strip and help line on). */
export function useChromeShown(part: ChromePart): boolean {
  const { app } = useShell();
  const workspace = useSession((s) => s.workspace);
  const workspaces = useRegistryList(app.workspaces);
  const toggled = useShellUi((s) => s.chrome[workspace]?.[part]);
  if (toggled !== undefined) return toggled;
  return part === 'timeline' ? (workspaces.find((def) => def.id === workspace)?.timeline ?? true) : true;
}

/** M6a (§8.2): whether the time slider shows in the active workspace (Model hides it; Windows › Timeline toggles). */
export function useTimelineShown(): boolean {
  return useChromeShown('timeline');
}

export function TimelineRegion(): JSX.Element | null {
  const shell = useShell();
  const shown = useTimelineShown();
  const def = panelDefOfKind(shell.panels, PANEL.timeline);
  if (!shown) return null;
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
