// Scene objects in Model (M6A-SPEC §5.13 "Group / Parent / Unparent / Duplicate / Delete objects", §6.2; B13): meshes
// and groups of one owner (the scene, or a character for made-editable meshes) form a hierarchy through `parent`.
//
// - `scene.group {ids?}` (`Mod+G`): a group holding the selected objects (topmost ones), desktop-DCC style: the
//   group's placement is identity under the objects' common parent (else the owner root) and its **pivot** sits at
//   the selection's world bounding-box centre; every object keeps its world transform. `ids: []` makes an empty group
//   at the origin (Create › Empty Group). The group becomes the selection.
// - `scene.parent {ids?, parent?}` (`P`): parents the selection to the last selected object (same owner only; a cycle
//   is refused), keeping world transforms.
// - `scene.unparent {ids?}` (`Shift+P`): moves objects to the owner root, keeping world transforms.
// - `scene.duplicate {ids?}` (`Mod+D`): copies the topmost selected objects with their subtrees under new ids at the
//   same transforms; meshes share the revision ref (no chunk copy) and keep their live parameters; the copies become
//   the selection. Names stay unique per owner ("Cube 2").
// - `scene.delete {ids?}`: soft-deletes the objects and their descendants; they leave the selection and the hilite.
// - `scene.rename {id, name}` and `mesh.setAttributes {mesh, patch}`: record patches (never component edits, §5.5
//   rule 9). `mesh.setAttributes` also takes a group id for the fields a group has (`name`, `budget`, `handheld`:
//   the Attributes panel edits a template root's grip and budget through it, M6A-B13-3).
// Made-editable (asset-backed) meshes keep their place in their character: grouping, parenting and duplicating them
// is refused (Duplicate Faces makes an authored copy, §5.13).
// The document writes live in the lazy `contentApply.ts` (M6A-B13-10): `prepare` loads it, `apply` runs its body.
import { type ReadonlyXf } from '@ekza-studio/anim-core';
import {
  type BudgetPresetId,
  type GroupId,
  type GroupRecord,
  type MeshId,
  type MeshOwner,
  type MeshRecord,
  type ReadView,
} from '@ekza-studio/doc';
import { worldPlacement } from '../../mesh/context';
import { ownerKey } from '../../mesh/records';
import type { EditorApp, PollResult } from '../../types';
import { type AnyOperator, defineOperator, fail, isRecord, OK, optionalArgs } from './define';
import { loadContentApply, loadedContentApply } from './contentLoad';

// ---------- records and placements ----------

export type SceneObject = MeshRecord | GroupRecord;

export const isGroupId = (id: string): id is GroupId => id.startsWith('grp_');
export const isMeshId = (id: string): id is MeshId => id.startsWith('msh_');

/** The live mesh or group of an id. */
export function sceneObject(view: ReadView, id: string): SceneObject | undefined {
  if (isGroupId(id)) return view.get('groups', id);
  if (isMeshId(id)) return view.get('meshes', id);
  return undefined;
}

/** World-from-local placement of a mesh or group (through its parents and, for a character's object, the root). */
export function objectWorld(view: ReadView, object: SceneObject): ReadonlyXf {
  return worldPlacement(view, object as MeshRecord);
}

export const sameOwner = (a: MeshOwner, b: MeshOwner): boolean => ownerKey(a) === ownerKey(b);

export const isAssetBacked = (object: SceneObject): boolean => 'source' in object && object.source !== null;

/** Live children of an object (meshes and groups). */
function childrenOf(view: ReadView, object: SceneObject): readonly SceneObject[] {
  return view.query.childrenOf(object.id, ownerKey(object.owner));
}

/** The object and every live descendant, parents first. */
export function subtree(view: ReadView, object: SceneObject): SceneObject[] {
  const out: SceneObject[] = [];
  const seen = new Set<string>();
  const visit = (node: SceneObject): void => {
    if (seen.has(node.id)) return;
    seen.add(node.id);
    out.push(node);
    for (const child of childrenOf(view, node)) visit(child);
  };
  visit(object);
  return out;
}

/** Whether `ancestor` is `id` or one of its ancestors (cycles stop the walk). */
export function isAncestorOrSelf(view: ReadView, ancestor: string, id: string): boolean {
  const seen = new Set<string>();
  let current: string | null = id;
  while (current !== null && !seen.has(current)) {
    if (current === ancestor) return true;
    seen.add(current);
    current = sceneObject(view, current)?.parent ?? null;
  }
  return false;
}

/** The objects of `ids` none of whose ancestors is in `ids` (common DCCs transform the topmost only). */
export function topmost(view: ReadView, ids: readonly string[]): SceneObject[] {
  const set = new Set(ids);
  const out: SceneObject[] = [];
  for (const id of ids) {
    const object = sceneObject(view, id);
    if (object === undefined) continue;
    let parent = object.parent;
    let nested = false;
    const seen = new Set<string>([id]);
    while (parent !== null && !seen.has(parent)) {
      if (set.has(parent)) {
        nested = true;
        break;
      }
      seen.add(parent);
      parent = sceneObject(view, parent)?.parent ?? null;
    }
    if (!nested && !out.some((o) => o.id === object.id)) out.push(object);
  }
  return out;
}

// ---------- names ----------

// ---------- args ----------

export function idsArg(app: EditorApp, args: unknown): string[] | null {
  const raw = optionalArgs(args);
  if (raw === null) return null;
  const ids = raw['ids'];
  if (ids === undefined) return [...app.session.getState().selection.objects];
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string')) return null;
  return ids;
}

export function liveObjects(app: EditorApp, ids: readonly string[]): SceneObject[] | string {
  const out: SceneObject[] = [];
  for (const id of ids) {
    const object = sceneObject(app.store, id);
    if (object === undefined) return `Unknown object ${id}`;
    out.push(object);
  }
  return out;
}

export function commonOwner(objects: readonly SceneObject[]): MeshOwner | null {
  const first = objects[0];
  if (first === undefined) return null;
  return objects.every((o) => sameOwner(o.owner, first.owner)) ? first.owner : null;
}

// ---------- operators ----------

const META = { category: 'scene', scope: 'model', workspaces: ['model'] } as const;

const group = defineOperator({
  id: 'scene.group',
  label: 'Group',
  description: 'Groups the selected objects under a new transform node.',
  ...META,
  flags: { undo: true },
  extraArgs: ['ids'],
  aliases: ['Group Objects'],
  poll({ app }, args): PollResult {
    const ids = idsArg(app, args);
    if (ids === null) return fail('expects { ids? }');
    const explicitEmpty = isRecord(args) && Array.isArray(args['ids']) && args['ids'].length === 0;
    if (ids.length === 0) return explicitEmpty ? OK : fail('Select objects to group');
    const objects = liveObjects(app, ids);
    if (typeof objects === 'string') return fail(objects);
    if (commonOwner(objects) === null) return fail('Group objects of one owner (the scene or one character)');
    if (objects.some(isAssetBacked)) return fail('Imported meshes keep their place in the character');
    return OK;
  },
  prepare: loadContentApply,
  apply: (ctx, args, impl) => impl.sceneGroup(ctx, args),
});

const parentOp = defineOperator({
  id: 'scene.parent',
  label: 'Parent',
  description: 'Parents the selected objects to the last selected one.',
  ...META,
  flags: { undo: true },
  extraArgs: ['ids', 'parent'],
  poll({ app }, args): PollResult {
    const raw = optionalArgs(args);
    if (raw === null) return fail('expects { ids?, parent? }');
    const selection = app.session.getState().selection.objects;
    const parentId = typeof raw['parent'] === 'string' ? raw['parent'] : selection.at(-1);
    const ids = Array.isArray(raw['ids']) ? (raw['ids'] as string[]) : selection.slice(0, -1);
    if (parentId === undefined || ids.length === 0) return fail('Select the children, then the parent last');
    const parentObject = sceneObject(app.store, parentId);
    if (parentObject === undefined) return fail(`Unknown object ${parentId}`);
    const objects = liveObjects(app, ids);
    if (typeof objects === 'string') return fail(objects);
    for (const object of objects) {
      if (!sameOwner(object.owner, parentObject.owner)) return fail('Parent objects of one owner only');
      if (isAncestorOrSelf(app.store, object.id, parentObject.id)) {
        return fail(`${object.name} cannot be parented under itself or its own child`);
      }
      if (isAssetBacked(object)) return fail('Imported meshes keep their place in the character');
      if (isGroupId(object.id) && !isGroupId(parentObject.id))
        return fail('A group can only be parented under a group');
    }
    if (isAssetBacked(parentObject)) return fail('Imported meshes keep their place in the character');
    return OK;
  },
  prepare: loadContentApply,
  apply: (ctx, args, impl) => impl.sceneParent(ctx, args),
});

const unparent = defineOperator({
  id: 'scene.unparent',
  label: 'Unparent',
  description: 'Moves the selected objects to the top level, keeping their world placement.',
  ...META,
  flags: { undo: true },
  extraArgs: ['ids'],
  poll({ app }, args): PollResult {
    const ids = idsArg(app, args);
    if (ids === null) return fail('expects { ids? }');
    const objects = liveObjects(app, ids);
    if (typeof objects === 'string') return fail(objects);
    if (objects.some(isAssetBacked)) return fail('Imported meshes keep their place in the character');
    return objects.some((o) => o.parent !== null) ? OK : fail('Select parented objects');
  },
  prepare: loadContentApply,
  apply: (ctx, args, impl) => impl.sceneUnparent(ctx, args),
});

const duplicate = defineOperator({
  id: 'scene.duplicate',
  label: 'Duplicate',
  description: 'Duplicates the selected objects.',
  ...META,
  flags: { undo: true, repeatable: true },
  extraArgs: ['ids'],
  poll({ app }, args): PollResult {
    const ids = idsArg(app, args);
    if (ids === null) return fail('expects { ids? }');
    if (ids.length === 0) return fail('Select objects to duplicate');
    const objects = liveObjects(app, ids);
    if (typeof objects === 'string') return fail(objects);
    for (const object of objects) {
      if (subtree(app.store, object).some(isAssetBacked)) {
        return fail('Imported meshes cannot be duplicated: use Duplicate Face for an authored copy');
      }
    }
    return OK;
  },
  prepare: loadContentApply,
  apply: (ctx, args, impl) => impl.sceneDuplicate(ctx, args),
});

const deleteObjects = defineOperator({
  id: 'scene.delete',
  label: 'Delete',
  description: 'Deletes the selected objects and their children.',
  ...META,
  flags: { undo: true },
  extraArgs: ['ids'],
  undoLabel: () => 'Delete Objects',
  poll({ app }, args): PollResult {
    const ids = idsArg(app, args);
    if (ids === null) return fail('expects { ids? }');
    if (ids.length === 0) return fail('Select objects to delete');
    const objects = liveObjects(app, ids);
    return typeof objects === 'string' ? fail(objects) : OK;
  },
  prepare: loadContentApply,
  apply: (ctx, args, impl) => impl.sceneDelete(ctx, args),
});

const rename = defineOperator({
  id: 'scene.rename',
  label: 'Rename',
  description: 'Renames a mesh or group.',
  ...META,
  flags: { undo: true, internal: true },
  extraArgs: ['id', 'name'],
  poll({ app }, args): PollResult {
    if (!isRecord(args) || typeof args['id'] !== 'string' || typeof args['name'] !== 'string') {
      return fail('expects { id, name }');
    }
    if (sceneObject(app.store, args['id']) === undefined) return fail(`Unknown object ${args['id']}`);
    return args['name'].trim() === '' ? fail('The name must not be empty') : OK;
  },
  prepare: loadContentApply,
  apply: (ctx, args, impl) => impl.sceneRename(ctx, args),
});

// ---------- mesh attributes ----------

export const BUDGET_PRESETS: readonly BudgetPresetId[] = [
  'hero',
  'npc',
  'boss',
  'handheld',
  'small-prop',
  'medium-prop',
  'building',
];
export const TOON_REASON = 'Toon palette arrives with the VRM writer (v0.4)';

const setAttributes = defineOperator({
  id: 'mesh.setAttributes',
  label: 'Mesh Attributes',
  description: "Changes a mesh's name, faceting, colour output, material, budget, grip or palette.",
  ...META,
  category: 'mesh',
  flags: { undo: true, internal: true },
  extraArgs: ['mesh', 'patch'],
  poll({ app }, args): PollResult {
    if (!isRecord(args) || typeof args['mesh'] !== 'string' || !isRecord(args['patch'])) {
      return fail('expects { mesh, patch }');
    }
    const object = sceneObject(app.store, args['mesh']);
    if (object === undefined) return fail(`Unknown mesh ${args['mesh']}`);
    // The field checks live with the bodies: before they load the poll passes, and the runner's second poll (after
    // `prepare` loaded them) refuses a bad patch with its reason (M6A-B13-10).
    const problem = loadedContentApply()?.patchProblem(app, object, args['patch']) ?? null;
    return problem === null ? OK : fail(problem);
  },
  prepare: loadContentApply,
  apply: (ctx, args, impl) => impl.meshSetAttributes(ctx, args),
});

export const SCENE_OPERATORS: readonly AnyOperator[] = [
  group,
  parentOp,
  unparent,
  duplicate,
  deleteObjects,
  rename,
  setAttributes,
];
