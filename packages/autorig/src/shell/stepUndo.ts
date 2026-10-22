// A step's own undo (AR-D8-3; D8): a step whose edits are U state, not document history, registers undo/redo here while
// its view is mounted — ② Markers' marker edits. The frame's Undo / Redo buttons and Mod+Z / Mod+Shift+Z / Mod+Y then
// run the step's instead of `edit.undo` / `edit.redo`, so Mod+Z after a marker drag reverts the drag and never undoes
// the import behind the step (an empty step history does nothing).
import type { WizardContext } from './context';
import { type SmallStore, smallStore } from './store';

export interface StepUndo {
  /** The label of the step's next undo / redo (null: nothing to undo / redo). */
  readonly undoLabel: string | null;
  readonly redoLabel: string | null;
  undo(): void;
  redo(): void;
}

const stores = new WeakMap<WizardContext['session'], SmallStore<StepUndo | null>>();

/** The step undo of a wizard session (null: the document history applies). */
export function stepUndo(session: WizardContext['session']): SmallStore<StepUndo | null> {
  let store = stores.get(session);
  if (store === undefined) {
    store = smallStore<StepUndo | null>(null);
    stores.set(session, store);
  }
  return store;
}
