// Goal posing for `pose.goals` (MCP-SPEC §4.10, P1): aim math (a bone pointed in a character-space direction, solved
// back to its driving FK control through the rig's inverse solver with eulerNear continuity) and IK target placement
// (`ikControlForEndWorld`, the pole kept or placed), plus the IK/FK range switch of `ensureIk: 'auto'`. Everything is
// evaluated from explicit channel buffers of one clip frame: the committed keyed pose, never the user's overrides.
import {
  type Mat4,
  mat4Compose,
  mat4Decompose,
  type Quat,
  quatInvert,
  quatMultiply,
  quatNormalize,
  quatRotateVec3,
  quatShortestArc,
  quatSlerp,
  type Vec3,
} from '@ekza-studio/anim-core';
import type { ChannelValues, ControlId } from '@ekza-studio/doc';
import {
  type ChannelBuffer,
  HUMAN_BONE_PARENT,
  type LimbDesc,
  type LimbId,
  type PoseBuffers,
  type RigProgram,
  readControlChannels,
  solveBoneChannels,
  solveControlChannels,
  writeControlChannels,
} from '@ekza-studio/rig';
import type { CharacterRuntime, EditorApp } from '../types';
import { drivingControl, SPLIT_BONE } from './goalTargets';
import { limbKitOf } from './ik';

function rotationOf(world: Float64Array, node: number): Quat {
  const xf = mat4Decompose(world.subarray(node * 16, node * 16 + 16));
  return quatNormalize(xf.q);
}

function positionOf(world: Float64Array, node: number): Vec3 {
  return [world[node * 16 + 12] as number, world[node * 16 + 13] as number, world[node * 16 + 14] as number];
}

function normalize(v: readonly number[]): Vec3 {
  const length = Math.hypot(v[0] ?? 0, v[1] ?? 0, v[2] ?? 0);
  return length < 1e-12 ? [0, 0, 0] : [(v[0] ?? 0) / length, (v[1] ?? 0) / length, (v[2] ?? 0) / length];
}

function sub(a: readonly number[], b: readonly number[]): Vec3 {
  return [(a[0] ?? 0) - (b[0] ?? 0), (a[1] ?? 0) - (b[1] ?? 0), (a[2] ?? 0) - (b[2] ?? 0)];
}

/** The angle between two directions (radians). */
export function angleBetween(a: readonly number[], b: readonly number[]): number {
  const u = normalize(a);
  const v = normalize(b);
  const dot = u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  return Math.acos(Math.min(1, Math.max(-1, dot)));
}

/** The rest pose of a program (every channel at its default). */
export function restPoseOf(program: RigProgram): PoseBuffers {
  const ch = program.allocChannels();
  program.resetChannels(ch);
  const pose = program.allocPose();
  program.evaluate(ch, pose);
  return pose;
}

/** The nearest present humanoid ancestor of a humanoid bone (null at the hips). */
function presentParent(humanoid: Readonly<Record<string, number | undefined>>, name: string): string | null {
  let parent = (HUMAN_BONE_PARENT as Readonly<Record<string, string | null>>)[name] ?? null;
  while (parent !== null && humanoid[parent] === undefined) {
    parent = (HUMAN_BONE_PARENT as Readonly<Record<string, string | null>>)[parent] ?? null;
  }
  return parent;
}

/**
 * The node a humanoid bone points at: its humanoid child (`leftLowerArm` → `leftHand`, skipping twist and secondary
 * nodes in between), the main-chain or middle-finger child when there are several, else the farthest one; −1 for
 * non-humanoid bones and humanoid leaves.
 */
function humanoidChild(runtime: CharacterRuntime, rest: PoseBuffers, node: number): number {
  const humanoid = (runtime.skeleton.humanoid ?? {}) as Readonly<Record<string, number | undefined>>;
  const name = Object.keys(humanoid).find((key) => humanoid[key] === node);
  if (name === undefined) return -1;
  const children = Object.keys(humanoid).filter((key) => presentParent(humanoid, key) === name);
  if (children.length === 0) return -1;
  const preferred =
    children.length === 1
      ? children[0]
      : (children.find((key) => !key.startsWith('left') && !key.startsWith('right')) ??
        children.find((key) => key.includes('middle')) ??
        [...children].sort(
          (a, b) =>
            Math.hypot(...sub(positionOf(rest.boneWorld, humanoid[b] as number), positionOf(rest.boneWorld, node))) -
            Math.hypot(...sub(positionOf(rest.boneWorld, humanoid[a] as number), positionOf(rest.boneWorld, node))),
        )[0]);
  return preferred === undefined ? -1 : (humanoid[preferred] ?? -1);
}

/**
 * The bone's aim axis in its own frame (from the rest pose): the direction to its humanoid child, else to its first
 * child node; a leaf continues the line from its parent; the humanoid head looks forward (+Z), so a head aim is a
 * look direction.
 */
export function aimAxisLocal(runtime: CharacterRuntime, rest: PoseBuffers, node: number, bone: string): Vec3 {
  const restRot = rotationOf(rest.boneWorld, node);
  const inverse = quatInvert(restRot);
  const humanoid = runtime.skeleton.humanoid ?? {};
  const isHead = Object.hasOwn(humanoid, SPLIT_BONE) && (humanoid as Record<string, number>)[SPLIT_BONE] === node;
  let world: Vec3;
  const human = humanoidChild(runtime, rest, node);
  const child =
    human >= 0 ? runtime.skeleton.nodes[human] : runtime.skeleton.nodes.find((candidate) => candidate.parent === node);
  if (isHead || bone === SPLIT_BONE) world = [0, 0, 1];
  else if (child !== undefined)
    world = normalize(sub(positionOf(rest.boneWorld, child.index), positionOf(rest.boneWorld, node)));
  else {
    const parent = runtime.skeleton.nodes[node]?.parent ?? -1;
    world =
      parent < 0 ? [0, 1, 0] : normalize(sub(positionOf(rest.boneWorld, node), positionOf(rest.boneWorld, parent)));
  }
  return normalize(quatRotateVec3(inverse, world));
}

/** The bone's current aim direction in a pose (character space). */
export function aimDirection(pose: PoseBuffers, node: number, axisLocal: Vec3): Vec3 {
  return normalize(quatRotateVec3(rotationOf(pose.boneWorld, node), axisLocal));
}

/** The node's world matrix in `pose` with its rotation replaced (position and scale kept). */
function withRotation(pose: PoseBuffers, node: number, q: Quat): Mat4 {
  const xf = mat4Decompose(pose.boneWorld.subarray(node * 16, node * 16 + 16));
  return mat4Compose({ t: xf.t, q: quatNormalize(q), s: xf.s });
}

export interface AimRequest {
  readonly node: number;
  readonly bone: string;
  readonly direction: Vec3;
  readonly keepTwist: boolean;
  readonly weight: number;
  readonly split?: { readonly neck: number; readonly head: number };
}

/** The pose state the goal solve works on: a channel buffer of one clip frame and its evaluated pose. */
export interface GoalState {
  readonly program: RigProgram;
  readonly ch: ChannelBuffer;
  readonly pose: PoseBuffers;
  /** Channels solved so far, per control (what the operator keys). */
  readonly solved: Map<ControlId, ChannelValues>;
}

/** Current channels of a control in the state (the eulerNear reference). */
function referenceOf(state: GoalState, control: ControlId): ChannelValues {
  return { ...readControlChannels(state.program, state.ch, control) };
}

/** Keeps the solved channels a control may take (keyable, unlocked); the others keep their values. */
export type ChannelFilter = (control: ControlId, values: ChannelValues) => ChannelValues;

/** Writes solved channels into the state (filtered) and records them for keying. */
function commitSolved(state: GoalState, control: ControlId, values: ChannelValues, filter: ChannelFilter): void {
  const kept = filter(control, values);
  writeControlChannels(state.program, state.ch, control, kept);
  state.solved.set(control, { ...state.solved.get(control), ...kept });
}

/** Solves `node` to the world rotation `q` through its driving control and re-evaluates the state. */
function solveNodeRotation(state: GoalState, node: number, q: Quat, filter: ChannelFilter): void {
  const control = drivingControl(state.program, node);
  if (control === null) return;
  const desired = new Map<number, Mat4>([[node, withRotation(state.pose, node, q)]]);
  const solved = solveBoneChannels(
    state.program,
    state.pose,
    desired,
    new Map([[control, referenceOf(state, control)]]),
  );
  for (const [id, values] of solved) commitSolved(state, id, values, filter);
  state.program.evaluate(state.ch, state.pose);
}

/**
 * One aim (§4.10): the minimal rotation from the bone's current direction to `direction`, without a twist about the
 * bone (`keepTwist`: from the current orientation; otherwise from its rest orientation under the current parent),
 * blended by `weight`; a head aim with `split` turns its parent (the neck) by its share first. `writable` filters a
 * control's solved channels (locked channels stay). Returns the bone and driving control.
 */
export function applyAim(
  state: GoalState,
  rest: PoseBuffers,
  runtime: CharacterRuntime,
  aim: AimRequest,
  filter: ChannelFilter,
): void {
  const axis = aimAxisLocal(runtime, rest, aim.node, aim.bone);
  const target = normalize(aim.direction);
  const goalRotation = (): Quat => {
    const current = rotationOf(state.pose.boneWorld, aim.node);
    if (aim.keepTwist) {
      const from = aimDirection(state.pose, aim.node, axis);
      return quatMultiply(quatShortestArc(from, target), current);
    }
    const parent = runtime.skeleton.nodes[aim.node]?.parent ?? -1;
    const restRelative =
      parent < 0
        ? rotationOf(rest.boneWorld, aim.node)
        : quatMultiply(quatInvert(rotationOf(rest.boneWorld, parent)), rotationOf(rest.boneWorld, aim.node));
    const start = parent < 0 ? restRelative : quatMultiply(rotationOf(state.pose.boneWorld, parent), restRelative);
    return quatMultiply(quatShortestArc(normalize(quatRotateVec3(start, axis)), target), start);
  };
  if (aim.split !== undefined) {
    const parent = runtime.skeleton.nodes[aim.node]?.parent ?? -1;
    const total = aim.split.neck + aim.split.head;
    const share = total > 0 ? aim.split.neck / total : 0;
    if (parent >= 0 && share > 0 && drivingControl(state.program, parent) !== null) {
      const current = rotationOf(state.pose.boneWorld, aim.node);
      const turn = quatMultiply(goalRotation(), quatInvert(current));
      const partial = quatSlerp([0, 0, 0, 1], turn, aim.weight * share);
      const parentRot = rotationOf(state.pose.boneWorld, parent);
      solveNodeRotation(state, parent, quatMultiply(partial, parentRot), filter);
    }
  }
  const current = rotationOf(state.pose.boneWorld, aim.node);
  solveNodeRotation(state, aim.node, quatSlerp(current, goalRotation(), aim.weight), filter);
}

/** The achieved aim direction and its error to the requested direction (radians). */
export function aimResult(
  state: GoalState,
  rest: PoseBuffers,
  runtime: CharacterRuntime,
  aim: AimRequest,
): { readonly achieved: Vec3; readonly errorRad: number } {
  const achieved = aimDirection(state.pose, aim.node, aimAxisLocal(runtime, rest, aim.node, aim.bone));
  return { achieved, errorRad: angleBetween(achieved, aim.direction) };
}

export interface IkRequest {
  readonly limb: LimbId;
  readonly position?: Vec3;
  readonly rotation?: Quat;
  readonly pole?: Vec3;
}

/**
 * Places a limb's IK effector (§4.10): the IK control channels that put the end bone at `position` (kept when absent)
 * with `rotation` (kept when absent), the pole control at `pole` (kept when absent), solved with the limb in IK.
 * Writes the solved channels into the state and returns the end bone's remaining distance to the goal.
 */
export function applyIkGoal(
  app: EditorApp,
  state: GoalState,
  limb: LimbDesc,
  goal: IkRequest,
  filter: ChannelFilter,
): number {
  const { program, ch } = state;
  const slot = limb.attrSlots.ikFk;
  if (slot >= 0) ch.attrs[slot] = 1;
  program.evaluate(ch, state.pose);
  const end = limb.nodes.end;
  const endXf = mat4Decompose(state.pose.boneWorld.subarray(end * 16, end * 16 + 16));
  const targetPosition: Vec3 = goal.position === undefined ? [...endXf.t] : [...goal.position];
  if (goal.pole !== undefined) {
    const pole = limb.params.pole;
    const index = program.controlIndex.get(pole);
    if (index !== undefined) {
      const world = mat4Decompose(state.pose.controlWorld.subarray(index * 16, index * 16 + 16));
      const desired = mat4Compose({ t: [...goal.pole], q: world.q, s: world.s });
      commitSolved(
        state,
        pole,
        solveControlChannels(program, state.pose, pole, desired, referenceOf(state, pole)),
        filter,
      );
      program.evaluate(ch, state.pose);
    }
  }
  const endWorld = mat4Compose({
    t: targetPosition,
    q: goal.rotation === undefined ? endXf.q : quatNormalize([...goal.rotation] as Quat),
    s: endXf.s,
  });
  const ikControl = limb.params.ikControl;
  const solved = limbKitOf(app).ikControlForEndWorld(
    program,
    state.pose,
    ch,
    limb.id,
    endWorld,
    referenceOf(state, ikControl),
  );
  commitSolved(state, ikControl, solved, filter);
  program.evaluate(ch, state.pose);
  // Goal tools report the remaining error and never fail for an imperfect reach (§6.3).
  return Math.hypot(...sub(positionOf(state.pose.boneWorld, end), targetPosition));
}
