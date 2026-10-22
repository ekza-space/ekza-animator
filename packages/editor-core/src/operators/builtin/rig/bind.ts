// C4 (auto-skin; M6B-SPEC §5.9, §6.2, §0.4.4): Bind Skin and Unbind Skin. `skin.bind` resolves its defaults at invoke
// time (targets, `symmetrize: null` → a boolean, the held joints), runs the solver in the skin worker during
// `prepare` (a progress pill; a later run supersedes an earlier one) and commits one transaction over every target
// mesh: the new skin layers, `MeshRecord.skin = {skeleton, bind}` (the `SkinBindRecord` of a full run; a masked run
// keeps the stored record) and, when the character has no control rig yet, the generated rig (§5.16). Rebinding a
// bound mesh with no point mask asks first (`rebindSkin`, answered by `answerRebind`); Adjust Last never asks again.
// A masked run keeps the held joints' weights (§5.10, `applyHolds`), needs a bound mesh and defaults its method and
// options to the mesh's stored bind record (§0.4.4). `skin.weights.autoForJoints`
// stays deferred (§0.3).
import { EkzaError, type JsonValue, type ParamDef } from '@ekza-studio/anim-core';
import type { CharacterId, MeshId, MeshRecord, SkeletonId, Tx } from '@ekza-studio/doc';
import { skeletonFromDoc } from '@ekza-studio/io';
import type { BindMethod, SkinBindArgs, SkinBindRecord, SkinWeights } from '@ekza-studio/mesh-core';
import { readRigDefinition, updateAutoRig, writeRigDefinition } from '@ekza-studio/rig';
import { loadMeshKernel, meshKernel } from '../../../mesh/kernel';
import {
  autoSymmetrize,
  bindRefusal,
  characterOfMesh,
  type SkinBindInputs,
  type SkinBindResult,
  type SkinServiceImpl,
  skeletonOfModelCharacter,
  skinBindInputs,
} from '../../../rig/skinService';
import type { EditorApp, OperatorArgs, OperatorContext } from '../../../types';
import { type AnyOperator, defineOperator, fail, isRecord, OK } from '../define';
import { rememberResolvedArgs } from '../lastop';
import { rigStub } from './stub';

// ---------- params (§6.2; the option box and the Last-op card read them) ----------

export const BIND_METHODS: readonly { readonly value: BindMethod; readonly label: string }[] = [
  { value: 'auto-lowpoly', label: 'Auto (low-poly)' },
  { value: 'closest', label: 'Closest distance' },
  { value: 'rigid-islands', label: 'Rigid islands' },
  { value: 'heat', label: 'Heat map' },
];

export const BIND_PARAMS: readonly ParamDef[] = [
  {
    name: 'method',
    label: 'Bind Method',
    kind: 'enum',
    bound: 'value',
    default: 'auto-lowpoly',
    options: BIND_METHODS,
  },
  {
    name: 'hierarchy',
    label: 'Closest in Hierarchy',
    kind: 'bool',
    bound: 'value',
    default: true,
    description: 'Closest distance: the nearest joint, its parent and its children (off: the 4 nearest joints)',
  },
  { name: 'dropoff', label: 'Dropoff Rate', kind: 'number', bound: 'value', default: 4, min: 0.1, max: 10, step: 0.1 },
  {
    name: 'stiffness',
    label: 'Heatmap Falloff',
    kind: 'number',
    bound: 'value',
    default: 1,
    min: 0.1,
    max: 10,
    step: 0.1,
    primary: true,
  },
  { name: 'pruneBelow', label: 'Prune Below', kind: 'fraction', bound: 'value', default: 0.025, min: 0, max: 0.2 },
  {
    name: 'rigidifyAbove',
    label: 'Rigidify Above',
    kind: 'fraction',
    bound: 'value',
    default: null,
    nullable: true,
    min: 0.5,
    max: 1,
  },
  {
    name: 'symmetrize',
    label: 'Symmetrize',
    kind: 'bool',
    bound: 'value',
    default: null,
    nullable: true,
    description: 'Auto: on when the mesh is X-symmetric and the skeleton has left/right pairs',
  },
  {
    name: 'joints',
    label: 'Influences',
    kind: 'data',
    bound: 'value',
    default: null,
    nullable: true,
    hidden: true,
    schema: { type: 'array', items: { type: 'string' } },
  },
  {
    name: 'points',
    label: 'Points',
    kind: 'data',
    bound: 'value',
    default: null,
    nullable: true,
    hidden: true,
    schema: { type: 'array', items: { type: 'integer', minimum: 0 } },
  },
  {
    name: 'holds',
    label: 'Held joints',
    kind: 'data',
    bound: 'value',
    default: [],
    hidden: true,
    schema: { type: 'array', items: { type: 'string' } },
  },
];

type BindArgs = OperatorArgs<'skin.bind'>;
const BIND_LABEL = 'Bind Skin';
const BUSY = 'Binding skin…';

// ---------- targets ----------

const meshIdsOf = (value: unknown): MeshId[] | null =>
  Array.isArray(value) && value.every((id) => typeof id === 'string') ? (value as MeshId[]) : null;

/** The character Bind Skin acts on without explicit meshes: the workspace's, the active one, the selection's. */
export function bindCharacter(app: EditorApp): CharacterId | null {
  const state = app.session.getState();
  const live = (id: CharacterId | null): CharacterId | null => {
    if (id === null) return null;
    const record = app.store.get('characters', id);
    return record !== undefined && record.deleted === null && record.source.kind === 'model' ? id : null;
  };
  const fromSession = live(state.rig.character) ?? live(state.activeCharacter);
  if (fromSession !== null) return fromSession;
  for (const id of state.selection.objects) {
    const mesh = app.store.get('meshes', id as MeshId);
    const owner = mesh === undefined ? null : characterOfMesh(mesh);
    if (owner !== null && live(owner) !== null) return owner;
  }
  // The only model-sourced character with a skeleton.
  const characters = app.store
    .list('characters')
    .filter((c) => c.deleted === null && c.source.kind === 'model' && skeletonOfModelCharacter(app.store, c) !== null);
  return characters.length === 1 ? (characters[0]?.id ?? null) : null;
}

/** Explicit meshes, else every authored mesh of the bind character (§0.2 step 7: one click binds all of them). */
export function bindTargets(app: EditorApp, args: unknown): MeshId[] {
  const explicit = isRecord(args) ? meshIdsOf(args['meshes']) : null;
  if (explicit !== null) return explicit;
  const character = bindCharacter(app);
  if (character === null) return [];
  return app.store.query
    .meshesOfOwner(character)
    .filter((mesh) => mesh.deleted === null && mesh.data !== null)
    .map((mesh) => mesh.id);
}

function bindPoll(app: EditorApp, args: unknown): ReturnType<typeof fail> {
  if (app.session.getState().dialog === 'rebindSkin') return fail('Answer the Rebind Skin question first');
  const meshes = bindTargets(app, args);
  if (meshes.length === 0) return fail('Select a character with a skeleton (Quick Rig creates one)');
  let character: CharacterId | null = null;
  for (const mesh of meshes) {
    const refusal = bindRefusal(app.store, mesh);
    if (refusal !== null) return fail(refusal);
    const owner = characterOfMesh(app.store.get('meshes', mesh) as MeshRecord);
    if (character !== null && owner !== character) return fail('Bind Skin binds the meshes of one character at a time');
    character = owner;
  }
  const joints = isRecord(args) ? args['joints'] : undefined;
  if (Array.isArray(joints) && joints.length === 0) return fail(EMPTY_MASK);
  // §5.9 refuses an empty joint mask: a mask whose keys name no joint of the skeleton is empty too (and with no mask,
  // a skeleton without a deforming joint has nothing to bind to).
  if (character !== null && !maskHasJoint(app, character, Array.isArray(joints) ? joints : null))
    return fail(EMPTY_MASK);
  // A point mask re-solves some points of a bound mesh; the others keep weights it would not have.
  const points = isRecord(args) ? args['points'] : undefined;
  if (Array.isArray(points)) {
    const unbound = meshes.find((mesh) => !isBound(app, mesh));
    if (unbound !== undefined) {
      const name = app.store.get('meshes', unbound)?.name ?? unbound;
      return fail(`Bind ${name} first: only a bound mesh re-binds selected points`);
    }
  }
  return OK;
}

const EMPTY_MASK = 'Bind Skin needs at least one joint to bind to';

/** True when the joint mask (null: every deforming joint) names at least one live joint of the character's skeleton. */
function maskHasJoint(app: EditorApp, character: CharacterId, mask: readonly unknown[] | null): boolean {
  const record = app.store.get('characters', character);
  const skeleton = record === undefined ? null : skeletonOfModelCharacter(app.store, record);
  if (skeleton === null) return true; // bindRefusal reports a missing skeleton
  const keys = mask === null ? null : new Set(mask.filter((key): key is string => typeof key === 'string'));
  return app.store
    .list('joints')
    .some(
      (joint) =>
        joint.skeleton === skeleton &&
        joint.deleted === null &&
        (keys === null ? joint.role === 'bone' : keys.has(joint.id)),
    );
}

// ---------- rebind confirm (§5.9) ----------

/** Pending Rebind Skin questions per app: the args of the run that asked. */
const rebindRequests = new WeakMap<
  EditorApp,
  { readonly args: BindArgs; readonly meshes: readonly MeshId[]; readonly points: number }
>();

/** The Rebind Skin question the `rebindSkin` dialog shows ("Rebind replaces painted weights on 612 points of body."). */
export function rebindRequest(
  app: EditorApp,
): { readonly meshes: readonly MeshId[]; readonly points: number; readonly text: string } | null {
  const request = rebindRequests.get(app);
  if (request === undefined) return null;
  const names = request.meshes.map((id) => app.store.get('meshes', id)?.name ?? id).join(', ');
  return {
    meshes: request.meshes,
    points: request.points,
    text: `Rebind replaces painted weights on ${request.points} points of ${names}. Undo restores them.`,
  };
}

/**
 * Answers the Rebind Skin question: 'rebind' re-runs the bind confirmed; 'selected' re-binds only the selected
 * points of each mesh (a masked run per mesh with a selection); 'cancel' drops it. Closes the dialog.
 */
export async function answerRebind(app: EditorApp, choice: 'rebind' | 'selected' | 'cancel'): Promise<void> {
  const request = rebindRequests.get(app);
  rebindRequests.delete(app);
  if (app.session.getState().dialog === 'rebindSkin') app.session.setState({ dialog: null });
  if (request === undefined || choice === 'cancel') return;
  const args = isRecord(request.args) ? request.args : {};
  if (choice === 'rebind') {
    await app.runUntyped('skin.bind', { ...args, meshes: request.meshes, confirm: true });
    return;
  }
  for (const mesh of request.meshes) {
    // An unbound mesh has no weights to keep outside the selection: it is left for a full bind.
    if (!isBound(app, mesh)) continue;
    const points = app.components.get(mesh, 'vertex').verts.toArray();
    if (points.length === 0) continue;
    await app.runUntyped('skin.bind', { ...args, meshes: [mesh], points: Array.from(points) });
  }
}

const isBound = (app: EditorApp, mesh: MeshId): boolean => {
  const record = app.store.get('meshes', mesh);
  if (record?.skin !== null && record?.skin !== undefined) return true;
  const data = app.meshes.get(mesh)?.data() ?? null;
  return data !== null && (meshKernel()?.readSkin(data) ?? null) !== null;
};

// ---------- the operator ----------

interface BindRun {
  readonly inputs: SkinBindInputs;
  readonly result: SkinBindResult;
}

interface BindPrepared {
  readonly runs: readonly BindRun[];
  readonly args: Required<SkinBindArgs> & { readonly symmetrize: boolean };
  readonly holds: readonly string[];
  /** Set when the run asked the Rebind Skin question instead of binding. */
  readonly asked: boolean;
}

/** §5.9 args with the run's values over the defaults (symmetrize still nullable here). */
function solverArgs(args: unknown): SkinBindArgs {
  const a = isRecord(args) ? args : {};
  const num = (key: string, fallback: number): number => (typeof a[key] === 'number' ? a[key] : fallback);
  const method = a['method'];
  return {
    method: BIND_METHODS.some((m) => m.value === method) ? (method as BindMethod) : 'auto-lowpoly',
    joints: Array.isArray(a['joints']) ? (a['joints'] as string[]) : null,
    points: Array.isArray(a['points']) ? (a['points'] as number[]) : null,
    hierarchy: typeof a['hierarchy'] === 'boolean' ? a['hierarchy'] : true,
    dropoff: num('dropoff', 4),
    stiffness: num('stiffness', 1),
    pruneBelow: num('pruneBelow', 0.025),
    rigidifyAbove: typeof a['rigidifyAbove'] === 'number' ? a['rigidifyAbove'] : null,
    symmetrize: typeof a['symmetrize'] === 'boolean' ? a['symmetrize'] : null,
  };
}

/** The `SkinBindRecord` keys a masked run inherits (§0.4.4: "with the stored bind arguments"). */
const STORED_KEYS = [
  'method',
  'hierarchy',
  'dropoff',
  'stiffness',
  'pruneBelow',
  'rigidifyAbove',
  'symmetrize',
  'joints',
] as const;

/**
 * The args of a masked run on one mesh: the run's own values over the mesh's stored bind record (Bind Unweighted
 * Points and the Quick Rig re-run pass only `{meshes, points}`), over the operator defaults.
 */
function maskedArgs(app: EditorApp, mesh: MeshId, args: unknown): SkinBindArgs {
  const skin = app.store.get('meshes', mesh)?.skin ?? null;
  const stored = skin !== null && 'bind' in skin && isRecord(skin.bind) ? skin.bind : null;
  const merged: Record<string, unknown> = {};
  if (stored !== null) for (const key of STORED_KEYS) if (stored[key] !== undefined) merged[key] = stored[key];
  if (isRecord(args)) for (const [key, value] of Object.entries(args)) if (value !== undefined) merged[key] = value;
  return solverArgs(merged);
}

/** The held joint keys of a character (§5.10; recorded in the args, never read again on replay). */
function heldJoints(app: EditorApp, args: unknown, character: CharacterId | null): string[] {
  const recorded = isRecord(args) ? args['holds'] : undefined;
  if (Array.isArray(recorded) && recorded.length > 0) return recorded.filter((k): k is string => typeof k === 'string');
  if (character === null) return [];
  return [...(app.session.getState().rig.holds.get(character) ?? [])].sort();
}

/** `MeshRecord.skin.bind` of a full run (§4.2 `SkinBindRecord`: never the point mask). */
export function bindRecordOf(args: SkinBindArgs & { readonly symmetrize: boolean }): SkinBindRecord {
  return {
    v: 1,
    method: args.method,
    hierarchy: args.hierarchy,
    dropoff: args.dropoff,
    stiffness: args.stiffness,
    pruneBelow: args.pruneBelow,
    rigidifyAbove: args.rigidifyAbove,
    symmetrize: args.symmetrize,
    ...(args.joints === null ? {} : { joints: [...args.joints] }),
  };
}

/** §5.16: generates the control rig in the bind's transaction when the character has none yet. */
export function ensureControlRig(tx: Tx, character: CharacterId, skeleton: SkeletonId): boolean {
  const record = tx.get('characters', character);
  const skeletonRecord = tx.get('skeletons', skeleton);
  if (record === undefined || skeletonRecord === undefined) return false;
  const current = readRigDefinition(tx, record.rig) ?? null;
  if (current !== null && current.controls.some((control) => control.deleted === null)) return false;
  const joints = tx.list('joints').filter((joint) => joint.skeleton === skeleton && joint.deleted === null);
  if (joints.length === 0) return false;
  const desc = skeletonFromDoc({ skeleton: skeletonRecord, joints, meshes: [] });
  // Q-RIG-2: legs IK, arms FK.
  const update = updateAutoRig(current, desc, { character, rig: record.rig }, { ik: { legs: true, arms: false } });
  if (current === null) {
    writeRigDefinition(tx, update.rig);
    return true;
  }
  // The rig record exists (a character always names its rig): patch it, add the generated records parents first.
  const { id: _rig, ...rigFields } = update.rig.rig;
  tx.patch('rigs', record.rig, rigFields);
  const written = new Set<string>();
  let pending = [...update.rig.controls];
  while (pending.length > 0) {
    const ids = new Set(pending.map((control) => control.id as string));
    const ready = pending.filter((c) => c.parent === null || !ids.has(c.parent) || written.has(c.parent));
    for (const control of ready.length > 0 ? ready : pending) {
      const { id, ...fields } = control;
      if (tx.get('controls', id) === undefined) tx.put('controls', control);
      else tx.patch('controls', id, fields);
      written.add(id);
    }
    pending = pending.filter((control) => !written.has(control.id));
  }
  for (const solver of update.rig.solvers) {
    const { id, ...fields } = solver;
    if (tx.get('solvers', id) === undefined) tx.put('solvers', solver);
    else tx.patch('solvers', id, fields);
  }
  for (const constraint of update.rig.constraints) {
    const { id, ...fields } = constraint;
    if (tx.get('constraints', id) === undefined) tx.put('constraints', constraint);
    else tx.patch('constraints', id, fields);
  }
  return true;
}

async function prepareBind(ctx: OperatorContext, args: BindArgs): Promise<BindPrepared> {
  const { app } = ctx;
  const meshes = bindTargets(app, args);
  const base = solverArgs(args);
  const character =
    meshes.length === 0 ? null : characterOfMesh(app.store.get('meshes', meshes[0] as MeshId) as MeshRecord);
  const holds = heldJoints(app, args, character);
  const confirmed = isRecord(args) && (args as Readonly<Record<string, unknown>>)['confirm'] === true;
  // §5.9: rebinding a bound mesh with no point mask asks first; Adjust Last's re-run never asks again.
  if (base.points === null && !confirmed && ctx.source !== 'card' && meshes.some((mesh) => isBound(app, mesh))) {
    const kernel = meshKernel();
    let points = 0;
    for (const mesh of meshes) {
      const data = app.meshes.get(mesh)?.data() ?? null;
      if (data !== null && kernel?.readSkin(data) !== null) points += data.counts.points;
    }
    rebindRequests.set(app, { args, meshes, points });
    app.session.setState({ dialog: 'rebindSkin' });
    return { runs: [], args: { ...base, symmetrize: false }, holds, asked: true };
  }
  const service = app.rig.skin as SkinServiceImpl;
  app.session.setState({ busy: { label: BUSY, progress: 0 } });
  try {
    const runs: BindRun[] = [];
    const masked = base.points !== null;
    // A masked run's method and options default to each mesh's stored record; the first target's are recorded.
    let resolved: SkinBindArgs = base;
    let recorded: boolean | null = base.symmetrize;
    for (const [i, mesh] of meshes.entries()) {
      const meshArgs = masked ? maskedArgs(app, mesh, args) : base;
      if (i === 0) {
        resolved = meshArgs;
        recorded = meshArgs.symmetrize;
      }
      const inputs = await skinBindInputs(app, mesh);
      // `symmetrize: null` resolves per mesh at invoke time; the first target's value is the one recorded.
      const symmetrize = meshArgs.symmetrize ?? autoSymmetrize(inputs.geometry, inputs.skeleton);
      recorded ??= symmetrize;
      const previous = masked ? inputs.previous : null;
      // §5.10: the held entries of the masked points come back from a copy (the worker takes `previous`'s buffers).
      const heldFrom: SkinWeights | null =
        previous !== null && holds.length > 0
          ? { ...previous, joints: previous.joints.slice(), weights: previous.weights.slice() }
          : null;
      const job = { geometry: inputs.geometry, skeleton: inputs.skeleton, args: { ...meshArgs, symmetrize }, previous };
      const solved =
        typeof service.run === 'function'
          ? await service.run(mesh, job)
          : await app.rig.skin.bind(mesh, { ...meshArgs, symmetrize });
      const result =
        heldFrom === null || base.points === null
          ? solved
          : { ...solved, skin: (await loadMeshKernel()).applyHolds(solved.skin, heldFrom, base.points, holds) };
      runs.push({ inputs, result });
      app.session.setState({ busy: { label: BUSY, progress: (i + 1) / meshes.length } });
    }
    return { runs, args: { ...resolved, symmetrize: recorded ?? false }, holds, asked: false };
  } finally {
    if (app.session.getState().busy?.label === BUSY) app.session.setState({ busy: null });
  }
}

const bind = defineOperator<'skin.bind', BindPrepared>({
  id: 'skin.bind',
  label: BIND_LABEL,
  description: 'Binds the meshes of a character to its skeleton with automatic weights (M6B-SPEC §5.9).',
  category: 'skin',
  scope: 'rig',
  workspaces: ['rig'],
  aliases: ['With Automatic Weights'],
  flags: { undo: true, adjustable: true, repeatable: true },
  params: BIND_PARAMS,
  extraArgs: ['meshes', 'confirm'],
  undoLabel: () => BIND_LABEL,
  poll: ({ app }, args) => bindPoll(app, args),
  prepare: (ctx, args) => prepareBind(ctx, args),
  apply({ app, tx }, _args, prepared) {
    if (tx === null) throw new EkzaError('internal', 'skin.bind runs in a transaction');
    if (prepared.asked) {
      throw new EkzaError('op-refused', 'Rebind replaces painted weights: answer the Rebind Skin question');
    }
    const kernel = meshKernel();
    if (kernel === null) throw new EkzaError('unavailable', 'Mesh tools are loading');
    const full = prepared.args.points === null;
    const characters = new Map<CharacterId, SkeletonId>();
    for (const { inputs, result } of prepared.runs) {
      // The solve read this revision; a concurrent edit makes it stale.
      if (app.meshes.get(inputs.mesh)?.data() !== inputs.data) {
        throw new EkzaError('op-refused', 'The mesh changed while binding: run Bind Skin again');
      }
      const record = tx.get('meshes', inputs.mesh) as MeshRecord;
      const stored = record.skin !== null && 'skeleton' in record.skin ? record.skin : null;
      const skin: MeshRecord['skin'] = full
        ? {
            skeleton: inputs.skeletonId,
            bind: bindRecordOf(prepared.args) as unknown as Readonly<Record<string, JsonValue>>,
          }
        : stored !== null && stored.skeleton === inputs.skeletonId
          ? stored
          : { skeleton: inputs.skeletonId, bind: null };
      // The record names its skeleton before the data is written, so the revision's `joints` (the reference copy of
      // the palette, `MeshRef.joints`) lists the bound joints on the first bind too.
      if (skin !== record.skin) tx.patch('meshes', inputs.mesh, { skin });
      app.meshes.writeData(tx, inputs.mesh, kernel.withSkin(inputs.data, result.skin));
      characters.set(inputs.character, inputs.skeletonId);
    }
    for (const [character, skeleton] of characters) ensureControlRig(tx, character, skeleton);
    const value = { meshes: prepared.runs.map((run) => run.inputs.mesh) };
    // Recorded for Adjust Last and replay: the resolved symmetrize and holds (a masked run also its method and options,
    // which may come from the stored record); `confirm` never replays.
    const a = prepared.args;
    rememberResolvedArgs(value, {
      ...(full
        ? {}
        : {
            method: a.method,
            hierarchy: a.hierarchy,
            dropoff: a.dropoff,
            stiffness: a.stiffness,
            pruneBelow: a.pruneBelow,
            rigidifyAbove: a.rigidifyAbove,
            joints: a.joints === null ? null : [...a.joints],
          }),
      symmetrize: a.symmetrize,
      holds: [...prepared.holds],
      confirm: false,
    });
    return value;
  },
});

// ---------- Unbind Skin ----------

const unbindRequests = new WeakMap<EditorApp, readonly MeshId[]>();

/** The meshes the `unbindSkin` dialog asks about ("Weights are discarded (undo restores them)"), or null. */
export function unbindRequest(app: EditorApp): readonly MeshId[] | null {
  return unbindRequests.get(app) ?? null;
}

/** Answers the Unbind Skin question ('unbind' runs it confirmed). Closes the dialog. */
export async function answerUnbind(app: EditorApp, choice: 'unbind' | 'cancel'): Promise<void> {
  const meshes = unbindRequests.get(app);
  unbindRequests.delete(app);
  if (app.session.getState().dialog === 'unbindSkin') app.session.setState({ dialog: null });
  if (meshes === undefined || choice === 'cancel') return;
  await app.runUntyped('skin.unbind', { meshes, confirm: true });
}

function unbindTargets(app: EditorApp, args: unknown): MeshId[] {
  return bindTargets(app, args).filter((mesh) => isBound(app, mesh));
}

const unbind = defineOperator<'skin.unbind', { readonly asked: boolean }>({
  id: 'skin.unbind',
  label: 'Unbind Skin',
  description: 'Removes the skin weights of the meshes (M6B-SPEC §5.9).',
  category: 'skin',
  scope: 'rig',
  workspaces: ['rig'],
  flags: { undo: true },
  extraArgs: ['meshes', 'confirm'],
  undoLabel: () => 'Unbind Skin',
  poll: ({ app }, args) => {
    if (app.session.getState().dialog === 'unbindSkin') return fail('Answer the Unbind Skin question first');
    return unbindTargets(app, args).length === 0 ? fail('No bound mesh to unbind') : OK;
  },
  async prepare({ app }, args) {
    await loadMeshKernel();
    if (isRecord(args) && (args as Readonly<Record<string, unknown>>)['confirm'] === true) return { asked: false };
    unbindRequests.set(app, unbindTargets(app, args));
    app.session.setState({ dialog: 'unbindSkin' });
    return { asked: true };
  },
  apply({ app, tx }, args, prepared) {
    if (tx === null) throw new EkzaError('internal', 'skin.unbind runs in a transaction');
    if (prepared.asked)
      throw new EkzaError('op-refused', 'Unbinding discards the weights: answer the Unbind Skin question');
    const kernel = meshKernel();
    if (kernel === null) throw new EkzaError('unavailable', 'Mesh tools are loading');
    for (const mesh of unbindTargets(app, args)) {
      const data = app.meshes.get(mesh)?.data() ?? null;
      if (data === null) throw new EkzaError('mesh-not-ready', `${mesh}: its mesh data is not available`);
      // The skin layers and the review layer go; the record forgets its skeleton.
      if (kernel.readSkin(data) !== null || kernel.readSkinReview(data) !== null) {
        app.meshes.writeData(tx, mesh, kernel.withSkin(data, null, null));
      }
      if (tx.get('meshes', mesh)?.skin !== null) tx.patch('meshes', mesh, { skin: null });
    }
  },
});

export const BIND_OPERATORS: readonly AnyOperator[] = [
  bind,
  rigStub('skin.weights.autoForJoints', 'Auto Weights for Selected Joints', {
    undo: true,
    adjustable: true,
    repeatable: true,
    deferred: true,
  }),
  unbind,
];
