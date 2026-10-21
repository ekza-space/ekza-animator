// C2 (kernel) / C3 (UI) (skeleton kernel; M6B-SPEC §6.1, §0.6): the skeleton operators of the MVP — Skeleton Template,
// Add Missing Bones, the rest edits Move / Rotate / Set Rest (§5.7), Orient Joint (§5.5, keys of bone-aligned controls
// converted), Mirror Joint (§5.6.1), Map Humanoid Bone, Rename, Restore Rest Flexion, Symmetry X and Select Joints —
// and the helpers Quick Rig shares (`quickRig.ts`): targets, world geometry (one cached TriangleBvh over the meshes),
// record writes and the control-rig update every skeleton edit runs in its transaction (§5.16). The deferred §6 ids
// keep their C0 stubs ("Arrives after the MVP"). Registered inside the lazy rig-workspace chunk.
//
// Character creation composes C1's `char.fromModel` (§5.1) into the same transaction: its definition's `prepare` runs
// in this operator's `prepare`, its `apply` in this `apply` (one undo step). The control-rig update calls the rig and io
// cores (`skeletonFromDoc`, `updateAutoRig`: C0 baselines until C1 lands them, C1's afterwards).
import {
  EkzaError,
  eulerToQuat,
  mat4Compose,
  type ParamDef,
  type ParamValues,
  quatNormalize,
  type ReadonlyXf,
} from '@ekza-studio/anim-core';
import {
  type CharacterId,
  type CharacterRecord,
  type ClipId,
  type ControlRecord,
  type CurveRecord,
  derivedId,
  type GroupId,
  type HumanBoneName,
  type JointId,
  type JointRecord,
  type MeshId,
  type MeshRecord,
  type ReadView,
  type RecordOf,
  type SkeletonId,
  type SkeletonRecord,
  type Tx,
} from '@ekza-studio/doc';
import { skeletonFromDoc } from '@ekza-studio/io';
import type { MeshData, SkinWeights, TriangleBvh } from '@ekza-studio/mesh-core';
import {
  addMissingBones,
  assembleTemplate,
  convertBoneAlignedRotation,
  DEFAULT_FLEXION,
  flexJoints,
  frontExtent,
  guessMarkers,
  isSkeletonPreset,
  type JointEdit,
  JointIndex,
  mirrorJoints,
  moveJoints,
  type OrientJointArgs,
  orientJoints,
  placeTemplate,
  type RigDefinition,
  readRigDefinition,
  renameJoint,
  setHumanBone,
  setJointRest,
  type SkeletonPreset,
  skeletonTemplate,
  type TemplateJoint,
  type TemplateKey,
  templateJointRecords,
  updateAutoRig,
} from '@ekza-studio/rig';
import { kernelMeshes } from '../../../mesh';
import { worldPlacement } from '../../../mesh/context';
import { loadMeshKernel, type MeshKernel, meshKernel } from '../../../mesh/kernel';
import { runSeed } from '../../../mesh/seed';
import type { ApplyContext, EditorApp, OperatorContext, PollResult, RunContext } from '../../../types';
import { combine } from '../select';
import { type AnyOperator, defineOperator, fail, isRecord, OK } from '../define';
import { rigStub } from './stub';

// ---------------------------------------------------------------------------------------------------------------------
// Messages and the kernel

/** The mesh kernel (loaded by every operator's `prepare` that needs geometry); throws "Mesh tools are loading". */
export function requireKernel(): MeshKernel {
  const kernel = meshKernel();
  if (kernel === null) throw new EkzaError('mesh-loading', 'Mesh tools are loading');
  return kernel;
}

export const ASSET_CHARACTER_REFUSAL = 'Rig edits on imported avatars arrive after the MVP';
export const POSED_REFUSAL = 'Joints are posed for testing — Go to Bind Pose to move them';
const NO_JOINTS = 'Select joints first';

// ---------------------------------------------------------------------------------------------------------------------
// Records

type Upsertable = 'joints' | 'controls' | 'solvers' | 'constraints' | 'rigs' | 'skeletons';

/** Writes a full record: a new id is put; an existing one (restored when soft-deleted) is patched field by field. */
export function upsertRecord<T extends Upsertable>(tx: Tx, table: T, record: RecordOf<T>): void {
  const existing = tx.getIncludingDeleted(table, record.id);
  if (existing === undefined) {
    tx.put(table, record);
    return;
  }
  if (existing.deleted !== null && record.deleted === null) tx.restore(table, record.id);
  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (key === 'id' || key === 'deleted') continue;
    if (JSON.stringify((existing as unknown as Record<string, unknown>)[key]) !== JSON.stringify(value))
      fields[key] = value;
  }
  if (Object.keys(fields).length > 0) tx.patch(table, record.id, fields as never);
}

/** Writes a pure joint edit (upserts, soft deletes). */
export function writeJointEdit(tx: Tx, edit: Pick<JointEdit, 'upserts' | 'deletes'>): void {
  for (const joint of edit.upserts) upsertRecord(tx, 'joints', joint);
  for (const id of edit.deletes) if (tx.get('joints', id) !== undefined) tx.softDelete('joints', id);
}

export interface SkeletonContext {
  readonly skeleton: SkeletonRecord;
  readonly character: CharacterRecord;
  /** Live joints of the skeleton, parents first. */
  readonly joints: readonly JointRecord[];
}

export function skeletonContext(view: ReadView, id: SkeletonId): SkeletonContext | null {
  const skeleton = view.get('skeletons', id);
  if (skeleton === undefined) return null;
  const character = view.get('characters', skeleton.character);
  if (character === undefined) return null;
  return { skeleton, character, joints: view.query.jointsOfSkeleton(id) };
}

/** The skeleton of the joints (all of one skeleton), else the active character's, else null. */
export function skeletonOf(app: EditorApp, view: ReadView, joints: readonly JointId[] | null): SkeletonId | null {
  if (joints !== null && joints.length > 0) {
    const skeletons = new Set(joints.map((id) => view.get('joints', id)?.skeleton));
    const [only] = skeletons;
    return skeletons.size === 1 && only !== undefined ? only : null;
  }
  const character = app.session.getState().rig.character;
  return character === null ? null : (view.query.skeletonOfCharacter(character)?.id ?? null);
}

/** The joints of `args.joints`, else the selected ones (live only). */
export function jointsArg(app: EditorApp, view: ReadView, raw: unknown): JointId[] {
  const given = isRecord(raw) && Array.isArray(raw['joints']) ? (raw['joints'] as unknown[]) : null;
  const ids = given ?? app.session.getState().selection.joints;
  return ids.filter((id): id is JointId => typeof id === 'string' && view.get('joints', id as JointId) !== undefined);
}

// ---------------------------------------------------------------------------------------------------------------------
// The control rig inside every skeleton edit (§5.16)

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Meshes of a character with resident data, as `DocSkeletonInput.meshes` (radii and support for C1's measure). */
function characterMeshes(app: EditorApp, view: ReadView, character: CharacterId) {
  const runtimes = kernelMeshes(app);
  const kernel = meshKernel();
  const out: { id: MeshId; data: MeshData; skin: SkinWeights | null; placement: Float64Array }[] = [];
  if (kernel === null) return out;
  for (const record of view.list('meshes')) {
    if (!('character' in record.owner) || record.owner.character !== character) continue;
    const data = runtimes?.get(record.id)?.data() ?? null;
    if (data === null || record.data?.manifest !== runtimes?.get(record.id)?.ref?.manifest) continue;
    out.push({
      id: record.id,
      data,
      skin: kernel.readSkin(data),
      placement: mat4Compose(worldPlacement(view, record)),
    });
  }
  return out;
}

/**
 * `rig.autoRig.update` inside the caller's transaction: the skeleton from the records (`skeletonFromDoc`), the rig
 * regenerated with the current IK choice (legs IK on, arms off for a new rig), controls of vanished bones soft-deleted
 * (their curves stay). A skeleton without joints leaves the rig alone.
 */
export function updateControlRig(app: EditorApp, tx: Tx, character: CharacterId): RigDefinition | null {
  const record = tx.get('characters', character);
  if (record === undefined) return null;
  const skeleton = tx.query.skeletonOfCharacter(character);
  if (skeleton === undefined) return null;
  const joints = tx.query.jointsOfSkeleton(skeleton.id);
  if (joints.length === 0) return null;
  const desc = skeletonFromDoc({ skeleton, joints, meshes: characterMeshes(app, tx, character) });
  const current = readRigDefinition(tx, record.rig) ?? null;
  const live = current?.controls ?? [];
  const ik =
    live.length > 0
      ? {
          legs: live.some((control) => control.key.startsWith('ik.leg.')),
          arms: live.some((control) => control.key.startsWith('ik.arm.')),
        }
      : { legs: true, arms: false };
  const update = updateAutoRig(live.length > 0 ? current : null, desc, { character, rig: record.rig }, { ik });
  const rig = update.rig;
  const existingRig = tx.get('rigs', record.rig);
  if (existingRig === undefined || !sameJson(existingRig, rig.rig)) upsertRecord(tx, 'rigs', rig.rig);
  for (const control of parentsFirst(rig.controls)) upsertRecord(tx, 'controls', control);
  for (const id of update.softDeleted) if (tx.get('controls', id) !== undefined) tx.softDelete('controls', id);
  for (const solver of rig.solvers) upsertRecord(tx, 'solvers', solver);
  for (const constraint of rig.constraints) upsertRecord(tx, 'constraints', constraint);
  return rig;
}

function parentsFirst(controls: readonly ControlRecord[]): ControlRecord[] {
  const ids = new Set(controls.map((control) => control.id));
  const done = new Set<string>();
  const out: ControlRecord[] = [];
  let pending = [...controls];
  while (pending.length > 0) {
    const ready = pending.filter((c) => c.parent === null || !ids.has(c.parent) || done.has(c.parent));
    const batch = ready.length > 0 ? ready : pending;
    for (const control of batch) {
      out.push(control);
      done.add(control.id);
    }
    pending = pending.filter((control) => !done.has(control.id));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Targets and geometry

/** The meshes under a set of scene objects (groups expand to their live descendant meshes), in a stable order. */
export function meshesOfObjects(view: ReadView, objects: readonly string[]): MeshId[] {
  const out: MeshId[] = [];
  const seen = new Set<string>();
  const all = view.list('meshes');
  const under = (group: string): void => {
    for (const mesh of all) if (mesh.parent === group && !seen.has(mesh.id)) visit(mesh.id);
    for (const child of view.list('groups')) if (child.parent === group) under(child.id);
  };
  const visit = (id: string): void => {
    if (seen.has(id)) return;
    const mesh = view.get('meshes', id as MeshId);
    if (mesh !== undefined) {
      seen.add(id);
      out.push(mesh.id);
      under(id); // meshes may parent meshes
      return;
    }
    if (view.get('groups', id as GroupId) !== undefined) under(id);
  };
  for (const id of objects) visit(id);
  return out;
}

export type RigTarget =
  | { readonly kind: 'scene'; readonly objects: readonly string[]; readonly meshes: readonly MeshId[] }
  | {
      readonly kind: 'character';
      readonly character: CharacterId;
      readonly skeleton: SkeletonId | null;
      readonly meshes: readonly MeshId[];
    };

/** Scene meshes (a new character) or the meshes of one model-sourced character; a string = the refusal. */
export function rigTarget(view: ReadView, objects: readonly string[]): RigTarget | string {
  const meshes = meshesOfObjects(view, objects);
  if (meshes.length === 0) return 'Select the meshes to rig';
  const records = meshes.map((id) => view.get('meshes', id) as MeshRecord);
  if (records.every((record) => 'scene' in record.owner)) return { kind: 'scene', objects, meshes };
  const owners = new Set(records.map((record) => ('character' in record.owner ? record.owner.character : null)));
  const [owner] = owners;
  if (owners.size !== 1 || owner === null || owner === undefined)
    return "Select scene meshes or one character's meshes";
  const character = view.get('characters', owner);
  if (character === undefined) return "Select scene meshes or one character's meshes";
  if (character.source.kind !== 'model') return ASSET_CHARACTER_REFUSAL;
  return {
    kind: 'character',
    character: owner,
    skeleton: view.query.skeletonOfCharacter(owner)?.id ?? null,
    meshes,
  };
}

export interface RigGeometry {
  readonly bvh: TriangleBvh;
  readonly bounds: readonly [readonly [number, number, number], readonly [number, number, number]];
  readonly ground: number;
  readonly height: number;
  /** The meshes in order and the cache key (ids, revisions and world placements). */
  readonly meshes: readonly MeshId[];
  readonly key: string;
}

const geometryCache = new WeakMap<EditorApp, Map<string, RigGeometry>>();

/**
 * World-space triangles of the meshes (each revision through its world placement) in one `TriangleBvh`; cached per
 * app by the ids, revisions and placements, so Quick Rig's preview can fit on every pointer frame. Throws
 * `EkzaError('mesh-loading')` while a mesh's data is not resident.
 */
export function rigGeometry(app: EditorApp, view: ReadView, meshes: readonly MeshId[]): RigGeometry {
  const runtimes = kernelMeshes(app);
  if (runtimes === null) throw new EkzaError('mesh-loading', 'Mesh tools are loading');
  const parts: { record: MeshRecord; data: MeshData; world: ReadonlyXf; tris: Uint32Array }[] = [];
  const keys: string[] = [];
  for (const id of meshes) {
    const record = view.get('meshes', id);
    if (record === undefined) throw new EkzaError('invalid-input', `No mesh ${id}`);
    const runtime = runtimes.get(id);
    const data = runtime?.data() ?? null;
    if (runtime === undefined || data === null) throw new EkzaError('mesh-loading', 'Mesh is loading');
    const world = worldPlacement(view, record);
    keys.push(`${id}@${runtime.ref?.manifest ?? ''}@${JSON.stringify(world)}`);
    parts.push({ record, data, world, tris: runtime.triangulation().tris });
  }
  const key = keys.join('|');
  let cache = geometryCache.get(app);
  if (cache === undefined) {
    cache = new Map();
    geometryCache.set(app, cache);
  }
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  let points = 0;
  let corners = 0;
  for (const part of parts) {
    points += part.data.counts.points;
    corners += part.tris.length;
  }
  const positions = new Float64Array(3 * points);
  const tris = new Uint32Array(corners);
  let p = 0;
  let c = 0;
  for (const part of parts) {
    const m = mat4Compose(part.world);
    const P = part.data.position;
    const base = p / 3;
    for (let i = 0; i < part.data.counts.points; i++) {
      const x = P[3 * i] as number;
      const y = P[3 * i + 1] as number;
      const z = P[3 * i + 2] as number;
      for (let k = 0; k < 3; k++) {
        positions[p + k] =
          (m[k] as number) * x + (m[4 + k] as number) * y + (m[8 + k] as number) * z + (m[12 + k] as number);
      }
      p += 3;
    }
    for (let i = 0; i < part.tris.length; i++) {
      tris[c++] = base + (part.data.cornerVert[part.tris[i] as number] as number);
    }
  }
  const bvh = new (requireKernel().TriangleBvh)(positions, tris);
  const bounds = bvh.bounds();
  const geometry: RigGeometry = {
    bvh,
    bounds,
    ground: bounds[0][1],
    height: bounds[1][1] - bounds[0][1],
    meshes,
    key,
  };
  if (cache.size >= 4) cache.delete(cache.keys().next().value as string);
  cache.set(key, geometry);
  return geometry;
}

// ---------------------------------------------------------------------------------------------------------------------
// Character creation through C1's char.fromModel (§5.1), composed into one transaction

export interface FromModelStep {
  readonly args: { readonly objects: readonly string[]; readonly name: null };
  readonly prepared: unknown;
}

/** `prepare` half: poll and prepare `char.fromModel` for the scene objects; throws its refusal. */
export async function prepareFromModel(ctx: OperatorContext, objects: readonly string[]): Promise<FromModelStep> {
  const def = ctx.app.operators.get('char.fromModel');
  const args = { objects, name: null } as const;
  if (def === undefined) throw new EkzaError('unavailable', 'Character from Selection is not available');
  const run: RunContext = {
    ...(ctx.panel === null ? {} : { panel: ctx.panel }),
    ...(ctx.paneId === null ? {} : { paneId: ctx.paneId }),
  };
  const poll = ctx.app.operators.poll('char.fromModel', run, args);
  if (poll !== true) throw new EkzaError('unavailable', `Character from Selection: ${poll.reason}`);
  const prepared = def.prepare === undefined ? undefined : await def.prepare(ctx, args);
  return { args, prepared };
}

/** `apply` half: the character, its skeleton and rig, the adopted meshes; returns the new ids. */
export function applyFromModel(
  ctx: ApplyContext,
  step: FromModelStep,
): { character: CharacterId; skeleton: SkeletonId } {
  const def = ctx.app.operators.get('char.fromModel');
  if (def === undefined) throw new EkzaError('unavailable', 'Character from Selection is not available');
  const result = def.apply(ctx, step.args, step.prepared);
  if (!isRecord(result) || typeof result['character'] !== 'string' || typeof result['skeleton'] !== 'string') {
    throw new EkzaError('invalid-input', 'char.fromModel returned no character');
  }
  return { character: result['character'] as CharacterId, skeleton: result['skeleton'] as SkeletonId };
}

/** Writes a template skeleton's joints into an (empty) skeleton and marks its preset (§5.2 identities). */
export function writeTemplateSkeleton(
  tx: Tx,
  skeleton: SkeletonId,
  preset: SkeletonPreset,
  template: readonly TemplateJoint[],
): void {
  const record = tx.get('skeletons', skeleton);
  if (record === undefined) throw new EkzaError('invalid-input', `No skeleton ${skeleton}`);
  for (const joint of templateJointRecords(template, skeleton)) upsertRecord(tx, 'joints', joint);
  const fields: Partial<SkeletonRecord> = {};
  if (record.preset !== preset) Object.assign(fields, { preset });
  if (record.template !== 'vrm-humanoid') Object.assign(fields, { template: 'vrm-humanoid', templateVersion: '1.0.0' });
  if (Object.keys(fields).length > 0) tx.patch('skeletons', skeleton, fields);
}

/** After a skeleton is created or refitted: Skeleton mode on the character, Quick Rig closed (§0.2 step 5). */
export function enterSkeletonMode(app: EditorApp, character: CharacterId): void {
  const state = app.session.getState();
  app.session.setState({
    rig: { ...state.rig, character, mode: 'skeleton', quickRig: null },
    selection: { ...state.selection, joints: [] },
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Templates on a model (§5.2 "Fitting at creation")

/** The generator parameters of the first selected humanoid body with a live generator, with its world placement. */
function humanoidBodyOf(view: ReadView, meshes: readonly MeshId[]): { height: number; world: ReadonlyXf } | null {
  for (const id of meshes) {
    const record = view.get('meshes', id);
    const generator = record?.generator;
    if (record === undefined || generator === null || generator === undefined) continue;
    if (generator.kind !== 'humanoidBody') continue;
    const height = generator.params['height'];
    return { height: typeof height === 'number' ? height : 1.6, world: worldPlacement(view, record) };
  }
  return null;
}

/**
 * CR-2 pre-fit: the generator's joint positions (through the source's world placement) replace the table; tails and
 * fingers follow the fit rules (head tail on the mesh top, hand tail 0.55 × the forearm past the wrist, toes tail at
 * the foot's front extent), then the minimum-bend flexion.
 */
export function preFitTemplate(
  preset: SkeletonPreset,
  body: { readonly height: number; readonly world: ReadonlyXf },
  geometry: RigGeometry,
  flexion: number,
): TemplateJoint[] {
  const m = mat4Compose(body.world);
  const at = (v: readonly number[]): [number, number, number] => {
    const out: [number, number, number] = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      out[k] =
        (m[k] as number) * (v[0] as number) +
        (m[4 + k] as number) * (v[1] as number) +
        (m[8 + k] as number) * (v[2] as number) +
        (m[12 + k] as number);
    }
    return out;
  };
  const rig = requireKernel().humanoidBodyRig({ height: body.height });
  const positions = new Map<TemplateKey, readonly [number, number, number]>();
  positions.set('root', [0, geometry.ground, 0]);
  for (const [bone, p] of Object.entries(rig)) positions.set(bone as HumanBoneName, at(p));
  const need = (key: TemplateKey) => positions.get(key) as readonly [number, number, number];
  const head = need('head');
  const wrist = need('rightHand');
  const elbow = need('rightLowerArm');
  const toe = need('rightToes');
  const H = geometry.height;
  const front = frontExtent(geometry.bvh, toe[0], geometry.ground, toe[1] + 0.02 * H);
  const tails = new Map<TemplateKey, readonly [number, number, number]>([
    ['head', [head[0], geometry.bounds[1][1], head[2]]],
    [
      'rightHand',
      [
        wrist[0] + 0.55 * (wrist[0] - elbow[0]),
        wrist[1] + 0.55 * (wrist[1] - elbow[1]),
        wrist[2] + 0.55 * (wrist[2] - elbow[2]),
      ],
    ],
    ['rightToes', front !== null && front > toe[2] ? [toe[0], toe[1], front] : [toe[0], toe[1], toe[2] + 0.04 * H]],
    ['rightFoot', toe],
  ]);
  return assembleTemplate(preset, { positions, tails }, flexion);
}

/** §5.2 fitting (2): the template scaled to the bounds height, centred on the bounds in x and z, on the ground. */
export function boundsTemplate(
  preset: SkeletonPreset,
  proportions: 'standard' | 'bigHead',
  geometry: RigGeometry,
  flexion: number,
): readonly TemplateJoint[] {
  const [lo, hi] = geometry.bounds;
  const template = skeletonTemplate(preset, { height: geometry.height, proportions, flexion });
  return placeTemplate(template, [(lo[0] + hi[0]) / 2, geometry.ground, (lo[2] + hi[2]) / 2]);
}

/** `proportions: 'auto'`: bigHead when the One-Click chin marker lies below 0.72 H (§5.2). */
export function resolveProportions(
  proportions: 'auto' | 'standard' | 'bigHead',
  geometry: RigGeometry,
): 'standard' | 'bigHead' {
  if (proportions !== 'auto') return proportions;
  const guess = guessMarkers(geometry.bvh, geometry.bounds);
  if (guess === null) return 'standard';
  return guess.markers.chin[1] - geometry.ground < 0.72 * geometry.height ? 'bigHead' : 'standard';
}

// ---------------------------------------------------------------------------------------------------------------------
// Params

const DEG = Math.PI / 180;
const data = (name: string, label: string, bound: 'selection' | 'pointer' | 'value' = 'selection'): ParamDef => ({
  name,
  label,
  kind: 'data',
  bound,
  default: null,
  nullable: true,
  hidden: true,
});
const enumParam = (name: string, label: string, values: readonly string[], value: string): ParamDef => ({
  name,
  label,
  kind: 'enum',
  bound: 'value',
  default: value,
  options: values.map((v) => ({ value: v, label: v })),
});
const boolParam = (name: string, label: string, value: boolean | null): ParamDef => ({
  name,
  label,
  kind: 'bool',
  bound: 'value',
  default: value,
  ...(value === null ? { nullable: true } : {}),
});
const distanceParam = (name: string, label: string): ParamDef => ({
  name,
  label,
  kind: 'distance',
  bound: 'value',
  default: 0,
  step: 0.01,
});
const angleParam = (name: string, label: string, degrees: number, extra: Partial<ParamDef> = {}): ParamDef => ({
  name,
  label,
  kind: 'angle',
  bound: 'value',
  default: degrees * DEG,
  step: DEG,
  ...extra,
});

export const PRESET_PARAM = enumParam('preset', 'Template', ['lite17', 'core21', 'standard33', 'full52'], 'standard33');
export const FLEXION_PARAM = angleParam('flexion', 'Rest flexion', 2, { min: 1 * DEG, max: 3 * DEG });

const TEMPLATE_PARAMS: readonly ParamDef[] = [
  { ...PRESET_PARAM, primary: true },
  enumParam('proportions', 'Proportions', ['auto', 'standard', 'bigHead'], 'auto'),
  FLEXION_PARAM,
  data('objects', 'Objects'),
];
const MOVE_PARAMS: readonly ParamDef[] = [
  { ...distanceParam('translateX', 'Translate X'), primary: true },
  distanceParam('translateY', 'Translate Y'),
  distanceParam('translateZ', 'Translate Z'),
  data('joints', 'Joints'),
  data('pivot', 'Pivot'),
  enumParam('mode', 'Mode', ['subtree', 'joint'], 'subtree'),
  boolParam('symmetry', 'Symmetry', null),
];
const ROTATE_PARAMS: readonly ParamDef[] = [
  { ...angleParam('rotateX', 'Rotate X', 0), primary: true },
  angleParam('rotateY', 'Rotate Y', 0),
  angleParam('rotateZ', 'Rotate Z', 0),
  data('joints', 'Joints'),
  data('pivot', 'Pivot'),
  enumParam('mode', 'Mode', ['subtree', 'joint'], 'subtree'),
  boolParam('symmetry', 'Symmetry', null),
];
const AXES6 = ['+x', '-x', '+y', '-y', '+z', '-z'] as const;
const ORIENT_PARAMS: readonly ParamDef[] = [
  { ...enumParam('preset', 'Preset', ['auto', 'world', 'maya', 'blender', 'custom'], 'auto'), primary: true },
  enumParam('mode', 'Orientation', ['world', 'aim'], 'aim'),
  enumParam('primary', 'Primary axis', AXES6, '+x'),
  enumParam('secondary', 'Secondary axis', [...AXES6, 'auto'], '+y'),
  enumParam('secondaryWorld', 'Secondary world', AXES6, '+y'),
  boolParam('children', 'Orient children', true),
  boolParam('symmetry', 'Symmetry', true),
  data('joints', 'Joints'),
];
const MIRROR_PARAMS: readonly ParamDef[] = [
  { ...enumParam('direction', 'Direction', ['auto', 'left-to-right', 'right-to-left'], 'auto'), primary: true },
  enumParam('mode', 'Mirror function', ['auto', 'orientation', 'behavior'], 'auto'),
  { name: 'search', label: 'Search for', kind: 'data', bound: 'value', default: '', hidden: true },
  { name: 'replace', label: 'Replace with', kind: 'data', bound: 'value', default: '', hidden: true },
  boolParam('update', 'Update in place', true),
  data('root', 'Root'),
];
const FLEX_PARAMS: readonly ParamDef[] = [
  { ...angleParam('angle', 'Angle', 2, { min: 0, max: 10 * DEG }), primary: true },
  data('joints', 'Joints'),
];

const str = (raw: unknown, key: string): string | null =>
  isRecord(raw) && typeof raw[key] === 'string' ? raw[key] : null;
const num = (raw: unknown, key: string, fallback: number): number =>
  isRecord(raw) && typeof raw[key] === 'number' && Number.isFinite(raw[key]) ? raw[key] : fallback;
const vec3 = (raw: unknown): [number, number, number] | null =>
  Array.isArray(raw) && raw.length === 3 && raw.every((v) => typeof v === 'number' && Number.isFinite(v))
    ? [raw[0] as number, raw[1] as number, raw[2] as number]
    : null;

/** The pose view refusal of rest edits (§5.7: posed joints never move). */
function restEditPoll(app: EditorApp): PollResult {
  return app.session.getState().rig.poseView === 'bind' ? OK : fail(POSED_REFUSAL);
}

/** The context of a joint operator: its joints, all of one live model skeleton; else the refusal. */
function jointTargets(
  app: EditorApp,
  view: ReadView,
  raw: unknown,
  allowEmpty = false,
): { ids: JointId[]; ctx: SkeletonContext } | string {
  const ids = jointsArg(app, view, raw);
  if (ids.length === 0 && !allowEmpty) return NO_JOINTS;
  const skeleton = skeletonOf(app, view, ids);
  if (skeleton === null) return ids.length === 0 ? 'No skeleton' : 'Select joints of one skeleton';
  const ctx = skeletonContext(view, skeleton);
  if (ctx === null) return 'No skeleton';
  if (ctx.character.source.kind !== 'model') return ASSET_CHARACTER_REFUSAL;
  return { ids, ctx };
}

function bound(view: ReadView, skeleton: SkeletonId): boolean {
  return view.query.meshesBoundTo(skeleton).length > 0;
}

// ---------------------------------------------------------------------------------------------------------------------
// skel.template.create (§5.2)

interface TemplatePrepared {
  readonly target: RigTarget & { readonly kind: 'scene' | 'character' };
  readonly preset: SkeletonPreset;
  readonly template: readonly TemplateJoint[];
  readonly fromModel: FromModelStep | null;
}

function templateTarget(app: EditorApp, view: ReadView, raw: unknown): RigTarget | string {
  const objects =
    isRecord(raw) && Array.isArray(raw['objects'])
      ? (raw['objects'] as unknown[]).filter((id): id is string => typeof id === 'string')
      : app.session.getState().selection.objects;
  const target = rigTarget(view, objects);
  if (typeof target === 'string') return target;
  if (
    target.kind === 'character' &&
    target.skeleton !== null &&
    view.query.jointsOfSkeleton(target.skeleton).length > 0
  ) {
    return 'The character already has a skeleton (Quick Rig refits it)';
  }
  return target;
}

const templateCreate = defineOperator<'skel.template.create', TemplatePrepared>({
  id: 'skel.template.create',
  label: 'Skeleton Template',
  description: 'Creates a VRM humanoid skeleton (and the character) on the selected meshes (M6B-SPEC §5.2).',
  category: 'skel',
  scope: 'rig',
  workspaces: ['rig'],
  flags: { undo: true, adjustable: true },
  params: TEMPLATE_PARAMS,
  poll(ctx, args): PollResult {
    const target = templateTarget(ctx.app, ctx.app.store, args);
    return typeof target === 'string' ? fail(target) : OK;
  },
  async prepare(ctx, args): Promise<TemplatePrepared> {
    await loadMeshKernel();
    const view = ctx.app.store;
    const target = templateTarget(ctx.app, view, args);
    if (typeof target === 'string') throw new EkzaError('op-refused', target);
    const raw = (args ?? {}) as ParamValues;
    const preset: SkeletonPreset = isSkeletonPreset(raw['preset']) ? raw['preset'] : 'standard33';
    const flexion = num(raw, 'flexion', DEFAULT_FLEXION);
    const geometry = rigGeometry(ctx.app, view, target.meshes);
    const body = humanoidBodyOf(view, target.meshes);
    const proportionsArg = str(raw, 'proportions');
    const template =
      body !== null
        ? preFitTemplate(preset, body, geometry, flexion)
        : boundsTemplate(
            preset,
            resolveProportions(
              proportionsArg === 'standard' || proportionsArg === 'bigHead' ? proportionsArg : 'auto',
              geometry,
            ),
            geometry,
            flexion,
          );
    const fromModel = target.kind === 'scene' ? await prepareFromModel(ctx, target.objects) : null;
    return { target, preset, template, fromModel };
  },
  apply(ctx, _args, prepared) {
    const tx = ctx.tx;
    if (tx === null) throw new EkzaError('unsupported', 'skel.template.create needs a transaction');
    let character: CharacterId;
    let skeleton: SkeletonId;
    if (prepared.target.kind === 'scene') {
      ({ character, skeleton } = applyFromModel(ctx, prepared.fromModel as FromModelStep));
    } else {
      character = prepared.target.character;
      const found = tx.query.skeletonOfCharacter(character);
      if (found === undefined) throw new EkzaError('invalid-input', 'The character has no skeleton record');
      skeleton = found.id;
    }
    writeTemplateSkeleton(tx, skeleton, prepared.preset, prepared.template);
    updateControlRig(ctx.app, tx, character);
    enterSkeletonMode(ctx.app, character);
    return { character, skeleton };
  },
});

// ---------------------------------------------------------------------------------------------------------------------
// skel.template.addMissing

const addMissing = defineOperator<'skel.template.addMissing', { readonly ctx: SkeletonContext }>({
  id: 'skel.template.addMissing',
  label: 'Add Missing Bones',
  description: 'Maps or adds the VRM-required bones the skeleton lacks (the skel.required-bones fix).',
  category: 'skel',
  scope: 'rig',
  workspaces: ['rig'],
  flags: { undo: true },
  extraArgs: ['skeleton'],
  poll(ctx, args): PollResult {
    const id = str(args, 'skeleton');
    const sc = id === null ? null : skeletonContext(ctx.app.store, id as SkeletonId);
    if (sc === null) return fail('expects { skeleton }');
    return sc.character.source.kind === 'model' ? OK : fail(ASSET_CHARACTER_REFUSAL);
  },
  prepare(ctx, args) {
    return { ctx: skeletonContext(ctx.app.store, str(args, 'skeleton') as SkeletonId) as SkeletonContext };
  },
  apply(ctx, _args, { ctx: sc }) {
    const tx = ctx.tx as Tx;
    const result = addMissingBones(sc.joints, sc.skeleton);
    writeJointEdit(tx, result);
    updateControlRig(ctx.app, tx, sc.character.id);
    return { added: result.added, mapped: result.mapped };
  },
});

// ---------------------------------------------------------------------------------------------------------------------
// Rest edits (§5.7)

interface JointPrepared {
  readonly ids: readonly JointId[];
  readonly ctx: SkeletonContext;
}

function prepareJoints(ctx: OperatorContext, args: unknown, allowEmpty = false): JointPrepared {
  const target = jointTargets(ctx.app, ctx.app.store, args, allowEmpty);
  if (typeof target === 'string') throw new EkzaError('op-refused', target);
  return target;
}

function symmetryOf(args: unknown, skeleton: SkeletonRecord): boolean {
  return isRecord(args) && typeof args['symmetry'] === 'boolean' ? args['symmetry'] : skeleton.symmetry;
}

/** The pivot of a rest edit: `args.pivot`, else the lead (last) joint's rest position. */
function pivotOf(args: unknown, prepared: JointPrepared): [number, number, number] {
  const given = isRecord(args) ? vec3(args['pivot']) : null;
  if (given !== null) return given;
  const lead = prepared.ctx.joints.find((joint) => joint.id === prepared.ids[prepared.ids.length - 1]);
  return lead === undefined ? [0, 0, 0] : [lead.restPosition[0], lead.restPosition[1], lead.restPosition[2]];
}

function finishJointEdit(
  ctx: ApplyContext,
  prepared: JointPrepared,
  edit: Pick<JointEdit, 'upserts' | 'deletes'>,
): void {
  const tx = ctx.tx as Tx;
  writeJointEdit(tx, edit);
  updateControlRig(ctx.app, tx, prepared.ctx.character.id);
}

const jointMove = defineOperator<'skel.joint.move', JointPrepared>({
  id: 'skel.joint.move',
  label: 'Move',
  description: 'Moves joint rests: with their subtrees (W) or alone (D + W), the partners mirrored (§5.7).',
  category: 'skel',
  scope: 'rig',
  workspaces: ['rig'],
  flags: { undo: true, adjustable: true, internal: true },
  params: MOVE_PARAMS,
  undoLabel: (args) => (isRecord(args) && args['mode'] === 'joint' ? 'Move Joint' : 'Move Joints'),
  poll(ctx, args): PollResult {
    const posed = restEditPoll(ctx.app);
    if (posed !== true) return posed;
    const target = jointTargets(ctx.app, ctx.app.store, args);
    return typeof target === 'string' ? fail(target) : OK;
  },
  prepare: (ctx, args) => prepareJoints(ctx, args),
  apply(ctx, args, prepared) {
    const t: [number, number, number] = [
      num(args, 'translateX', 0),
      num(args, 'translateY', 0),
      num(args, 'translateZ', 0),
    ];
    const mode = isRecord(args) && args['mode'] === 'joint' ? 'joint' : 'subtree';
    const edit = moveJoints(
      prepared.ctx.joints,
      prepared.ids,
      { t, pivot: [0, 0, 0] },
      mode,
      symmetryOf(args, prepared.ctx.skeleton),
    );
    finishJointEdit(ctx, prepared, edit);
  },
});

const jointRotateRest = defineOperator<'skel.joint.rotateRest', JointPrepared>({
  id: 'skel.joint.rotateRest',
  label: 'Rotate',
  description: "Rotates the subtree's rests about the joint (E, unbound) or re-orients the joint alone (D + E) (§5.7).",
  category: 'skel',
  scope: 'rig',
  workspaces: ['rig'],
  flags: { undo: true, adjustable: true, internal: true },
  params: ROTATE_PARAMS,
  undoLabel: (args) => (isRecord(args) && args['mode'] === 'joint' ? 'Orient Joint' : 'Rotate Joints'),
  poll(ctx, args): PollResult {
    const posed = restEditPoll(ctx.app);
    if (posed !== true) return posed;
    const target = jointTargets(ctx.app, ctx.app.store, args);
    if (typeof target === 'string') return fail(target);
    const subtree = !(isRecord(args) && args['mode'] === 'joint');
    if (subtree && bound(ctx.app.store, target.ctx.skeleton.id)) {
      return fail('Bound joints rotate as a test pose (E); D + E re-orients the joint');
    }
    return OK;
  },
  prepare: (ctx, args) => prepareJoints(ctx, args),
  apply(ctx, args, prepared) {
    const euler: [number, number, number] = [num(args, 'rotateX', 0), num(args, 'rotateY', 0), num(args, 'rotateZ', 0)];
    const q = quatNormalize(eulerToQuat(euler, 'xyz'));
    const mode = isRecord(args) && args['mode'] === 'joint' ? 'joint' : 'subtree';
    const edit = moveJoints(
      prepared.ctx.joints,
      prepared.ids,
      { q, pivot: pivotOf(args, prepared) },
      mode,
      symmetryOf(args, prepared.ctx.skeleton),
    );
    if (mode === 'joint')
      convertKeysForReorient(ctx, prepared.ctx, rotationDeltasOf(prepared.ctx.joints, edit.upserts));
    finishJointEdit(ctx, prepared, edit);
  },
});

/** Old → new local rest deltas Δ = q_old⁻¹·q_new of the joints whose rest rotation changed. */
function rotationDeltasOf(
  before: readonly JointRecord[],
  after: readonly JointRecord[],
): Map<JointId, readonly [number, number, number, number]> {
  const out = new Map<JointId, readonly [number, number, number, number]>();
  const old = new Map(before.map((joint) => [joint.id, joint]));
  for (const joint of after) {
    const previous = old.get(joint.id);
    if (previous === undefined || sameJson(previous.restRotation, joint.restRotation)) continue;
    const edit = setJointRest([previous], joint.id, { rotation: joint.restRotation });
    const delta = edit.rotationDeltas.get(joint.id);
    if (delta !== undefined) out.set(joint.id, delta);
  }
  return out;
}

const jointSetRest = defineOperator<'skel.joint.setRest', JointPrepared>({
  id: 'skel.joint.setRest',
  label: 'Set Rest',
  description: "Sets a joint's rest position and/or rotation (Attributes › Joint).",
  category: 'skel',
  scope: 'rig',
  workspaces: ['rig'],
  flags: { undo: true },
  extraArgs: ['joint', 'position', 'rotation'],
  poll(ctx, args): PollResult {
    const posed = restEditPoll(ctx.app);
    if (posed !== true) return posed;
    const joint = str(args, 'joint');
    if (joint === null) return fail('expects { joint, position?, rotation? }');
    const target = jointTargets(ctx.app, ctx.app.store, { joints: [joint] });
    return typeof target === 'string' ? fail(target) : OK;
  },
  prepare: (ctx, args) => prepareJoints(ctx, { joints: [str(args, 'joint')] }),
  apply(ctx, args, prepared) {
    const raw = args as unknown as Record<string, unknown>;
    const position = vec3(raw['position']);
    const rotation =
      Array.isArray(raw['rotation']) &&
      raw['rotation'].length === 4 &&
      raw['rotation'].every((v) => typeof v === 'number')
        ? raw['rotation']
        : null;
    const edit = setJointRest(prepared.ctx.joints, prepared.ids[0] as JointId, { position, rotation });
    convertKeysForReorient(ctx, prepared.ctx, edit.rotationDeltas);
    finishJointEdit(ctx, prepared, edit);
  },
});

// ---------------------------------------------------------------------------------------------------------------------
// Orient Joint (§5.5) and the key conversion of bone-aligned controls

/**
 * §5.5 step 6: rotation keys of **bone-aligned** controls (generic and secondary chains: `drives.bone` by name) that
 * drive a re-oriented joint convert by R(r′) = Δ⁻¹·R(r) with Euler continuity. Keys convert where the three rotation
 * curves of a control are keyed at the same times (the S-key layout); other layouts are reported and left as they are.
 * Humanoid controls are world-aligned and never convert. Returns the number of converted keys.
 */
export function convertKeysForReorient(
  ctx: ApplyContext,
  sc: SkeletonContext,
  deltas: ReadonlyMap<JointId, readonly [number, number, number, number]>,
): number {
  const tx = ctx.tx as Tx;
  if (deltas.size === 0) return 0;
  const byName = new Map(sc.joints.map((joint) => [joint.name, joint.id]));
  const controls = tx.query.controlsOfRig(sc.character.rig).filter((control) => {
    const bone = control.drives?.bone;
    if (bone === undefined || !('name' in bone)) return false;
    const joint = byName.get(bone.name);
    return joint !== undefined && deltas.has(joint);
  });
  let converted = 0;
  const skipped: string[] = [];
  for (const control of controls) {
    const bone = control.drives?.bone as { readonly name: string };
    const delta = deltas.get(byName.get(bone.name) as JointId) as readonly [number, number, number, number];
    const curves = tx.list('curves').filter((curve) => curve.control === control.id);
    const byClip = new Map<ClipId, Map<string, CurveRecord>>();
    for (const curve of curves) {
      if (curve.channel !== 'rx' && curve.channel !== 'ry' && curve.channel !== 'rz') continue;
      const map = byClip.get(curve.clip) ?? new Map<string, CurveRecord>();
      map.set(curve.channel, curve);
      byClip.set(curve.clip, map);
    }
    for (const channels of byClip.values()) {
      const rx = channels.get('rx');
      const ry = channels.get('ry');
      const rz = channels.get('rz');
      if (rx === undefined || ry === undefined || rz === undefined) {
        skipped.push(control.name);
        continue;
      }
      const kx = tx.query.keysOfCurve(rx.id);
      const ky = tx.query.keysOfCurve(ry.id);
      const kz = tx.query.keysOfCurve(rz.id);
      if (
        kx.length !== ky.length ||
        kx.length !== kz.length ||
        kx.some((k, i) => k.t !== ky[i]?.t || k.t !== kz[i]?.t)
      ) {
        skipped.push(control.name);
        continue;
      }
      let reference: [number, number, number] | null = null;
      for (let i = 0; i < kx.length; i++) {
        const a = kx[i] as (typeof kx)[number];
        const b = ky[i] as (typeof ky)[number];
        const c = kz[i] as (typeof kz)[number];
        const r: [number, number, number] = [a.v, b.v, c.v];
        const next = convertBoneAlignedRotation(r, control.rotateOrder, delta, reference ?? r);
        reference = next;
        if (next[0] !== a.v) tx.patch('keys', a.id, { v: next[0] });
        if (next[1] !== b.v) tx.patch('keys', b.id, { v: next[1] });
        if (next[2] !== c.v) tx.patch('keys', c.id, { v: next[2] });
        converted += 3;
      }
    }
  }
  if (skipped.length > 0) {
    ctx.app.services.notify.toast({
      kind: 'warning',
      text: `Rotation keys of ${[...new Set(skipped)].join(', ')} were not converted (their channels are keyed at different times)`,
    });
  }
  return converted;
}

/** `preset: 'auto'` resolves at invoke time: World when every joint has a human bone, else the preference (§5.5). */
function orientArgs(
  app: EditorApp,
  view: ReadView,
  args: unknown,
  ids: readonly JointId[],
): Omit<OrientJointArgs, 'joints'> {
  const raw = isRecord(args) ? args : {};
  let preset = typeof raw['preset'] === 'string' ? raw['preset'] : 'auto';
  if (preset === 'auto') {
    const human = ids.every((id) => (view.get('joints', id)?.humanBone ?? null) !== null);
    preset = human ? 'world' : app.prefs.getState().rigging.orientPreset;
  }
  const axis = (key: string, fallback: OrientJointArgs['primary']): OrientJointArgs['primary'] =>
    (AXES6 as readonly string[]).includes(raw[key] as string) ? (raw[key] as OrientJointArgs['primary']) : fallback;
  const children = raw['children'] !== false;
  const symmetry = raw['symmetry'] !== false;
  switch (preset) {
    case 'world':
      return { mode: 'world', primary: '+x', secondary: '+y', secondaryWorld: '+y', children, symmetry };
    case 'maya':
      return { mode: 'aim', primary: '+x', secondary: '+y', secondaryWorld: '+y', children, symmetry };
    case 'blender':
      return { mode: 'aim', primary: '+y', secondary: '+z', secondaryWorld: '+y', children, symmetry };
    default:
      return {
        mode: raw['mode'] === 'world' ? 'world' : 'aim',
        primary: axis('primary', '+x'),
        secondary: raw['secondary'] === 'auto' ? 'auto' : axis('secondary', '+y'),
        secondaryWorld: axis('secondaryWorld', '+y'),
        children,
        symmetry,
      };
  }
}

const jointOrient = defineOperator<'skel.joint.orient', JointPrepared>({
  id: 'skel.joint.orient',
  label: 'Orient Joint',
  description: 'Sets joint rest orientations: World, or the primary axis down the bone (§5.5).',
  category: 'skel',
  scope: 'rig',
  workspaces: ['rig'],
  flags: { undo: true, adjustable: true, repeatable: true },
  params: ORIENT_PARAMS,
  aliases: ['Recalculate Roll'],
  poll(ctx, args): PollResult {
    const posed = restEditPoll(ctx.app);
    if (posed !== true) return posed;
    const target = jointTargets(ctx.app, ctx.app.store, args);
    if (typeof target === 'string') return fail(target);
    const resolved = orientArgs(ctx.app, ctx.app.store, args, target.ids);
    if (resolved.secondary !== 'auto' && resolved.primary[1] === resolved.secondary[1]) {
      return fail('The secondary axis must differ from the primary axis');
    }
    return OK;
  },
  prepare: (ctx, args) => prepareJoints(ctx, args),
  apply(ctx, args, prepared) {
    const resolved = orientArgs(ctx.app, ctx.app.store, args, prepared.ids);
    const edit = orientJoints(prepared.ctx.joints, { ...resolved, joints: prepared.ids });
    convertKeysForReorient(ctx, prepared.ctx, edit.rotationDeltas);
    finishJointEdit(ctx, prepared, edit);
  },
});

const jointMirror = defineOperator<'skel.joint.mirror', JointPrepared>({
  id: 'skel.joint.mirror',
  label: 'Mirror Joints',
  description: 'Mirrors a joint subtree across the YZ plane, updating counterparts in place (§5.6.1).',
  category: 'skel',
  scope: 'rig',
  workspaces: ['rig'],
  flags: { undo: true, adjustable: true, repeatable: true },
  params: MIRROR_PARAMS,
  aliases: ['Symmetrize Bones'],
  poll(ctx, args): PollResult {
    const posed = restEditPoll(ctx.app);
    if (posed !== true) return posed;
    const root = str(args, 'root');
    const target = jointTargets(ctx.app, ctx.app.store, root === null ? args : { joints: [root] });
    return typeof target === 'string' ? fail(target) : OK;
  },
  prepare(ctx, args) {
    const root = str(args, 'root');
    const prepared = prepareJoints(ctx, root === null ? args : { joints: [root] });
    // The lead (last) selected joint is the root.
    return { ids: [prepared.ids[prepared.ids.length - 1] as JointId], ctx: prepared.ctx };
  },
  apply(ctx, args, prepared) {
    const raw = isRecord(args) ? args : {};
    const seed = runSeed(ctx, 'skel.joint.mirror');
    const skeleton = prepared.ctx.skeleton.id;
    const newId = (n: number): JointId => {
      let id = derivedId('joint', 'skel.joint.mirror', [skeleton], seed, n);
      for (let k = 1; ctx.tx?.getIncludingDeleted('joints', id) !== undefined; k++) {
        id = derivedId('joint', 'skel.joint.mirror', [skeleton], `${seed}:${k}`, n);
      }
      return id;
    };
    const direction =
      raw['direction'] === 'left-to-right' || raw['direction'] === 'right-to-left' ? raw['direction'] : 'auto';
    const mode = raw['mode'] === 'orientation' || raw['mode'] === 'behavior' ? raw['mode'] : 'auto';
    const edit = mirrorJoints(
      prepared.ctx.joints,
      {
        root: prepared.ids[0] as JointId,
        direction,
        mode,
        search: typeof raw['search'] === 'string' ? raw['search'] : '',
        replace: typeof raw['replace'] === 'string' ? raw['replace'] : '',
        update: raw['update'] !== false,
      },
      newId,
    );
    finishJointEdit(ctx, prepared, edit);
    // The mirrored joints: the upserts linked back to a source joint of the subtree.
    const sources = new Set(
      new JointIndex(prepared.ctx.joints).subtree(prepared.ids[0] as JointId).map((joint) => joint.id),
    );
    return { joints: edit.upserts.filter((u) => u.mirror !== null && sources.has(u.mirror)).map((u) => u.id) };
  },
});

// ---------------------------------------------------------------------------------------------------------------------
// Humanoid mapping, rename, flexion, symmetry, joint selection

const jointSetHumanBone = defineOperator<'skel.joint.setHumanBone', JointPrepared>({
  id: 'skel.joint.setHumanBone',
  label: 'Map Humanoid Bone',
  description: 'Maps a joint to a VRM humanoid bone (unique; the VRM parent map is enforced).',
  category: 'skel',
  scope: 'rig',
  workspaces: ['rig'],
  flags: { undo: true },
  extraArgs: ['joint', 'bone'],
  poll(ctx, args): PollResult {
    const joint = str(args, 'joint');
    if (joint === null || !isRecord(args) || (args['bone'] !== null && typeof args['bone'] !== 'string')) {
      return fail('expects { joint, bone }');
    }
    const target = jointTargets(ctx.app, ctx.app.store, { joints: [joint] });
    return typeof target === 'string' ? fail(target) : OK;
  },
  prepare: (ctx, args) => prepareJoints(ctx, { joints: [str(args, 'joint')] }),
  apply(ctx, args, prepared) {
    const bone = isRecord(args) ? args['bone'] : null;
    finishJointEdit(ctx, prepared, setHumanBone(prepared.ctx.joints, prepared.ids[0] as JointId, bone));
  },
});

const jointRename = defineOperator<'skel.joint.rename', JointPrepared>({
  id: 'skel.joint.rename',
  label: 'Rename Joint',
  description: 'Renames a joint (unique per skeleton); the partner takes the mirrored name. Keys never change.',
  category: 'skel',
  scope: 'rig',
  workspaces: ['rig'],
  flags: { undo: true },
  extraArgs: ['joint', 'name', 'mirror'],
  poll(ctx, args): PollResult {
    const joint = str(args, 'joint');
    if (joint === null || str(args, 'name') === null) return fail('expects { joint, name, mirror? }');
    const target = jointTargets(ctx.app, ctx.app.store, { joints: [joint] });
    return typeof target === 'string' ? fail(target) : OK;
  },
  prepare: (ctx, args) => prepareJoints(ctx, { joints: [str(args, 'joint')] }),
  apply(ctx, args, prepared) {
    const mirror = !(isRecord(args) && args['mirror'] === false);
    finishJointEdit(
      ctx,
      prepared,
      renameJoint(prepared.ctx.joints, prepared.ids[0] as JointId, str(args, 'name') ?? '', mirror),
    );
  },
});

const jointFlex = defineOperator<'skel.joint.flex', JointPrepared>({
  id: 'skel.joint.flex',
  label: 'Restore Rest Flexion',
  description: 'Bends elbows and knees by at least the rest flexion on their hinge side (the skel.hinge-bend fix).',
  category: 'skel',
  scope: 'rig',
  workspaces: ['rig'],
  flags: { undo: true, adjustable: true },
  params: FLEX_PARAMS,
  poll(ctx, args): PollResult {
    const posed = restEditPoll(ctx.app);
    if (posed !== true) return posed;
    const target = jointTargets(ctx.app, ctx.app.store, args, true);
    return typeof target === 'string' ? fail(target) : OK;
  },
  prepare: (ctx, args) => prepareJoints(ctx, args, true),
  apply(ctx, args, prepared) {
    const angle = num(args, 'angle', DEFAULT_FLEXION);
    finishJointEdit(
      ctx,
      prepared,
      flexJoints(prepared.ctx.joints, angle, prepared.ids.length === 0 ? null : prepared.ids),
    );
  },
});

const symmetrySet = defineOperator<'skel.symmetry.set', void>({
  id: 'skel.symmetry.set',
  label: 'Symmetry X',
  description: "Sets the skeleton's X symmetry (joint edits move mirror partners).",
  category: 'skel',
  scope: 'rig',
  workspaces: ['rig'],
  flags: { undo: true },
  extraArgs: ['skeleton', 'on'],
  poll(ctx, args): PollResult {
    const id = str(args, 'skeleton');
    if (id === null || !isRecord(args) || typeof args['on'] !== 'boolean') return fail('expects { skeleton, on }');
    return ctx.app.store.get('skeletons', id as SkeletonId) === undefined ? fail('No skeleton') : OK;
  },
  apply(ctx, args) {
    const id = str(args, 'skeleton') as SkeletonId;
    const on = isRecord(args) && args['on'] === true;
    if (ctx.tx?.get('skeletons', id)?.symmetry !== on) ctx.tx?.patch('skeletons', id, { symmetry: on });
  },
});

const SELECT_MODES = ['replace', 'toggle', 'add', 'remove'] as const;

const selectJoints = defineOperator<'select.joints', void>({
  id: 'select.joints',
  label: 'Select Joints',
  description: 'Selects joints (Skeleton mode); all = every joint of the active skeleton.',
  category: 'select',
  scope: 'rig',
  workspaces: ['rig'],
  flags: { selection: true },
  extraArgs: ['ids', 'all', 'mode'],
  poll(_ctx, args): PollResult {
    if (args !== undefined && args !== null && !isRecord(args)) return fail('expects { ids?, all?, mode? }');
    const mode = isRecord(args) ? args['mode'] : undefined;
    if (mode !== undefined && !(SELECT_MODES as readonly unknown[]).includes(mode))
      return fail('mode: replace, toggle, add or remove');
    return OK;
  },
  apply(ctx, args) {
    const app = ctx.app;
    const view = app.store;
    const raw = isRecord(args) ? args : {};
    const mode = (SELECT_MODES as readonly unknown[]).includes(raw['mode'])
      ? (raw['mode'] as (typeof SELECT_MODES)[number])
      : 'replace';
    let ids: JointId[];
    if (raw['all'] === true) {
      const skeleton = skeletonOf(app, view, null);
      ids = skeleton === null ? [] : view.query.jointsOfSkeleton(skeleton).map((joint) => joint.id);
    } else {
      ids = (Array.isArray(raw['ids']) ? (raw['ids'] as unknown[]) : []).filter(
        (id): id is JointId => typeof id === 'string' && view.get('joints', id as JointId) !== undefined,
      );
    }
    const selection = app.session.getState().selection;
    app.session.setState({ selection: { ...selection, joints: combine(selection.joints, ids, mode) } });
  },
});

export const SKELETON_OPERATORS: readonly AnyOperator[] = [
  templateCreate,
  addMissing,
  rigStub('skel.joint.create', 'Create Joints', { undo: true, deferred: true, tool: 'jointTool' }),
  rigStub('skel.joint.duplicate', 'Duplicate Joints', {
    undo: true,
    adjustable: true,
    repeatable: true,
    deferred: true,
  }),
  rigStub('skel.joint.setRole', 'Set Joint Role', { undo: true, deferred: true }),
  rigStub('skel.socket.create', 'Create Socket', { undo: true, adjustable: true, deferred: true }),
  rigStub('skel.joint.insert', 'Insert Joints', { undo: true, adjustable: true, deferred: true, tool: 'insertJoint' }),
  rigStub('skel.bone.split', 'Split Bone', { undo: true, adjustable: true, repeatable: true, deferred: true }),
  rigStub('skel.joint.remove', 'Remove Joints', { undo: true, repeatable: true, deferred: true }),
  rigStub('skel.joint.delete', 'Delete Joint and Children', { undo: true, repeatable: true, deferred: true }),
  rigStub('skel.joint.reparent', 'Parent', { undo: true, deferred: true }),
  rigStub('skel.joint.unparent', 'Unparent', { undo: true, deferred: true }),
  jointRename,
  jointSetHumanBone,
  rigStub('skel.joint.setSide', 'Set Side', { undo: true, deferred: true }),
  jointMove,
  jointRotateRest,
  jointSetRest,
  jointOrient,
  jointMirror,
  jointFlex,
  symmetrySet,
  rigStub('skel.pose.tStance', 'T-Stance', { deferred: true }),
  rigStub('skel.pose.applyAsRest', 'Apply Pose as Rest', { undo: true, deferred: true }),
  selectJoints,
];
