// The `paintedSinceBind` listener (AUTORIG-SPEC §4.3, §5.4; D4; lazy with the ② and ③ views). It sees every finished
// document run through the registry's shipped `onBeforeDocumentRun` hook — a composition's inner runs included, which
// `session.lastRun` would hide — and confirms it by the history's top step changing: a `skin.weights.*` run sets the
// flag, a `skin.bind` (or Create Skeleton / its refit, which rebinds a bound skeleton) clears it. A run that records
// no step (refused, cancelled, a navigation) changes nothing. The document has no "painted" flag, so this U state is
// the wizard's own; it is conservative (an undone stroke still counts: one extra question at most).
import type { Disposer } from '@ekza-studio/anim-core';
import type { EditorApp } from '@ekza-studio/editor-core';
import type { AutoRigSessionStore } from '../../session';
import { paintedAfterRun, paintTracked } from './index';

const installed = new WeakMap<EditorApp, { count: number; dispose: Disposer }>();

function watch(app: EditorApp, session: AutoRigSessionStore): Disposer {
  let pending: { readonly id: string; readonly top: number | null } | null = null;
  const offRun = app.operators.onBeforeDocumentRun((id) => {
    pending = paintTracked(id) ? { id, top: app.history.peekUndo()?.id ?? null } : null;
  });
  const offHistory = app.history.subscribe(() => {
    if (pending === null) return;
    const top = app.history.peekUndo()?.id ?? null;
    if (top === pending.top) return;
    const painted = session.getState().rig.paintedSinceBind;
    const next = paintedAfterRun(pending.id, painted);
    pending = null;
    if (next !== painted) session.patch('rig', { paintedSinceBind: next });
  });
  return () => {
    offRun();
    offHistory();
  };
}

/** Installs the listener for an app while any wizard view needs it (reference-counted); the disposer releases it. */
export function watchPaintedSinceBind(app: EditorApp, session: AutoRigSessionStore): Disposer {
  const current = installed.get(app);
  if (current !== undefined) current.count += 1;
  else installed.set(app, { count: 1, dispose: watch(app, session) });
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
