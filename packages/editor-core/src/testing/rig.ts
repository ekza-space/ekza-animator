// Naive FK rig program of the shared test kit (MVP-SPEC §7 WP-0b): the evaluation formulas of ARCHITECTURE §5 and
// MVP-SPEC §4.11.9 (control worlds, rotate / translateRotate / full bindings, raw bone locals, normalized humanoid
// rotations) evaluated op by op over a SkeletonDesc. No schedule compilation, no constraint or solver slots.
import {
  type Mat4,
  mat4Compose,
  mat4Decompose,
  mat4Identity,
  mat4Invert,
  mat4Multiply,
  mat4TransformPoint,
  type Quat,
  quatInvert,
  quatMultiply,
  type Vec3,
  type Xf,
  eulerToQuat,
  xfIdentity,
} from '@ekza-animator/anim-core';
import type { BoneRef, ControlId, ControlRecord, HumanBoneName, RigRecord } from '@ekza-animator/doc';
import {
  CHANNELS_PER_CONTROL,
  type ChannelBuffer,
  HUMAN_BONE_NAMES,
  HUMAN_BONE_PARENT,
  type PoseBuffers,
  type RigProgram,
  type RigWarning,
  type SkeletonDesc,
} from '@ekza-animator/rig';

/** Channel slot of a TRS channel (tx ty tz rx ry rz sx sy sz), or -1 for custom attributes. */
export function channelSlot(channel: string): number {
  return TRS_SLOTS[channel] ?? -1;
}
const TRS_SLOTS: Readonly<Record<string, number>> = { tx: 0, ty: 1, tz: 2, rx: 3, ry: 4, rz: 5, sx: 6, sy: 7, sz: 8 };

/** 0, or 1 for scale channels (doc `defaultChannelValue`). */
export function channelDefault(channel: string): number {
  return channel === 'sx' || channel === 'sy' || channel === 'sz' ? 1 : 0;
}

/** Resolves a semantic bone reference to a SkeletonDesc node index (-1 when absent). */
export function resolveBone(skeleton: SkeletonDesc, ref: BoneRef): number {
  if ('humanoid' in ref) return skeleton.humanoid?.[ref.humanoid] ?? -1;
  let seen = 0;
  for (const node of skeleton.nodes) {
    const parentName = node.parent === -1 ? null : (skeleton.nodes[node.parent]?.name ?? null);
    if (node.name !== ref.name || parentName !== ref.parentName) continue;
    if (seen === (ref.occurrence ?? 0)) return node.index;
    seen++;
  }
  return -1;
}

interface Binding {
  readonly control: number;
  readonly mode: 'rotate' | 'translateRotate' | 'full';
  /** K_cb = (W_c⁰)⁻¹ · W_b⁰. */
  readonly bind: Mat4;
  readonly bindQ: Quat;
}

/**
 * Compiles a naive program for `controls` (parents before children, e.g. `store.query.controlsOfRig`). Dangling
 * parents and missing bones are reported as warnings, never thrown.
 */
export function createNaiveRigProgram(
  skeleton: SkeletonDesc,
  rig: RigRecord,
  controls: readonly ControlRecord[],
): RigProgram {
  const warnings: RigWarning[] = [];
  const controlIds = controls.map((control) => control.id);
  const controlIndex = new Map<ControlId, number>(controlIds.map((id, i) => [id, i]));
  const nodeCount = skeleton.nodes.length;
  const facing = mat4Compose({ t: [0, 0, 0], q: skeleton.facing, s: [1, 1, 1] });

  // Rest bone worlds in canonical space: W⁰_b = F · Π L⁰.
  const restLocal = skeleton.nodes.map((node) => mat4Compose(node.restLocal));
  const restWorld: Mat4[] = [];
  for (const node of skeleton.nodes) {
    const parentWorld = node.parent === -1 ? facing : (restWorld[node.parent] as Mat4);
    restWorld.push(mat4Multiply(parentWorld, restLocal[node.index] as Mat4));
  }

  // Control offsets O_c = (W⁰_parent)⁻¹ · W⁰_c; a control whose parent comes later or is missing hangs off the root.
  const controlRest = controls.map((control) => mat4Compose(control.restWorld));
  const parentIndex = controls.map((control, i) => {
    if (control.parent === null) return -1;
    const parent = controlIndex.get(control.parent);
    if (parent === undefined || parent >= i) {
      warnings.push({
        code: 'dangling-ref',
        message: `${control.key}: parent is not an earlier control`,
        ids: [control.id],
      });
      return -1;
    }
    return parent;
  });
  const offsets = controls.map((_, i) => {
    const parent = parentIndex[i] as number;
    const rest = controlRest[i] as Mat4;
    return parent === -1 ? rest : mat4Multiply(invert(controlRest[parent] as Mat4), rest);
  });

  const bindings = new Map<number, Binding>();
  controls.forEach((control, i) => {
    if (control.drives === null) return;
    const node = resolveBone(skeleton, control.drives.bone);
    if (node === -1) {
      warnings.push({ code: 'missing-bone', message: `${control.key}: bone not found`, ids: [control.id] });
      return;
    }
    if (bindings.has(node)) {
      warnings.push({ code: 'duplicate-binding', message: `${control.key}: bone already driven`, ids: [control.id] });
      return;
    }
    const bind = mat4Multiply(invert(controlRest[i] as Mat4), restWorld[node] as Mat4);
    bindings.set(node, { control: i, mode: control.drives.mode, bind, bindQ: mat4Decompose(bind).q });
  });

  // Humanoid bookkeeping for N_b = D_hp(b)⁻¹ · D_b with D_b = q(W_b) · q(W⁰_b)⁻¹.
  const humanNode = HUMAN_BONE_NAMES.map((name) => skeleton.humanoid?.[name] ?? -1);
  const restQInverse = humanNode.map((node) =>
    node === -1 ? null : quatInvert(mat4Decompose(restWorld[node] as Mat4).q),
  );
  const humanParent = HUMAN_BONE_NAMES.map((name) => nearestPresentAncestor(name, skeleton));
  const hipsNode = skeleton.humanoid?.hips ?? -1;

  const xf: Xf = xfIdentity();
  const local = new Float64Array(16);
  const scratch = new Float64Array(16);
  const inverse = new Float64Array(16);
  const position: Vec3 = [0, 0, 0];
  const euler: Vec3 = [0, 0, 0];
  const rotation: Quat = [0, 0, 0, 1];
  const deltas = HUMAN_BONE_NAMES.map((): Quat => [0, 0, 0, 1]);

  const program: RigProgram = {
    rigId: rig.id,
    skeleton,
    controlIds,
    controlIndex,
    controls,
    nodeCount,
    drivenNodes: [...bindings.keys()].sort((a, b) => a - b),
    warnings,
    allocChannels(): ChannelBuffer {
      const ch: ChannelBuffer = {
        values: new Float64Array(controls.length * CHANNELS_PER_CONTROL),
        attrs: new Float64Array(0),
      };
      program.resetChannels(ch);
      return ch;
    },
    allocPose(): PoseBuffers {
      return {
        boneLocal: new Float64Array(nodeCount * 10),
        boneWorld: new Float64Array(nodeCount * 16),
        controlWorld: new Float64Array(controls.length * 16),
        humanLocal: new Float64Array(HUMAN_BONE_NAMES.length * 4),
        hipsPosition: new Float64Array(3),
        version: 0,
      };
    },
    resetChannels(ch: ChannelBuffer): void {
      for (let c = 0; c < controls.length; c++) {
        const o = c * CHANNELS_PER_CONTROL;
        ch.values.fill(0, o, o + 6);
        ch.values.fill(1, o + 6, o + 9);
      }
    },
    evaluate(ch: ChannelBuffer, out: PoseBuffers): void {
      // Control worlds: W_c = W_parent · O_c · T(t) · R(r; order) · S(s).
      controls.forEach((control, c) => {
        const o = c * CHANNELS_PER_CONTROL;
        const v = ch.values;
        xf.t[0] = v[o] as number;
        xf.t[1] = v[o + 1] as number;
        xf.t[2] = v[o + 2] as number;
        euler[0] = v[o + 3] as number;
        euler[1] = v[o + 4] as number;
        euler[2] = v[o + 5] as number;
        eulerToQuat(euler, control.rotateOrder, xf.q);
        xf.s[0] = v[o + 6] as number;
        xf.s[1] = v[o + 7] as number;
        xf.s[2] = v[o + 8] as number;
        mat4Compose(xf, local);
        mat4Multiply(offsets[c] as Mat4, local, scratch);
        const parent = parentIndex[c] as number;
        if (parent !== -1) mat4Multiply(out.controlWorld.subarray(parent * 16, parent * 16 + 16), scratch, scratch);
        out.controlWorld.set(scratch, c * 16);
      });

      for (const node of skeleton.nodes) {
        const i = node.index;
        const parentWorld =
          node.parent === -1 ? facing : out.boneWorld.subarray(node.parent * 16, node.parent * 16 + 16);
        const world = out.boneWorld.subarray(i * 16, i * 16 + 16);
        const binding = bindings.get(i);
        if (binding === undefined) {
          mat4Multiply(parentWorld, restLocal[i] as Mat4, world);
        } else {
          const controlWorld = out.controlWorld.subarray(binding.control * 16, binding.control * 16 + 16);
          if (binding.mode === 'rotate') {
            // q_b = q(W_c) · q(K_cb); the bone keeps its rest local translation and scale under the current parent.
            mat4Decompose(controlWorld, xf);
            quatMultiply(xf.q, binding.bindQ, rotation);
            mat4TransformPoint(parentWorld, node.restLocal.t, position);
            mat4Decompose(parentWorld, xf);
            xf.t[0] = position[0];
            xf.t[1] = position[1];
            xf.t[2] = position[2];
            xf.q[0] = rotation[0];
            xf.q[1] = rotation[1];
            xf.q[2] = rotation[2];
            xf.q[3] = rotation[3];
            xf.s[0] *= node.restLocal.s[0];
            xf.s[1] *= node.restLocal.s[1];
            xf.s[2] *= node.restLocal.s[2];
            mat4Compose(xf, world);
          } else {
            mat4Multiply(controlWorld, binding.bind, world);
          }
        }
        // Raw bone local L_b = W_parentBone⁻¹ · W_b (roots: relative to the facing frame).
        mat4Multiply(invert(parentWorld, inverse), world, scratch);
        mat4Decompose(scratch, xf);
        out.boneLocal.set(xf.t, i * 10);
        out.boneLocal.set(xf.q, i * 10 + 3);
        out.boneLocal.set(xf.s, i * 10 + 7);
      }

      HUMAN_BONE_NAMES.forEach((_, h) => {
        const node = humanNode[h] as number;
        const delta = deltas[h] as Quat;
        if (node === -1) {
          out.humanLocal.set(IDENTITY_Q, h * 4);
          return;
        }
        mat4Decompose(out.boneWorld.subarray(node * 16, node * 16 + 16), xf);
        quatMultiply(xf.q, restQInverse[h] as Quat, delta);
        const parent = humanParent[h] as number;
        if (parent === -1) out.humanLocal.set(delta, h * 4);
        else out.humanLocal.set(quatMultiply(quatInvert(deltas[parent] as Quat, rotation), delta, rotation), h * 4);
      });
      if (hipsNode !== -1) out.hipsPosition.set(out.boneWorld.subarray(hipsNode * 16 + 12, hipsNode * 16 + 15));
      out.version++;
    },
  };
  return program;
}

/** Index into HUMAN_BONE_NAMES of the nearest humanoid ancestor present in the skeleton, or -1. */
function nearestPresentAncestor(name: HumanBoneName, skeleton: SkeletonDesc): number {
  let parent = HUMAN_BONE_PARENT[name];
  while (parent !== null) {
    if (skeleton.humanoid?.[parent] !== undefined) return HUMAN_BONE_NAMES.indexOf(parent);
    parent = HUMAN_BONE_PARENT[parent];
  }
  return -1;
}

const IDENTITY_Q: readonly number[] = [0, 0, 0, 1];

function invert(m: Mat4, out: Mat4 = new Float64Array(16)): Mat4 {
  return mat4Invert(m, out) ?? mat4Identity(out);
}
