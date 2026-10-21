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
import type { CharacterId, ControlId, ControlRecord } from '@ekza-studio/doc';
import type { ControlVisibility, EditorApp } from '../types';

/** ikFk at or above this hides the FK chain; at or below `IK_HIDDEN_AT` the IK control and pole (§5.5 rule 2). */
export const FK_HIDDEN_AT = 0.999;
export const IK_HIDDEN_AT = 0.001;

/**
 * Rule 2's state of a limb at `ikFk = w`: 2 = IK (its FK chain hidden), 0 = FK (its IK control and pole hidden),
 * 1 = between (both shown). Per-frame callers compare these to skip work while no limb crosses a threshold.
 */
export function limbVisibilityState(w: number): 0 | 1 | 2 {
  return w >= FK_HIDDEN_AT ? 2 : w <= IK_HIDDEN_AT ? 0 : 1;
}

const NO_CONTROLS: ReadonlySet<ControlId> = new Set();

/** Rule 1 on a record and the session (no IK/FK rule). */
function hiddenByRule1(app: EditorApp, record: ControlRecord | undefined): boolean {
  if (record === undefined || record.deleted !== null) return true;
  const state = app.session.getState();
  if (state.hiddenControls.has(record.id)) return true;
  return record.hiddenByDefault && !state.showSecondary;
}

/**
 * The controls of a character that rule 2 hides at the current frame (FK chains of IK limbs, IK controls and poles
 * of FK limbs). A shared empty set without a runtime, without limbs or when no limb hides anything (no allocation).
 */
export function limbHiddenControls(app: EditorApp, character: CharacterId): ReadonlySet<ControlId> {
  const program = app.characters.get(character)?.program;
  if (program === undefined || program.limbs.length === 0) return NO_CONTROLS;
  let out: Set<ControlId> | null = null;
  for (const limb of program.limbs) {
    const state = limbVisibilityState(app.evaluation.ikFk(character, limb.id) ?? 0);
    const hidden = state === 2 ? limb.fkControls : state === 0 ? limb.ikControls : null;
    if (hidden === null || hidden.length === 0) continue;
    out ??= new Set();
    for (const id of hidden) out.add(id);
  }
  return out ?? NO_CONTROLS;
}

/**
 * A resolver for many controls at once (the viewport recomputes every control when the visible set may change):
 * rule 2 is evaluated once per character with limbs and then looked up; characters without limbs cost nothing.
 * Valid until the session, preferences, document or pose change.
 */
export function controlVisibilityResolver(app: EditorApp): (control: ControlId) => ControlVisibility {
  let byCharacter: Map<CharacterId, ReadonlySet<ControlId>> | null = null;
  const state = app.session.getState();
  const ghostPref = app.prefs.getState().ikFkVisibility === 'ghost';
  return (control: ControlId): ControlVisibility => {
    const record = app.store.get('controls', control);
    if (hiddenByRule1(app, record) || record === undefined) return 'hidden';
    const character = app.store.get('rigs', record.rig)?.character;
    if (character === undefined) return 'visible';
    const program = app.characters.get(character)?.program;
    if (program === undefined || program.limbs.length === 0) return 'visible';
    let hidden = byCharacter?.get(character);
    if (hidden === undefined) {
      hidden = limbHiddenControls(app, character);
      (byCharacter ??= new Map()).set(character, hidden);
    }
    if (!hidden.has(control)) return 'visible';
    // Rule 3 (and the 'ghost' preference): hidden by the IK/FK rule but selected — a ghost.
    return ghostPref || state.selection.controls.includes(control) ? 'ghost' : 'hidden';
  };
}

/** M2A-SPEC §5.5 rules 1–3 for one control (see the header). */
export function controlVisibility(app: EditorApp, control: ControlId): ControlVisibility {
  return controlVisibilityResolver(app)(control);
}
