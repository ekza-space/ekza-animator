// Mounted Graph Editors per app (STUDIO-TOUCH-SPEC §20.3 item 18; T10 moved it here from Studio Pro's Graph panel,
// which re-imports it): Pro's Graph panels and a touch shell's Curves layer share one registry. The first mounted editor
// registers the graph contributions (tools, `graph.frame`, `select.curveKeys`, `graph.view.setMode`); the last one to
// unmount removes them. `graph.frame` and the e2e test hooks act on the focused editor: the one the pointer last
// entered or pressed, else the most recently mounted.
import type { Disposer } from '@ekza-studio/anim-core';
import type { EditorApp } from '@ekza-studio/editor-core';
import { registerGraphContributions } from './graph/contributions';
import type { GraphEditorController } from './graph/GraphEditorController';

export interface GraphEditorHandle {
  readonly controller: GraphEditorController;
  /** The canvas that receives pointer events (its client rect maps canvas CSS px to page px). */
  readonly surface: HTMLCanvasElement;
  /** Shown size ÷ controller size (a touch shell draws the controller at its size and shows it larger); 1 if absent. */
  readonly scale?: number;
}

interface AppGraphEditors {
  readonly handles: GraphEditorHandle[];
  focused: GraphEditorHandle | null;
  contributions: Disposer | null;
}

const editors = new WeakMap<EditorApp, AppGraphEditors>();

function entryOf(app: EditorApp): AppGraphEditors {
  let entry = editors.get(app);
  if (entry === undefined) {
    entry = { handles: [], focused: null, contributions: null };
    editors.set(app, entry);
  }
  return entry;
}

/** The Graph Editor `graph.frame` and the test hooks act on; null when none is mounted. */
export function focusedGraphEditor(app: EditorApp): GraphEditorHandle | null {
  const entry = editors.get(app);
  if (entry === undefined) return null;
  return entry.focused ?? entry.handles.at(-1) ?? null;
}

export function focusGraphEditor(app: EditorApp, handle: GraphEditorHandle): void {
  const entry = entryOf(app);
  if (entry.handles.includes(handle)) entry.focused = handle;
}

export function attachGraphEditor(app: EditorApp, handle: GraphEditorHandle): Disposer {
  const entry = entryOf(app);
  entry.handles.push(handle);
  if (entry.contributions === null) {
    try {
      entry.contributions = registerGraphContributions(app, () => focusedGraphEditor(app)?.controller ?? null);
    } catch (error) {
      // Another owner already contributed the graph tools: the editor still works with those.
      console.warn('Graph Editor contributions were not registered:', error);
    }
  }
  return () => {
    const index = entry.handles.indexOf(handle);
    if (index === -1) return;
    entry.handles.splice(index, 1);
    if (entry.focused === handle) entry.focused = null;
    if (entry.handles.length === 0) {
      entry.contributions?.();
      entry.contributions = null;
    }
  };
}
