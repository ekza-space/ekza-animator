// The Rig & Skin session defaults (M6B-SPEC §4.6, §5.24; C0 baseline, then C7). U state: never in the document.
import type { BrushSettings, RigSessionState } from '../types';

/** Maya's Paint Skin Weights defaults (§8.7): Replace, value 1, opacity 1, 40 px, smooth, surface, front faces. */
export const DEFAULT_BRUSH: BrushSettings = {
  op: 'replace',
  value: 1,
  opacity: 1,
  radiusPx: 40,
  falloff: 'smooth',
  reach: 'surface',
  frontOnly: true,
  mirror: true,
};

/** The right and bottom dock tabs per mode (§5.24 table), remembered per mode once the user changes them. */
const TAB_MEMORY: RigSessionState['tabMemory'] = {
  object: { right: 'channelBox', bottom: 'validation' },
  skeleton: { right: 'rigToolkit', bottom: 'validation' },
  // The Component Editor arrives after the MVP (§0.3, C6): Skin mode keeps Validation below (showing the absent
  // editor's tab would cover the viewport in the R-Side layout, which has no slot for it).
  skin: { right: 'paintWeights', bottom: 'validation' },
  shape: { right: 'attributes', bottom: 'validation' },
};

export function defaultRigSession(): RigSessionState {
  return {
    mode: 'object',
    lastMode: 'skeleton',
    character: null,
    poseView: 'bind',
    activeInfluence: null,
    holds: new Map(),
    paint: { mode: 'paint', brush: DEFAULT_BRUSH },
    snap: { projectedCenter: true, grid: false, vertex: false, increment: false },
    shapeCvMode: false,
    shapeMirrorEdits: true,
    quickRig: null,
    hiddenJoints: new Set(),
    lockedJoints: new Set(),
    tabMemory: TAB_MEMORY,
  };
}
