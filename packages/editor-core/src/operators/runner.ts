// The operator runner (MVP-SPEC §4.11.0, ADR 0008 §1): poll → prepare (async, no document writes) → poll again →
// apply (sync; for `flags.undo` exactly one transaction) → one editor-history step. `app.run` inside `apply` throws
// `nested-run`; a failing apply rolls the document back (the store) and the session back (the runner).
import { EkzaError } from '@ekza-animator/anim-core';
import type { DocumentStore } from '@ekza-animator/doc';
import type { CaptureOutcome, DocCapture } from '../history/capture';
import type { KernelHistory } from '../history/history';
import { consumedControls, type OverrideLocation, overrideDelta, sameLocation } from '../history/overrides';
import { selectionSnapshot } from '../session/selection';
import type { EditorApp, OperatorRegistry, OperatorResult, RunContext, SessionState, SessionStore } from '../types';
import { type AnyOperatorDef, operatorContext, unknownOperator } from './registry';

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
  ): void => {
    if (outcome.kind === 'removed') history.forgetDocEntry(outcome.txId);
    const docTxId = outcome.kind === 'new' || outcome.kind === 'coalesced' ? outcome.txId : null;
    const after = session.getState();
    const whereAfter = deps.location();
    // Override edits are recorded only where they still apply: a run that moved the frame or switched clip or
    // character has had its overrides discarded by the kernel.
    const delta =
      whereAfter !== null && sameLocation(where, whereAfter)
        ? overrideDelta(before.overrides, after.overrides, whereAfter)
        : null;
    if (delta !== null && docTxId !== null) {
      // Keying consumed these overrides: earlier steps lose their override parts (§4.11.1 rule 5).
      const consumed = consumedControls(before.overrides, after.overrides);
      if (consumed.length > 0) history.dropOverrides({ character: delta.character, controls: consumed });
    }
    if (docTxId !== null || delta !== null) history.record({ label, docTxId, overrides: delta });
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
      if (store.preview?.active === true) return cancelled('gesture in progress');

      rollback = session.getState();
      const where = deps.location();
      const label = def.undoLabel?.(args) ?? def.label;
      const navigations = history.navigations;
      const scope = capture.begin();
      let value: unknown;
      let outcome: CaptureOutcome = { kind: 'none' };
      applying++;
      try {
        if (def.flags?.undo === true) {
          value = store.transact({ label, selectionBefore: selectionSnapshot(rollback.selection) }, (tx) => {
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
      if (history.navigations === navigations && !scope.loaded) recordStep(label, rollback, where, outcome);
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
