// The `paintedSinceBind` listener (AUTORIG-SPEC §4.3, §5.4; D4; lazy with the ② and ③ views): editor-core's
// `autorigFlow` (T5b, shared with Halo) watches every finished document run — a composition's inner runs included —
// confirmed by the history's top step changing: a `skin.weights.*` run sets the flag, a `skin.bind` (or Create
// Skeleton / its refit) clears it. This module binds it to the wizard's `rig` slice. Conservative: an undone stroke
// still counts (one extra question at most).
import type { Disposer } from '@ekza-studio/anim-core';
import { type EditorApp, watchPaintedSinceBind as flowWatch } from '@ekza-studio/editor-core';
import type { AutoRigSessionStore } from '../../session';

/** Installs the listener for an app while any wizard view needs it (reference-counted); the disposer releases it. */
export function watchPaintedSinceBind(app: EditorApp, session: AutoRigSessionStore): Disposer {
  return flowWatch(app, {
    get: () => session.getState().rig.paintedSinceBind,
    set: (paintedSinceBind) => session.patch('rig', { paintedSinceBind }),
  });
}
