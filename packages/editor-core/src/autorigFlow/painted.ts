// `paintedSinceBind` (AUTORIG-SPEC §4.3, §5.4; moved from Auto-Rig ③ by T5b): whether weights were painted since the
// flow's last bind, which decides whether a rebind may skip M6b's "Rebind replaces painted weights" question and
// whether the hands may follow their forearms. The listener sees every finished document run through the registry's
// shipped `onBeforeDocumentRun` hook — a composition's inner runs included, which `session.lastRun` would hide — and
// confirms it by the history's top step changing: a `skin.weights.*` run sets the flag, a `skin.bind` (or Create
// Skeleton / its refit, which rebinds a bound skeleton) clears it. A run that records no step (refused, cancelled, a
// navigation) changes nothing. The document has no "painted" flag, so this U state is the flow's own; it is
// conservative (an undone stroke still counts: one extra question at most).
import type { Disposer } from '@ekza-studio/anim-core';
import type { EditorApp } from '../types';

/**
 * Reducer of `paintedSinceBind`: a finished document run with a history step sets it when it was a weight edit
 * (`skin.weights.*`) and clears it when it was a bind (`skin.bind`, or Create Skeleton / its refit); any other run
 * leaves it.
 */
export function paintedAfterRun(id: string, painted: boolean): boolean {
  if (id.startsWith('skin.weights.')) return true;
  if (id === 'skin.bind' || id === 'skel.quickRig.commit') return false;
  return painted;
}

/** Whether a run can change `paintedSinceBind` (the listener watches only these). */
export const paintTracked = (id: string): boolean =>
  id.startsWith('skin.weights.') || id === 'skin.bind' || id === 'skel.quickRig.commit';

/** Where the flag lives (the wizard's `rig` slice, the flow state, Halo's session). */
export interface PaintedPort {
  get(): boolean;
  set(painted: boolean): void;
}

function watch(app: EditorApp, port: PaintedPort): Disposer {
  let pending: { readonly id: string; readonly top: number | null } | null = null;
  const offRun = app.operators.onBeforeDocumentRun((id) => {
    pending = paintTracked(id) ? { id, top: app.history.peekUndo()?.id ?? null } : null;
  });
  const offHistory = app.history.subscribe(() => {
    if (pending === null) return;
    const top = app.history.peekUndo()?.id ?? null;
    if (top === pending.top) return;
    const painted = port.get();
    const next = paintedAfterRun(pending.id, painted);
    pending = null;
    if (next !== painted) port.set(next);
  });
  return () => {
    offRun();
    offHistory();
  };
}

const installed = new WeakMap<EditorApp, { count: number; dispose: Disposer }>();

/**
 * Installs the listener for an app while any view needs it (reference-counted per app: the first port is the one
 * written while it is installed); the disposer releases it.
 */
export function watchPaintedSinceBind(app: EditorApp, port: PaintedPort): Disposer {
  const current = installed.get(app);
  if (current !== undefined) current.count += 1;
  else installed.set(app, { count: 1, dispose: watch(app, port) });
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const entry = installed.get(app);
    if (entry === undefined) return;
    entry.count -= 1;
    if (entry.count === 0) {
      entry.dispose();
      installed.delete(app);
    }
  };
}
