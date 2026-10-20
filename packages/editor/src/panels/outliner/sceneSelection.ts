// Scene object selection from the Model panels (M6A-SPEC §6.2 `select.objects`, §8.8; B13): the Outliner runs B10's
// `select.objects {ids, mode}`. Until that operator lands (it poll-fails "not available yet" in a build without B10)
// the panels write the object selection directly, as selection-only U state allows (M6A-B13-4), so the Outliner,
// Attributes and Palette stay usable; with B10 the operator (and its "Select" history step) always runs.
import type { EditorApp, OperatorResult, RunContext, SceneObjectId, SelectMode } from '@ekza-animator/editor-core';
import { NOT_AVAILABLE_YET } from '@ekza-animator/editor-core';

type Run = (op: string, args?: unknown, ctx?: RunContext) => Promise<OperatorResult<unknown>>;

/** The object selection after a click with `mode` on `ids` (Outliner rules: Shift toggles, Mod removes). */
export function nextObjectSelection(
  current: readonly SceneObjectId[],
  ids: readonly SceneObjectId[],
  mode: SelectMode,
): SceneObjectId[] {
  switch (mode) {
    case 'replace':
      return [...ids];
    case 'add':
      return [...current.filter((id) => !ids.includes(id)), ...ids];
    case 'remove':
      return current.filter((id) => !ids.includes(id));
    case 'toggle': {
      const removed = current.filter((id) => !ids.includes(id));
      const added = ids.filter((id) => !current.includes(id));
      return [...removed, ...added];
    }
  }
}

export async function selectObjects(
  app: EditorApp,
  run: Run,
  ids: readonly SceneObjectId[],
  mode: SelectMode,
  panel: string,
): Promise<void> {
  const args = { ids, mode };
  const poll =
    app.operators.get('select.objects') === undefined ? null : app.operators.poll('select.objects', { panel }, args);
  if (poll !== null && poll !== true && poll.reason === NOT_AVAILABLE_YET) {
    const state = app.session.getState();
    const objects = nextObjectSelection(state.selection.objects, ids, mode);
    app.session.setState({ selection: { ...state.selection, objects } });
    return;
  }
  await run('select.objects', args, { panel });
}
