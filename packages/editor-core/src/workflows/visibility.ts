// M2A-SPEC §5.5: `controlVisibility`, the single visibility rule of controls (viewport drawing and picking, marquee,
// Outliner dimming, pick-walk, the test API `controls()[].visible`). A0 lands rule 1 as a working baseline (M1 code
// paths call it from the first day); A2 adds the IK/FK rules 2–5 (hidden FK/IK sets by `evaluation.ikFk`, ghosts).
import type { ControlId } from '@ekza-animator/doc';
import type { ControlVisibility, EditorApp } from '../types';

/**
 * Rule 1: `hidden` when the user hid the control (`session.hiddenControls`) or it is `hiddenByDefault` (secondary
 * controls) while `showSecondary` is off; `hidden` for unknown or deleted controls; else `visible`.
 */
export function controlVisibility(app: EditorApp, control: ControlId): ControlVisibility {
  const record = app.store.get('controls', control);
  if (record === undefined) return 'hidden';
  const state = app.session.getState();
  if (state.hiddenControls.has(control)) return 'hidden';
  if (record.hiddenByDefault && !state.showSecondary) return 'hidden';
  return 'visible';
}
