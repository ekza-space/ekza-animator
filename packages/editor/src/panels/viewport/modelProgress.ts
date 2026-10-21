// Getting started progress the document does not show (M6A-SPEC §8.8; B13; imported by lazy chunks only): step ⑥
// "Export model" ticks once a static model export finished in this app (the Export dialog's Static model section
// marks it). Per app and per session, like the other steps' "reached" state.
import type { EditorApp } from '@ekza-studio/editor-core';
import { useSyncExternalStore } from 'react';

const exported = new WeakSet<EditorApp>();
const listeners = new Set<() => void>();

/** Records a finished static model export of `app` (idempotent). */
export function markModelExported(app: EditorApp): void {
  if (exported.has(app)) return;
  exported.add(app);
  for (const listener of listeners) listener();
}

export function modelExported(app: EditorApp): boolean {
  return exported.has(app);
}

/** Re-renders when `app` exports its first static model. */
export function useModelExported(app: EditorApp): boolean {
  return useSyncExternalStore(
    (notify) => {
      listeners.add(notify);
      return () => listeners.delete(notify);
    },
    () => exported.has(app),
    () => exported.has(app),
  );
}
