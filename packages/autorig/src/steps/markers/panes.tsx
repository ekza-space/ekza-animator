// What ② and ③'s *Adjust joints* draw over the R-Markers panes (AUTORIG-SPEC §5.3 wireframe, §8.3; D4): each pane's
// label — FRONT · drag ↔ ↕, SIDE · depth ↕, 3D · orbit — laid out like the frame's pane grid, and the §8.3 device class
// following the window's width.
import type { StepPane } from '../../shell/steps';
import { type JSX, useEffect, useState } from 'react';
import { messages } from '../../i18n';
import { type MarkerPane, paneKind, type ScreenClass, screenClass } from './index';

/** The §8.3 device class, following the window's width. */
export function useScreenClass(): ScreenClass {
  const [screen, setScreen] = useState<ScreenClass>(() =>
    typeof window === 'undefined' ? 'desktop' : screenClass(window.innerWidth),
  );
  useEffect(() => {
    const update = (): void => setScreen(screenClass(window.innerWidth));
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return screen;
}

const LABEL: Readonly<Record<MarkerPane, () => string>> = {
  front: () => messages().markers.paneFront,
  side: () => messages().markers.paneSide,
  persp: () => messages().markers.panePersp,
};

/** The pane labels over a pane grid (pointer-transparent). */
export function PaneLabels(props: { readonly panes: readonly StepPane[] }): JSX.Element {
  return (
    <div className="pointer-events-none absolute inset-0 flex" data-testid="ar-pane-labels">
      {props.panes.map((pane) => (
        <div key={pane.id} className="min-w-0" style={{ flex: `${pane.size ?? 1} 1 0` }}>
          <span
            className="m-1 inline-block rounded-field bg-panel/80 px-1.5 text-[11px] text-fg-2"
            data-pane-label={pane.id}
          >
            {LABEL[paneKind(pane.id) ?? 'persp']()}
          </span>
        </div>
      ))}
    </div>
  );
}
