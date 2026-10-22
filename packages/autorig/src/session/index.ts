// The Auto-Rig session store (AUTORIG-SPEC §4.3; D0 stub, D3 owns it): stores the U state, patches slices generically
// and mirrors them to `sessionStorage` (`AUTORIG_SESSION_KEY`). D0 lands the default session, composed from each step
// package's slice default, so every package starts from one definition.
import { ANIMATIONS_SLICE } from '../steps/animations';
import { EXPORT_SLICE } from '../steps/export';
import { MARKERS_SLICE } from '../steps/markers';
import { MODEL_SLICE } from '../steps/model';
import { RIG_SLICE } from '../steps/rig';
import type { AutoRigSession } from '../types';

/** A fresh session: step ①, no subject, no intake, no start pose, every slice at its owner's default. */
export function defaultAutoRigSession(): AutoRigSession {
  return {
    step: 'model',
    subject: { character: null, meshes: [] },
    intake: null,
    startPose: null,
    nav: null,
    busy: null,
    model: MODEL_SLICE,
    markers: MARKERS_SLICE,
    rig: RIG_SLICE,
    animations: ANIMATIONS_SLICE,
    export: EXPORT_SLICE,
  };
}
