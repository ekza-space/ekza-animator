// ② Markers step (AUTORIG-SPEC §5.3, §8.1, §8.3; D4): M6b's Quick Rig (C2/C3) in the front │ side │ persp panes of
// the `'rig-markers'` layout, the compact marker list beside a body pictogram, the fingers choice, keyboard nudges and
// *Auto-rig ▸* (`autorig.rig`, then ③). This module is in `/autorig`'s first visit (the frame's step registry and the
// session store import it), so it holds only the `markers` slice, its reducers and the pane grid; the view
// (`./MarkersStep`), the step's start (`./enter`) and the keys (`./keys`) are lazy chunks.
import type { WizardContext } from '../../shell/context';
import type { StepPane, StepViewProps } from '../../shell/steps';
import type { AutoRigMarkersSlice, AutoRigSession } from '../../types';
import type { ComponentType } from 'react';

export const MARKERS_SLICE: AutoRigMarkersSlice = { pane: 'front', lastOrtho: 'front' };

export type MarkerPane = AutoRigMarkersSlice['pane'];

/** The R-Markers pane ids and sizes (C7's `RIG_MARKER_PANES` / `RIG_MARKER_SIZES`, written out: importing the
 *  constants from `/autorig` costs `/editor` bytes, AR-D3-1). */
export const MARKER_PANE_IDS: Readonly<Record<MarkerPane, string>> = {
  front: 'pane-front',
  side: 'pane-side',
  persp: 'pane-persp',
};
const SIZES: Readonly<Record<MarkerPane, number>> = { front: 40, side: 30, persp: 30 };

/** The pane kind of a pane id, or null for another pane. */
export function paneKind(id: string | null | undefined): MarkerPane | null {
  if (id === MARKER_PANE_IDS.front) return 'front';
  if (id === MARKER_PANE_IDS.side) return 'side';
  if (id === MARKER_PANE_IDS.persp) return 'persp';
  return null;
}

/** Reducer: the pane the pointer is over (or the phone's switch picked); an ortho pane is remembered as the last one. */
export function withPane(slice: AutoRigMarkersSlice, pane: MarkerPane): Partial<AutoRigMarkersSlice> {
  if (slice.pane === pane && (pane === 'persp' || slice.lastOrtho === pane)) return {};
  return pane === 'persp' ? { pane } : { pane, lastOrtho: pane };
}

/** The ortho pane a keyboard nudge acts in: the pane under the pointer, else the last ortho pane used (§8.1). */
export function nudgePane(slice: AutoRigMarkersSlice): 'front' | 'side' {
  return slice.pane === 'persp' ? slice.lastOrtho : slice.pane;
}

/** §8.3 device classes by the window's width. */
export type ScreenClass = 'phone' | 'tablet' | 'desktop';

export function screenClass(width: number): ScreenClass {
  if (width < 700) return 'phone';
  return width < 1024 ? 'tablet' : 'desktop';
}

const windowClass = (): ScreenClass => (typeof window === 'undefined' ? 'desktop' : screenClass(window.innerWidth));

/**
 * The ② pane grid (§5.3, §8.3): front │ side │ persp (40/30/30) on a desktop; front │ side with a 3D toggle on a
 * tablet in portrait; one pane at a time on a phone (the Front │ Side │ 3D switch writes `markers.pane`).
 */
export function markerPanes(slice: AutoRigMarkersSlice, screen: ScreenClass): readonly StepPane[] {
  const pane = (kind: MarkerPane, size?: number): StepPane => ({
    id: MARKER_PANE_IDS[kind],
    ...(size === undefined ? {} : { size }),
  });
  if (screen === 'phone') return [pane(slice.pane)];
  if (screen === 'tablet') return slice.pane === 'persp' ? [pane('persp')] : [pane('front', 50), pane('side', 50)];
  return (['front', 'side', 'persp'] as const).map((kind) => pane(kind, SIZES[kind]));
}

export const stepPanes = (session: AutoRigSession): readonly StepPane[] => markerPanes(session.markers, windowClass());

/** §4.2's step start: Quick Rig on the subject (a lazy chunk). */
export const stepEnter = (ctx: WizardContext): Promise<void> =>
  import('./enter').then((module) => module.enterMarkers(ctx));

export const stepView = (): Promise<{ readonly default: ComponentType<StepViewProps> }> => import('./MarkersStep');
