// Preview sessions (M6A-SPEC §4.6 `MeshOpSession`, §5.5 rule 1, §5.7 card drags): a tool or card drag runs the op on
// the open meshes in place, with no document writes. `update` takes the op's `adjust` fast path when every target
// offers it, else reverts and re-runs; `cancel` reverts everything; `commitOp` takes the session's deltas when its op,
// targets and args match the operator's (else it cancels the session and runs the op itself).
//
// `base: 'before-last'` previews an adjust-last re-run from the pre-op mesh: the last op's journal edge is applied
// backwards first, the run reads the selection **that op read** (its kind and components, recorded on the edge, §5.7:
// whatever the current mode), and the session survives the undo of that step (the ref then equals the session's base).
// `commitOp` takes a session only when the selection its run would read equals the session's (`sameInput`), so a
// committed session is always what a fresh run would have written.
import { EkzaError, type ParamValues } from '@ekza-animator/anim-core';
import { deepEqual, type MeshId } from '@ekza-animator/doc';
import type { ComponentSelection, MeshDelta, MeshOp, OpResult, Refusal } from '@ekza-animator/mesh-core';
import type { MeshOpSession } from '../types';
import { dirtyOf } from './dirty';
import type { OpInput } from './input';
import type { JournalEdge } from './journal';
import type { MeshRuntimeImpl } from './runtime';

/** One target of a session. */
export interface SessionTarget {
  readonly runtime: MeshRuntimeImpl;
  readonly wasOpen: boolean;
  /** The last op's edge undone for a 'before-last' session (re-applied on cancel when the ref still needs it). */
  readonly undone: JournalEdge | null;
  /** What the run reads (a copy): compared with what the commit's run would read before the session is taken. */
  readonly input: OpInput;
  /** The selection the op runs on (`input.selection`, expanded by the symmetry map for 'expand' ops). */
  readonly selection: ComponentSelection | null;
  deltas: MeshDelta[];
  result: OpResult | Refusal;
}

/** What a session needs from the registry. */
export interface SessionHost {
  /** Runs `op` once on a target inside its own kernel transaction; the delta, or a refusal (log aborted). */
  run(
    op: MeshOp,
    target: SessionTarget,
    args: ParamValues,
  ): { readonly delta: MeshDelta | null; readonly result: OpResult | Refusal };
  /** Content changed by the session (preview events). */
  changed(target: SessionTarget, deltas: readonly MeshDelta[]): void;
  /** The session ended (cancelled or committed): the registry forgets it and settles the targets. */
  ended(session: OpSession, how: 'cancel' | 'commit'): void;
}

const isRefusalResult = (r: OpResult | Refusal): r is Refusal => (r as Refusal).refused === true;

export class OpSession implements MeshOpSession {
  active = true;
  /** Why the session ended when something else ended it ("Changed by another user"). */
  endedBecause: string | null = null;
  args: ParamValues;

  constructor(
    readonly op: MeshOp,
    readonly targets: readonly SessionTarget[],
    args: ParamValues,
    readonly base: 'current' | 'before-last',
    private readonly host: SessionHost,
  ) {
    this.args = args;
  }

  get opId(): string {
    return this.op.id;
  }

  get meshes(): readonly MeshId[] {
    return this.targets.map((t) => t.runtime.id);
  }

  get results(): ReadonlyMap<MeshId, OpResult | Refusal> {
    return new Map(this.targets.map((t) => [t.runtime.id, t.result]));
  }

  update(args: ParamValues): void {
    if (!this.active) return;
    const patch: Record<string, ParamValues[string]> = {};
    for (const [key, value] of Object.entries(args)) {
      if (!deepEqual(value, this.args[key] ?? null)) patch[key] = value;
    }
    if (Object.keys(patch).length === 0) return;
    const merged: ParamValues = { ...this.args, ...patch };
    if (this.tryAdjust(patch)) {
      this.args = merged;
      return;
    }
    // Revert every target and re-run with the new args.
    for (const target of this.targets) this.revert(target);
    for (const target of this.targets) {
      const { delta, result } = this.host.run(this.op, target, merged);
      target.result = result;
      target.deltas = delta === null ? [] : [delta];
      if (delta !== null) this.host.changed(target, target.deltas);
    }
    this.args = merged;
  }

  cancel(): void {
    if (!this.active) return;
    for (const target of this.targets) this.revert(target);
    this.active = false;
    this.host.ended(this, 'cancel');
  }

  /** Ends the session for a commit: its deltas stay applied and belong to the commit now. */
  take(): readonly SessionTarget[] {
    this.active = false;
    this.host.ended(this, 'commit');
    return this.targets;
  }

  /** True when a commit of `op` on `targets` with `args` is this session's result (§5.5 rule 2). */
  matches(op: MeshOp, targets: readonly string[], args: ParamValues): boolean {
    if (!this.active || op.id !== this.op.id) return false;
    if (targets.length !== this.targets.length) return false;
    const mine = new Set<string>(this.meshes);
    if (!targets.every((id) => mine.has(id))) return false;
    for (const target of this.targets) {
      if (isRefusalResult(target.result)) return false;
      const resolved = target.result.resolvedArgs;
      for (const [key, value] of Object.entries(args)) {
        if (value === undefined) continue;
        const ours = Object.hasOwn(resolved, key) ? resolved[key] : this.args[key];
        if (!deepEqual(value, ours ?? null)) return false;
      }
    }
    return true;
  }

  private tryAdjust(patch: ParamValues): boolean {
    const begun: SessionTarget[] = [];
    try {
      for (const target of this.targets) {
        const result = target.result;
        if (isRefusalResult(result) || result.adjust === undefined) throw new EkzaError('unsupported', 'no fast path');
        const mesh = target.runtime.lineage;
        if (mesh === null) throw new EkzaError('unsupported', 'no mesh');
        mesh.begin(this.op.id);
        begun.push(target);
        if (!result.adjust(patch)) throw new EkzaError('unsupported', 'adjust declined');
      }
    } catch {
      for (const target of begun) target.runtime.lineage?.abort();
      return false;
    }
    for (const target of this.targets) {
      const mesh = target.runtime.lineage;
      if (mesh === null) continue;
      const delta = mesh.end();
      target.deltas.push(delta);
      const result = target.result as OpResult;
      target.result = { ...result, resolvedArgs: { ...result.resolvedArgs, ...patch } };
      this.host.changed(target, [delta]);
    }
    return true;
  }

  private revert(target: SessionTarget): void {
    const mesh = target.runtime.lineage;
    if (mesh === null || target.deltas.length === 0) {
      target.deltas = [];
      return;
    }
    for (let i = target.deltas.length - 1; i >= 0; i--) mesh.apply(target.deltas[i] as MeshDelta, 'backward');
    const dirty = dirtyOf(target.deltas);
    target.deltas = [];
    target.runtime.noteChanged(dirty, true);
  }
}
