// M2A-SPEC §5.5: `controlVisibility`, the single visibility rule of controls (viewport drawing and picking, marquee,
// Outliner dimming, pick-walk, the test API `controls()[].visible`). Key targets ('character', 'bodyPart') apply
// rule 1 only (`isControlVisible` in targets.ts).
//
// 1. `hidden` when the user hid the control (`session.hiddenControls`) or it is `hiddenByDefault` (secondary
//    controls) while `showSecondary` is off; `hidden` for unknown or deleted controls.
// 2. IK/FK: with `w = evaluation.ikFk(character, limb)` at the current frame, a limb's `fkControls` are hidden when
//    `w ≥ 0.999` and its `ikControls` when `w ≤ 0.001`; with `prefs.ikFkVisibility: 'ghost'` (M2a-stretch) they are
//    `ghost` instead (25 % alpha, not pickable). `fk.toes` and finger controls follow rule 1 only.
// 3. A selected control that rule 2 hides is `ghost` (drawn at 25 % alpha, never pickable) and stays selected.
// 4–5. The viewport draws pole lines for visible poles and recomputes visibility per pose version (viewport).
import type { CharacterId, ControlId, ControlRecord } from '@ekza-animator/doc';
import type { ControlVisibility, EditorApp } from '../types';

/** ikFk at or above this hides the FK chain; at or below `IK_HIDDEN_AT` the IK control and pole (§5.5 rule 2). */
export const FK_HIDDEN_AT = 0.999;
export const IK_HIDDEN_AT = 0.001;

/** Rule 1 on a record and the session (no IK/FK rule). */
function hiddenByRule1(app: EditorApp, record: ControlRecord | undefined): boolean {
  if (record === undefined || record.deleted !== null) return true;
  const state = app.session.getState();
  if (state.hiddenControls.has(record.id)) return true;
  return record.hiddenByDefault && !state.showSecondary;
}

/**
 * The controls of a character that rule 2 hides at the current frame (FK chains of IK limbs, IK controls and poles
 * of FK limbs). Empty without a runtime or without limbs.
 */
export function limbHiddenControls(app: EditorApp, character: CharacterId): ReadonlySet<ControlId> {
  const program = app.characters.get(character)?.program;
  const out = new Set<ControlId>();
  if (program === undefined || program.limbs.length === 0) return out;
  for (const limb of program.limbs) {
    const w = app.evaluation.ikFk(character, limb.id) ?? 0;
    if (w >= FK_HIDDEN_AT) for (const id of limb.fkControls) out.add(id);
    if (w <= IK_HIDDEN_AT) for (const id of limb.ikControls) out.add(id);
  }
  return out;
}

/**
 * A resolver for many controls at once (the viewport recomputes every control per pose version): rule 2 is
 * evaluated once per character and then looked up. Valid until the session, preferences, document or pose change.
 */
export function controlVisibilityResolver(app: EditorApp): (control: ControlId) => ControlVisibility {
  const byCharacter = new Map<CharacterId, ReadonlySet<ControlId>>();
  const state = app.session.getState();
  const selected = new Set(state.selection.controls);
  const ghostPref = app.prefs.getState().ikFkVisibility === 'ghost';
  return (control: ControlId): ControlVisibility => {
    const record = app.store.get('controls', control);
    if (hiddenByRule1(app, record) || record === undefined) return 'hidden';
    const character = app.store.get('rigs', record.rig)?.character;
    if (character === undefined) return 'visible';
    let hidden = byCharacter.get(character);
    if (hidden === undefined) {
      hidden = limbHiddenControls(app, character);
      byCharacter.set(character, hidden);
    }
    if (!hidden.has(control)) return 'visible';
    return ghostPref || selected.has(control) ? 'ghost' : 'hidden';
  };
}

/** M2A-SPEC §5.5 rules 1–3 for one control (see the header). */
export function controlVisibility(app: EditorApp, control: ControlId): ControlVisibility {
  return controlVisibilityResolver(app)(control);
}
