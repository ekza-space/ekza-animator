// `autorig.controls {hidden}` (AUTORIG-SPEC §5.4, §5.5; AR-D9-8; U state, not undoable): hides every control of the
// document while Auto-Rig shows a character (②–④), through the session's per-user hidden set
// (`session.hiddenControls`; no pane flags, which live in the panes' per-workspace memory and stayed off in Studio
// after a hand-over), and gives back only the controls it hid. While hidden, controls the document gains (a re-rig, an
// undo) are hidden too. The shell runs it (it never writes the session itself, §4.1).
import type { ControlId } from '@ekza-studio/doc';
import { type EditorApp, GLOBAL_SCOPE } from '../../../../types';
import { type AnyOperator, defineOperator, fail, isRecord, OK } from '../../define';

interface Held {
  /** The controls this operator added to the hidden set (the user's own hidden ones are left alone). */
  readonly added: Set<ControlId>;
  readonly off: () => void;
}

const held = new WeakMap<EditorApp, Held>();

function hideAll(app: EditorApp, added: Set<ControlId>): void {
  const before = app.session.getState().hiddenControls;
  let next: Set<ControlId> | null = null;
  for (const control of app.store.list('controls')) {
    if (control.deleted !== null || before.has(control.id)) continue;
    next ??= new Set(before);
    next.add(control.id);
    added.add(control.id);
  }
  if (next !== null) app.session.setState({ hiddenControls: next });
}

/** Whether `autorig.controls` holds the controls hidden in this app (tests). */
export const controlsHeld = (app: EditorApp): boolean => held.has(app);

const controls = defineOperator<'autorig.controls'>({
  id: 'autorig.controls',
  label: 'Hide Rig Controls',
  description: "Hides the rig's controls while Auto-Rig shows the character, or gives them back (per user, not saved).",
  category: 'autorig',
  scope: GLOBAL_SCOPE,
  poll(_ctx, args) {
    return isRecord(args) && typeof args['hidden'] === 'boolean' ? OK : fail('expects { hidden: boolean }');
  },
  apply({ app }, args) {
    const current = held.get(app);
    if (args.hidden) {
      if (current !== undefined) {
        hideAll(app, current.added);
        return;
      }
      const added = new Set<ControlId>();
      hideAll(app, added);
      held.set(app, { added, off: app.store.subscribe(() => hideAll(app, added)) });
      return;
    }
    if (current === undefined) return;
    held.delete(app);
    current.off();
    const before = app.session.getState().hiddenControls;
    const next = new Set([...before].filter((id) => !current.added.has(id)));
    if (next.size !== before.size) app.session.setState({ hiddenControls: next });
  },
});

export const WIZARD_CONTROLS_OPERATORS: readonly AnyOperator[] = [controls];
