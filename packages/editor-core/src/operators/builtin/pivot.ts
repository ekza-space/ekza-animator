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
// - `scene.object.transform {ids, placements}`: object W/E/R, MMB and Channels panel commits in Model, labelled by the
//   dominant change ("Move", "Rotate", "Scale").
// The bounds and the matrices are the lazy half (`pivotImpl.ts`, loaded by `prepare`, §5.27).
import type { ParamDef, ReadonlyVec3, ReadonlyXf, Vec3, Xf } from '@ekza-studio/anim-core';
import type { GroupId, GroupRecord, MeshId, MeshRecord, ReadView, Tx } from '@ekza-studio/doc';
import { meshKernel } from '../../mesh';
import type { EditorApp, OperatorContext, PollResult } from '../../types';
import { type AnyOperator, defineOperator, fail, isFiniteNumber, isRecord, OK, optionalArgs } from './define';
import type * as PivotImpl from './pivotImpl';
import { MODEL_SETTINGS_REASON } from './softSelect';
import { NOT_AVAILABLE_YET } from './stub';

/** A mesh or group record (scene objects with a placement and a pivot). */
export type ObjectRecord = MeshRecord | GroupRecord;

export const NOTHING_TO_TRANSFORM = 'Select a mesh or group first';
export const MESH_LOADING = 'Mesh is loading';
export const FREEZE_SKINNED = 'Freezing would move a skinned mesh off its bones';
export const NOTHING_TO_FREEZE = 'Choose translate, rotate or scale to freeze';

type Impl = typeof PivotImpl;
const loadImpl = (): Promise<Impl> => import('./pivotImpl');

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

/** Patches the placement or pivot of a mesh or group. */
export function patchObject(
  tx: Tx,
  record: ObjectRecord,
  fields: { readonly placement?: ReadonlyXf; readonly pivot?: ReadonlyVec3 },
): void {
  if ('data' in record) tx.patch('meshes', record.id, fields);
  else tx.patch('groups', record.id, fields);
}

/** Direct children (meshes and groups of the same owner) of an object. */
export function childrenOf(view: ReadView, record: ObjectRecord): ObjectRecord[] {
  const out: ObjectRecord[] = [];
  for (const mesh of view.list('meshes')) if (mesh.parent === record.id) out.push(mesh);
  for (const group of view.list('groups')) if (group.parent === record.id) out.push(group);
  return out;
}

/** Every descendant mesh of an object (depth first, parents before children). */
export function descendantMeshes(view: ReadView, record: ObjectRecord, seen = new Set<string>()): MeshRecord[] {
  const out: MeshRecord[] = [];
  for (const child of childrenOf(view, record)) {
    if (seen.has(child.id)) continue;
    seen.add(child.id);
    if ('data' in child) out.push(child);
    out.push(...descendantMeshes(view, child, seen));
  }
  return out;
}

/** The meshes an object's bounds or Freeze read: the mesh itself, or a group's descendant meshes with data. */
function meshesOf(view: ReadView, record: ObjectRecord): MeshRecord[] {
  return ('data' in record ? [record] : descendantMeshes(view, record)).filter((mesh) => mesh.data !== null);
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

function ready(app: EditorApp, meshes: readonly MeshRecord[]): boolean {
  return meshes.every((mesh) => app.meshes.get(mesh.id)?.state === 'ready');
}

const kernelReady = (): PollResult => (meshKernel() === null ? fail('Mesh tools are loading') : OK);

/** Whether the loaded kernel's `mesh.applyTransform` is B4's op, not the B0a stub (probed once per kernel module). */
const applyTransformLanded = new WeakMap<object, boolean>();
function applyTransformReady(): PollResult {
  const kernel = meshKernel();
  if (kernel === null) return fail('Mesh tools are loading');
  let landed = applyTransformLanded.get(kernel);
  if (landed === undefined) {
    landed = true;
    const op = kernel.MESH_OPS['mesh.applyTransform'];
    const probe = kernel.emptyMesh();
    try {
      probe.begin('probe');
      const result = op?.run(
        probe,
        null,
        {},
        {
          symmetry: null,
          hidden: null,
          placement: { t: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] },
          faceted: true,
          soft: null,
          curves: { compile: () => ({}) as never, evaluate: () => 0 },
          epsilon: 1e-9,
        },
      );
      landed = op !== undefined && !(kernel.isRefusal(result) && result.code === 'not-implemented');
    } catch {
      // The real op may refuse an empty probe in its own way: it is there.
    } finally {
      probe.abort();
    }
    applyTransformLanded.set(kernel, landed);
  }
  // Until B4 lands the op, Freeze and Bake Pivot poll-fail as other ops that have not landed yet (READY.b4).
  return landed ? OK : fail(NOT_AVAILABLE_YET);
}

// ---------------------------------------------------------------------------------------------------------------
// `model.pivot.editToggle`, `mesh.pivot.*`, `mesh.resetTransforms`

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
    poll({ app }, raw) {
      const targets = targetsOf(app, raw);
      if (typeof targets === 'string') return fail(targets);
      if (kind === 'reset') return OK;
      return targets.every((record) => ready(app, meshesOf(app.store, record))) ? OK : fail(MESH_LOADING);
    },
    prepare: loadImpl,
    apply({ app, tx }, raw, impl) {
      const targets = targetsOf(app, raw);
      if (tx === null || typeof targets === 'string') return;
      (impl as Impl).applyPivotFrom(app, tx, targets, kind);
    },
  };
  return def;
}

const pivotBake = defineOperator<'mesh.pivot.bake', Impl>({
  id: 'mesh.pivot.bake',
  label: 'Bake Pivot',
  description: 'Makes the pivot the object origin without moving the mesh.',
  ...pivot,
  extraArgs: ['ids'],
  poll({ app }, raw) {
    const targets = targetsOf(app, raw);
    if (typeof targets === 'string') return fail(targets);
    const moved = (record: ObjectRecord): boolean =>
      record.pivot[0] !== 0 || record.pivot[1] !== 0 || record.pivot[2] !== 0;
    if (targets.some((record) => 'data' in record)) {
      const ok = kernelReady();
      if (ok !== true) return ok;
    }
    for (const record of targets) {
      if ('data' in record && record.skin !== null && moved(record)) return fail(FREEZE_SKINNED);
    }
    // A mesh's geometry moves by −pivot through `mesh.applyTransform`; a group's children only change placements.
    return targets.some((record) => 'data' in record && moved(record)) ? applyTransformReady() : OK;
  },
  prepare: loadImpl,
  apply(ctx, raw, impl) {
    const targets = targetsOf(ctx.app, raw);
    if (ctx.tx === null || typeof targets === 'string') return;
    impl.applyBakePivot(ctx, ctx.tx, targets);
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

export interface FreezeParts {
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
    for (const mesh of meshesOf(view, record)) {
      if (seen.has(mesh.id)) continue;
      seen.add(mesh.id);
      out.push(mesh);
    }
  }
  return out;
}

function freezePoll(ctx: OperatorContext, raw: unknown): PollResult {
  const targets = targetsOf(ctx.app, raw);
  if (typeof targets === 'string') return fail(targets);
  const parts = freezeParts(raw);
  if (!parts.translate && !parts.rotate && !parts.scale) return fail(NOTHING_TO_FREEZE);
  const meshes = freezeMeshes(ctx.app.store, targets);
  if (meshes.length === 0) return fail('Freeze works on meshes (a group freezes its meshes)');
  const ok = kernelReady();
  if (ok !== true) return ok;
  if (meshes.some((mesh) => mesh.skin !== null)) return fail(FREEZE_SKINNED);
  const landed = applyTransformReady();
  if (landed !== true) return landed;
  return ready(ctx.app, meshes) ? OK : fail(MESH_LOADING);
}

const freezeTransforms = defineOperator<'mesh.freezeTransforms', Impl>({
  id: 'mesh.freezeTransforms',
  label: 'Freeze Transformations',
  description: 'Bakes the object transforms into the mesh data.',
  ...pivot,
  flags: { undo: true, adjustable: true, repeatable: true },
  params: FREEZE_PARAMS,
  extraArgs: ['ids'],
  aliases: ['Apply Transform'],
  poll: freezePoll,
  prepare: loadImpl,
  apply(ctx, raw, impl) {
    const targets = targetsOf(ctx.app, raw);
    if (ctx.tx === null || typeof targets === 'string') return;
    impl.applyFreeze(ctx, ctx.tx, freezeMeshes(ctx.app.store, targets), freezeParts(raw));
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
