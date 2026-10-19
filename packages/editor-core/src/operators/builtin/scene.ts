// Scene objects in Model (M6A-SPEC §5.13 "Group / Parent / Unparent / Duplicate / Delete objects", §6.2; B13): meshes
// and groups of one owner (the scene, or a character for made-editable meshes) form a hierarchy through `parent`.
//
// - `scene.group {ids?}` (`Mod+G`): a group holding the selected objects (topmost ones), Maya-style: the group's
//   placement is identity under the objects' common parent (else the owner root) and its **pivot** sits at the
//   selection's world bounding-box centre; every object keeps its world transform. `ids: []` makes an empty group at
//   the origin (Create › Empty Group). The group becomes the selection.
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
import {
  EkzaError,
  type ReadonlyVec3,
  type ReadonlyXf,
  type Vec3,
  quatRotateVec3,
  xfIdentity,
  xfInvert,
} from '@ekza-animator/anim-core';
import {
  type BudgetPresetId,
  fractionalIndex,
  type GroupId,
  type GroupRecord,
  type HandheldGrip,
  type MeshBudget,
  type MeshId,
  type MeshOwner,
  type MeshRecord,
  type PaletteId,
  type ReadView,
  type Tx,
} from '@ekza-animator/doc';
import { newRecordId } from '../../app/internals';
import { worldPlacement } from '../../mesh/context';
import { localFromWorld, MAX_NAME, orderAfterSiblings, ownerKey, uniqueMeshName } from '../../mesh/records';
import type { EditorApp, PollResult, SceneObjectId } from '../../types';
import { type AnyOperator, defineOperator, fail, isRecord, OK, optionalArgs } from './define';

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

const sameOwner = (a: MeshOwner, b: MeshOwner): boolean => ownerKey(a) === ownerKey(b);

const isAssetBacked = (object: SceneObject): boolean => 'source' in object && object.source !== null;

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

/** The objects of `ids` none of whose ancestors is in `ids` (Maya and Blender transform the topmost only). */
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

function transformPoint(xf: ReadonlyXf, p: ReadonlyVec3): Vec3 {
  const scaled: Vec3 = [p[0] * xf.s[0], p[1] * xf.s[1], p[2] * xf.s[2]];
  const r = quatRotateVec3(xf.q, scaled);
  return [r[0] + xf.t[0], r[1] + xf.t[1], r[2] + xf.t[2]];
}

/** World bounding box of objects (their meshes' revisions; an object without geometry counts as its origin). */
export function worldBounds(app: EditorApp, view: ReadView, objects: readonly SceneObject[]): [Vec3, Vec3] | null {
  const lo: Vec3 = [Infinity, Infinity, Infinity];
  const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  const add = (p: ReadonlyVec3): void => {
    for (let i = 0; i < 3; i++) {
      lo[i] = Math.min(lo[i] as number, p[i] as number);
      hi[i] = Math.max(hi[i] as number, p[i] as number);
    }
  };
  for (const root of objects) {
    for (const object of subtree(view, root)) {
      const world = objectWorld(view, object);
      const data = isMeshId(object.id) ? (app.meshes.get(object.id)?.data() ?? null) : null;
      if (data === null || data.counts.points === 0) {
        add(world.t);
        continue;
      }
      for (let v = 0; v < data.counts.points; v++) {
        add(
          transformPoint(world, [
            data.position[3 * v] as number,
            data.position[3 * v + 1] as number,
            data.position[3 * v + 2] as number,
          ]),
        );
      }
    }
  }
  return lo[0] === Infinity ? null : [lo, hi];
}

// ---------- names ----------

/** A live group name of `owner` not used by its meshes or groups (`base`, `base 2`, …). */
export function uniqueObjectName(view: ReadView, owner: MeshOwner, base: string, except?: string): string {
  const stem = (base.trim() === '' ? 'Group' : base.trim()).slice(0, MAX_NAME);
  const key = ownerKey(owner);
  const used = new Set<string>();
  for (const mesh of view.query.meshesOfOwner(key)) if (mesh.id !== except) used.add(mesh.name);
  for (const group of view.list('groups')) {
    if (group.id !== except && ownerKey(group.owner) === key) used.add(group.name);
  }
  if (!used.has(stem)) return stem;
  for (let n = 2; ; n++) {
    const suffix = ` ${n}`;
    const name = `${stem.slice(0, MAX_NAME - suffix.length)}${suffix}`;
    if (!used.has(name)) return name;
  }
}

/** A name for a renamed object: trimmed, ≤ 64 characters; a mesh name unique among its owner's other meshes. */
function renamedName(view: ReadView, object: SceneObject, name: string): string {
  const clean = name.trim().slice(0, MAX_NAME);
  if (!isMeshId(object.id)) return clean;
  const others = new Set(
    view.query
      .meshesOfOwner(ownerKey(object.owner))
      .filter((mesh) => mesh.id !== object.id)
      .map((mesh) => mesh.name),
  );
  if (!others.has(clean)) return clean;
  for (let n = 2; ; n++) {
    const suffix = ` ${n}`;
    const candidate = `${clean.slice(0, MAX_NAME - suffix.length)}${suffix}`;
    if (!others.has(candidate)) return candidate;
  }
}

// ---------- args ----------

function idsArg(app: EditorApp, args: unknown): string[] | null {
  const raw = optionalArgs(args);
  if (raw === null) return null;
  const ids = raw['ids'];
  if (ids === undefined) return [...app.session.getState().selection.objects];
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string')) return null;
  return ids;
}

function liveObjects(app: EditorApp, ids: readonly string[]): SceneObject[] | string {
  const out: SceneObject[] = [];
  for (const id of ids) {
    const object = sceneObject(app.store, id);
    if (object === undefined) return `Unknown object ${id}`;
    out.push(object);
  }
  return out;
}

function commonOwner(objects: readonly SceneObject[]): MeshOwner | null {
  const first = objects[0];
  if (first === undefined) return null;
  return objects.every((o) => sameOwner(o.owner, first.owner)) ? first.owner : null;
}

function setSelection(app: EditorApp, objects: readonly SceneObjectId[]): void {
  const state = app.session.getState();
  app.session.setState({ selection: { ...state.selection, objects } });
}

/** Patches an object's parent and local placement (keeping its world placement) and orders it last. */
function reparent(tx: Tx, object: SceneObject, parent: GroupId | MeshId | null, world: ReadonlyXf): void {
  const placement = localFromWorld(tx, object.owner, parent, world);
  const order = orderAfterSiblings(tx, object.owner, parent);
  if (isGroupId(object.id)) tx.patch('groups', object.id, { parent: parent as GroupId | null, placement, order });
  else tx.patch('meshes', object.id, { parent, placement, order });
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
  apply({ app, tx }, args) {
    if (tx === null) throw new EkzaError('internal', 'scene.group runs in a transaction');
    const ids = idsArg(app, args) ?? [];
    const roots = topmost(tx, ids);
    const owner = commonOwner(roots) ?? { scene: true as const };
    const firstParent = roots[0]?.parent ?? null;
    const parent = roots.every((o) => o.parent === firstParent) ? firstParent : null;
    const id = newRecordId(app, 'group');
    const worlds = new Map(roots.map((o) => [o.id, objectWorld(tx, o)] as const));
    // Identity under the parent; the pivot at the bounding-box centre, in the group's (= the parent's) space.
    const bounds = worldBounds(app, tx, roots);
    const parentWorld = parentWorldOf(tx, owner, parent);
    const centre: Vec3 =
      bounds === null
        ? [0, 0, 0]
        : [(bounds[0][0] + bounds[1][0]) / 2, (bounds[0][1] + bounds[1][1]) / 2, (bounds[0][2] + bounds[1][2]) / 2];
    const pivot = transformPoint(xfInvert(parentWorld), centre);
    const first = roots[0];
    tx.put('groups', {
      id,
      name: uniqueObjectName(tx, owner, 'Group'),
      owner,
      parent: parent as GroupId | null,
      order: first?.parent === parent && first !== undefined ? first.order : orderAfterSiblings(tx, owner, parent),
      placement: xfIdentity(),
      pivot: roots.length === 0 ? [0, 0, 0] : pivot,
      template: null,
      budget: null,
      handheld: null,
      deleted: null,
    });
    for (const object of roots) reparent(tx, object, id, worlds.get(object.id) as ReadonlyXf);
    setSelection(app, [id]);
    return { group: id };
  },
});

/** World placement of a parent (a group or mesh), else the owner root (a character's placement, or identity). */
function parentWorldOf(view: ReadView, owner: MeshOwner, parent: GroupId | MeshId | null): ReadonlyXf {
  if (parent !== null) {
    const node = sceneObject(view, parent);
    if (node !== undefined) return objectWorld(view, node);
  }
  if ('character' in owner) return view.get('characters', owner.character)?.placement ?? xfIdentity();
  return xfIdentity();
}

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
  apply({ app, tx }, args) {
    if (tx === null) throw new EkzaError('internal', 'scene.parent runs in a transaction');
    const raw = optionalArgs(args) ?? {};
    const selection = app.session.getState().selection.objects;
    const parentId = (typeof raw['parent'] === 'string' ? raw['parent'] : selection.at(-1)) as GroupId | MeshId;
    const ids = Array.isArray(raw['ids']) ? (raw['ids'] as string[]) : selection.slice(0, -1);
    for (const object of topmost(tx, ids)) {
      if (object.parent === parentId) continue;
      reparent(tx, object, parentId, objectWorld(tx, object));
    }
  },
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
  apply({ app, tx }, args) {
    if (tx === null) throw new EkzaError('internal', 'scene.unparent runs in a transaction');
    for (const object of topmost(tx, idsArg(app, args) ?? [])) {
      if (object.parent !== null) reparent(tx, object, null, objectWorld(tx, object));
    }
  },
});

/** The name a copy counts up from: "Cube 2" → "Cube" (the copy is "Cube 3", Maya's pCube2 → pCube3). */
const copyStem = (name: string): string => name.replace(/ \d+$/, '') || name;

/** Copies an object's subtree under `parent` with new ids; returns the copy of the root. */
function copySubtree(
  app: EditorApp,
  tx: Tx,
  root: SceneObject,
  parent: GroupId | MeshId | null,
  order: string,
): string {
  const map = new Map<string, string>();
  const taken = new Set<string>();
  for (const object of subtree(tx, root)) {
    const copyParent = object.id === root.id ? parent : ((map.get(object.parent ?? '') ?? null) as GroupId | null);
    const copyOrder = object.id === root.id ? order : object.order;
    if (isGroupId(object.id)) {
      const id = newRecordId(app, 'group');
      map.set(object.id, id);
      const record = object as GroupRecord;
      tx.put('groups', {
        ...record,
        id,
        name: uniqueObjectName(tx, record.owner, copyStem(record.name)),
        parent: copyParent as GroupId | null,
        order: copyOrder,
        deleted: null,
      });
    } else {
      const id = newRecordId(app, 'mesh');
      map.set(object.id, id);
      const record = object as MeshRecord;
      const name = uniqueMeshName(tx, record.owner, copyStem(record.name), taken);
      taken.add(name);
      tx.put('meshes', { ...record, id, name, parent: copyParent, order: copyOrder, deleted: null });
    }
  }
  return map.get(root.id) as string;
}

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
  apply({ app, tx }, args) {
    if (tx === null) throw new EkzaError('internal', 'scene.duplicate runs in a transaction');
    const created: SceneObjectId[] = [];
    for (const root of topmost(tx, idsArg(app, args) ?? [])) {
      // Right after the original among its siblings.
      let next: string | null = null;
      for (const sibling of tx.query.childrenOf(root.parent, ownerKey(root.owner))) {
        if (sibling.order > root.order && (next === null || sibling.order < next)) next = sibling.order;
      }
      created.push(copySubtree(app, tx, root, root.parent, fractionalIndex(root.order, next)) as SceneObjectId);
    }
    setSelection(app, created);
    return { created };
  },
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
  apply({ app, tx }, args) {
    if (tx === null) throw new EkzaError('internal', 'scene.delete runs in a transaction');
    const removed = new Set<string>();
    for (const root of topmost(tx, idsArg(app, args) ?? [])) {
      // Children first, so no live record ever points at a deleted parent.
      for (const object of subtree(tx, root).reverse()) {
        if (isGroupId(object.id)) tx.softDelete('groups', object.id);
        else tx.softDelete('meshes', object.id);
        removed.add(object.id);
      }
    }
    const state = app.session.getState();
    const objects = state.selection.objects.filter((id) => !removed.has(id));
    const hilite = state.model.hilite.filter((id) => !removed.has(id));
    app.session.setState({
      selection: { ...state.selection, objects },
      model: hilite.length === state.model.hilite.length ? state.model : { ...state.model, hilite },
    });
    return { count: removed.size };
  },
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
  apply({ tx }, args) {
    if (tx === null) throw new EkzaError('internal', 'scene.rename runs in a transaction');
    const object = sceneObject(tx, args.id) as SceneObject;
    const name = renamedName(tx, object, args.name);
    if (name === object.name) return;
    if (isGroupId(object.id)) tx.patch('groups', object.id, { name });
    else tx.patch('meshes', object.id, { name });
  },
});

// ---------- mesh attributes ----------

const COLOUR_OUTPUTS = ['palette-texture', 'vertex-colour', 'material-per-colour'] as const;
export const BUDGET_PRESETS: readonly BudgetPresetId[] = [
  'hero',
  'npc',
  'boss',
  'handheld',
  'small-prop',
  'medium-prop',
  'building',
];
const GROUP_FIELDS = new Set(['name', 'budget', 'handheld']);
const MESH_FIELDS = new Set(['name', 'faceted', 'colourOutput', 'material', 'budget', 'handheld', 'palette']);
export const TOON_REASON = 'Toon palette arrives with the VRM writer (v0.4)';

/** §4.2 grip bounds (clamped, as the load repair does). */
export function clampGrip(grip: HandheldGrip): HandheldGrip {
  const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
  return {
    bone: grip.bone === 'leftHand' ? 'leftHand' : 'rightHand',
    offset: [clamp(grip.offset[0], -0.3, 0.3), clamp(grip.offset[1], -0.3, 0.3), clamp(grip.offset[2], -0.3, 0.3)],
    rotationDegrees: [
      clamp(grip.rotationDegrees[0], -360, 360),
      clamp(grip.rotationDegrees[1], -360, 360),
      clamp(grip.rotationDegrees[2], -360, 360),
    ],
    scale: clamp(grip.scale, 0.25, 2),
  };
}

const isVec3 = (value: unknown): value is readonly [number, number, number] =>
  Array.isArray(value) && value.length === 3 && value.every((c) => typeof c === 'number' && Number.isFinite(c));

function gripProblem(value: unknown): string | null {
  if (value === null) return null;
  if (!isRecord(value)) return 'handheld must be a grip { bone, offset, rotationDegrees, scale } or null';
  if (value['bone'] !== 'rightHand' && value['bone'] !== 'leftHand') return 'grip bone: rightHand or leftHand';
  if (!isVec3(value['offset']) || !isVec3(value['rotationDegrees'])) return 'grip offset and rotation: three numbers';
  const scale = value['scale'];
  return typeof scale === 'number' && Number.isFinite(scale) ? null : 'grip scale: a number';
}

function budgetProblem(value: unknown): string | null {
  if (value === null) return null;
  if (!isRecord(value)) return 'budget must be { preset }, { tris } or null';
  if ('preset' in value) return BUDGET_PRESETS.includes(value['preset'] as BudgetPresetId) ? null : 'unknown preset';
  const tris = value['tris'];
  return typeof tris === 'number' && Number.isInteger(tris) && tris >= 1 ? null : 'tris must be a whole number ≥ 1';
}

/** The first problem of an attribute patch for `object`, or null. */
function patchProblem(app: EditorApp, object: SceneObject, patch: Readonly<Record<string, unknown>>): string | null {
  const allowed = isGroupId(object.id) ? GROUP_FIELDS : MESH_FIELDS;
  const keys = Object.keys(patch);
  if (keys.length === 0) return 'Nothing to change';
  for (const key of keys) {
    if (!allowed.has(key)) return `${isGroupId(object.id) ? 'A group' : 'A mesh'} has no attribute '${key}'`;
    const value = patch[key];
    switch (key) {
      case 'name':
        if (typeof value !== 'string' || value.trim() === '') return 'The name must not be empty';
        break;
      case 'faceted':
        if (typeof value !== 'boolean') return 'faceted must be true or false';
        break;
      case 'colourOutput':
        if (!COLOUR_OUTPUTS.includes(value as (typeof COLOUR_OUTPUTS)[number])) return 'unknown colour output';
        if (isAssetBacked(object)) return 'Imported meshes keep their materials';
        break;
      case 'material': {
        if (isAssetBacked(object)) return 'Imported meshes keep their materials';
        const preset = isRecord(value) ? value['preset'] : undefined;
        if (preset === 'toon') return TOON_REASON;
        if (preset !== 'unlit' && preset !== 'lit') return 'material must be { preset: unlit | lit }';
        break;
      }
      case 'budget': {
        const problem = budgetProblem(value);
        if (problem !== null) return problem;
        break;
      }
      case 'handheld': {
        const problem = gripProblem(value);
        if (problem !== null) return problem;
        break;
      }
      case 'palette':
        if (isAssetBacked(object)) return 'Imported meshes keep their materials';
        if (
          value !== null &&
          (typeof value !== 'string' || app.store.get('palettes', value as PaletteId) === undefined)
        ) {
          return 'Unknown palette';
        }
        break;
    }
  }
  return null;
}

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
    const problem = patchProblem(app, object, args['patch']);
    return problem === null ? OK : fail(problem);
  },
  apply({ tx }, args) {
    if (tx === null) throw new EkzaError('internal', 'mesh.setAttributes runs in a transaction');
    const object = sceneObject(tx, args.mesh) as SceneObject;
    const raw = args.patch as Readonly<Record<string, unknown>>;
    const patch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (key === 'name') {
        const name = renamedName(tx, object, value as string);
        if (name !== object.name) patch['name'] = name;
      } else if (key === 'handheld') {
        patch['handheld'] = value === null ? null : clampGrip(value as HandheldGrip);
      } else if (key === 'budget') {
        patch['budget'] = value as MeshBudget;
      } else {
        patch[key] = value;
      }
    }
    if (Object.keys(patch).length === 0) return;
    if (isGroupId(object.id)) tx.patch('groups', object.id, patch);
    else tx.patch('meshes', object.id, patch);
  },
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
