// Rig & Skin below 1024 px (M6B-SPEC §5.24; research 09 §11.2, research 19): view-only. The rig shell watches the
// window width and tells editor-core (`setRigViewOnly`), whose runner then refuses document edits in Rig & Skin;
// test poses (U state) and Validation keep working. The pane banner reads the same flag.
import type { Disposer } from '@ekza-studio/anim-core';
import { type EditorApp, setRigViewOnly } from '@ekza-studio/editor-core';

/** Narrower than the minimum editing width of research 09 §11.2 (1024 px). */
export const RIG_VIEW_ONLY_QUERY = '(max-width: 1023.98px)';

const listeners = new Set<() => void>();
let narrow = false;

/** Whether the window is narrower than 1024 px (false without `matchMedia`). */
export function rigNarrow(): boolean {
  return narrow;
}

export function subscribeRigNarrow(listener: () => void): Disposer {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Follows the window width for `app` until disposed (the editor stays editable when the query is unavailable). */
export function watchRigViewOnly(app: EditorApp): Disposer {
  const media = typeof globalThis.matchMedia === 'function' ? globalThis.matchMedia(RIG_VIEW_ONLY_QUERY) : null;
  const update = (): void => {
    narrow = media?.matches === true;
    setRigViewOnly(app, narrow);
    for (const listener of Array.from(listeners)) listener();
  };
  update();
  media?.addEventListener('change', update);
  return () => {
    media?.removeEventListener('change', update);
    narrow = false;
    setRigViewOnly(app, false);
    for (const listener of Array.from(listeners)) listener();
  };
}
