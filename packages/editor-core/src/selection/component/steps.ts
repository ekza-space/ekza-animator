// Selection undo (M6A-SPEC §5.6, ADR 0016 D12; B10): with `prefs.modeling.undoSelection[workspace]` on (Model's
// default), every selection gesture records one selection-only history step through `EditorHistory.recordSelection`
// ("Select"; hide and show record "Hide"/"Show"). A gesture that changes nothing records nothing. Auto-repeated
// grow/shrink keys (`RunContext.repeat`) coalesce into the step before, but only into the step the run right before
// them recorded: a continuation never merges into an earlier gesture's step when its own first run changed nothing.
import type { EditorApp, HideSnapshot, MeshSelectionSnapshot, SelectionGesture, SelectionSnapshot } from '../../types';

/** Whether the active workspace records selection steps (Model: on, Animate: off). */
export function undoSelectionOn(app: Pick<EditorApp, 'prefs' | 'session'>): boolean {
  return app.prefs.getState().modeling.undoSelection[app.session.getState().workspace] === true;
}

function sameArray(a: ArrayLike<number> | null, b: ArrayLike<number> | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

function sameMesh(a: MeshSelectionSnapshot | undefined, b: MeshSelectionSnapshot | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return (
    a.manifest === b.manifest &&
    a.kind === b.kind &&
    a.active === b.active &&
    sameArray(a.verts, b.verts) &&
    sameArray(a.edges, b.edges) &&
    sameArray(a.faces, b.faces) &&
    sameArray(a.order, b.order)
  );
}

/** Whether two selection snapshots describe the same selection (controls, objects, per-mesh components). */
export function sameSelection(a: SelectionSnapshot, b: SelectionSnapshot): boolean {
  if (!sameList(a.controls, b.controls) || !sameList(a.objects, b.objects)) return false;
  const keys = new Set([...Object.keys(a.meshes), ...Object.keys(b.meshes)]);
  for (const key of keys) if (!sameMesh(a.meshes[key], b.meshes[key])) return false;
  return true;
}

/** Whether two hide snapshots describe the same hidden objects and components. */
export function sameHidden(a: HideSnapshot, b: HideSnapshot): boolean {
  if (a.objects.length !== b.objects.length || !a.objects.every((id) => b.objects.includes(id))) return false;
  const keys = new Set([...Object.keys(a.meshes), ...Object.keys(b.meshes)]);
  for (const key of keys) {
    const x = a.meshes[key];
    const y = b.meshes[key];
    if (x === undefined || y === undefined) {
      if (x !== y) return false;
      continue;
    }
    if (x.manifest !== y.manifest || !sameArray(x.verts, y.verts) || !sameArray(x.edges, y.edges)) return false;
    if (!sameArray(x.faces, y.faces)) return false;
  }
  return true;
}

/** Per app: the id of the step the last selection run recorded, null when that run recorded nothing. */
const lastRecorded = new WeakMap<EditorApp, number | null>();

/**
 * Runs a selection gesture: snapshots the selection of `meshes` (default: the hilited meshes) before and after `fn`
 * and records one "Select" step when it changed and the workspace records selection steps. `repeat` continues the
 * top step only when the previous selection run recorded it (every discrete gesture is its own step, §5.6).
 */
export function selectionGesture<T>(
  app: EditorApp,
  gesture: SelectionGesture,
  opts: { readonly repeat?: boolean; readonly meshes?: readonly string[] },
  fn: () => T,
): T {
  const meshes = opts.meshes as SelectionSnapshot['hilite'] | undefined;
  const before = app.components.snapshot(meshes);
  const result = fn();
  const after = app.components.snapshot(meshes);
  if (undoSelectionOn(app) && !sameSelection(before, after)) {
    const previous = lastRecorded.get(app) ?? null;
    const continues = opts.repeat === true && previous !== null && previous === app.history.peekUndo()?.id;
    app.history.recordSelection(
      { kind: 'select', gesture, before, after },
      'Select',
      continues ? { repeat: true } : undefined,
    );
    lastRecorded.set(app, app.history.peekUndo()?.id ?? null);
  } else {
    lastRecorded.set(app, null);
  }
  return result;
}

/** Records a "Hide" or "Show" step when the hidden objects or components changed (and the workspace records them). */
export function recordHide(app: EditorApp, label: 'Hide' | 'Show', before: HideSnapshot, after: HideSnapshot): void {
  if (!undoSelectionOn(app) || sameHidden(before, after)) return;
  app.history.recordSelection({ kind: 'hide', before, after }, label);
}
