import {
  type Mat4,
  mat4Compose,
  mat4Decompose,
  type Quat,
  quatInvert,
  quatMultiply,
  quatRotateVec3,
  type ReadonlyXf,
  type Vec3,
  type Xf,
  xfInvert,
  xfMultiply,
} from '@ekza-animator/anim-core';
import type { ChannelValues, ControlId, HumanBoneName } from '@ekza-animator/doc';
import { HUMAN_BONE_INDEX } from '../humanoid/map';
import { isHumanoidProgram, solveBoneChannels } from '../inverse/solve';
import { internalsOf, type RigInternals } from '../kernel/internals';
import { xfaGet } from '../math/xfa';
import type { FootPin, PoseBuffers, RigProgram, TwoBoneIkOutput } from '../types';
import { solveTwoBoneIk } from './twoBone';

// Plant Feet for FK legs (MVP-SPEC §4.11.19, ADR 0004 §12): per pinned side, the upper leg / lower leg / foot are
// re-solved with the two-bone IK so the foot bone returns to its pinned world, and the result is converted to the
// FK leg controls' channels.

function worldOf(pose: PoseBuffers, node: number): Xf {
  return mat4Decompose(pose.boneWorld.slice(node * 16, node * 16 + 16));
}

function sub(a: readonly number[], b: readonly number[]): Vec3 {
  return [(a[0] as number) - (b[0] as number), (a[1] as number) - (b[1] as number), (a[2] as number) - (b[2] as number)];
}

function nodeOf(internals: RigInternals, bone: HumanBoneName): number {
  return internals.humanNode[HUMAN_BONE_INDEX.get(bone) as number] as number;
}

/**
 * Channels of the FK leg controls that put each pinned foot back on its pin (§4.11.19): parent world = the upper
 * leg's parent bone, target = pinned foot position, pole = knee + normalize(m)·(l1 + l2) with m the knee offset
 * perpendicular to hip → foot (straight legs: the rest pole side, in front of the knee), hinge = the knee hinge (+X in
 * character space at rest, in the lower leg's frame), end rotation = the pinned foot rotation, soft = 0.
 * Unreachable pins straighten the leg towards them and warn.
 */
export function plantFeetChannels(
  program: RigProgram,
  pose: PoseBuffers,
  pins: readonly FootPin[],
  reference: ReadonlyMap<ControlId, ChannelValues>,
): { readonly values: Map<ControlId, ChannelValues>; readonly reached: boolean; readonly warnings: readonly string[] } {
  const warnings: string[] = [];
  const values = new Map<ControlId, ChannelValues>();
  if (!isHumanoidProgram(program)) {
    return { values, reached: false, warnings: ['Plant Feet needs a humanoid rig'] };
  }
  const internals = internalsOf(program);
  const targets = new Map<number, Mat4>();
  let reached = true;
  const out: TwoBoneIkOutput = { upperLocal: [0, 0, 0, 1], midLocal: [0, 0, 0, 1], endLocal: [0, 0, 0, 1], reached: false };

  for (const pin of pins) {
    const prefix = pin.side === 'L' ? 'left' : 'right';
    const upper = nodeOf(internals, `${prefix}UpperLeg` as HumanBoneName);
    const mid = nodeOf(internals, `${prefix}LowerLeg` as HumanBoneName);
    const end = nodeOf(internals, `${prefix}Foot` as HumanBoneName);
    if (upper === -1 || mid === -1 || end === -1) {
      warnings.push(`Plant Feet: the ${pin.side} leg is incomplete; skipped`);
      reached = false;
      continue;
    }
    if (internals.driver[upper] === -1 || internals.driver[mid] === -1 || internals.driver[end] === -1) {
      warnings.push(`Plant Feet: the ${pin.side} leg has no FK controls; skipped`);
      reached = false;
      continue;
    }
    const parent = internals.nodeParent[upper] as number;
    const parentWorld: Mat4 =
      parent === -1 ? mat4Compose(xfaGet(internals.facing, 0)) : pose.boneWorld.slice(parent * 16, parent * 16 + 16);

    // Rest relations between the three bones (intermediate nodes count as rigid at rest).
    const restUpper = xfaGet(internals.restWorld, upper);
    const restMid = xfaGet(internals.restWorld, mid);
    const restEnd = xfaGet(internals.restWorld, end);
    const upperRest: ReadonlyXf = xfaGet(internals.restLocal, upper);
    const midRest: ReadonlyXf = xfMultiply(xfInvert(restUpper), restMid);
    const endRest: ReadonlyXf = xfMultiply(xfInvert(restMid), restEnd);
    const l1 = Math.hypot(...midRest.t) * Math.abs(restUpper.s[0]);
    const l2 = Math.hypot(...endRest.t) * Math.abs(restMid.s[0]);

    // Knee hinge: +X in character space at rest, expressed in the lower leg's frame.
    const hingeLocal = quatRotateVec3(quatInvert(restMid.q), [1, 0, 0]);

    // Pole from the current bend plane; a straight leg uses the rest pole side (+Z, in front of the knee).
    const hip = worldOf(pose, upper);
    const knee = worldOf(pose, mid);
    const foot = worldOf(pose, end);
    const hipToFoot = sub(foot.t, hip.t);
    const hipToKnee = sub(knee.t, hip.t);
    const along = Math.hypot(...hipToFoot);
    const axis: Vec3 = along > 1e-12 ? [hipToFoot[0] / along, hipToFoot[1] / along, hipToFoot[2] / along] : [0, -1, 0];
    const proj = hipToKnee[0] * axis[0] + hipToKnee[1] * axis[1] + hipToKnee[2] * axis[2];
    let m: Vec3 = [hipToKnee[0] - proj * axis[0], hipToKnee[1] - proj * axis[1], hipToKnee[2] - proj * axis[2]];
    if (Math.hypot(...m) <= 1e-3 * (l1 + l2)) {
      const poleSideLocal = quatRotateVec3(quatInvert(restMid.q), [0, 0, 1]);
      m = quatRotateVec3(knee.q, poleSideLocal);
    }
    const mLength = Math.hypot(...m);
    const reach = l1 + l2;
    const pole: Vec3 = [
      knee.t[0] + (m[0] / mLength) * reach,
      knee.t[1] + (m[1] / mLength) * reach,
      knee.t[2] + (m[2] / mLength) * reach,
    ];

    const pinned = mat4Decompose(pin.footWorld);
    solveTwoBoneIk(
      {
        parentWorld,
        upperRest,
        midRest,
        endRest,
        hingeLocal,
        target: pinned.t,
        pole,
        twist: 0,
        soft: 0,
        endWorldRotation: pinned.q,
      },
      out,
    );
    if (!out.reached) {
      reached = false;
      warnings.push(`Plant Feet: the ${pin.side} foot cannot reach its pin; the leg was straightened towards it`);
    }
    // World rotations of the solved bones (rotate bindings only need rotations).
    const parentQ = mat4Decompose(parentWorld).q;
    const qUpper = quatMultiply(parentQ, out.upperLocal);
    const qMid = quatMultiply(qUpper, out.midLocal);
    const qEnd = quatMultiply(qMid, out.endLocal);
    targets.set(upper, withRotation(hip, qUpper));
    targets.set(mid, withRotation(knee, qMid));
    targets.set(end, withRotation(foot, qEnd));
  }
  if (targets.size > 0) {
    for (const [control, channels] of solveBoneChannels(program, pose, targets, reference)) values.set(control, channels);
  }
  return { values, reached, warnings };
}

function withRotation(xf: Xf, q: Quat): Mat4 {
  return mat4Compose({ t: xf.t, q, s: xf.s });
}
