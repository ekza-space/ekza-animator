// ② Markers step (AUTORIG-SPEC §5.3; D0 stub, D4 owns it): the Quick Rig markers in front │ side │ persp panes, the
// fingers choice, keyboard nudges, the `markers` slice and its reducers. D0 lands only the slice's default.
import type { AutoRigMarkersSlice } from '../../types';

export const MARKERS_SLICE: AutoRigMarkersSlice = { pane: 'front', lastOrtho: 'front' };
