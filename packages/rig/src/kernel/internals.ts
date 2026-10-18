import type { RotateOrder } from '@ekza-animator/anim-core';
import type { ConstraintRecord, ControlRecord, SolverRecord } from '@ekza-animator/doc';
import { deriveInternals } from '../compile/build';
import type { XfArrays } from '../math/xfa';
import type { AttrKey, AttrSlot, LimbDesc, RigProgram, SkeletonDesc } from '../types';
import type { RigOpImpl } from './ops';

export interface ScheduledRigOp {
  readonly record: ConstraintRecord | SolverRecord;
  readonly impl: RigOpImpl;
  /** Control slots and node indices the op overwrites (re-read into the kernel's transforms after it runs). */
  readonly writesControls: Int32Array;
  readonly writesNodes: Int32Array;
  /** Control slots and node indices the op reads (the §5.8 influencing-curve definition follows them). */
  readonly readsControls: Int32Array;
  readonly readsNodes: Int32Array;
  /**
   * The op's `compile` result (M2A-SPEC §4.3), handed to `run`; `undefined` without `compile`. Set once by the
   * compiler after `createProgram`.
   */
  state: unknown;
  /** True when `compile` threw: the op is skipped at run time (the compiler warned). */
  skipped: boolean;
}

/**
 * Compiled rig data shared by the kernel, the inverse solvers and clip import. Everything is indexed by control
 * slot (schedule order) or SkeletonDesc node index.
 */
export interface RigInternals {
  readonly skeleton: SkeletonDesc;
  readonly controlCount: number;
  readonly nodeCount: number;
  /** Control records in slot order. */
  readonly controls: readonly ControlRecord[];
  /** Effective parent slot per control (−1 = character root) after dangling-reference and cycle repair. */
  readonly controlParent: Int32Array;
  readonly rotateOrders: readonly RotateOrder[];
  /** W⁰_c per control (rest world, canonical). */
  readonly controlRest: XfArrays;
  /** O_c = (W⁰_parent)⁻¹ · W⁰_c per control. */
  readonly offsets: XfArrays;
  /** 1 when slot `9c + k` (tx ty tz rx ry rz sx sy sz) is keyable. */
  readonly keyable: Uint8Array;
  /** Node driven by each control, −1 for pure space controls. */
  readonly drivenNode: Int32Array;
  /** Resolved mirror counterpart per control, −1 when none. */
  readonly mirror: Int32Array;
  readonly nodeParent: Int32Array;
  /** Driving control slot per node, −1 when the node keeps its rest local transform. */
  readonly driver: Int32Array;
  /** BIND_* per node. */
  readonly bindMode: Uint8Array;
  /** K_cb = (W⁰_c)⁻¹ · W⁰_b per driven node (identity elsewhere). */
  readonly bind: XfArrays;
  readonly restLocal: XfArrays;
  readonly restWorld: XfArrays;
  readonly facing: XfArrays;
  /** Node per HUMAN_BONE_NAMES slot (−1 when absent). */
  readonly humanNode: Int32Array;
  /** Nearest present humanoid ancestor per HUMAN_BONE_NAMES slot (−1 for hips and absent bones). */
  readonly humanParent: Int32Array;
  /** q(W⁰_b)⁻¹ per HUMAN_BONE_NAMES slot. */
  readonly humanRestInverse: Float64Array;
  readonly hipsNode: number;
  /** Schedule: kind (OP_* constants) and index (control slot, node or custom op). */
  readonly opKind: Uint8Array;
  readonly opIndex: Int32Array;
  readonly customOps: readonly ScheduledRigOp[];
  /** Attribute slots by (control id, name) (M2A-SPEC §5.1 rule 2) and their index. */
  readonly attrSlots: readonly AttrSlot[];
  readonly attrIndex: ReadonlyMap<AttrKey, number>;
  /** `AttrDef.default` per attribute slot (resetChannels / allocChannels). */
  readonly attrDefaults: Float64Array;
  /** Enabled ik2 solvers that compiled (§5.4 rule 4); built by the compiler (A1), empty before. */
  readonly limbs: readonly LimbDesc[];
}

const registry = new WeakMap<RigProgram, RigInternals>();

export function registerInternals(program: RigProgram, internals: RigInternals): void {
  registry.set(program, internals);
}

/**
 * Compiled data of `program`. Programs from `compileRig` carry it; for any other implementation of the RigProgram
 * contract (e.g. the shared test kit's naive program) it is derived once from `program.controls` and
 * `program.skeleton` with the program's own slot order.
 */
export function internalsOf(program: RigProgram): RigInternals {
  const known = registry.get(program);
  if (known !== undefined) return known;
  const derived = deriveInternals(program);
  registry.set(program, derived);
  return derived;
}

/**
 * Whether the rig op `id` (a constraint or solver record id) is scheduled in `program` but skipped at run time
 * because its `compile` threw (M2A-SPEC §5.4 rule 4: such an `ik2` op stays in `RigProgram.limbs` and
 * `evaluation.ikFk` reads its limb as 0). False for ops that run and for ids the program does not schedule.
 */
export function isRigOpSkipped(program: RigProgram, id: string): boolean {
  for (const op of internalsOf(program).customOps) if (op.record.id === id) return op.skipped;
  return false;
}
