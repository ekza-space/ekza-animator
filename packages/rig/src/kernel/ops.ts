// Rig op extension point (MVP-SPEC §7 WP-3, ADR 0004 §6–7). Constraint and solver records compile to ops; the MVP
// registers no implementations, so every enabled record compiles to a disabled op with an 'unsupported-op' warning.
// V1 registers `ik2`, `parent`, … here without a schema change. Registration is explicit (nothing registers on import).
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

export type RigOpKind = 'constraint' | 'solver';

const registry = new Map<string, RigOpImpl>();

function registryKey(kind: RigOpKind, type: string): string {
  return `${kind}:${type}`;
}

/**
 * V1 extension point. Programs compiled afterwards schedule records of this kind and type: the op runs after the
 * worlds it reads and after the worlds it writes were computed (it overwrites them in `pose.controlWorld` /
 * `pose.boneWorld`), and before anything below them. Throws EkzaError('unsupported') when the type is taken.
 */
export function registerRigOp(kind: RigOpKind, type: string, impl: RigOpImpl): Disposer {
  if (kind !== 'constraint' && kind !== 'solver') {
    throw new EkzaError('unsupported', `Unknown rig op kind '${String(kind)}'`);
  }
  if (typeof type !== 'string' || type.length === 0) {
    throw new EkzaError('unsupported', 'A rig op type must be a non-empty string');
  }
  const key = registryKey(kind, type);
  if (registry.has(key)) throw new EkzaError('unsupported', `Rig op ${key} is already registered`);
  registry.set(key, impl);
  return () => {
    if (registry.get(key) === impl) registry.delete(key);
  };
}

export function lookupRigOp(kind: RigOpKind, type: string): RigOpImpl | undefined {
  return registry.get(registryKey(kind, type));
}
