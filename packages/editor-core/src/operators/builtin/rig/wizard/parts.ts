// `autorig.parts {hidden}` (AUTORIG-SPEC §6.1; AR-D10-1; U state, not undoable): the unticked parts of a multi-mesh
// model ("Part of the character" off) are hidden while Auto-Rig shows the model, so the views show what the VRM will
// hold and a click on a tick shows which mesh it is. Hiding goes through the session's per-user hidden objects
// (`model.hiddenObjects`, the set Studio's Hide writes); the operator remembers which meshes it added and gives back
// only those, so a mesh the user hid in Studio stays hidden. `{hidden: []}` gives every one back (the shell does it
// when Auto-Rig unmounts, so Studio shows the whole scene). The shell runs it (it never writes the session itself,
// §4.1).
import { type EditorApp, GLOBAL_SCOPE, type SceneObjectId } from '../../../../types';
import { type AnyOperator, defineOperator, fail, isRecord, OK } from '../../define';

/** The meshes `autorig.parts` added to the hidden set, per app. */
const added = new WeakMap<EditorApp, ReadonlySet<SceneObjectId>>();

/** The meshes `autorig.parts` hides in this app now (tests). */
export const partsHidden = (app: EditorApp): readonly SceneObjectId[] => [...(added.get(app) ?? [])];

const isMeshList = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((id) => typeof id === 'string');

const parts = defineOperator<'autorig.parts'>({
  id: 'autorig.parts',
  label: 'Hide Left-Out Parts',
  description:
    'Hides the parts left out of the character while Auto-Rig shows the model, or gives them back (per user).',
  category: 'autorig',
  scope: GLOBAL_SCOPE,
  poll(_ctx, args) {
    return isRecord(args) && isMeshList(args['hidden']) ? OK : fail('expects { hidden: mesh ids }');
  },
  apply({ app }, args) {
    const before = app.session.getState().model.hiddenObjects;
    const mine = added.get(app) ?? new Set<SceneObjectId>();
    const wanted = new Set<SceneObjectId>(args.hidden.filter((id) => app.store.get('meshes', id) !== undefined));
    const next = new Set(before);
    const now = new Set<SceneObjectId>();
    // give back what this operator hid and no longer should
    for (const id of mine) if (!wanted.has(id)) next.delete(id);
    // hide the wanted ones; a mesh the user had hidden already stays theirs
    for (const id of wanted) {
      if (mine.has(id) || !before.has(id)) {
        next.add(id);
        now.add(id);
      }
    }
    if (now.size === 0) added.delete(app);
    else added.set(app, now);
    const same = next.size === before.size && [...next].every((id) => before.has(id));
    if (!same) app.session.setState({ model: { ...app.session.getState().model, hiddenObjects: next } });
  },
});

export const WIZARD_PARTS_OPERATORS: readonly AnyOperator[] = [parts];
