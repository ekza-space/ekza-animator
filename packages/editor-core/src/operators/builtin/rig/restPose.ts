// The rest-pose operators of Rig & Skin (M6B-SPEC §5.7, §5.17; AUTORIG-SPEC §10 A0), the A-pose path:
//
// - `skel.pose.tStance {character?}` (T-Stance): rig's `tStancePose` written as the character's **test pose**
//   (`TestPoseService`, one 'Test Pose' history step, never a key, the view switches to Test). The posed joints are
//   solved into control channels (`solveBoneChannels` on the rest pose); every IK limb the pose bends is switched to FK
//   for the test (`@ikFk` = 0 on its IK control, §5.17).
// - `skel.pose.applyAsRest {character?, pose?: 'test' | 'tStance'}` (Apply Pose as Rest; `pose: 'tStance'` is
//   "Straighten to T-Pose"), undoable, **one step**: `pose: 'test'` (default) takes the current test pose (refused
//   without one), `pose: 'tStance'` computes the T-Stance in `prepare` and applies it directly. `prepare` loads the
//   control-rig libraries (`prepareAutoRig`) and the mesh kernel and computes the pose deltas M_j = W_j(P)·W⁰_j⁻¹;
//   `apply` (one transaction) bakes every bound mesh of the character by LBS (`bakeSkinnedMesh`: weights bit-equal),
//   writes the joints (`applyPoseAsRest`: rest positions posed, template rotations identity, tails moved), clears the
//   test pose and regenerates the control rig in the same transaction (`writeAutoRigUpdate`).
//   Refusals: no model character or skeleton, an asset-sourced character (imported avatars, M6b's rule — which is also
//   where a `modification: prohibited` licence lives), a character mesh that is not bound. With clips, a UI run first
//   asks (the `applyPoseAsRest` dialog: "Clips authored on the old rest shift by the pose delta (n clips). Do this before
//   animating."); the answer re-runs with `confirm: true`. Headless runs never ask.
//   The test pose is session state, not document state: the step's undo puts the test pose the run cleared back and its
//   redo clears it again (a history listener keyed by the step), so undo restores rest, points and test pose together.
import { EkzaError, type Mat4 } from '@ekza-studio/anim-core';
import type {
  ChannelValues,
  CharacterId,
  ControlId,
  JointId,
  JointRecord,
  MeshId,
  MeshRecord,
  SkeletonRecord,
} from '@ekza-studio/doc';
import type { MeshData } from '@ekza-studio/mesh-core';
import {
  applyOverrides,
  applyPoseAsRest,
  limbOfControl,
  poseDeltaOf,
  posedWorldOf,
  type RigProgram,
  restWorldOf,
  solveBoneChannels,
  tStancePose,
} from '@ekza-studio/rig';
import { isBoundTo, modelParts } from '../../../characters/modelInput';
import type { KernelCharacters } from '../../../characters/registry';
import { meshKernel } from '../../../mesh/kernel';
import { applyPoseView } from '../../../rig/chunk/workspace';
import type { EditorApp, OperatorContext, PollResult, RunSource } from '../../../types';
import { type AnyOperator, defineOperator, fail, isRecord, OK, optionalArgs } from '../define';
import { type AutoRigLibs, prepareAutoRig, reportAutoRigUpdate, rigCharacterOf, writeAutoRigUpdate } from './autorig';
import { RIG_ONLY_REASON } from './mode';
import { ASSET_CHARACTER_REFUSAL, writeJointEdit } from './skeleton';

/** The undo label of `pose: 'tStance'` (the Validation Fix and the Skeleton menu item). */
export const STRAIGHTEN_LABEL = 'Straighten to T-Pose';
export const APPLY_POSE_AS_REST_LABEL = 'Apply Pose as Rest';
export const T_STANCE_LABEL = 'T-Stance';
export const NO_TEST_POSE = 'Pose the character first (T-Stance)';
export const BIND_FIRST = 'Bind Skin first: the mesh follows the skeleton only once it is bound';
export const NO_MODEL_CHARACTER = 'Make a character from your model first';
export const NO_SKELETON = 'Create a skeleton first';
/** The confirm of a run on a character with clips (M6B-SPEC §5.7). */
export const clipsShiftText = (clips: number): string =>
  `Clips authored on the old rest shift by the pose delta (${clips} clip${clips === 1 ? '' : 's'}). Do this before animating.`;

/** Sources that ask before shifting clips (headless runs, `api`, never ask). */
const ASKING_SOURCES: ReadonlySet<RunSource> = new Set([
  'keyboard',
  'menu',
  'marking-menu',
  'toolkit',
  'palette',
  'tool',
]);

type PoseKind = 'test' | 'tStance';
type Pose = ReadonlyMap<ControlId, ChannelValues>;

interface Target {
  readonly character: CharacterId;
  readonly skeleton: SkeletonRecord;
  readonly joints: readonly JointRecord[];
  /** The bound meshes and their resident revisions. */
  readonly meshes: readonly { readonly record: MeshRecord; readonly data: MeshData }[];
}

/** The character the rest-pose operators work on, with its skeleton and bound meshes; else the refusal. */
function targetOf(app: EditorApp, raw: unknown): Target | string {
  const args = optionalArgs(raw);
  if (args === null) return 'expects { character?, pose? }';
  const pose = args['pose'];
  if (pose !== undefined && pose !== 'test' && pose !== 'tStance') return "pose is 'test' or 'tStance'";
  const explicit = args['character'];
  const id = rigCharacterOf(app, explicit);
  if (id === null) {
    const any = typeof explicit !== 'string' ? app.store.list('characters')[0] : undefined;
    return any !== undefined && any.source?.kind === 'asset' ? ASSET_CHARACTER_REFUSAL : NO_MODEL_CHARACTER;
  }
  const record = app.store.get('characters', id);
  if (record === undefined) return `Unknown character ${id}`;
  if (record.source?.kind !== 'model') return ASSET_CHARACTER_REFUSAL;
  const parts = modelParts(app, id);
  if (parts === null) return NO_SKELETON;
  if (parts === 'loading') return 'Mesh is loading';
  if (parts.joints.length === 0) return NO_SKELETON;
  const bound = parts.meshes.filter((mesh) => isBoundTo(mesh.record, parts.skeleton.id));
  if (bound.length === 0 || bound.length !== parts.meshes.length) return BIND_FIRST;
  return { character: id, skeleton: parts.skeleton, joints: parts.joints, meshes: bound };
}

const isConfirmed = (raw: unknown): boolean => isRecord(raw) && raw['confirm'] === true;
const poseOf = (raw: unknown): PoseKind => (isRecord(raw) && raw['pose'] === 'tStance' ? 'tStance' : 'test');

/** The current test pose of a character (empty before the rig-workspace services exist). */
const testPoseOf = (app: EditorApp, character: CharacterId): Pose =>
  app.rig.loaded ? app.rig.testPose.values(character) : new Map();

/** Live joint record per node of the character's runtime skeleton (through the stable joint keys). */
function jointsByNode(program: RigProgram, joints: readonly JointRecord[]): (JointRecord | undefined)[] {
  const byKey = new Map(joints.map((joint) => [joint.key, joint]));
  return (program.skeleton.jointKeys ?? []).map((key) => byKey.get(key));
}

/** The bone worlds of `pose` on the character's program (defaults ⊕ the pose; the 'test' channel source). */
function evaluatePose(program: RigProgram, pose: Pose): Float64Array {
  const ch = program.allocChannels();
  program.resetChannels(ch);
  if (pose.size > 0) applyOverrides(program, ch, pose);
  const out = program.allocPose();
  program.evaluate(ch, out);
  return out.boneWorld;
}

/** The pose deltas of the joints a test pose moves (W_j(P)·W⁰_j⁻¹; joints at rest are absent). */
function testPoseDeltas(app: EditorApp, target: Target, pose: Pose): Map<JointId, Mat4> {
  const runtime = app.characters.get(target.character);
  if (runtime === undefined) throw new EkzaError('op-refused', 'The character is still loading');
  const worlds = evaluatePose(runtime.program, pose);
  const deltas = new Map<JointId, Mat4>();
  jointsByNode(runtime.program, target.joints).forEach((joint, node) => {
    if (joint === undefined) return;
    const delta = poseDeltaOf(joint, worlds.subarray(16 * node, 16 * node + 16));
    if (delta !== null) deltas.set(joint.id, delta);
  });
  return deltas;
}

// ---------------------------------------------------------------------------------------------------------------------
// The clips confirm (the `applyPoseAsRest` dialog answers with `confirm: true`)

/** The run that asked, per app: its character and pose (the dialog's re-run takes them). */
const pendingAsks = new WeakMap<EditorApp, { readonly character: CharacterId; readonly pose: PoseKind }>();

/** Clips of a character that the new rest shifts (generated test clips are never exported and do not count). */
export function shiftedClips(app: Pick<EditorApp, 'store'>, character: CharacterId): number {
  return app.store.query.clipsOfCharacter(character).filter((clip) => clip.source.kind !== 'test').length;
}

// ---------------------------------------------------------------------------------------------------------------------
// The test pose a straighten cleared comes back with its undo (and goes again with its redo)

interface Cleared {
  readonly character: CharacterId;
  readonly before: Pose;
  readonly label: string;
}
const watched = new WeakMap<EditorApp, { pending: Cleared | null; readonly steps: Map<number, Cleared> }>();

function watchHistory(app: EditorApp): { pending: Cleared | null; readonly steps: Map<number, Cleared> } {
  const existing = watched.get(app);
  if (existing !== undefined) return existing;
  const state = { pending: null as Cleared | null, steps: new Map<number, Cleared>() };
  watched.set(app, state);
  let undoTop = app.history.peekUndo()?.id ?? null;
  let redoTop = app.history.peekRedo()?.id ?? null;
  app.history.subscribe(() => {
    const undo = app.history.peekUndo();
    const redo = app.history.peekRedo();
    const u = undo?.id ?? null;
    const r = redo?.id ?? null;
    const pending = state.pending;
    if (pending !== null && undo !== null && u !== undoTop && undo.label === pending.label && undo.docTxId !== null) {
      // The run's own step was just recorded.
      state.steps.set(undo.id, pending);
      state.pending = null;
    } else if (r !== null && r === undoTop && r !== redoTop) {
      // Undo of a straighten: its test pose comes back (only inside Rig & Skin, where test poses live).
      const cleared = state.steps.get(r);
      if (cleared !== undefined && cleared.before.size > 0 && app.rig.loaded && inRig(app)) {
        app.rig.testPose.set(cleared.character, cleared.before, { record: false });
      }
    } else if (u !== null && u === redoTop && u !== undoTop) {
      // Redo: the test pose goes again.
      const cleared = state.steps.get(u);
      if (cleared !== undefined && app.rig.loaded) app.rig.testPose.forget(cleared.character);
    }
    undoTop = u;
    redoTop = r;
  });
  return state;
}

/** Resolves once the character runtimes caught up with the document (a just-bound character's program). */
const settled = (app: EditorApp): Promise<void> => (app.characters as KernelCharacters).settled();

const inRig = (app: EditorApp): boolean => app.session.getState().workspace === 'rig';

// ---------------------------------------------------------------------------------------------------------------------
// skel.pose.tStance

const tStance = defineOperator<'skel.pose.tStance', Target>({
  id: 'skel.pose.tStance',
  label: T_STANCE_LABEL,
  description:
    'Poses the arms along ±X and the shins upright as a test pose (never a key; Apply Pose as Rest keeps it).',
  category: 'skel',
  scope: 'rig',
  workspaces: ['rig'],
  extraArgs: ['character'],
  poll({ app }, raw): PollResult {
    if (!inRig(app)) return fail(RIG_ONLY_REASON);
    const target = targetOf(app, raw);
    if (typeof target === 'string') return fail(target);
    return OK;
  },
  async prepare(ctx: OperatorContext, raw) {
    await settled(ctx.app);
    const target = targetOf(ctx.app, raw);
    if (typeof target === 'string') throw new EkzaError('op-refused', target);
    return target;
  },
  apply({ app }, _raw, target) {
    const runtime = app.characters.get(target.character);
    if (runtime === undefined) throw new EkzaError('op-refused', 'The character is still loading');
    const program = runtime.program;
    const { deltas } = tStancePose(target.joints, target.skeleton.id);
    const nodes = jointsByNode(program, target.joints);
    const worlds = new Map<number, Mat4>();
    nodes.forEach((joint, node) => {
      if (joint !== undefined && deltas.has(joint.id)) worlds.set(node, posedWorldOf(joint, deltas));
    });
    const rest = program.allocPose();
    const ch = program.allocChannels();
    program.resetChannels(ch);
    program.evaluate(ch, rest);
    const solved = solveBoneChannels(program, rest, worlds, new Map());
    const pose = new Map<ControlId, ChannelValues>(solved);
    // §5.17: an IK limb bent by the pose is switched to FK for the test.
    for (const control of solved.keys()) {
      const limb = limbOfControl(program, control);
      if (limb === null || !limb.fkControls.includes(control)) continue;
      if ((app.evaluation.ikFk(target.character, limb.id) ?? 0) <= 0) continue;
      const ik = limb.params.ikControl;
      pose.set(ik, { ...pose.get(ik), '@ikFk': 0 });
    }
    app.rig.testPose.set(target.character, pose);
    applyPoseView(app, 'test');
  },
});

// ---------------------------------------------------------------------------------------------------------------------
// skel.pose.applyAsRest

interface ApplyPrepared {
  readonly asked: boolean;
  readonly target: Target | null;
  readonly pose: PoseKind;
  readonly libs: AutoRigLibs | null;
  /** Joint → its pose delta (absent = at rest). */
  readonly deltas: ReadonlyMap<JointId, Mat4>;
  /** The test pose the run clears (restored by its undo). */
  readonly before: Pose;
}

const applyAsRest = defineOperator<'skel.pose.applyAsRest', ApplyPrepared>({
  id: 'skel.pose.applyAsRest',
  label: APPLY_POSE_AS_REST_LABEL,
  description:
    'Makes the posed skeleton the new rest: bound meshes are baked into the pose, weights kept (Straighten to T-Pose ' +
    'applies the T-Stance).',
  category: 'skel',
  scope: 'rig',
  workspaces: ['rig'],
  flags: { undo: true },
  extraArgs: ['character', 'pose', 'confirm'],
  undoLabel: (raw) => (poseOf(raw) === 'tStance' ? STRAIGHTEN_LABEL : APPLY_POSE_AS_REST_LABEL),
  poll({ app }, raw): PollResult {
    const merged = mergedArgs(app, raw);
    const target = targetOf(app, merged);
    if (typeof target === 'string') return fail(target);
    if (poseOf(merged) === 'test' && testPoseOf(app, target.character).size === 0) return fail(NO_TEST_POSE);
    return OK;
  },
  async prepare(ctx, raw): Promise<ApplyPrepared> {
    const { app } = ctx;
    const args = mergedArgs(app, raw);
    const confirmed = isConfirmed(raw);
    const target = targetOf(app, args);
    if (typeof target === 'string') throw new EkzaError('op-refused', target);
    const pose = poseOf(args);
    const empty = { target: null, pose, libs: null, deltas: new Map(), before: new Map() } as const;
    const clips = shiftedClips(app, target.character);
    if (!confirmed && clips > 0 && ctx.source !== undefined && ASKING_SOURCES.has(ctx.source)) {
      pendingAsks.set(app, { character: target.character, pose });
      const state = app.session.getState();
      // The dialog reads the clip count of the Rig & Skin character: it is the one asked about.
      app.session.setState({ rig: { ...state.rig, character: target.character }, dialog: 'applyPoseAsRest' });
      return { asked: true, ...empty };
    }
    const libs = await prepareAutoRig();
    await settled(app);
    // The mesh data may have changed while the libraries loaded: read the target again.
    const fresh = targetOf(app, args);
    if (typeof fresh === 'string') throw new EkzaError('op-refused', fresh);
    const before = testPoseOf(app, fresh.character);
    const deltas =
      pose === 'tStance' ? tStancePose(fresh.joints, fresh.skeleton.id).deltas : testPoseDeltas(app, fresh, before);
    return { asked: false, target: fresh, pose, libs, deltas, before };
  },
  apply(ctx, _raw, prepared) {
    if (prepared.asked) return;
    const { app } = ctx;
    pendingAsks.delete(app);
    const tx = ctx.tx;
    const { target, libs } = prepared;
    if (tx === null || target === null || libs === null) throw new EkzaError('internal', 'skel.pose.applyAsRest');
    const kernel = meshKernel();
    if (kernel === null) throw new EkzaError('mesh-loading', 'Mesh is loading');
    // Bake every bound mesh by the pose (weights untouched).
    const bakedMeshes = new Map<MeshId, MeshData>();
    for (const { record, data } of target.meshes) {
      if (app.meshes.get(record.id)?.data() !== data) {
        throw new EkzaError('op-refused', 'The mesh changed while preparing: run it again');
      }
      const skin = kernel.readSkin(data);
      if (skin === null) throw new EkzaError('op-refused', BIND_FIRST);
      const deltas = skin.palette.map((entry) => prepared.deltas.get(entry.key as JointId) ?? null);
      const baked = kernel.bakeSkinnedMesh(data, skin, deltas);
      if (baked === data) continue;
      app.meshes.writeData(tx, record.id, baked);
      bakedMeshes.set(record.id, baked);
    }
    // The joints: the posed worlds become the rest (§5.7 rule).
    const byId = new Map(target.joints.map((joint) => [joint.id, joint]));
    const edit = applyPoseAsRest(target.joints, (id) => {
      const joint = byId.get(id) as JointRecord;
      return prepared.deltas.has(id) ? posedWorldOf(joint, prepared.deltas) : restWorldOf(joint);
    });
    writeJointEdit(tx, edit);
    const label = prepared.pose === 'tStance' ? STRAIGHTEN_LABEL : APPLY_POSE_AS_REST_LABEL;
    // A confirmed re-run carries only `confirm`: the step takes the asking run's label.
    tx.annotate({ label });
    // Clear the test pose (its undo brings it back, see `watchHistory`); the view returns to Bind.
    if (app.rig.loaded) {
      const history = watchHistory(app);
      history.pending = { character: target.character, before: prepared.before, label };
      app.rig.testPose.forget(target.character);
      if (inRig(app)) applyPoseView(app, 'bind');
    }
    // The control rig follows the new rest in the same transaction (§5.16).
    const update = writeAutoRigUpdate(withRevisions(app, bakedMeshes), tx, target.character, libs);
    reportAutoRigUpdate(app, update);
  },
});

/**
 * `app` with the baked revisions in place of the runtimes' resident data. `writeAutoRigUpdate` measures the control
 * shapes on the character's meshes (`skeletonFromDoc` radii and height) through `app.meshes`, whose runtimes take a
 * revision written in a transaction only once it settles; overlaying the baked data makes the update inside the
 * straighten's transaction equal to a fresh `rig.autoRig.update` after it.
 */
function withRevisions(app: EditorApp, revisions: ReadonlyMap<MeshId, MeshData>): EditorApp {
  if (revisions.size === 0) return app;
  const bind = <T extends object>(target: T, key: PropertyKey): unknown => {
    const value: unknown = Reflect.get(target, key, target);
    return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
  };
  const meshes = new Proxy(app.meshes, {
    get(target, key) {
      if (key !== 'get') return bind(target, key);
      return (id: MeshId) => {
        const runtime = target.get(id);
        const data = revisions.get(id);
        if (runtime === undefined || data === undefined) return runtime;
        return new Proxy(runtime, { get: (rt, k) => (k === 'data' ? () => data : bind(rt, k)) });
      };
    },
  });
  return new Proxy(app, { get: (target, key) => (key === 'meshes' ? meshes : bind(target, key)) });
}

/** The args of a run: a confirmed re-run takes the asking run's character and pose (explicit args win). */
function mergedArgs(app: EditorApp, raw: unknown): unknown {
  const asked = pendingAsks.get(app);
  if (!isRecord(raw) || raw['confirm'] !== true || asked === undefined) return raw;
  return { character: asked.character, pose: asked.pose, ...raw };
}

export const REST_POSE_OPERATORS: readonly AnyOperator[] = [tStance, applyAsRest];
