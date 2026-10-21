// C8a (constraint kernel; deferred after the MVP, M6B-SPEC §0.3, §5.18). C0: `parseConstraintParams` and
// `withoutConstraints` are working baselines (the compiler keeps compiling constraint records as disabled ops); the
// constraint ops, bake and mirror are stubs, and CONSTRAINT_OPS is not registered by `registerBuiltinRigOps` yet.
import { EkzaError } from '@ekza-studio/anim-core';
import type { ConstraintRecord } from '@ekza-studio/doc';
import type { RigOpImpl } from '../kernel/ops';
import type {
  BakeConstraintsArgs,
  ClipSampler,
  ConstraintType,
  ImportedCurve,
  RigDefinition,
  SkeletonDesc,
} from '../types';

export { parseConstraintParams } from './params';

function stubOp(type: ConstraintType): RigOpImpl {
  const fail = (): never => {
    throw new EkzaError('not-implemented', `rig.CONSTRAINT_OPS.${type}`);
  };
  const impl: RigOpImpl = { reads: fail, writes: fail, run: fail };
  return Object.freeze(impl);
}

/** Registered by `registerBuiltinRigOps` under ('constraint', type) — by C8a; C0 stubs. */
export const CONSTRAINT_OPS: Readonly<Record<ConstraintType, RigOpImpl>> = Object.freeze({
  parent: stubOp('parent'),
  point: stubOp('point'),
  orient: stubOp('orient'),
  aim: stubOp('aim'),
});

/** Pure core of §5.19 item 4: per clip, keys for the driven controls' keyable channels, plus residual warnings. */
export function bakeConstraints(
  _def: RigDefinition,
  _skeleton: SkeletonDesc,
  _clips: readonly ClipSampler[],
  _args: BakeConstraintsArgs,
): { readonly keys: readonly ImportedCurve[]; readonly residuals: readonly string[] } {
  throw new EkzaError('not-implemented', 'rig.bakeConstraints');
}

export function mirrorConstraint(
  _record: ConstraintRecord,
  _def: RigDefinition,
  _skeleton: SkeletonDesc,
): ConstraintRecord | null {
  throw new EkzaError('not-implemented', 'rig.mirrorConstraint');
}

/** The definition with every constraint record disabled: bake's P_off for all constraints and the program of the
 *  `bind` channel source (§5.17). C0 working baseline. */
export function withoutConstraints(def: RigDefinition): RigDefinition {
  if (def.constraints.every((constraint) => !constraint.enabled)) return def;
  return { ...def, constraints: def.constraints.map((c) => (c.enabled ? { ...c, enabled: false } : c)) };
}
