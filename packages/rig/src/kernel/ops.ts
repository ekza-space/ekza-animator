// Rig op extension point (MVP-SPEC §7 WP-3, ADR 0004 §6–7, M2A-SPEC §4.3/§5.4). Constraint and solver records
// compile to ops; a record whose kind and type have no registered implementation compiles to a disabled op with an
// 'unsupported-op' warning. `registerBuiltinRigOps` registers the built-in implementations (M2a: `solver:ik2`, A1)
// without a schema change. Registration is explicit (nothing registers on import).
import { type Disposer, EkzaError } from '@ekza-animator/anim-core';
import type { ConstraintRecord, ControlId, SolverRecord } from '@ekza-animator/doc';
import type { ChannelBuffer, PoseBuffers, RigOpCompileContext, RigProgram } from '../types';

export interface RigOpImpl {
  /** Declared reads (control ids / bone node indices) for scheduling. */
  reads(
    record: ConstraintRecord | SolverRecord,
    ctx: RigOpCompileContext,
  ): { readonly controls: readonly ControlId[]; readonly nodes: readonly number[] };
  writes(
    record: ConstraintRecord | SolverRecord,
    ctx: RigOpCompileContext,
  ): { readonly controls: readonly ControlId[]; readonly nodes: readonly number[] };
  /**
   * Optional, once per compile, AFTER `createProgram` (the ctx carries the finished program, whose `limbs` the
   * compiler built from the records before): precomputed rest data and scratch buffers, handed to `run` as `state`.
   * A throw disables the op for this program (it is skipped at run time and warns).
   */
  compile?(
    record: ConstraintRecord | SolverRecord,
    ctx: RigOpCompileContext & { readonly program: RigProgram },
  ): unknown;
  /**
   * Returns `false` when it wrote nothing (e.g. `ik2` at ikFk 0): the kernel then skips the read-back of the op's
   * written worlds and does not mark its nodes overridden, so bone locals stay bit-identical to a program without
   * the op. `true` or `undefined` = wrote (M1 behaviour).
   */
  run(
    record: ConstraintRecord | SolverRecord,
    ctx: {
      readonly pose: PoseBuffers;
      readonly channels: ChannelBuffer;
      readonly program: RigProgram;
      readonly state: unknown;
    },
  ): boolean | void;
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

/**
 * The built-in op implementations `registerBuiltinRigOps` registers (M2A-SPEC §5.3). Empty until A1 adds
 * `['solver', 'ik2', ik2Op]`; the registration function works from A0 on, so `createEditorApp` and tests call it.
 */
export const BUILTIN_RIG_OPS: readonly (readonly [kind: RigOpKind, type: string, impl: RigOpImpl])[] = [];

let builtinUsers = 0;
let builtinDisposers: Disposer[] = [];

/**
 * Registers the built-in rig ops (M2a: `solver:ik2`). Reference-counted, so several editor apps and tests may call
 * it: the first call registers, the last disposer unregisters. A built-in type that a host already registered
 * itself is left to the host. Never registers on import.
 */
export function registerBuiltinRigOps(): Disposer {
  if (builtinUsers === 0) {
    builtinDisposers = [];
    for (const [kind, type, impl] of BUILTIN_RIG_OPS) {
      if (lookupRigOp(kind, type) !== undefined) continue;
      builtinDisposers.push(registerRigOp(kind, type, impl));
    }
  }
  builtinUsers++;
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    builtinUsers--;
    if (builtinUsers === 0) {
      for (const dispose of builtinDisposers.splice(0).reverse()) dispose();
    }
  };
}
