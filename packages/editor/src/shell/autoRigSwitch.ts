// Auto-Rig (AUTORIG-SPEC §3.4, D2): the lazy half of Studio's switch to Auto-Rig (`shell.autoRig`, `./menuItems`). The
// subject rule and the first-run dialog's remembered-choice write live here, in a small chunk of their own, so that
// `/editor`'s eager scripts keep only the two menu items and the operator (§7.0 rules 1 and 5, AR-D2-10/11). The
// chunk is prefetched when the File or Help menu opens (`prefetchForMenuItems`), so a menu click does not wait for it;
// it never imports the Rig & Skin chunk (`rig-workspace`) nor the Model operators chunk.
import type { GroupId, MeshId } from '@ekza-studio/doc';
import type { AutoRigSubject, EditorApp } from '@ekza-studio/editor-core';

export { writeEntryChoice } from '../dialogs/entryChoice';

/**
 * What Auto-Rig works on when Studio switches to it (§3.4): the selection — the scene meshes under the selected
 * objects (a selected group gives its descendant meshes, as `char.fromModel` reads its objects; a selected mesh its
 * child meshes too), else the active character — else every visible scene mesh; else null (Auto-Rig starts at its
 * Model step). §3.4's last fallback, "the only character", is the active character: the session keeps one active
 * whenever a character exists (`repairSession`). Visible = neither the mesh nor any of its ancestors is hidden (Model's
 * Hide), as `objectsDrawnIn` reads it. One walk down the scene hierarchy; `childrenOf` breaks parent cycles.
 */
export function autoRigSubject(app: EditorApp): AutoRigSubject | null {
  const { selection, activeCharacter, model } = app.session.getState();
  const picked = new Set<string>(selection.objects);
  const selected: MeshId[] = [];
  const visible: MeshId[] = [];
  const walk = (parent: GroupId | MeshId | null, under: boolean, shown: boolean): void => {
    for (const record of app.store.query.childrenOf(parent, 'scene')) {
      const inSelection = under || picked.has(record.id);
      const isShown = shown && !model.hiddenObjects.has(record.id);
      if ('data' in record) {
        if (inSelection) selected.push(record.id);
        if (isShown) visible.push(record.id);
      }
      walk(record.id, inSelection, isShown);
    }
  };
  walk(null, false, true);
  if (selected.length > 0) return { character: null, meshes: selected };
  if (activeCharacter !== null) return { character: activeCharacter, meshes: [] };
  return visible.length > 0 ? { character: null, meshes: visible } : null;
}
