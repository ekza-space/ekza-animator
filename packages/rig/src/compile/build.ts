import type { RotateOrder } from '@ekza-animator/anim-core';
import type { ControlId, ControlRecord } from '@ekza-animator/doc';
import { HUMAN_BONE_NAMES } from '../humanoid/bones';
import { humanNodeIndices, nearestHumanAncestor } from '../humanoid/map';
import { facingXf, nodeParents, restLocals, restWorlds } from '../humanoid/rest';
import { allocXfArrays, xfaInvMul, xfaSet } from '../math/xfa';
import { BIND_FULL, BIND_ROTATE, BIND_TRANSLATE_ROTATE, OP_BONE, OP_CONTROL } from '../kernel/constants';
import type { RigInternals, ScheduledRigOp } from '../kernel/internals';
import { CHANNELS_PER_CONTROL, type RigProgram, type RigWarning, type SkeletonDesc } from '../types';
import { boneRefLabel, createBoneResolver } from './bones';

const ROTATE_ORDERS: ReadonlySet<string> = new Set(['xyz', 'yzx', 'zxy', 'xzy', 'yxz', 'zyx']);

export interface BuildInput {
  readonly skeleton: SkeletonDesc;
  /** Controls in slot (schedule) order. */
  readonly controls: readonly ControlRecord[];
  /** Effective parent slot per control (must be an earlier slot, else −1). */
  readonly parents: readonly number[];
  /** Schedule entries; when omitted: every control in slot order, then every node in index order. */
  readonly schedule?: { readonly kind: Uint8Array; readonly index: Int32Array };
  readonly customOps?: readonly ScheduledRigOp[];
}

/**
 * Builds the compiled data for controls already in slot order: rest frames, offsets, bindings (with duplicate and
 * missing-bone repair), mirror pairs and humanoid bookkeeping. Never throws on document content; problems are
 * appended to `warnings`.
 */
export function buildInternals(input: BuildInput, warnings: RigWarning[]): RigInternals {
  const { skeleton, controls } = input;
  const controlCount = controls.length;
  const nodeCount = skeleton.nodes.length;
  const nodeParent = nodeParents(skeleton);
  const restLocal = restLocals(skeleton);
  const restWorld = restWorlds(skeleton, restLocal);
  const facing = facingXf(skeleton);

  const controlParent = new Int32Array(controlCount);
  controls.forEach((_, slot) => {
    const parent = input.parents[slot] ?? -1;
    controlParent[slot] = parent >= 0 && parent < slot ? parent : -1;
  });

  const controlRest = allocXfArrays(controlCount);
  controls.forEach((control, slot) => xfaSet(controlRest, slot, safeXf(control.restWorld)));
  const offsets = allocXfArrays(controlCount);
  for (let slot = 0; slot < controlCount; slot++) {
    const parent = controlParent[slot] as number;
    if (parent === -1) xfaSet(offsets, slot, safeXf(controls[slot]?.restWorld));
    else xfaInvMul(controlRest, parent, controlRest, slot, offsets, slot);
  }

  const rotateOrders: RotateOrder[] = controls.map((control) =>
    ROTATE_ORDERS.has(control.rotateOrder) ? control.rotateOrder : 'xyz',
  );
  const keyable = new Uint8Array(controlCount * CHANNELS_PER_CONTROL);
  controls.forEach((control, slot) => {
    for (let k = 0; k < 9; k++) {
      const group = k < 3 ? control.keyable?.t : k < 6 ? control.keyable?.r : control.keyable?.s;
      keyable[slot * CHANNELS_PER_CONTROL + k] = group?.[k % 3] === true ? 1 : 0;
    }
  });

  // Bindings: a bone driven by several controls keeps the one with the smallest id (deterministic).
  const resolve = createBoneResolver(skeleton);
  const drivenNode = new Int32Array(controlCount).fill(-1);
  const driver = new Int32Array(nodeCount).fill(-1);
  const bindMode = new Uint8Array(nodeCount);
  const bySlotId = controls.map((_, slot) => slot).sort((a, b) => compareIds(controls[a]?.id, controls[b]?.id));
  for (const slot of bySlotId) {
    const control = controls[slot] as ControlRecord;
    const drives = control.drives;
    if (drives === null || drives === undefined) continue;
    const node = resolve(drives.bone);
    if (node === -1) {
      warnings.push({
        code: 'missing-bone',
        message: `${control.key}: bone ${boneRefLabel(drives.bone)} is not in the skeleton; the control drives nothing`,
        ids: [control.id],
      });
      continue;
    }
    if (driver[node] !== -1) {
      const winner = controls[driver[node] as number] as ControlRecord;
      warnings.push({
        code: 'duplicate-binding',
        message: `${control.key}: bone ${boneRefLabel(drives.bone)} is already driven by ${winner.key}`,
        ids: [control.id, winner.id],
      });
      continue;
    }
    driver[node] = slot;
    drivenNode[slot] = node;
    bindMode[node] =
      drives.mode === 'rotate' ? BIND_ROTATE : drives.mode === 'translateRotate' ? BIND_TRANSLATE_ROTATE : BIND_FULL;
  }
  const bind = allocXfArrays(nodeCount);
  for (let node = 0; node < nodeCount; node++) {
    const slot = driver[node] as number;
    if (slot !== -1) xfaInvMul(controlRest, slot, restWorld, node, bind, node);
  }

  // Mirror pairs.
  const slotOf = new Map<ControlId, number>(controls.map((control, slot) => [control.id, slot]));
  const mirror = new Int32Array(controlCount).fill(-1);
  controls.forEach((control, slot) => {
    if (control.mirror === null || control.mirror === undefined) return;
    const other = slotOf.get(control.mirror);
    if (other === undefined) {
      warnings.push({
        code: 'dangling-ref',
        message: `${control.key}: mirror counterpart ${control.mirror} does not exist`,
        ids: [control.id],
      });
      return;
    }
    mirror[slot] = other;
  });

  // Humanoid bookkeeping for N_b = D_hp(b)⁻¹ · D_b, D_b = q(W_b) · q(W⁰_b)⁻¹.
  const humanNode = humanNodeIndices(skeleton);
  const humanParent = new Int32Array(HUMAN_BONE_NAMES.length).fill(-1);
  const humanRestInverse = new Float64Array(HUMAN_BONE_NAMES.length * 4);
  HUMAN_BONE_NAMES.forEach((name, h) => {
    const node = humanNode[h] as number;
    if (node === -1) {
      humanRestInverse[h * 4 + 3] = 1;
      return;
    }
    humanRestInverse[h * 4] = -(restWorld.q[node * 4] as number);
    humanRestInverse[h * 4 + 1] = -(restWorld.q[node * 4 + 1] as number);
    humanRestInverse[h * 4 + 2] = -(restWorld.q[node * 4 + 2] as number);
    humanRestInverse[h * 4 + 3] = restWorld.q[node * 4 + 3] as number;
    const parent = nearestHumanAncestor(name, (bone) => humanNode[HUMAN_BONE_NAMES.indexOf(bone)] !== -1);
    humanParent[h] = parent === null ? -1 : HUMAN_BONE_NAMES.indexOf(parent);
  });
  const hipsNode = humanNode[0] as number;

  let opKind: Uint8Array;
  let opIndex: Int32Array;
  if (input.schedule !== undefined) {
    opKind = input.schedule.kind;
    opIndex = input.schedule.index;
  } else {
    opKind = new Uint8Array(controlCount + nodeCount);
    opIndex = new Int32Array(controlCount + nodeCount);
    for (let slot = 0; slot < controlCount; slot++) {
      opKind[slot] = OP_CONTROL;
      opIndex[slot] = slot;
    }
    for (let node = 0; node < nodeCount; node++) {
      opKind[controlCount + node] = OP_BONE;
      opIndex[controlCount + node] = node;
    }
  }

  return {
    skeleton,
    controlCount,
    nodeCount,
    controls,
    controlParent,
    rotateOrders,
    controlRest,
    offsets,
    keyable,
    drivenNode,
    mirror,
    nodeParent,
    driver,
    bindMode,
    bind,
    restLocal,
    restWorld,
    facing,
    humanNode,
    humanParent,
    humanRestInverse,
    hipsNode,
    opKind,
    opIndex,
    customOps: input.customOps ?? [],
  };
}

/** Internals of a RigProgram that `compileRig` did not create, using the program's own slot order. */
export function deriveInternals(program: RigProgram): RigInternals {
  const controls = program.controlIds.map((id, slot) => {
    const record = program.controls[slot];
    return record !== undefined && record.id === id
      ? record
      : (program.controls.find((c) => c.id === id) as ControlRecord);
  });
  const parents = controls.map((control, slot) => {
    if (control.parent === null) return -1;
    const parent = program.controlIndex.get(control.parent);
    return parent === undefined || parent >= slot ? -1 : parent;
  });
  return buildInternals({ skeleton: program.skeleton, controls, parents }, []);
}

function compareIds(a: string | undefined, b: string | undefined): number {
  const x = a ?? '';
  const y = b ?? '';
  return x < y ? -1 : x > y ? 1 : 0;
}

/** A finite transform from a possibly damaged record (non-finite parts become identity parts). */
function safeXf(xf: ControlRecord['restWorld'] | undefined): ControlRecord['restWorld'] {
  if (xf === undefined) return IDENTITY_XF;
  const finite = (v: readonly number[] | undefined, n: number): boolean =>
    Array.isArray(v) && v.length >= n && v.slice(0, n).every((x) => Number.isFinite(x));
  return {
    t: finite(xf.t, 3) ? xf.t : IDENTITY_XF.t,
    q: finite(xf.q, 4) ? xf.q : IDENTITY_XF.q,
    s: finite(xf.s, 3) && xf.s.every((x) => x !== 0) ? xf.s : IDENTITY_XF.s,
  };
}

const IDENTITY_XF: ControlRecord['restWorld'] = { t: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] };
