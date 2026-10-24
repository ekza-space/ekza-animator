// What the Thumb key means for the shell now (STUDIO-TOUCH-SPEC §5.5, §4.5): the situation the modifier map is read
// against, and the row in force (null: the key is hidden). Eager: the key's two lines render from it; the controller
// that feeds the viewport (`./thumb`) is in the lazy input chunk.
import type { EditorApp } from '@ekza-studio/editor-core';
import type { HaloStore } from '../shell/store';
import { type Meaning, type ThumbRow, type ThumbSituation, thumbRow } from './modifierMap';

/** What the next tap or drag would act on, from the session and the shell. */
export function situationOf(app: EditorApp, store: HaloStore): ThumbSituation {
  const s = app.session.getState();
  const ui = store.get();
  const components = s.model.components.selected;
  const selected =
    s.selection.controls.length > 0 ||
    s.selection.objects.length > 0 ||
    s.selection.joints.length > 0 ||
    (s.model.componentMode !== 'object' && components.vertex + components.edge + components.face > 0);
  return {
    stage: ui.stage,
    tool: s.tools.viewport,
    selected,
    rigMode: s.rig.mode,
    jointSelected: s.selection.joints.length > 0,
    softSelect: s.model.softSelect.on,
    extrude: s.model.extrudeSession !== null,
    sheet: ui.sheet,
  };
}

/** The row in force for the shell now (null: hidden), honouring Settings › Input › Thumb key (§4.5). */
export function currentRow(app: EditorApp, store: HaloStore): ThumbRow | null {
  const ui = store.get();
  if (ui.home || ui.input.thumbKey === 'never') return null;
  if (ui.input.thumbKey === 'auto' && ui.hardwareModifier) return null;
  return thumbRow(situationOf(app, store));
}

/**
 * The tap and drag meanings in force: the row's, or a meaning chosen in the chooser for this row (a hold-free choice
 * among the selection meanings replaces the tap line, any other the drag line).
 */
export function meaningsOf(
  row: ThumbRow,
  pick: { readonly row: string; readonly meaning: string } | null,
): { readonly tap: Meaning | undefined; readonly drag: Meaning | undefined; readonly chosen: Meaning | null } {
  const chosen = pick !== null && pick.row === row.id ? (row.choices.find((c) => c.id === pick.meaning) ?? null) : null;
  if (chosen === null) return { tap: row.tap, drag: row.drag, chosen };
  return chosen.gesture === 'tap' ? { tap: chosen, drag: row.drag, chosen } : { tap: row.tap, drag: chosen, chosen };
}
