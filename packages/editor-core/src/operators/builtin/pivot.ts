// Pivots and object transforms (M6A-SPEC §6.2, §5.13, §5.15; B12a).
//
// - `model.pivot.editToggle` (`D` held, `Insert`/`Home`): the transform tools move the pivot instead of the selection
//   (U state `session.model.pivotEdit`); in object mode a pivot drag commits `mesh.pivot.set`, in a component mode it
//   pins `session.model.componentPivot` (world).
// - `mesh.pivot.set {id, pivot}` and Modify › Pivot: Center Pivot (bounds centre), Pivot to Bottom Center (bounds
//   bottom centre), Reset Pivot (origin), Bake Pivot (the geometry moves so the pivot becomes the object origin and
//   the placement compensates: one step). Records: meshes and groups; bounds are in the object's own space (a
//   group's: its descendant meshes' points).
// - `mesh.resetTransforms {ids?}`: placement = identity, positions untouched (an ordinary record patch).
// - `mesh.freezeTransforms {ids?, translate, rotate, scale}`: in one transaction `commitOp(mesh.applyTransform)` on
//   each target mesh with M = P′⁻¹·P (P the placement, P′ the placement with the frozen parts reset), so the world
//   stays where it was; the pivot moves by M, the frozen parts of the placement become identity and child objects
//   are compensated (M·C). Groups apply to their descendant meshes. Skinned meshes refuse (`freeze.skinned`).
// - `scene.object.transform {ids, placements}`: object W/E/R, MMB and Channel Box commits in Model, labelled by the
//   dominant change ("Move", "Rotate", "Scale").
import {
  EkzaError,
  type Mat4,
  mat4Compose,
  mat4Decompose,
  mat4Invert,
  mat4Multiply,
  type ParamDef,
  type ReadonlyVec3,
  type ReadonlyXf,
  type Vec3,
  type Xf,
} from '@ekza-animator/anim-core';
import type { GroupId, GroupRecord, MeshId, MeshRecord, ReadView, Tx } from '@ekza-animator/doc';
import { attachMeshes, meshKernel } from '../../mesh';
import { runSeed } from '../../mesh/seed';
import type { ApplyContext, EditorApp, OperatorContext, PollResult } from '../../types';
import { type AnyOperator, defineOperator, fail, isFiniteNumber, isRecord, OK, optionalArgs } from './define';
import { MODEL_SETTINGS_REASON } from './softSelect';

/** A mesh or group record (scene objects with a placement and a pivot). */
export type ObjectRecord = MeshRecord | GroupRecord;

export const NOTHING_TO_TRANSFORM = 'Select a mesh or group first';
export const MESH_LOADING = 'Mesh is loading';
export const FREEZE_SKINNED = 'Freezing would move a skinned mesh off its bones';
export const NOTHING_TO_FREEZE = 'Choose translate, rotate or scale to freeze';

// ---------------------------------------------------------------------------------------------------------------
// records

/** The live mesh or group record of an id, or null. */
export function objectRecord(view: ReadView, id: string): ObjectRecord | null {
  if (id.startsWith('grp_')) return view.get('groups', id as GroupId) ?? null;
  return view.get('meshes', id as MeshId) ?? null;
}

export function objectTableOf(record: ObjectRecord): 'meshes' | 'groups' {
  return 'data' in record ? 'meshes' : 'groups';
}

function ownerKey(record: ObjectRecord): string {
  return 'character' in record.owner ? `char:${record.owner.character}` : 'scene';
}

/** The scene matrix of an object: the character root (character-owned), then the placements from the top down. */
export function objectMatrix(view: ReadView, record: ObjectRecord): Mat4 {
  const chain: ReadonlyXf[] = [record.placement];
  const seen = new Set<string>([record.id]);
  let parent: string | null = record.parent;
  while (parent !== null && !seen.has(parent)) {
    seen.add(parent);
    const next = objectRecord(view, parent);
    if (next === null || ownerKey(next) !== ownerKey(record)) break;
    chain.push(next.placement);
    parent = next.parent;
  }
  let world: Mat4 | null = null;
  if ('character' in record.owner) {
    const character = view.get('characters', record.owner.character);
    if (character !== undefined) world = mat4Compose(character.placement);
  }
  for (let i = chain.length - 1; i >= 0; i--) {
    const local = mat4Compose(chain[i] as ReadonlyXf);
    world = world === null ? local : mat4Multiply(world, local);
  }
  return world ?? mat4Compose(record.placement);
}

/** Direct children (meshes and groups of the same owner) of an object. */
export function childrenOf(view: ReadView, record: ObjectRecord): ObjectRecord[] {
  const out: ObjectRecord[] = [];
  for (const mesh of view.list('meshes')) if (mesh.parent === record.id) out.push(mesh);
  for (const group of view.list('groups')) if (group.parent === record.id) out.push(group);
  return out;
}

/** Every descendant mesh of an object (depth first, parents before children). */
function descendantMeshes(view: ReadView, record: ObjectRecord, seen = new Set<string>()): MeshRecord[] {
  const out: MeshRecord[] = [];
  for (const child of childrenOf(view, record)) {
    if (seen.has(child.id)) continue;
    seen.add(child.id);
    if ('data' in child) out.push(child);
    out.push(...descendantMeshes(view, child, seen));
  }
  return out;
}

/** The objects an operator applies to by default: the hilite in a component mode, else the selected objects. */
export function defaultObjects(app: EditorApp): ObjectRecord[] {
  const state = app.session.getState();
  const ids: readonly string[] =
    state.workspace === 'model' && state.model.componentMode !== 'object'
      ? state.model.hilite
      : state.selection.objects;
  const out: ObjectRecord[] = [];
  for (const id of ids) {
    const record = objectRecord(app.store, id);
    if (record !== null) out.push(record);
  }
  return out;
}

function idsArg(raw: unknown): readonly string[] | null | string {
  const args = optionalArgs(raw);
  if (args === null) return 'expects { ids? }';
  const ids = args['ids'];
  if (ids === undefined) return null;
  if (!Array.isArray(ids)) return 'ids is a list of mesh or group ids';
  const out: string[] = [];
  for (const id of ids as unknown[]) {
    if (typeof id !== 'string') return 'ids is a list of mesh or group ids';
    out.push(id);
  }
  return out;
}

/** The target records of an `{ids?}` operator, or the reason there are none. */
function targetsOf(app: EditorApp, raw: unknown): ObjectRecord[] | string {
  const ids = idsArg(raw);
  if (typeof ids === 'string') return ids;
  if (ids === null) {
    const objects = defaultObjects(app);
    return objects.length === 0 ? NOTHING_TO_TRANSFORM : objects;
  }
  if (ids.length === 0) return NOTHING_TO_TRANSFORM;
  const out: ObjectRecord[] = [];
  for (const id of ids) {
    const record = objectRecord(app.store, id);
    if (record === null) return `Unknown mesh or group ${id}`;
    out.push(record);
  }
  return out;
}

function vec3(value: unknown): Vec3 | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const [x, y, z] = value as unknown[];
  return isFiniteNumber(x) && isFiniteNumber(y) && isFiniteNumber(z) ? [x, y, z] : null;
}

/** A finite placement with a non-zero rotation quaternion (normalized), or null. */
export function placementArg(value: unknown): Xf | null {
  if (!isRecord(value)) return null;
  const t = vec3(value['t']);
  const s = vec3(value['s']);
  const q = value['q'];
  if (t === null || s === null || !Array.isArray(q) || q.length !== 4) return null;
  const [x, y, z, w] = q as unknown[];
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z) || !isFiniteNumber(w)) return null;
  const len = Math.hypot(x, y, z, w);
  if (!(len > 0)) return null;
  return { t, q: [x / len, y / len, z / len, w / len], s };
}

// ---------------------------------------------------------------------------------------------------------------
// bounds

/** Local-space positions of a ready mesh, or null while its runtime is not ready. */
function meshPositions(
  app: EditorApp,
  id: MeshId,
): { readonly position: ArrayLike<number>; readonly n: number } | null {
  const runtime = app.meshes.get(id);
  if (runtime === undefined || runtime.state !== 'ready') return null;
  const data = runtime.data();
  if (data === null) return null;
  return { position: data.position, n: data.counts.points };
}

interface Bounds {
  readonly min: Vec3;
  readonly max: Vec3;
}

function apply4(m: Mat4, x: number, y: number, z: number): Vec3 {
  return [
    (m[0] as number) * x + (m[4] as number) * y + (m[8] as number) * z + (m[12] as number),
    (m[1] as number) * x + (m[5] as number) * y + (m[9] as number) * z + (m[13] as number),
    (m[2] as number) * x + (m[6] as number) * y + (m[10] as number) * z + (m[14] as number),
  ];
}

/**
 * Bounds of an object in its own space: a mesh's points; a group's descendant meshes' points mapped into the
 * group. 'loading' while a mesh is not ready; null for an object without points.
 */
export function objectBounds(app: EditorApp, record: ObjectRecord): Bounds | null | 'loading' {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  const add = (p: Vec3): void => {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k] as number, p[k] as number);
      max[k] = Math.max(max[k] as number, p[k] as number);
    }
  };
  const meshes: { readonly mesh: MeshRecord; readonly toLocal: Mat4 | null }[] = [];
  if ('data' in record) meshes.push({ mesh: record, toLocal: null });
  else {
    const inverse = mat4Invert(objectMatrix(app.store, record));
    if (inverse === null) return null;
    for (const mesh of descendantMeshes(app.store, record)) {
      if (mesh.data === null) continue;
      meshes.push({ mesh, toLocal: mat4Multiply(inverse, objectMatrix(app.store, mesh)) });
    }
  }
  for (const { mesh, toLocal } of meshes) {
    const points = meshPositions(app, mesh.id);
    if (points === null) return 'loading';
    const p = points.position;
    for (let v = 0; v < points.n; v++) {
      const x = p[3 * v] as number;
      const y = p[3 * v + 1] as number;
      const z = p[3 * v + 2] as number;
      add(toLocal === null ? [x, y, z] : apply4(toLocal, x, y, z));
    }
  }
  return min[0] <= max[0] ? { min, max } : null;
}

// ---------------------------------------------------------------------------------------------------------------
// `model.pivot.editToggle`, `mesh.pivot.*`

const pivotEditToggle = defineOperator({
  id: 'model.pivot.editToggle',
  label: 'Edit Pivot',
  description: 'Moves the pivot instead of the object or components.',
  category: 'model',
  scope: 'model',
  workspaces: ['model'],
  poll: ({ app }) => (app.session.getState().workspace === 'model' ? OK : fail(MODEL_SETTINGS_REASON)),
  apply({ app }) {
    const state = app.session.getState();
    app.session.setState({ model: { ...state.model, pivotEdit: !state.model.pivotEdit } });
  },
});

const pivot = { category: 'mesh', scope: 'model', workspaces: ['model'], flags: { undo: true } } as const;

const pivotSet = defineOperator({
  id: 'mesh.pivot.set',
  label: 'Set Pivot',
  description: 'Sets the rotate/scale pivot of a mesh or group.',
  ...pivot,
  extraArgs: ['id', 'pivot'],
  poll({ app }, raw) {
    const args: unknown = raw;
    if (!isRecord(args) || typeof args['id'] !== 'string' || vec3(args['pivot']) === null) {
      return fail('expects { id, pivot: [x, y, z] }');
    }
    return objectRecord(app.store, args['id']) === null ? fail(`Unknown mesh or group ${args['id']}`) : OK;
  },
  apply({ tx }, args) {
    const record = tx === null ? null : objectRecord(tx, args.id);
    const value = vec3(args.pivot);
    if (tx === null || record === null || value === null) return;
    patchObject(tx, record, { pivot: value });
  },
});

/** A pivot from the bounds (`center`, `bottomCenter`) or the origin (`reset`). */
function pivotFrom(kind: 'center' | 'bottomCenter' | 'reset', bounds: Bounds | null): Vec3 | null {
  if (kind === 'reset') return [0, 0, 0];
  if (bounds === null) return null;
  const cx = 0.5 * (bounds.min[0] + bounds.max[0]);
  const cz = 0.5 * (bounds.min[2] + bounds.max[2]);
  return kind === 'center' ? [cx, 0.5 * (bounds.min[1] + bounds.max[1]), cz] : [cx, bounds.min[1], cz];
}

function boundsPoll(app: EditorApp, raw: unknown, kind: 'center' | 'bottomCenter' | 'reset'): PollResult {
  const targets = targetsOf(app, raw);
  if (typeof targets === 'string') return fail(targets);
  if (kind === 'reset') return OK;
  for (const record of targets) if (objectBounds(app, record) === 'loading') return fail(MESH_LOADING);
  return OK;
}

function pivotFromBounds(
  id: 'mesh.pivot.center' | 'mesh.pivot.bottomCenter' | 'mesh.pivot.reset',
  label: string,
  description: string,
  kind: 'center' | 'bottomCenter' | 'reset',
): AnyOperator {
  const def: AnyOperator = {
    id,
    label,
    description,
    ...pivot,
    extraArgs: ['ids'],
    poll: ({ app }, raw) => boundsPoll(app, raw, kind),
    apply({ app, tx }: ApplyContext, raw: unknown) {
      const targets = targetsOf(app, raw);
      if (tx === null || typeof targets === 'string') return;
      for (const record of targets) {
        const bounds = objectBounds(app, record);
        const next = pivotFrom(kind, bounds === 'loading' ? null : bounds);
        if (next !== null) patchObject(tx, record, { pivot: next });
      }
    },
  };
  return def;
}

/** Moves the children of an object by `delta` in its space (T(delta)·C), keeping their world placement when the
 *  object's own frame moved by −delta. */
function shiftChildren(tx: Tx, record: ObjectRecord, delta: ReadonlyVec3): void {
  for (const child of childrenOf(tx, record)) {
    const t = child.placement.t;
    patchObject(tx, child, {
      placement: { ...child.placement, t: [t[0] + delta[0], t[1] + delta[1], t[2] + delta[2]] },
    });
  }
}

/** Patches the placement or pivot of a mesh or group. */
export function patchObject(
  tx: Tx,
  record: ObjectRecord,
  fields: { readonly placement?: ReadonlyXf; readonly pivot?: ReadonlyVec3 },
): void {
  if ('data' in record) tx.patch('meshes', record.id, fields);
  else tx.patch('groups', record.id, fields);
}

/** `placement.t + R·(s ∘ v)`: where a local point v sits in the parent. */
function inParent(placement: ReadonlyXf, v: ReadonlyVec3): Vec3 {
  const m = mat4Compose(placement);
  return apply4(m, v[0], v[1], v[2]);
}

function kernelReady(): PollResult {
  return meshKernel() === null ? fail('Mesh tools are loading') : OK;
}

/** Runs `mesh.applyTransform {matrix}` on one mesh inside the operator's transaction (B4's kernel op). */
function applyMatrix(ctx: ApplyContext, tx: Tx, opId: string, mesh: MeshId, matrix: Mat4): void {
  const kernel = meshKernel();
  const meshes = attachMeshes(ctx.app);
  const op = kernel?.MESH_OPS['mesh.applyTransform'];
  if (kernel === null || meshes === null || op === undefined) {
    throw new EkzaError('mesh-loading', 'Mesh tools are loading');
  }
  meshes.commitOp(tx, op, [mesh], { matrix: Array.from(matrix) }, { seed: runSeed(ctx, opId), kind: null });
}

function isIdentityTranslation(v: ReadonlyVec3): boolean {
  return v[0] === 0 && v[1] === 0 && v[2] === 0;
}

const pivotBake = defineOperator({
  id: 'mesh.pivot.bake',
  label: 'Bake Pivot',
  description: 'Makes the pivot the object origin without moving the mesh.',
  ...pivot,
  extraArgs: ['ids'],
  poll({ app }, raw) {
    const targets = targetsOf(app, raw);
    if (typeof targets === 'string') return fail(targets);
    if (targets.some((record) => 'data' in record)) {
      const ready = kernelReady();
      if (ready !== true) return ready;
    }
    for (const record of targets) {
      if ('data' in record && record.skin !== null && !isIdentityTranslation(record.pivot)) return fail(FREEZE_SKINNED);
    }
    return OK;
  },
  apply(ctx, raw) {
    const { app, tx } = ctx;
    const targets = targetsOf(app, raw);
    if (tx === null || typeof targets === 'string') return;
    for (const target of targets) {
      const record = objectRecord(tx, target.id);
      if (record === null || isIdentityTranslation(record.pivot)) continue;
      const p = record.pivot;
      if ('data' in record && record.data !== null) {
        const shift = mat4Compose({ t: [-p[0], -p[1], -p[2]], q: [0, 0, 0, 1], s: [1, 1, 1] });
        applyMatrix(ctx, tx, 'mesh.pivot.bake', record.id, shift);
      }
      shiftChildren(tx, record, [-p[0], -p[1], -p[2]]);
      patchObject(tx, record, {
        placement: { ...record.placement, t: inParent(record.placement, p) },
        pivot: [0, 0, 0],
      });
    }
  },
});

const resetTransforms = defineOperator({
  id: 'mesh.resetTransforms',
  label: 'Reset Transformations',
  description: 'Resets the object transforms of the selection.',
  ...pivot,
  extraArgs: ['ids'],
  poll({ app }, raw) {
    const targets = targetsOf(app, raw);
    return typeof targets === 'string' ? fail(targets) : OK;
  },
  apply({ app, tx }, raw) {
    const targets = targetsOf(app, raw);
    if (tx === null || typeof targets === 'string') return;
    for (const record of targets)
      patchObject(tx, record, { placement: { t: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] } });
  },
});

// ---------------------------------------------------------------------------------------------------------------
// Freeze Transformations

const BOOL = (name: string, label: string): ParamDef => ({ name, label, kind: 'bool', bound: 'value', default: true });

export const FREEZE_PARAMS: readonly ParamDef[] = [
  BOOL('translate', 'Translate'),
  BOOL('rotate', 'Rotate'),
  BOOL('scale', 'Scale'),
];

interface FreezeParts {
  readonly translate: boolean;
  readonly rotate: boolean;
  readonly scale: boolean;
}

function freezeParts(raw: unknown): FreezeParts {
  const args = optionalArgs(raw) ?? {};
  return {
    translate: args['translate'] !== false,
    rotate: args['rotate'] !== false,
    scale: args['scale'] !== false,
  };
}

/** The meshes Freeze changes: target meshes and every descendant mesh of a target group (parents first). */
function freezeMeshes(view: ReadView, targets: readonly ObjectRecord[]): MeshRecord[] {
  const out: MeshRecord[] = [];
  const seen = new Set<string>();
  for (const record of targets) {
    if ('data' in record) {
      if (!seen.has(record.id)) {
        seen.add(record.id);
        out.push(record);
      }
    } else {
      for (const mesh of descendantMeshes(view, record)) {
        if (seen.has(mesh.id)) continue;
        seen.add(mesh.id);
        out.push(mesh);
      }
    }
  }
  return out.filter((mesh) => mesh.data !== null);
}

/** The placement with the frozen parts reset to identity. */
export function frozenPlacement(placement: ReadonlyXf, parts: FreezeParts): Xf {
  return {
    t: parts.translate ? [0, 0, 0] : [placement.t[0], placement.t[1], placement.t[2]],
    q: parts.rotate ? [0, 0, 0, 1] : [placement.q[0], placement.q[1], placement.q[2], placement.q[3]],
    s: parts.scale ? [1, 1, 1] : [placement.s[0], placement.s[1], placement.s[2]],
  };
}

/** M = P′⁻¹·P: the mesh-local matrix that keeps the world where it was once the placement is P′. */
export function freezeMatrix(placement: ReadonlyXf, next: ReadonlyXf): Mat4 | null {
  const inverse = mat4Invert(mat4Compose(next));
  return inverse === null ? null : mat4Multiply(inverse, mat4Compose(placement));
}

function isIdentityMatrix(m: Mat4): boolean {
  for (let i = 0; i < 16; i++) if (Math.abs((m[i] as number) - (i % 5 === 0 ? 1 : 0)) > 1e-12) return false;
  return true;
}

function freezePoll(ctx: OperatorContext, raw: unknown): PollResult {
  const targets = targetsOf(ctx.app, raw);
  if (typeof targets === 'string') return fail(targets);
  const parts = freezeParts(raw);
  if (!parts.translate && !parts.rotate && !parts.scale) return fail(NOTHING_TO_FREEZE);
  const meshes = freezeMeshes(ctx.app.store, targets);
  if (meshes.length === 0) return fail('Freeze works on meshes (a group freezes its meshes)');
  const ready = kernelReady();
  if (ready !== true) return ready;
  for (const mesh of meshes) {
    if (mesh.skin !== null) return fail(FREEZE_SKINNED);
    const runtime = ctx.app.meshes.get(mesh.id);
    if (runtime === undefined || runtime.state !== 'ready') return fail(MESH_LOADING);
  }
  return OK;
}

const freezeTransforms = defineOperator({
  id: 'mesh.freezeTransforms',
  label: 'Freeze Transformations',
  description: 'Bakes the object transforms into the mesh data.',
  ...pivot,
  flags: { undo: true, adjustable: true, repeatable: true },
  params: FREEZE_PARAMS,
  extraArgs: ['ids'],
  aliases: ['Apply Transform'],
  poll: freezePoll,
  apply(ctx, raw) {
    const { app, tx } = ctx;
    const targets = targetsOf(app, raw);
    if (tx === null || typeof targets === 'string') return;
    const parts = freezeParts(raw);
    for (const target of freezeMeshes(app.store, targets)) {
      // Parents first: a child's placement already carries its frozen parent's compensation.
      const record = tx.get('meshes', target.id);
      if (record === undefined) continue;
      const next = frozenPlacement(record.placement, parts);
      const matrix = freezeMatrix(record.placement, next);
      if (matrix === null || isIdentityMatrix(matrix)) continue;
      applyMatrix(ctx, tx, 'mesh.freezeTransforms', record.id, matrix);
      for (const child of childrenOf(tx, record)) {
        patchObject(tx, child, { placement: mat4Decompose(mat4Multiply(matrix, mat4Compose(child.placement))) });
      }
      tx.patch('meshes', record.id, { placement: next, pivot: apply4(matrix, ...record.pivot) });
    }
  },
});

// ---------------------------------------------------------------------------------------------------------------
// `scene.object.transform`

/** The dominant change of a placement edit (the history label of object W/E/R commits). */
export function placementChangeLabel(before: readonly ReadonlyXf[], after: readonly ReadonlyXf[]): string {
  let t = 0;
  let r = 0;
  let s = 0;
  before.forEach((a, i) => {
    const b = after[i];
    if (b === undefined) return;
    if (a.t.some((v, k) => v !== b.t[k])) t++;
    if (a.q.some((v, k) => v !== b.q[k])) r++;
    if (a.s.some((v, k) => v !== b.s[k])) s++;
  });
  if (r > 0 && r >= s && r >= t) return 'Rotate';
  if (s > 0 && s >= t) return 'Scale';
  return 'Move';
}

function transformArgs(raw: unknown): { readonly ids: readonly string[]; readonly placements: Xf[] } | string {
  const expects = 'expects { ids, placements } (one placement per id)';
  if (!isRecord(raw)) return expects;
  const ids = raw['ids'];
  const placements = raw['placements'];
  if (!Array.isArray(ids) || !Array.isArray(placements) || ids.length === 0 || ids.length !== placements.length) {
    return expects;
  }
  const names: string[] = [];
  for (const id of ids as unknown[]) {
    if (typeof id !== 'string') return expects;
    names.push(id);
  }
  const parsed: Xf[] = [];
  for (const value of placements) {
    const placement = placementArg(value);
    if (placement === null) return 'a placement is { t: [x, y, z], q: [x, y, z, w], s: [x, y, z] } of finite numbers';
    parsed.push(placement);
  }
  return { ids: names, placements: parsed };
}

const objectTransform = defineOperator({
  id: 'scene.object.transform',
  label: 'Move',
  description: 'Commits object moves, rotations and scales in Model.',
  category: 'scene',
  scope: 'model',
  workspaces: ['model'],
  flags: { undo: true, internal: true },
  extraArgs: ['ids', 'placements'],
  poll({ app }, raw) {
    const args = transformArgs(raw);
    if (typeof args === 'string') return fail(args);
    for (const id of args.ids) if (objectRecord(app.store, id) === null) return fail(`Unknown mesh or group ${id}`);
    return OK;
  },
  apply({ tx }, raw) {
    const args = transformArgs(raw);
    if (tx === null || typeof args === 'string') return;
    const before: ReadonlyXf[] = [];
    const after: ReadonlyXf[] = [];
    args.ids.forEach((id, i) => {
      const record = objectRecord(tx, id);
      const placement = args.placements[i];
      if (record === null || placement === undefined) return;
      before.push(record.placement);
      after.push(placement);
      patchObject(tx, record, { placement });
    });
    tx.annotate({ label: placementChangeLabel(before, after) });
  },
});

export const PIVOT_OPERATORS: readonly AnyOperator[] = [
  pivotEditToggle,
  pivotSet,
  pivotFromBounds('mesh.pivot.center', 'Center Pivot', 'Moves the pivot to the centre of the bounds.', 'center'),
  pivotFromBounds(
    'mesh.pivot.bottomCenter',
    'Bottom Center Pivot',
    'Moves the pivot to the bottom centre of the bounds.',
    'bottomCenter',
  ),
  pivotFromBounds('mesh.pivot.reset', 'Reset Pivot', 'Moves the pivot back to the object origin.', 'reset'),
  pivotBake,
  resetTransforms,
  freezeTransforms,
  objectTransform,
];
