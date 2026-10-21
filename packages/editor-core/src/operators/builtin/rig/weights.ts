// C6 (skin UI with the C5 MVP subset; M6B-SPEC §5.10–§5.13, §6.2, §0.6): the weight operators. Each one resolves its
// targets and the held joints at invoke time (recorded in its args, `holds`, so Adjust Last and replay never read the
// session again), computes the new weights in `prepare` with the pure kernel (mesh-core `editWeights`,
// `mirrorWeights`) and commits ONE transaction through plain `writeData` (the CR-1 fallback, §0.4.1): one undo step,
// never a key.
//
// - `skin.weights.paint {mesh, joint, op, value, stamps, mirror, holds}`: a stroke of the Paint Skin Weights tool (the
//   tool previews the same stamps through `beginStroke`; the commit is bit-identical, P-S2).
// - `skin.weights.flood {op, value, opacity, mirror, joint, points, holds}`: the brush's op at `s = opacity` on every
//   point of the target meshes (or `points`). Defaults: the session brush and the active influence; `mirror` defaults
//   to false (with `mirror: true` only the partners outside the mask take the mirrored op).
// - `skin.weights.set {value, mode, joint, mesh, points, holds}`: table edits and scripts (§5.12).
// - `skin.weights.mirror {direction, surface, selection, holds}`, `.smooth {factor, iterations, expand, holds}`,
//   `.prune {below, holds}`, `.normalize {lockActive, holds}`: the utilities of §5.13 on the target meshes (the selected
//   points when `selection` / when points are selected, else every point).
// - `skin.palette.compact {meshes}`: Remove Unused Influences (skeleton order, P-S6).
// Targets: the hilited bound meshes of the active character, else all its bound meshes (Skin mode works on them).
// The deferred ids of this file (§0.3) stay stubs.
import { EkzaError, type JsonValue, type ParamDef } from '@ekza-studio/anim-core';
import type { CharacterId, MeshId, SkeletonId } from '@ekza-studio/doc';
import type {
  MeshData,
  PaintOp,
  SkinGeometry,
  SkinSkeleton,
  SkinWeights,
  StrokeStamp,
  WeightContext,
} from '@ekza-studio/mesh-core';
import { loadMeshKernel, meshKernel } from '../../../mesh/kernel';
import { characterOfMesh, readyMeshData, skeletonOfModelCharacter, skinSkeletonOf } from '../../../rig/skinService';
import type { EditorApp, OperatorContext, PollResult } from '../../../types';
import { type AnyOperator, defineOperator, fail, isRecord, OK } from '../define';
import { rememberResolvedArgs } from '../lastop';
import { rigStub } from './stub';

// ---------- targets, holds, inputs (shared with influence.ts, the tool and the panels) ----------

/** The model character a mesh is bound in (its record's skin names the character's skeleton), or null. */
export function boundCharacter(app: Pick<EditorApp, 'store'>, mesh: MeshId): CharacterId | null {
  const record = app.store.get('meshes', mesh);
  if (record === undefined || record.deleted !== null || record.skin === null || !('skeleton' in record.skin))
    return null;
  const character = characterOfMesh(record);
  const char = character === null ? undefined : app.store.get('characters', character);
  if (char === undefined || char.deleted !== null || char.source.kind !== 'model') return null;
  return record.skin.skeleton === skeletonOfModelCharacter(app.store, char) ? char.id : null;
}

/** The character Skin mode works on: the workspace's active character, else the session's. */
export function skinCharacter(app: Pick<EditorApp, 'store' | 'session'>): CharacterId | null {
  const state = app.session.getState();
  for (const id of [state.rig.character, state.activeCharacter]) {
    if (id === null) continue;
    const record = app.store.get('characters', id);
    if (record !== undefined && record.deleted === null && record.source.kind === 'model') return id;
  }
  return null;
}

/** The bound meshes of a character, by order then id. */
export function boundMeshesOf(app: Pick<EditorApp, 'store'>, character: CharacterId): MeshId[] {
  return app.store.query
    .meshesOfOwner(character)
    .filter((mesh) => mesh.deleted === null && mesh.data !== null && boundCharacter(app, mesh.id) === character)
    .sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : a.id < b.id ? -1 : 1))
    .map((mesh) => mesh.id);
}

/** The meshes a weight operator acts on: the hilited bound meshes of the active character, else all its bound ones. */
export function skinTargets(app: Pick<EditorApp, 'store' | 'session'>): MeshId[] {
  const character = skinCharacter(app);
  if (character === null) return [];
  const bound = boundMeshesOf(app, character);
  const hilite = new Set<string>(app.session.getState().model.hilite);
  const hilited = bound.filter((mesh) => hilite.has(mesh));
  return hilited.length > 0 ? hilited : bound;
}

/** The `prefs.rigging.holds` key of a character (per project and character, §5.10). */
export function holdsPrefKey(app: Pick<EditorApp, 'session'>, character: CharacterId): string {
  return `${app.session.getState().projectName}/${character}`;
}

/** The held joint keys of a character: the session's, else the ones remembered in the prefs (sorted). */
export function heldKeysOf(app: Pick<EditorApp, 'session' | 'prefs'>, character: CharacterId | null): string[] {
  if (character === null) return [];
  const session = app.session.getState().rig.holds.get(character);
  if (session !== undefined) return [...session].sort();
  const remembered = app.prefs.getState().rigging.holds[holdsPrefKey(app, character)];
  return remembered === undefined ? [] : [...remembered].sort();
}

/** The holds an operator runs with: the recorded `holds` arg (replay, Adjust Last), else the session's. */
function resolvedHolds(app: EditorApp, args: unknown, character: CharacterId | null): string[] {
  const recorded = isRecord(args) ? args['holds'] : undefined;
  if (Array.isArray(recorded)) return recorded.filter((key): key is string => typeof key === 'string');
  return heldKeysOf(app, character);
}

/** A joint's display name (the record's name, else the key). */
export function jointName(app: Pick<EditorApp, 'store'>, key: string): string {
  return app.store.get('joints', key as never)?.name ?? key;
}

/** Everything a weight edit of one mesh reads: the stored form, its skin, the solver geometry and skeleton. */
export interface WeightInputs {
  readonly mesh: MeshId;
  readonly character: CharacterId;
  readonly skeletonId: SkeletonId;
  readonly data: MeshData;
  readonly skin: SkinWeights;
  readonly geometry: SkinGeometry;
  readonly skeleton: SkinSkeleton;
}

/** The inputs of a bound mesh whose revision is resident (null when not bound or not loaded). Synchronous. */
export function weightInputsNow(app: EditorApp, mesh: MeshId): WeightInputs | null {
  const kernel = meshKernel();
  const character = boundCharacter(app, mesh);
  const record = app.store.get('meshes', mesh);
  if (kernel === null || character === null || record === undefined) return null;
  const data = app.meshes.get(mesh)?.data() ?? null;
  const skin = data === null ? null : kernel.readSkin(data);
  if (data === null || skin === null) return null;
  const skeletonId = (record.skin as { readonly skeleton: SkeletonId }).skeleton;
  const skeleton = skinSkeletonCached(app, skeletonId);
  return {
    mesh,
    character,
    skeletonId,
    data,
    skin,
    geometry: kernel.skinGeometryOf(data, skeleton.height),
    skeleton,
  };
}

/** The inputs of a bound mesh, waiting for the kernel and the revision. */
export async function weightInputs(app: EditorApp, mesh: MeshId): Promise<WeightInputs> {
  await loadMeshKernel();
  if (boundCharacter(app, mesh) === null) {
    const name = app.store.get('meshes', mesh)?.name ?? mesh;
    throw new EkzaError('op-refused', `${name} is not bound (Skin › Bind Skin first)`);
  }
  await readyMeshData(app, mesh);
  const inputs = weightInputsNow(app, mesh);
  if (inputs === null) throw new EkzaError('mesh-not-ready', `${mesh}: its skin is not available`);
  return inputs;
}

/** `SkinSkeleton` per skeleton record, cached while its joint records are the same objects (records are immutable). */
const skeletonCache = new WeakMap<
  object,
  Map<SkeletonId, { readonly joints: readonly object[]; readonly skeleton: SkinSkeleton }>
>();
function skinSkeletonCached(app: EditorApp, id: SkeletonId): SkinSkeleton {
  let byApp = skeletonCache.get(app);
  if (byApp === undefined) {
    byApp = new Map();
    skeletonCache.set(app, byApp);
  }
  const joints = app.store.query.jointsOfSkeleton(id);
  const hit = byApp.get(id);
  if (hit !== undefined && hit.joints.length === joints.length && hit.joints.every((joint, i) => joint === joints[i]))
    return hit.skeleton;
  const skeleton = skinSkeletonOf(app.store, id);
  byApp.set(id, { joints: [...joints], skeleton });
  return skeleton;
}

/** The weight context of inputs with a set of held keys. */
export function weightContext(inputs: WeightInputs, holds: readonly string[]): WeightContext {
  return { skeleton: inputs.skeleton, geometry: inputs.geometry, holds: new Set(holds) };
}

/** The selected points of a mesh (Skin mode's component selection), ascending. */
export function selectedPoints(app: EditorApp, mesh: MeshId): number[] {
  try {
    return Array.from(app.components.get(mesh, 'vertex').verts.toArray()).sort((a, b) => a - b);
  } catch {
    return [];
  }
}

/** Why a joint cannot be painted on a set of meshes, or null (§5.10: held; unknown joints). */
export function skinPaintRefusal(
  app: EditorApp,
  character: CharacterId | null,
  joint: string,
  holds?: readonly string[],
): string | null {
  const record = app.store.get('joints', joint as never);
  if (record === undefined || record.deleted !== null) return `Pick an influence first (${joint} is not a joint)`;
  const held = holds ?? heldKeysOf(app, character);
  if (held.includes(joint)) return `${record.name} is held`;
  return null;
}

/** "socket_back does not deform by default", once per joint and session (§5.10). */
const warnedJoints = new WeakMap<EditorApp, Set<string>>();
export function warnNonDeforming(app: EditorApp, joint: string): void {
  const record = app.store.get('joints', joint as never);
  if (record === undefined || record.role === 'bone') return;
  let warned = warnedJoints.get(app);
  if (warned === undefined) {
    warned = new Set();
    warnedJoints.set(app, warned);
  }
  if (warned.has(joint)) return;
  warned.add(joint);
  app.services.notify.toast({ kind: 'info', text: `${record.name} does not deform by default` });
}

// ---------- the common run shape ----------

interface MeshEdit {
  readonly inputs: WeightInputs;
  readonly skin: SkinWeights;
  readonly changed: Uint32Array;
}

interface Prepared {
  readonly edits: readonly MeshEdit[];
  readonly holds: readonly string[];
}

const NO_BOUND = 'No bound mesh (Skin › Bind Skin first)';

/** Commits the edits of a run: one `writeData` per changed mesh (the CR-1 fallback). */
function commit(
  ctx: Parameters<AnyOperator['apply']>[0],
  prepared: Prepared,
): { readonly meshes: MeshId[]; readonly holds: string[] } {
  const { app, tx } = ctx;
  if (tx === null) throw new EkzaError('internal', 'weight edits run in a transaction');
  const kernel = meshKernel();
  if (kernel === null) throw new EkzaError('unavailable', 'Mesh tools are loading');
  const meshes: MeshId[] = [];
  for (const edit of prepared.edits) {
    if (edit.changed.length === 0 && edit.skin.palette.length === edit.inputs.skin.palette.length) continue;
    if (app.meshes.get(edit.inputs.mesh)?.data() !== edit.inputs.data) {
      throw new EkzaError('op-refused', 'The mesh changed while editing its weights: try again');
    }
    app.meshes.writeData(tx, edit.inputs.mesh, kernel.withSkin(edit.inputs.data, edit.skin));
    meshes.push(edit.inputs.mesh);
  }
  return { meshes, holds: [...prepared.holds] };
}

const holdsParam: ParamDef = {
  name: 'holds',
  label: 'Held joints',
  kind: 'data',
  bound: 'value',
  default: null,
  nullable: true,
  hidden: true,
  schema: { type: 'array', items: { type: 'string' } },
};

const pointsParam: ParamDef = {
  name: 'points',
  label: 'Points',
  kind: 'data',
  bound: 'selection',
  default: null,
  nullable: true,
  hidden: true,
  schema: { type: 'array', items: { type: 'integer', minimum: 0 } },
};

const jointParam = (bound: 'value' | 'selection'): ParamDef => ({
  name: 'joint',
  label: 'Influence',
  kind: 'data',
  bound,
  default: null,
  nullable: true,
  hidden: true,
  schema: { type: 'string' },
});

const OPS: readonly { readonly value: PaintOp; readonly label: string }[] = [
  { value: 'replace', label: 'Replace' },
  { value: 'add', label: 'Add' },
  { value: 'scale', label: 'Scale' },
  { value: 'smooth', label: 'Smooth' },
];
const isOp = (value: unknown): value is PaintOp => OPS.some((op) => op.value === value);

const numberOr = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

/** A poll over the resolved targets. */
function targetsPoll(app: EditorApp): PollResult {
  return skinTargets(app).length === 0 ? fail(NO_BOUND) : OK;
}

/** Runs a kernel edit per target mesh in `prepare`. */
async function prepareEach(
  ctx: OperatorContext,
  args: unknown,
  meshes: readonly MeshId[],
  edit: (
    inputs: WeightInputs,
    weightCtx: WeightContext,
  ) => { readonly skin: SkinWeights; readonly changed: Uint32Array },
): Promise<Prepared> {
  const { app } = ctx;
  const character = meshes.length === 0 ? null : boundCharacter(app, meshes[0] as MeshId);
  const holds = resolvedHolds(app, args, character);
  const edits: MeshEdit[] = [];
  for (const mesh of meshes) {
    const inputs = await weightInputs(app, mesh);
    const out = edit(inputs, weightContext(inputs, holds));
    edits.push({ inputs, skin: out.skin, changed: out.changed });
  }
  return { edits, holds };
}

// ---------- skin.weights.paint ----------

/** A recorded stamp (`stamps: data (ptr)`): point indices and their strengths. */
interface StampArg {
  readonly points: readonly number[];
  readonly strength: readonly number[];
}

/** Stamps as the kernel takes them. */
export function stampsOf(value: unknown): StrokeStamp[] {
  if (!Array.isArray(value)) return [];
  const out: StrokeStamp[] = [];
  for (const stamp of value as readonly unknown[]) {
    if (!isRecord(stamp)) continue;
    const points = stamp['points'];
    const strength = stamp['strength'];
    if (!isArrayLike(points) || !isArrayLike(strength)) continue;
    out.push({
      points: Uint32Array.from(points as ArrayLike<number>),
      strength: Float32Array.from(strength as ArrayLike<number>),
    });
  }
  return out;
}

const isArrayLike = (value: unknown): boolean =>
  Array.isArray(value) || value instanceof Uint32Array || value instanceof Float32Array;

/** Stamps as recorded args (plain arrays, so LastRun and replays are JSON). */
export function stampArgs(stamps: readonly StrokeStamp[]): StampArg[] {
  return stamps.map((stamp) => ({ points: Array.from(stamp.points), strength: Array.from(stamp.strength) }));
}

function paintPoll(app: EditorApp, args: unknown): PollResult {
  if (!isRecord(args) || typeof args['mesh'] !== 'string' || typeof args['joint'] !== 'string' || !isOp(args['op'])) {
    return fail('expects { mesh, joint, op, value, stamps, mirror }');
  }
  const mesh = args['mesh'] as MeshId;
  const character = boundCharacter(app, mesh);
  if (character === null) return fail(NO_BOUND);
  const holds = Array.isArray(args['holds']) ? (args['holds'] as string[]) : undefined;
  const refusal = skinPaintRefusal(app, character, args['joint'], holds);
  return refusal === null ? OK : fail(refusal);
}

const paint = defineOperator<'skin.weights.paint', Prepared>({
  id: 'skin.weights.paint',
  label: 'Paint Skin Weights',
  description: 'One stroke of the Paint Skin Weights tool (M6B-SPEC §5.11).',
  category: 'skin',
  scope: 'rig',
  workspaces: ['rig'],
  tool: 'paintSkinWeights',
  flags: { undo: true, internal: true },
  params: [
    {
      name: 'mesh',
      label: 'Mesh',
      kind: 'data',
      bound: 'pointer',
      default: null,
      nullable: true,
      hidden: true,
      schema: { type: 'string' },
    },
    jointParam('value'),
    { name: 'op', label: 'Operation', kind: 'enum', bound: 'value', default: 'replace', options: OPS },
    { name: 'value', label: 'Value', kind: 'number', bound: 'value', default: 1, min: -1, max: 1 },
    {
      name: 'stamps',
      label: 'Stamps',
      kind: 'data',
      bound: 'pointer',
      default: [],
      hidden: true,
      schema: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            points: { type: 'array', items: { type: 'integer', minimum: 0 } },
            strength: { type: 'array', items: { type: 'number' } },
          },
        },
      },
    },
    { name: 'mirror', label: 'Mirror Stroke', kind: 'bool', bound: 'value', default: false },
    holdsParam,
  ],
  undoLabel: () => 'Paint Skin Weights',
  poll: ({ app }, args) => paintPoll(app, args),
  async prepare(ctx, args) {
    const mesh = args.mesh;
    warnNonDeforming(ctx.app, args.joint);
    return prepareEach(ctx, args, [mesh], (inputs, weightCtx) => {
      const kernel = meshKernel();
      if (kernel === null) throw new EkzaError('unavailable', 'Mesh tools are loading');
      return kernel.editWeights(
        inputs.skin,
        {
          kind: 'stroke',
          joint: args.joint,
          op: args.op,
          value: args.value,
          stamps: stampsOf(args.stamps),
          mirror: args.mirror,
        },
        weightCtx,
      );
    });
  },
  apply: (ctx, _args, prepared) => {
    commit(ctx, prepared);
  },
});

// ---------- skin.weights.flood ----------

/** The active influence's joint (a palette key), else null. */
export function activeJoint(app: Pick<EditorApp, 'session'>): string | null {
  return app.session.getState().rig.activeInfluence?.joint ?? null;
}

const flood = defineOperator<'skin.weights.flood', Prepared>({
  id: 'skin.weights.flood',
  label: 'Flood',
  description: "Applies the brush's operation to every point of the meshes (M6B-SPEC §5.11).",
  category: 'skin',
  scope: 'rig',
  workspaces: ['rig'],
  flags: { undo: true, repeatable: true },
  params: [
    { name: 'op', label: 'Operation', kind: 'enum', bound: 'value', default: null, nullable: true, options: OPS },
    { name: 'value', label: 'Value', kind: 'number', bound: 'value', default: null, nullable: true, min: -1, max: 1 },
    {
      name: 'opacity',
      label: 'Opacity',
      kind: 'fraction',
      bound: 'value',
      default: null,
      nullable: true,
      min: 0,
      max: 1,
    },
    { name: 'mirror', label: 'Mirror', kind: 'bool', bound: 'value', default: false, nullable: true },
    jointParam('selection'),
    pointsParam,
    holdsParam,
  ],
  undoLabel: () => 'Flood Skin Weights',
  poll: ({ app }, args) => {
    const targets = targetsPoll(app);
    if (targets !== true) return targets;
    const joint = (isRecord(args) && typeof args['joint'] === 'string' ? args['joint'] : null) ?? activeJoint(app);
    if (joint === null) return fail('Pick an influence first (Paint Weights panel)');
    const holds = isRecord(args) && Array.isArray(args['holds']) ? (args['holds'] as string[]) : undefined;
    const refusal = skinPaintRefusal(app, skinCharacter(app), joint, holds);
    return refusal === null ? OK : fail(refusal);
  },
  async prepare(ctx, args) {
    const brush = ctx.app.session.getState().rig.paint.brush;
    const a = isRecord(args) ? args : {};
    const joint = (typeof a['joint'] === 'string' ? a['joint'] : null) ?? activeJoint(ctx.app);
    if (joint === null) throw new EkzaError('op-refused', 'Pick an influence first (Paint Weights panel)');
    const op = isOp(a['op']) ? a['op'] : brush.op;
    const value = numberOr(a['value'], brush.value);
    const opacity = numberOr(a['opacity'], brush.opacity);
    // One-sided by default (Maya's Flood; §5.11's Flood row has no mirror): the brush's X-mirror stroke setting is
    // not inherited, so the panel's Flood never hands a left joint's points to the right one (M6B-C6-17).
    const mirror = typeof a['mirror'] === 'boolean' ? a['mirror'] : false;
    const points = Array.isArray(a['points']) ? (a['points'] as number[]) : null;
    warnNonDeforming(ctx.app, joint);
    const prepared = await prepareEach(ctx, args, skinTargets(ctx.app), (inputs, weightCtx) => {
      const kernel = meshKernel();
      if (kernel === null) throw new EkzaError('unavailable', 'Mesh tools are loading');
      return kernel.editWeights(
        inputs.skin,
        { kind: 'flood', points: points ?? rangeOf(inputs.skin.points), joint, op, value, opacity, mirror },
        weightCtx,
      );
    });
    return { ...prepared, resolved: { op, value, opacity, mirror, joint } } as Prepared;
  },
  apply: (ctx, _args, prepared) => {
    const out = commit(ctx, prepared);
    const resolved = (prepared as Prepared & { readonly resolved?: Record<string, JsonValue> }).resolved ?? {};
    return recorded(out, { ...resolved, holds: out.holds });
  },
});

const rangeOf = (n: number): number[] => Array.from({ length: n }, (_, i) => i);

/** Records the resolved args of a run for Adjust Last and replay (the runner reads them from the returned value). */
function recorded(out: object, args: Record<string, JsonValue>): void {
  rememberResolvedArgs(out, args);
  return out as unknown as void;
}

// ---------- skin.weights.set ----------

const set = defineOperator<'skin.weights.set', Prepared>({
  id: 'skin.weights.set',
  label: 'Set Weights',
  description: "Sets one joint's weight on points; every point is normalized on its own (M6B-SPEC §5.12).",
  category: 'skin',
  scope: 'rig',
  workspaces: ['rig'],
  flags: { undo: true, adjustable: true },
  params: [
    { name: 'value', label: 'Value', kind: 'fraction', bound: 'value', default: 1, min: -1, max: 1, primary: true },
    {
      name: 'mode',
      label: 'Mode',
      kind: 'enum',
      bound: 'value',
      default: 'set',
      options: [
        { value: 'set', label: 'Set' },
        { value: 'add', label: 'Add' },
        { value: 'mul', label: 'Multiply' },
      ],
    },
    jointParam('value'),
    {
      name: 'mesh',
      label: 'Mesh',
      kind: 'data',
      bound: 'value',
      default: null,
      nullable: true,
      hidden: true,
      schema: { type: 'string' },
    },
    pointsParam,
    holdsParam,
  ],
  undoLabel: () => 'Set Skin Weights',
  poll: ({ app }, args) => {
    if (!isRecord(args) || typeof args['mesh'] !== 'string' || typeof args['joint'] !== 'string') {
      return fail('expects { mesh, joint, value, points }');
    }
    const character = boundCharacter(app, args['mesh']);
    if (character === null) return fail(NO_BOUND);
    const holds = Array.isArray(args['holds']) ? (args['holds'] as string[]) : undefined;
    const refusal = skinPaintRefusal(app, character, args['joint'], holds);
    return refusal === null ? OK : fail(refusal);
  },
  async prepare(ctx, args) {
    warnNonDeforming(ctx.app, args.joint);
    const points = Array.isArray(args.points) ? args.points : selectedPoints(ctx.app, args.mesh);
    const prepared = await prepareEach(ctx, args, [args.mesh], (inputs, weightCtx) => {
      const kernel = meshKernel();
      if (kernel === null) throw new EkzaError('unavailable', 'Mesh tools are loading');
      return kernel.editWeights(
        inputs.skin,
        { kind: 'set', points, joint: args.joint, value: args.value, mode: args.mode ?? 'set' },
        weightCtx,
      );
    });
    return { ...prepared, points } as Prepared;
  },
  apply: (ctx, _args, prepared) => {
    const out = commit(ctx, prepared);
    const points = (prepared as Prepared & { readonly points?: readonly number[] }).points ?? [];
    return recorded(out, { holds: out.holds, points: [...points] });
  },
});

// ---------- utilities: mirror, smooth, prune, normalize, compact ----------

/** The points of a utility run on one mesh: the selection when asked for (or when some are selected), else all. */
function utilityPoints(app: EditorApp, mesh: MeshId, mode: 'selection' | 'selected-or-all'): number[] | null {
  const selected = selectedPoints(app, mesh);
  if (mode === 'selection') return selected;
  return selected.length > 0 ? selected : null;
}

const mirror = defineOperator<'skin.weights.mirror', Prepared>({
  id: 'skin.weights.mirror',
  label: 'Mirror Skin Weights',
  description: 'Copies the weights of one side onto the other across the YZ plane (M6B-SPEC §5.13).',
  category: 'skin',
  scope: 'rig',
  workspaces: ['rig'],
  flags: { undo: true, adjustable: true, repeatable: true },
  params: [
    {
      name: 'direction',
      label: 'Direction',
      kind: 'enum',
      bound: 'value',
      default: 'positive-to-negative',
      options: [
        { value: 'positive-to-negative', label: '+X to −X (left to right)' },
        { value: 'negative-to-positive', label: '−X to +X (right to left)' },
      ],
    },
    {
      name: 'surface',
      label: 'Surface Association',
      kind: 'enum',
      bound: 'value',
      default: 'partners',
      options: [
        { value: 'partners', label: 'Partners' },
        { value: 'closest-point', label: 'Closest point' },
      ],
    },
    { name: 'selection', label: 'Selected Points Only', kind: 'bool', bound: 'value', default: false },
    holdsParam,
  ],
  undoLabel: () => 'Mirror Skin Weights',
  poll: ({ app }) => targetsPoll(app),
  async prepare(ctx, args) {
    const a = isRecord(args) ? args : {};
    const direction = a['direction'] === 'negative-to-positive' ? 'negative-to-positive' : 'positive-to-negative';
    const surface = a['surface'] === 'closest-point' ? 'closest-point' : 'partners';
    const selection = a['selection'] === true;
    return prepareEach(ctx, args, skinTargets(ctx.app), (inputs, weightCtx) => {
      const kernel = meshKernel();
      if (kernel === null) throw new EkzaError('unavailable', 'Mesh tools are loading');
      const points = selection ? utilityPoints(ctx.app, inputs.mesh, 'selection') : null;
      return kernel.mirrorWeights(inputs.skin, { direction, surface, points }, weightCtx);
    });
  },
  apply: (ctx, _args, prepared) => {
    const out = commit(ctx, prepared);
    return recorded(out, { holds: out.holds });
  },
});

const smooth = defineOperator<'skin.weights.smooth', Prepared>({
  id: 'skin.weights.smooth',
  label: 'Smooth Skin Weights',
  description: 'Moves the selected points (else every point) toward the average of their neighbours (M6B-SPEC §5.13).',
  category: 'skin',
  scope: 'rig',
  workspaces: ['rig'],
  flags: { undo: true, adjustable: true, repeatable: true },
  params: [
    { name: 'factor', label: 'Factor', kind: 'fraction', bound: 'value', default: 0.5, min: 0, max: 1, primary: true },
    { name: 'iterations', label: 'Iterations', kind: 'int', bound: 'value', default: 1, min: 1, max: 20 },
    { name: 'expand', label: 'Expand / Contract', kind: 'int', bound: 'value', default: 0, min: -3, max: 3 },
    holdsParam,
  ],
  undoLabel: () => 'Smooth Skin Weights',
  poll: ({ app }) => targetsPoll(app),
  async prepare(ctx, args) {
    const a = isRecord(args) ? args : {};
    return prepareEach(ctx, args, skinTargets(ctx.app), (inputs, weightCtx) => {
      const kernel = meshKernel();
      if (kernel === null) throw new EkzaError('unavailable', 'Mesh tools are loading');
      const points = utilityPoints(ctx.app, inputs.mesh, 'selected-or-all') ?? rangeOf(inputs.skin.points);
      return kernel.editWeights(
        inputs.skin,
        {
          kind: 'smooth',
          points,
          factor: numberOr(a['factor'], 0.5),
          iterations: numberOr(a['iterations'], 1),
          expand: numberOr(a['expand'], 0),
        },
        weightCtx,
      );
    });
  },
  apply: (ctx, _args, prepared) => {
    const out = commit(ctx, prepared);
    return recorded(out, { holds: out.holds });
  },
});

const prune = defineOperator<'skin.weights.prune', Prepared>({
  id: 'skin.weights.prune',
  label: 'Prune Small Weights',
  description: 'Drops weights below a threshold and renormalizes (M6B-SPEC §5.13).',
  category: 'skin',
  scope: 'rig',
  workspaces: ['rig'],
  flags: { undo: true, adjustable: true, repeatable: true },
  params: [
    {
      name: 'below',
      label: 'Prune Below',
      kind: 'fraction',
      bound: 'value',
      default: 0.01,
      min: 0,
      max: 0.2,
      primary: true,
    },
    holdsParam,
  ],
  undoLabel: () => 'Prune Small Weights',
  poll: ({ app }) => targetsPoll(app),
  async prepare(ctx, args) {
    const below = numberOr(isRecord(args) ? args['below'] : undefined, 0.01);
    return prepareEach(ctx, args, skinTargets(ctx.app), (inputs, weightCtx) => {
      const kernel = meshKernel();
      if (kernel === null) throw new EkzaError('unavailable', 'Mesh tools are loading');
      const points = utilityPoints(ctx.app, inputs.mesh, 'selected-or-all');
      return kernel.editWeights(inputs.skin, { kind: 'prune', points, below }, weightCtx);
    });
  },
  apply: (ctx, _args, prepared) => {
    const out = commit(ctx, prepared);
    return recorded(out, { holds: out.holds });
  },
});

const normalize = defineOperator<'skin.weights.normalize', Prepared>({
  id: 'skin.weights.normalize',
  label: 'Normalize Weights',
  description: 'Rescales the free weights of every point to sum to 1 (M6B-SPEC §5.13).',
  category: 'skin',
  scope: 'rig',
  workspaces: ['rig'],
  flags: { undo: true, adjustable: true, repeatable: true },
  params: [
    { name: 'lockActive', label: 'Lock Active Influence', kind: 'bool', bound: 'value', default: false },
    holdsParam,
  ],
  undoLabel: () => 'Normalize Weights',
  poll: ({ app }) => targetsPoll(app),
  async prepare(ctx, args) {
    const lockActive = isRecord(args) && args['lockActive'] === true ? activeJoint(ctx.app) : null;
    return prepareEach(ctx, args, skinTargets(ctx.app), (inputs, weightCtx) => {
      const kernel = meshKernel();
      if (kernel === null) throw new EkzaError('unavailable', 'Mesh tools are loading');
      const points = utilityPoints(ctx.app, inputs.mesh, 'selected-or-all');
      return kernel.editWeights(inputs.skin, { kind: 'normalize', points, lockActive }, weightCtx);
    });
  },
  apply: (ctx, _args, prepared) => {
    const out = commit(ctx, prepared);
    return recorded(out, { holds: out.holds });
  },
});

const compact = defineOperator<'skin.palette.compact', Prepared>({
  id: 'skin.palette.compact',
  label: 'Remove Unused Influences',
  description: 'Drops joints without weight from the palette and writes it in skeleton order (M6B-SPEC §5.13).',
  category: 'skin',
  scope: 'rig',
  workspaces: ['rig'],
  flags: { undo: true, repeatable: true },
  extraArgs: ['meshes'],
  undoLabel: () => 'Remove Unused Influences',
  poll: ({ app }, args) => {
    const meshes = isRecord(args) && Array.isArray(args['meshes']) ? (args['meshes'] as MeshId[]) : skinTargets(app);
    if (meshes.length === 0) return fail(NO_BOUND);
    return meshes.every((mesh) => boundCharacter(app, mesh) !== null) ? OK : fail(NO_BOUND);
  },
  async prepare(ctx, args) {
    const meshes =
      isRecord(args) && Array.isArray(args['meshes']) ? (args['meshes'] as MeshId[]) : skinTargets(ctx.app);
    return prepareEach(ctx, { holds: [] }, meshes, (inputs, weightCtx) => {
      const kernel = meshKernel();
      if (kernel === null) throw new EkzaError('unavailable', 'Mesh tools are loading');
      const out = kernel.editWeights(inputs.skin, { kind: 'compact' }, weightCtx);
      // A palette that only lost entries still needs its write.
      return out.skin.palette.length !== inputs.skin.palette.length && out.changed.length === 0
        ? { skin: out.skin, changed: Uint32Array.of(0) }
        : out;
    });
  },
  apply: (ctx, _args, prepared) => {
    commit(ctx, prepared);
  },
});

export const WEIGHT_OPERATORS: readonly AnyOperator[] = [
  paint,
  flood,
  set,
  rigStub('skin.weights.assign', 'Assign to Joint', { undo: true, repeatable: true, deferred: true }),
  rigStub('skin.weights.rigidIslands', 'Rigid Islands', { undo: true, repeatable: true, deferred: true }),
  mirror,
  rigStub('skin.weights.transfer', 'Copy Skin Weights', { undo: true, adjustable: true, deferred: true }),
  smooth,
  rigStub('skin.weights.hammer', 'Hammer Skin Weights', { undo: true, repeatable: true, deferred: true }),
  rigStub('skin.weights.copyVertex', 'Copy Vertex Weights', { deferred: true }),
  rigStub('skin.weights.pasteVertex', 'Paste Vertex Weights', { undo: true, repeatable: true, deferred: true }),
  prune,
  normalize,
  rigStub('skin.weights.move', 'Move Weights to Influences', {
    undo: true,
    adjustable: true,
    repeatable: true,
    deferred: true,
  }),
  compact,
];
