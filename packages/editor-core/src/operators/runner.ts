// The operator runner (MVP-SPEC §4.11.0, ADR 0008 §1): poll → prepare (async, no document writes) → poll again →
// apply (sync; for `flags.undo` exactly one transaction) → one editor-history step. `app.run` inside `apply` throws
// `nested-run`; a failing apply rolls the document back (the store) and the session back (the runner).
import { EkzaError } from '@ekza-animator/anim-core';
import type { DocumentStore } from '@ekza-animator/doc';
import type { CaptureOutcome, DocCapture } from '../history/capture';
import type { KernelHistory } from '../history/history';
import { type OverrideLocation, overrideDelta, sameLocation } from '../history/overrides';
import { ownerOfControl } from '../session/location';
import { selectionSnapshot } from '../session/selection';
import type {
  EditorApp,
  OperatorDef,
  OperatorRegistry,
  OperatorResult,
  RunContext,
  SessionState,
  SessionStore,
} from '../types';
import { type AnyOperatorDef, operatorContext, unknownOperator } from './registry';

/** Consecutive runs with the same `key` within `ms` merge into one undo step (Channel Box ↑/↓ nudges). */
export interface OperatorCoalescing {
  readonly key: string;
  readonly ms: number;
}

/**
 * An operator that opts into coalescing (§4.11.0 rule 7). `OperatorDef.coalesce` is part of the contract since the
 * v0.3 integration; this alias stays for code written against the WP-7a export. The run's transaction carries
 * `coalesceKey`/`coalesceMs`, so the store merges the document part; override-only steps with the same key merge in
 * the editor history within the same window.
 */
export type CoalescingOperatorDef<A = void, R = void, P = void> = OperatorDef<A, R, P>;

function coalescingOf(def: AnyOperatorDef, args: unknown): OperatorCoalescing | null {
  const spec = def.coalesce?.(args) ?? null;
  return spec !== null && spec.key.length > 0 && spec.ms > 0 ? spec : null;
}

/**
 * Operators that run while a preview (gesture) is active (§4.11.0 rule 3 exception): `edit.escape` exists to cancel
 * that gesture. They must not write the document while the preview is active (`store.transact` would throw).
 */
export const GESTURE_SAFE_OPERATORS: ReadonlySet<string> = new Set(['edit.escape']);

export interface OperatorRunner {
  /** Throws `nested-run` synchronously when called from inside an operator's apply. */
  run(id: string, args: unknown, ctx: RunContext | undefined): Promise<OperatorResult<unknown>>;
}

export function createOperatorRunner(deps: {
  readonly app: () => EditorApp;
  readonly registry: OperatorRegistry;
  readonly store: DocumentStore;
  readonly session: SessionStore;
  readonly history: KernelHistory;
  readonly capture: DocCapture;
  /** Active character's clip and clip frame (where override edits are recorded). */
  readonly location: () => OverrideLocation | null;
}): OperatorRunner {
  const { store, session, history, capture } = deps;
  let applying = 0;

  /** One history step for what `apply` did: its doc entry and/or its override edits (§4.11.0 rule 7). */
  const recordStep = (
    label: string,
    before: SessionState,
    where: OverrideLocation | null,
    outcome: CaptureOutcome,
    coalescing: OperatorCoalescing | null,
  ): void => {
    if (outcome.kind === 'removed') history.forgetDocEntry(outcome.txId);
    const docTxId = outcome.kind === 'new' || outcome.kind === 'coalesced' ? outcome.txId : null;
    const after = session.getState();
    const whereAfter = deps.location();
    // Override edits are recorded only where they still apply: a run that moved the frame or switched clip or
    // character has had its overrides discarded by the kernel.
    const delta =
      whereAfter !== null && sameLocation(where, whereAfter)
        ? overrideDelta(before.overrides, after.overrides, whereAfter, (control) => ownerOfControl(store, control))
        : null;
    // Keying that consumes overrides keeps the earlier override steps: this step's delta brings the override back
    // on undo, so the next undo still finds the typed edit that made it (§4.11.1 rule 5, acceptance round 1).
    if (docTxId === null && delta === null) return;
    // A new doc entry carries the final label (`tx.annotate` may have refined it).
    const stepLabel = outcome.kind === 'new' ? outcome.label : label;
    if (coalescing === null) history.record({ label: stepLabel, docTxId, overrides: delta });
    else {
      history.record({ label: stepLabel, docTxId, overrides: delta, coalesceKey: coalescing.key }, coalescing.ms);
    }
  };

  const execute = async (def: AnyOperatorDef, args: unknown, ctx: RunContext | undefined) => {
    const opCtx = operatorContext(deps.app(), ctx);
    let rollback: SessionState | null = null;
    try {
      const first = def.poll?.(opCtx, args) ?? true;
      if (first !== true) return cancelled(first.reason);
      const prepared = def.prepare === undefined ? undefined : await def.prepare(opCtx, args);
      const second = def.poll?.(opCtx, args) ?? true;
      if (second !== true) return cancelled(second.reason);
      // A gesture-safe operator run during a gesture records no step: the overrides it sees are the gesture's
      // transient values, and cancelling the gesture is not an edit.
      const duringGesture = store.preview?.active === true;
      if (duringGesture && !GESTURE_SAFE_OPERATORS.has(def.id)) return cancelled('gesture in progress');

      rollback = session.getState();
      const where = deps.location();
      const label = def.undoLabel?.(args) ?? def.label;
      const coalescing = coalescingOf(def, args);
      const navigations = history.navigations;
      const scope = capture.begin();
      let value: unknown;
      let outcome: CaptureOutcome = { kind: 'none' };
      applying++;
      try {
        if (def.flags?.undo === true) {
          const meta = {
            label,
            selectionBefore: selectionSnapshot(rollback.selection),
            ...(coalescing === null ? {} : { coalesceKey: coalescing.key, coalesceMs: coalescing.ms }),
          };
          value = store.transact(meta, (tx) => {
            const result = def.apply({ ...opCtx, tx }, args, prepared);
            tx.annotate({ selectionAfter: selectionSnapshot(session.getState().selection) });
            return result;
          });
        } else {
          value = def.apply({ ...opCtx, tx: null }, args, prepared);
        }
      } finally {
        applying--;
        outcome = capture.end(scope);
      }
      // An operator that navigated the history (edit.undo/redo) adds no step: its doc undo and restored overrides
      // are the navigation itself, and a new step would clear the redo stack.
      if (history.navigations === navigations && !scope.loaded && !duringGesture) {
        recordStep(label, rollback, where, outcome, coalescing);
      }
      return { status: 'finished', value } as const;
    } catch (error) {
      if (rollback !== null) session.setState(rollback, true);
      return {
        status: 'failed',
        error: {
          code: error instanceof EkzaError ? error.code : 'internal',
          message: error instanceof Error ? error.message : String(error),
        },
      } as const;
    }
  };

  return {
    run(id: string, args: unknown, ctx: RunContext | undefined): Promise<OperatorResult<unknown>> {
      if (applying > 0) throw new EkzaError('nested-run', `app.run('${id}') inside an operator's apply`);
      const def = deps.registry.get(id);
      if (def === undefined) return Promise.resolve(cancelled(unknownOperator(id)));
      return execute(def, args, ctx);
    },
  };
}

function cancelled(reason: string): OperatorResult<never> {
  return { status: 'cancelled', reason };
}
