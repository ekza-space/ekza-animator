// The `markers` slice's reducers (AUTORIG-SPEC §4.3, §8.1; D4; lazy with ②'s view): the pane under the pointer (or the
// phone's pane switch), the last ortho pane, the pane a keyboard nudge acts in.
import type { AutoRigMarkersSlice } from '../../types';
import { MARKER_PANE_IDS, type MarkerPane } from './index';

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
