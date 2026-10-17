import { eulerToQuat, type Quat, type Vec3 } from '@ekza-animator/anim-core';
import type { ControlId, RigId } from '@ekza-animator/doc';
import { HUMAN_BONE_NAMES } from '../humanoid/bones';
import { allocXfArrays, type XfArrays, xfaAlignQuat, xfaFromMat4, xfaInvMul, xfaMul, xfaToMat4 } from '../math/xfa';
import { CHANNELS_PER_CONTROL, type ChannelBuffer, type PoseBuffers, type RigProgram, type RigWarning } from '../types';
import { BIND_FULL, BIND_NONE, BIND_ROTATE, BIND_TRANSLATE_ROTATE, OP_BONE, OP_CONTROL } from './constants';
import { type RigInternals, registerInternals } from './internals';

const HUMAN_COUNT = HUMAN_BONE_NAMES.length;

/**
 * The stateless kernel (ADR 0004 §5–8, ARCHITECTURE §5): `evaluate(channels, out)` runs the compiled schedule over
 * preallocated buffers and allocates nothing.
 *
 * - control:  W_c = W_parent · O_c · T(t) · R(r; order) · S(s)
 * - bone:     undriven W_b = W_parentBone · L⁰_b; rotate q_b = q(W_c) · q(K_cb) with the rest local translation and
 *             scale under the current parent; translateRotate as rotate but positioned at W_c · K_cb; full W_b = W_c · K_cb
 * - outputs:  L_b = W_parentBone⁻¹ · W_b (roots: relative to the facing frame), N_b = D_hp(b)⁻¹ · D_b with
 *             D_b = q(W_b) · q(W⁰_b)⁻¹, and the hips position.
 */
export function createProgram(rigId: RigId, internals: RigInternals, warnings: readonly RigWarning[]): RigProgram {
  const {
    skeleton,
    controlCount,
    nodeCount,
    controls,
    controlParent,
    rotateOrders,
    offsets,
    nodeParent,
    driver,
    bindMode,
    bind,
    restLocal,
    facing,
    humanNode,
    humanParent,
    humanRestInverse,
    hipsNode,
    opKind,
    opIndex,
    customOps,
  } = internals;

  const controlIds = controls.map((control) => control.id);
  const controlIndex = new Map<ControlId, number>(controlIds.map((id, slot) => [id, slot]));
  const drivenNodes: number[] = [];
  for (let node = 0; node < nodeCount; node++) if (driver[node] !== -1) drivenNodes.push(node);

  // Evaluation scratch (the kernel is single-threaded and not re-entrant).
  const controlWorlds: XfArrays = allocXfArrays(controlCount);
  const nodeWorlds: XfArrays = allocXfArrays(nodeCount);
  const local: XfArrays = allocXfArrays(1);
  const scratch: XfArrays = allocXfArrays(1);
  const overridden = new Uint8Array(nodeCount);
  const deltas = new Float64Array(HUMAN_COUNT * 4);
  const euler: Vec3 = [0, 0, 0];
  const rotation: Quat = [0, 0, 0, 1];

  const resetChannels = (ch: ChannelBuffer): void => {
    const values = ch.values;
    const count = Math.min(controlCount, Math.floor(values.length / CHANNELS_PER_CONTROL));
    for (let slot = 0; slot < count; slot++) {
      const o = slot * CHANNELS_PER_CONTROL;
      values[o] = 0;
      values[o + 1] = 0;
      values[o + 2] = 0;
      values[o + 3] = 0;
      values[o + 4] = 0;
      values[o + 5] = 0;
      values[o + 6] = 1;
      values[o + 7] = 1;
      values[o + 8] = 1;
    }
    ch.attrs.fill(0);
  };

  const evaluateControl = (ch: ChannelBuffer, slot: number, out: PoseBuffers): void => {
    const v = ch.values;
    const o = slot * CHANNELS_PER_CONTROL;
    local.t[0] = v[o] as number;
    local.t[1] = v[o + 1] as number;
    local.t[2] = v[o + 2] as number;
    euler[0] = v[o + 3] as number;
    euler[1] = v[o + 4] as number;
    euler[2] = v[o + 5] as number;
    eulerToQuat(euler, rotateOrders[slot] ?? 'xyz', rotation);
    local.q[0] = rotation[0];
    local.q[1] = rotation[1];
    local.q[2] = rotation[2];
    local.q[3] = rotation[3];
    local.s[0] = v[o + 6] as number;
    local.s[1] = v[o + 7] as number;
    local.s[2] = v[o + 8] as number;
    const parent = controlParent[slot] as number;
    if (parent === -1) {
      xfaMul(offsets, slot, local, 0, controlWorlds, slot);
    } else {
      xfaMul(controlWorlds, parent, offsets, slot, scratch, 0);
      xfaMul(scratch, 0, local, 0, controlWorlds, slot);
    }
    xfaToMat4(controlWorlds, slot, out.controlWorld, slot * 16);
  };

  const evaluateBone = (node: number, out: PoseBuffers): void => {
    const parent = nodeParent[node] as number;
    const parentWorlds = parent === -1 ? facing : nodeWorlds;
    const parentIndex = parent === -1 ? 0 : parent;
    const mode = bindMode[node] as number;
    if (mode === BIND_FULL) {
      xfaMul(controlWorlds, driver[node] as number, bind, node, nodeWorlds, node);
    } else {
      xfaMul(parentWorlds, parentIndex, restLocal, node, nodeWorlds, node);
      if (mode !== BIND_NONE) {
        // q_b = q(W_c) · q(K_cb); translateRotate also takes the position of W_c · K_cb.
        xfaMul(controlWorlds, driver[node] as number, bind, node, scratch, 0);
        const q4 = node * 4;
        nodeWorlds.q[q4] = scratch.q[0] as number;
        nodeWorlds.q[q4 + 1] = scratch.q[1] as number;
        nodeWorlds.q[q4 + 2] = scratch.q[2] as number;
        nodeWorlds.q[q4 + 3] = scratch.q[3] as number;
        if (mode === BIND_TRANSLATE_ROTATE) {
          nodeWorlds.t[node * 3] = scratch.t[0] as number;
          nodeWorlds.t[node * 3 + 1] = scratch.t[1] as number;
          nodeWorlds.t[node * 3 + 2] = scratch.t[2] as number;
        }
      }
    }
    xfaToMat4(nodeWorlds, node, out.boneWorld, node * 16);
  };

  const program: RigProgram = {
    rigId,
    skeleton,
    controlIds,
    controlIndex,
    controls,
    nodeCount,
    drivenNodes,
    warnings,
    allocChannels(): ChannelBuffer {
      const ch: ChannelBuffer = {
        values: new Float64Array(controlCount * CHANNELS_PER_CONTROL),
        attrs: new Float64Array(0),
      };
      resetChannels(ch);
      return ch;
    },
    allocPose(): PoseBuffers {
      const pose: PoseBuffers = {
        boneLocal: new Float64Array(nodeCount * 10),
        boneWorld: new Float64Array(nodeCount * 16),
        controlWorld: new Float64Array(controlCount * 16),
        humanLocal: new Float64Array(HUMAN_COUNT * 4),
        hipsPosition: new Float64Array(3),
        version: 0,
      };
      for (let h = 0; h < HUMAN_COUNT; h++) pose.humanLocal[h * 4 + 3] = 1;
      return pose;
    },
    resetChannels,
    evaluate(ch: ChannelBuffer, out: PoseBuffers): void {
      if (customOps.length > 0) overridden.fill(0);
      const steps = opKind.length;
      for (let k = 0; k < steps; k++) {
        const kind = opKind[k] as number;
        const index = opIndex[k] as number;
        if (kind === OP_CONTROL) evaluateControl(ch, index, out);
        else if (kind === OP_BONE) evaluateBone(index, out);
        else {
          const op = customOps[index];
          if (op === undefined) continue;
          op.impl.run(op.record, { pose: out, channels: ch, program });
          // Ops overwrite worlds in the pose buffers; read them back so that downstream steps see them.
          for (const slot of op.writesControls) xfaFromMat4(out.controlWorld, slot * 16, controlWorlds, slot);
          for (const node of op.writesNodes) {
            xfaFromMat4(out.boneWorld, node * 16, nodeWorlds, node);
            overridden[node] = 1;
          }
        }
      }

      // Raw bone locals.
      const boneLocal = out.boneLocal;
      for (let node = 0; node < nodeCount; node++) {
        const mode = bindMode[node] as number;
        const b = node * 10;
        if (overridden[node] === 0 && mode === BIND_NONE) {
          boneLocal[b] = restLocal.t[node * 3] as number;
          boneLocal[b + 1] = restLocal.t[node * 3 + 1] as number;
          boneLocal[b + 2] = restLocal.t[node * 3 + 2] as number;
          boneLocal[b + 3] = restLocal.q[node * 4] as number;
          boneLocal[b + 4] = restLocal.q[node * 4 + 1] as number;
          boneLocal[b + 5] = restLocal.q[node * 4 + 2] as number;
          boneLocal[b + 6] = restLocal.q[node * 4 + 3] as number;
          boneLocal[b + 7] = restLocal.s[node * 3] as number;
          boneLocal[b + 8] = restLocal.s[node * 3 + 1] as number;
          boneLocal[b + 9] = restLocal.s[node * 3 + 2] as number;
          continue;
        }
        const parent = nodeParent[node] as number;
        if (parent === -1) xfaInvMul(facing, 0, nodeWorlds, node, scratch, 0);
        else xfaInvMul(nodeWorlds, parent, nodeWorlds, node, scratch, 0);
        if (overridden[node] === 0 && mode === BIND_ROTATE) {
          // The rotate binding keeps the rest local translation and scale exactly.
          scratch.t[0] = restLocal.t[node * 3] as number;
          scratch.t[1] = restLocal.t[node * 3 + 1] as number;
          scratch.t[2] = restLocal.t[node * 3 + 2] as number;
          scratch.s[0] = restLocal.s[node * 3] as number;
          scratch.s[1] = restLocal.s[node * 3 + 1] as number;
          scratch.s[2] = restLocal.s[node * 3 + 2] as number;
        }
        xfaAlignQuat(scratch, 0, restLocal.q, node);
        boneLocal[b] = scratch.t[0] as number;
        boneLocal[b + 1] = scratch.t[1] as number;
        boneLocal[b + 2] = scratch.t[2] as number;
        boneLocal[b + 3] = scratch.q[0] as number;
        boneLocal[b + 4] = scratch.q[1] as number;
        boneLocal[b + 5] = scratch.q[2] as number;
        boneLocal[b + 6] = scratch.q[3] as number;
        boneLocal[b + 7] = scratch.s[0] as number;
        boneLocal[b + 8] = scratch.s[1] as number;
        boneLocal[b + 9] = scratch.s[2] as number;
      }

      // Normalized humanoid rotations (parents precede children in HUMAN_BONE_NAMES).
      const humanLocal = out.humanLocal;
      for (let h = 0; h < HUMAN_COUNT; h++) {
        const node = humanNode[h] as number;
        const o = h * 4;
        if (node === -1) {
          deltas[o] = 0;
          deltas[o + 1] = 0;
          deltas[o + 2] = 0;
          deltas[o + 3] = 1;
          humanLocal[o] = 0;
          humanLocal[o + 1] = 0;
          humanLocal[o + 2] = 0;
          humanLocal[o + 3] = 1;
          continue;
        }
        // D_b = q(W_b) · q(W⁰_b)⁻¹
        const ax = nodeWorlds.q[node * 4] as number;
        const ay = nodeWorlds.q[node * 4 + 1] as number;
        const az = nodeWorlds.q[node * 4 + 2] as number;
        const aw = nodeWorlds.q[node * 4 + 3] as number;
        const bx = humanRestInverse[o] as number;
        const by = humanRestInverse[o + 1] as number;
        const bz = humanRestInverse[o + 2] as number;
        const bw = humanRestInverse[o + 3] as number;
        const dx = ax * bw + aw * bx + ay * bz - az * by;
        const dy = ay * bw + aw * by + az * bx - ax * bz;
        const dz = az * bw + aw * bz + ax * by - ay * bx;
        const dw = aw * bw - ax * bx - ay * by - az * bz;
        deltas[o] = dx;
        deltas[o + 1] = dy;
        deltas[o + 2] = dz;
        deltas[o + 3] = dw;
        const parent = humanParent[h] as number;
        let nx = dx;
        let ny = dy;
        let nz = dz;
        let nw = dw;
        if (parent !== -1) {
          // N_b = D_hp⁻¹ · D_b
          const p = parent * 4;
          const px = -(deltas[p] as number);
          const py = -(deltas[p + 1] as number);
          const pz = -(deltas[p + 2] as number);
          const pw = deltas[p + 3] as number;
          nx = px * dw + pw * dx + py * dz - pz * dy;
          ny = py * dw + pw * dy + pz * dx - px * dz;
          nz = pz * dw + pw * dz + px * dy - py * dx;
          nw = pw * dw - px * dx - py * dy - pz * dz;
        }
        const sign = nw < 0 ? -1 : 1;
        const inv = sign / Math.sqrt(nx * nx + ny * ny + nz * nz + nw * nw);
        humanLocal[o] = nx * inv;
        humanLocal[o + 1] = ny * inv;
        humanLocal[o + 2] = nz * inv;
        humanLocal[o + 3] = nw * inv;
      }
      if (hipsNode !== -1) {
        out.hipsPosition[0] = nodeWorlds.t[hipsNode * 3] as number;
        out.hipsPosition[1] = nodeWorlds.t[hipsNode * 3 + 1] as number;
        out.hipsPosition[2] = nodeWorlds.t[hipsNode * 3 + 2] as number;
      } else {
        out.hipsPosition[0] = 0;
        out.hipsPosition[1] = 0;
        out.hipsPosition[2] = 0;
      }
      out.version++;
    },
  };
  registerInternals(program, internals);
  return program;
}
