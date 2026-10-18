import type { ReadonlyVec3 } from '@ekza-animator/anim-core';
import type { HumanBoneName } from '@ekza-animator/doc';
import { allocXfArrays, type XfArrays, xfaMul, xfaSet } from '../math/xfa';
import type { SkeletonDesc } from '../types';
import { HUMAN_BONE_NAMES } from './bones';

/** `SkeletonDesc.facing` as a transform element (t = 0, s = 1). */
export function facingXf(skeleton: SkeletonDesc): XfArrays {
  const xf = allocXfArrays(1);
  xfaSet(xf, 0, { t: [0, 0, 0], q: skeleton.facing, s: [1, 1, 1] });
  return xf;
}

/**
 * Parent node index per node; a parent that is not an earlier node (the contract requires topological order) is
 * treated as a scene root so that evaluation never reads an unwritten world.
 */
export function nodeParents(skeleton: SkeletonDesc): Int32Array {
  const parents = new Int32Array(skeleton.nodes.length);
  skeleton.nodes.forEach((node, i) => {
    const parent = node.parent;
    parents[i] = Number.isInteger(parent) && parent >= 0 && parent < i ? parent : -1;
  });
  return parents;
}

/** Rest LOCAL transforms per node (rotations normalized). */
export function restLocals(skeleton: SkeletonDesc): XfArrays {
  const xf = allocXfArrays(skeleton.nodes.length);
  skeleton.nodes.forEach((node, i) => xfaSet(xf, i, node.restLocal));
  return xf;
}

/** Rest WORLD transforms per node in canonical character space: W⁰_b = F · Π L⁰ (MVP-SPEC §4.11.9). */
export function restWorlds(skeleton: SkeletonDesc, locals: XfArrays = restLocals(skeleton)): XfArrays {
  const parents = nodeParents(skeleton);
  const facing = facingXf(skeleton);
  const worlds = allocXfArrays(skeleton.nodes.length);
  for (let i = 0; i < skeleton.nodes.length; i++) {
    const parent = parents[i] as number;
    if (parent === -1) xfaMul(facing, 0, locals, i, worlds, i);
    else xfaMul(worlds, parent, locals, i, worlds, i);
  }
  return worlds;
}

/** Canonical (+Z) rest WORLD positions of the humanoid bones (VRMA writer derives parent-relative offsets). */
export function humanoidRestWorldPositions(
  skeleton: SkeletonDesc,
): Readonly<Partial<Record<HumanBoneName, ReadonlyVec3>>> {
  const out: Partial<Record<HumanBoneName, ReadonlyVec3>> = {};
  const map = skeleton.humanoid;
  if (map === null) return out;
  const worlds = restWorlds(skeleton);
  for (const name of HUMAN_BONE_NAMES) {
    const node = map[name];
    if (node === undefined || !Number.isInteger(node) || node < 0 || node >= skeleton.nodes.length) continue;
    out[name] = [worlds.t[node * 3] as number, worlds.t[node * 3 + 1] as number, worlds.t[node * 3 + 2] as number];
  }
  return out;
}

/**
 * vrm0 three-vrm mapping (§4.11.9): conjugates every normalized rotation by the π yaw, `(x, y, z, w) → (−x, y, −z, w)`.
 * `out` may alias `humanLocal`; both hold `HUMAN_BONE_NAMES.length` quaternions.
 */
export function flipYawHumanLocal(humanLocal: Float64Array, out: Float64Array): void {
  const count = Math.min(humanLocal.length, out.length) >> 2;
  for (let h = 0; h < count; h++) {
    const o = h * 4;
    // `0 − x` instead of `−x` so that zero components never become −0.
    out[o] = 0 - (humanLocal[o] as number);
    out[o + 1] = humanLocal[o + 1] as number;
    out[o + 2] = 0 - (humanLocal[o + 2] as number);
    out[o + 3] = humanLocal[o + 3] as number;
  }
}
