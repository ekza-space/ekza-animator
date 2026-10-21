import { eulerNear, type Mat4, type Vec3 } from '@ekza-studio/anim-core';
import type { ChannelValues, ControlId, ControlRecord } from '@ekza-studio/doc';
import { hasRequiredHumanoid } from '../autorig/definition';
import { BIND_ROTATE } from '../kernel/constants';
import { internalsOf, type RigInternals } from '../kernel/internals';
import {
  allocXfArrays,
  type XfArrays,
  xfaFromMat4,
  xfaIdentity,
  xfaInvMul,
  xfaMul,
  xfaMulInv,
  xfaToMat4,
} from '../math/xfa';
import { controlSlotOf, SLOT_CHANNELS, writeControlChannels } from '../sampler/channels';
import type { PoseBuffers, RigProgram } from '../types';

// Inverse path (ARCHITECTURE §6): channels from desired worlds, L_c = (W_parent · O_c)⁻¹ · W, rotations through
// eulerNear against the current values so keys never jump by 2π or flip branch.

const scratch: XfArrays = allocXfArrays(4);
const PARENT = 0;
const DESIRED = 1;
const LOCAL = 2;
const TMP = 3;

/** P = W_parent · O_c of `slot` (parents read from `pose`) into scratch element `out`. */
function parentFrame(internals: RigInternals, pose: PoseBuffers, slot: number, out: number): void {
  const parent = internals.controlParent[slot] as number;
  if (parent === -1) {
    xfaIdentity(scratch, TMP);
  } else {
    xfaFromMat4(pose.controlWorld, parent * 16, scratch, TMP);
  }
  xfaMul(scratch, TMP, internals.offsets, slot, scratch, out);
}

/** Keyable t/r channels of `slot` from the local transform in scratch element LOCAL. */
function channelsFromLocal(internals: RigInternals, slot: number, reference: ChannelValues): ChannelValues {
  const values: ChannelValues = {};
  const keyable = internals.keyable;
  const base = slot * 9;
  for (let k = 0; k < 3; k++) {
    if (keyable[base + k] === 1) values[SLOT_CHANNELS[k] as 'tx' | 'ty' | 'tz'] = scratch.t[LOCAL * 3 + k] as number;
  }
  if (keyable[base + 3] === 1 || keyable[base + 4] === 1 || keyable[base + 5] === 1) {
    const ref: Vec3 = [reference.rx ?? 0, reference.ry ?? 0, reference.rz ?? 0];
    const q: [number, number, number, number] = [
      scratch.q[LOCAL * 4] as number,
      scratch.q[LOCAL * 4 + 1] as number,
      scratch.q[LOCAL * 4 + 2] as number,
      scratch.q[LOCAL * 4 + 3] as number,
    ];
    const e = eulerNear(q, internals.rotateOrders[slot] ?? 'xyz', ref);
    if (keyable[base + 3] === 1) values.rx = e[0];
    if (keyable[base + 4] === 1) values.ry = e[1];
    if (keyable[base + 5] === 1) values.rz = e[2];
  }
  return values;
}

/** Channels (keyable t/r only) that place `control` at `desiredWorld` given the parents in `pose`; rotations via eulerNear(reference). */
export function solveControlChannels(
  program: RigProgram,
  pose: PoseBuffers,
  control: ControlId,
  desiredWorld: Mat4,
  reference: ChannelValues,
): ChannelValues {
  const internals = internalsOf(program);
  const slot = controlSlotOf(program, control);
  parentFrame(internals, pose, slot, PARENT);
  xfaFromMat4(desiredWorld, 0, scratch, DESIRED);
  xfaInvMul(scratch, PARENT, scratch, DESIRED, scratch, LOCAL);
  return channelsFromLocal(internals, slot, reference);
}

/** Every control's channels recovered from an evaluated pose (rotations nearest to `reference`, else to zero). */
function channelsFromPose(
  program: RigProgram,
  internals: RigInternals,
  pose: PoseBuffers,
  reference: ReadonlyMap<ControlId, ChannelValues>,
): ReturnType<RigProgram['allocChannels']> {
  const ch = program.allocChannels();
  for (let slot = 0; slot < internals.controlCount; slot++) {
    const control = internals.controls[slot] as ControlRecord;
    parentFrame(internals, pose, slot, PARENT);
    xfaFromMat4(pose.controlWorld, slot * 16, scratch, DESIRED);
    xfaInvMul(scratch, PARENT, scratch, DESIRED, scratch, LOCAL);
    const ref = reference.get(control.id) ?? {};
    const e = eulerNear(
      [
        scratch.q[LOCAL * 4] as number,
        scratch.q[LOCAL * 4 + 1] as number,
        scratch.q[LOCAL * 4 + 2] as number,
        scratch.q[LOCAL * 4 + 3] as number,
      ],
      internals.rotateOrders[slot] ?? 'xyz',
      [ref.rx ?? 0, ref.ry ?? 0, ref.rz ?? 0],
    );
    const o = slot * 9;
    ch.values[o] = scratch.t[LOCAL * 3] as number;
    ch.values[o + 1] = scratch.t[LOCAL * 3 + 1] as number;
    ch.values[o + 2] = scratch.t[LOCAL * 3 + 2] as number;
    ch.values[o + 3] = e[0];
    ch.values[o + 4] = e[1];
    ch.values[o + 5] = e[2];
    ch.values[o + 6] = scratch.s[LOCAL * 3] as number;
    ch.values[o + 7] = scratch.s[LOCAL * 3 + 1] as number;
    ch.values[o + 8] = scratch.s[LOCAL * 3 + 2] as number;
  }
  return ch;
}

/**
 * Top-down solve for desired bone worlds (node index → canonical world): each target's driving control is solved
 * in schedule order and the rig is re-evaluated before the next control, so children see their solved parents.
 * Rotate-bound bones use only the desired rotation (their position follows the parent bone). Nodes that no control
 * drives are ignored. Returns the keyable t/r channels of every solved control.
 */
export function solveBoneChannels(
  program: RigProgram,
  pose: PoseBuffers,
  boneWorlds: ReadonlyMap<number, Mat4>,
  reference: ReadonlyMap<ControlId, ChannelValues>,
): Map<ControlId, ChannelValues> {
  const internals = internalsOf(program);
  const targets = [...boneWorlds.keys()]
    .filter(
      (node) => Number.isInteger(node) && node >= 0 && node < internals.nodeCount && internals.driver[node] !== -1,
    )
    .sort((a, b) => (internals.driver[a] as number) - (internals.driver[b] as number));
  const result = new Map<ControlId, ChannelValues>();
  if (targets.length === 0) return result;
  const ch = channelsFromPose(program, internals, pose, reference);
  const work = program.allocPose();
  let current = pose;
  let dirty = false;
  const desired = new Float64Array(16);
  for (const node of targets) {
    if (dirty) {
      program.evaluate(ch, work);
      current = work;
      dirty = false;
    }
    const slot = internals.driver[node] as number;
    const control = internals.controls[slot] as ControlRecord;
    // Desired control world: W_c = W_b · K_cb⁻¹; for rotate bindings only the rotation is prescribed.
    xfaFromMat4(boneWorlds.get(node) as Mat4, 0, scratch, DESIRED);
    xfaMulInv(scratch, DESIRED, internals.bind, node, scratch, LOCAL);
    if (internals.bindMode[node] === BIND_ROTATE) {
      xfaFromMat4(current.controlWorld, slot * 16, scratch, TMP);
      scratch.t.copyWithin(LOCAL * 3, TMP * 3, TMP * 3 + 3);
      scratch.s.copyWithin(LOCAL * 3, TMP * 3, TMP * 3 + 3);
    }
    xfaToMat4(scratch, LOCAL, desired, 0);
    const ref = reference.get(control.id) ?? {
      rx: ch.values[slot * 9 + 3] as number,
      ry: ch.values[slot * 9 + 4] as number,
      rz: ch.values[slot * 9 + 5] as number,
    };
    const values = solveControlChannels(program, current, control.id, desired, ref);
    writeControlChannels(program, ch, control.id, values);
    result.set(control.id, values);
    dirty = true;
  }
  return result;
}

/** Nearest driving control up the hierarchy (the node's own driver first), null when none. */
export function controlForNode(program: RigProgram, node: number): ControlId | null {
  const internals = internalsOf(program);
  let current = Number.isInteger(node) && node >= 0 && node < internals.nodeCount ? node : -1;
  while (current !== -1) {
    const slot = internals.driver[current] as number;
    if (slot !== -1) return (internals.controls[slot] as ControlRecord).id;
    current = internals.nodeParent[current] as number;
  }
  return null;
}

/** The node `control` drives, −1 if it drives none (or is not part of the program). */
export function nodeForControl(program: RigProgram, control: ControlId): number {
  const slot = program.controlIndex.get(control);
  if (slot === undefined) return -1;
  return internalsOf(program).drivenNode[slot] as number;
}

/** True for programs whose skeleton maps the VRM-required bones and whose controls drive the humanoid hips. */
export function isHumanoidProgram(program: RigProgram): boolean {
  if (!hasRequiredHumanoid(program.skeleton)) return false;
  const internals = internalsOf(program);
  const hips = internals.hipsNode;
  if (hips === -1) return false;
  const slot = internals.driver[hips] as number;
  if (slot === -1) return false;
  const bone = internals.controls[slot]?.drives?.bone;
  return bone !== undefined && 'humanoid' in bone && bone.humanoid === 'hips';
}
