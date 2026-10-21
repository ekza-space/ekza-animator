// C3 (skeleton UI; M6B-SPEC §6, §0.6): the operators of this file, registered by C0 from their stubs (§3 rule 1)
// inside the lazy rig-workspace chunk. MVP operators (§0.6) poll-fail "not available yet" until their owner lands
// them; deferred ones poll-fail "Arrives after the MVP" and are internal (listed in no menu, palette or keymap).
import type { AnyOperator } from '../define';
import { rigStub } from './stub';

export const QUICK_RIG_SESSION_OPERATORS: readonly AnyOperator[] = [
  rigStub('skel.quickRig.start', 'Quick Rig…', {}),
  rigStub('skel.quickRig.setMarker', 'Set Marker', { internal: true }),
  rigStub('skel.quickRig.guess', 'Guess Markers', {}),
  rigStub('skel.quickRig.clear', 'Clear Markers', {}),
  rigStub('skel.quickRig.setPreset', 'Quick Rig Template', { internal: true }),
  rigStub('skel.quickRig.cancel', 'Cancel Quick Rig', {}),
  rigStub('skel.quickRig.pick', 'Select Marker', { internal: true }),
];
