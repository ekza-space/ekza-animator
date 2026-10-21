// Scene objects (meshes and groups, M6A-SPEC §4.2) as the viewport's transform tools see them (B9): the world matrix
// of an object (its placement composed with its parents', and with the character root for character-owned meshes)
// and its pivot. The Scale tool scales the selected objects in Model's object mode; B12a's move and rotate reuse it.
import { type Mat4, mat4Compose, mat4Multiply, type ReadonlyVec3, type ReadonlyXf } from '@ekza-studio/anim-core';
import type { CharacterId, GroupRecord, MeshRecord } from '@ekza-studio/doc';
import type { EditorApp } from '@ekza-studio/editor-core';

export type SceneObjectRecord = MeshRecord | GroupRecord;

/** The live mesh or group record of an id, or null. */
export function sceneObject(app: Pick<EditorApp, 'store'>, id: string): SceneObjectRecord | null {
  const mesh = app.store.get('meshes', id as MeshRecord['id']);
  if (mesh !== undefined) return mesh.deleted === null ? mesh : null;
  const group = app.store.get('groups', id as GroupRecord['id']);
  return group !== undefined && group.deleted === null ? group : null;
}

/** The table an object lives in. */
export function objectTable(record: SceneObjectRecord): 'meshes' | 'groups' {
  return 'data' in record ? 'meshes' : 'groups';
}

/**
 * The scene matrix of an object: the character root (for character-owned objects; identity when unknown), then the
 * placements from the top parent down. A missing, deleted, cross-owner or cyclic parent ends the chain (it reads as
 * a root, as the document's queries do).
 */
export function objectWorld(
  app: Pick<EditorApp, 'store'>,
  record: SceneObjectRecord,
  characterWorld: (character: CharacterId) => Mat4 | null,
): Mat4 {
  const chain: ReadonlyXf[] = [record.placement];
  const seen = new Set<string>([record.id]);
  const owner = ownerKey(record);
  let parent: string | null = record.parent;
  while (parent !== null && !seen.has(parent)) {
    seen.add(parent);
    const next = sceneObject(app, parent);
    if (next === null || ownerKey(next) !== owner) break;
    chain.push(next.placement);
    parent = next.parent;
  }
  const character = 'character' in record.owner ? record.owner.character : null;
  let world: Mat4 | null = character === null ? null : characterWorld(character);
  for (let i = chain.length - 1; i >= 0; i--) {
    const local = mat4Compose(chain[i] as ReadonlyXf);
    world = world === null ? local : mat4Multiply(world, local);
  }
  return world ?? mat4Compose(record.placement);
}

/** World position of the object's pivot (object space → scene). */
export function pivotWorld(world: Mat4, pivot: ReadonlyVec3): [number, number, number] {
  const m = world;
  return [
    (m[0] as number) * pivot[0] + (m[4] as number) * pivot[1] + (m[8] as number) * pivot[2] + (m[12] as number),
    (m[1] as number) * pivot[0] + (m[5] as number) * pivot[1] + (m[9] as number) * pivot[2] + (m[13] as number),
    (m[2] as number) * pivot[0] + (m[6] as number) * pivot[1] + (m[10] as number) * pivot[2] + (m[14] as number),
  ];
}

function ownerKey(record: SceneObjectRecord): string {
  return 'character' in record.owner ? `char:${record.owner.character}` : 'scene';
}

/** The lead and the other selected objects that still exist. */
export function selectedObjects(app: Pick<EditorApp, 'store' | 'session'>): readonly SceneObjectRecord[] {
  const out: SceneObjectRecord[] = [];
  for (const id of app.session.getState().selection.objects) {
    const record = sceneObject(app, id);
    if (record !== null) out.push(record);
  }
  return out;
}

/**
 * The selected objects a transform applies to (selection order kept, the lead last): every selected object except
 * those with a selected ancestor, which follow that ancestor's placement instead of being transformed twice (Maya
 * and Blender transform only the topmost selected objects). The ancestor chain is `objectWorld`'s: same owner, a
 * missing, deleted, cross-owner or cyclic parent ends it; an object on a parent cycle (which the document's repair
 * breaks on load) counts as a root, so a cycle never drops all of its selected members.
 */
export function topmostSelectedObjects(app: Pick<EditorApp, 'store' | 'session'>): readonly SceneObjectRecord[] {
  const selected = selectedObjects(app);
  if (selected.length < 2) return selected;
  const ids = new Set<string>(selected.map((record) => record.id));
  return selected.filter((record) => {
    const owner = ownerKey(record);
    const seen = new Set<string>([record.id]);
    let selectedAncestor = false;
    let parent: string | null = record.parent;
    while (parent !== null && !seen.has(parent)) {
      seen.add(parent);
      const next = sceneObject(app, parent);
      if (next === null || ownerKey(next) !== owner) break;
      if (ids.has(next.id)) selectedAncestor = true;
      parent = next.parent;
    }
    return !selectedAncestor || parent === record.id;
  });
}
