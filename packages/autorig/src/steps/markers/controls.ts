// The rig's controls hidden while Auto-Rig shows a character (AR-D8-4, AR-D9-8; D8, D9; lazy with ② to ④): after
// Auto-rig the IK rings and pole targets covered the markers (②), the joints (③ *Adjust joints*) and the character
// whose deformation ③'s review and ④'s previews show. While a step holds them, every control of the document is in
// the session's per-user hidden set (`session.hiddenControls`, U state: no pane flags, so nothing stays behind in
// the panes' per-workspace memory when the shell unmounts or a step changes the workspace); the controls the wizard
// hid are given back when the last hold ends (a tick later, so a step change does not flash them), and Studio draws
// them again.
import type { ControlId } from '@ekza-studio/doc';
import type { EditorApp } from '@ekza-studio/editor-core';
import { useEffect } from 'react';
import type { WizardContext } from '../../shell/context';

interface Hold {
  count: number;
  /** The controls this hold added to the hidden set (the user's own hidden ones are left alone). */
  readonly added: Set<ControlId>;
  off: (() => void) | null;
  release: ReturnType<typeof setTimeout> | null;
}

const holds = new WeakMap<EditorApp, Hold>();

function hideAll(app: EditorApp, hold: Hold): void {
  const before = app.session.getState().hiddenControls;
  let next: Set<ControlId> | null = null;
  for (const control of app.store.list('controls')) {
    if (control.deleted !== null || before.has(control.id)) continue;
    next ??= new Set(before);
    next.add(control.id);
    hold.added.add(control.id);
  }
  if (next !== null) app.session.setState({ hiddenControls: next });
}

function showAgain(app: EditorApp, hold: Hold): void {
  hold.off?.();
  hold.off = null;
  const before = app.session.getState().hiddenControls;
  const next = new Set([...before].filter((id) => !hold.added.has(id)));
  hold.added.clear();
  if (next.size !== before.size) app.session.setState({ hiddenControls: next });
}

/** Hides every control while `active` (the third argument is kept for the callers' layout key; unused). */
export function useHiddenControls(ctx: WizardContext, active: boolean, _layout?: string): void {
  useEffect(() => {
    if (!active) return undefined;
    const { app } = ctx;
    let hold = holds.get(app);
    if (hold === undefined) {
      hold = { count: 0, added: new Set(), off: null, release: null };
      holds.set(app, hold);
    }
    const current = hold;
    if (current.release !== null) {
      clearTimeout(current.release);
      current.release = null;
    }
    current.count += 1;
    hideAll(app, current);
    // controls a re-rig or an undo brings back are hidden too
    current.off ??= app.store.subscribe(() => hideAll(app, current));
    return () => {
      current.count -= 1;
      if (current.count > 0) return;
      current.release = setTimeout(() => {
        current.release = null;
        if (current.count === 0) showAgain(app, current);
      }, 0);
    };
  }, [ctx, active]);
}
