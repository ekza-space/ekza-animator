// Mounted Dope Sheets per app: `dopeSheet.frame`, the ripple control set and the e2e probe act on the focused one —
// the one the pointer last entered or pressed, else the most recently mounted. Type-only imports of the controller
// keep this module (loaded with the eager panel wrapper) free of the lazy body's code.
import type { Disposer } from '@ekza-studio/anim-core';
import type { DopeSheetController } from '@ekza-studio/curve-editor';
import type { EditorApp } from '@ekza-studio/editor-core';

export interface DopeSheetHandle {
  readonly controller: DopeSheetController;
  /** The canvas that receives pointer events (its client rect maps canvas CSS px to page px). */
  readonly surface: HTMLCanvasElement;
}

interface AppDopeSheets {
  readonly handles: DopeSheetHandle[];
  focused: DopeSheetHandle | null;
}

const sheets = new WeakMap<EditorApp, AppDopeSheets>();

function entryOf(app: EditorApp): AppDopeSheets {
  let entry = sheets.get(app);
  if (entry === undefined) {
    entry = { handles: [], focused: null };
    sheets.set(app, entry);
  }
  return entry;
}

/** The Dope Sheet the operators and the probe act on; null when none is mounted. */
export function focusedDopeSheet(app: EditorApp): DopeSheetHandle | null {
  const entry = sheets.get(app);
  if (entry === undefined) return null;
  return entry.focused ?? entry.handles.at(-1) ?? null;
}

export function focusDopeSheet(app: EditorApp, handle: DopeSheetHandle): void {
  const entry = entryOf(app);
  if (entry.handles.includes(handle)) entry.focused = handle;
}

export function attachDopeSheet(app: EditorApp, handle: DopeSheetHandle): Disposer {
  const entry = entryOf(app);
  entry.handles.push(handle);
  return () => {
    const index = entry.handles.indexOf(handle);
    if (index === -1) return;
    entry.handles.splice(index, 1);
    if (entry.focused === handle) entry.focused = null;
  };
}
