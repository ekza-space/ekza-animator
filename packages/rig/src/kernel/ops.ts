// WP-3: rig op extension point (MVP-SPEC §7 WP-3). `registerRigOp` throws until the op registry lands.
import { type Disposer, EkzaError } from '@ekza-animator/anim-core';
import type { ConstraintRecord, ControlId, SolverRecord } from '@ekza-animator/doc';
import type { ChannelBuffer, PoseBuffers, RigProgram } from '../types';

export interface RigOpImpl {
  /** Declared reads (control ids / bone node indices) for scheduling. */
  reads(record: ConstraintRecord | SolverRecord): {
    readonly controls: readonly ControlId[];
    readonly nodes: readonly number[];
  };
  writes(record: ConstraintRecord | SolverRecord): {
    readonly controls: readonly ControlId[];
    readonly nodes: readonly number[];
  };
  run(
    record: ConstraintRecord | SolverRecord,
    ctx: { readonly pose: PoseBuffers; readonly channels: ChannelBuffer; readonly program: RigProgram },
  ): void;
}

/** V1 extension point. */
export function registerRigOp(_kind: 'constraint' | 'solver', _type: string, _impl: RigOpImpl): Disposer {
  throw new EkzaError('not-implemented', 'rig.registerRigOp');
}
