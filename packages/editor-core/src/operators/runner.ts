// The operator runner (MVP-SPEC §4.11.0, ADR 0008 §1): poll → prepare (async, no document writes) → poll again →
// apply (sync; for `flags.undo` exactly one transaction) → one editor-history step. `app.run` inside `apply` throws
// `nested-run`; a failing apply rolls the document back (the store) and the session back (the runner).
//
// M-AI (MCP-SPEC §4.1 runner rules 1–9) for runs with `RunContext.actor` (an agent):
// 1. `signal` aborted before the first poll, after `prepare`, or right before `apply` → `cancelled` ('cancelled by the
//    agent'); once `apply` started the run completes.
// 2. Labels are `AI: ` + the operator's label (≤ 80 characters); `tx.annotate({label})` gets the same prefix.
// 3. The recorded step carries `actor` and `changes` (the capture scope's batches, in commit order).
// 4. `def.coalesce` is ignored (no coalesce key in the transaction or the step).
// 5. No selection snapshots in the transaction meta.
// 6. Unless `access === 'view'`, the user's session state is recorded by reference before `apply` and compared right
//    after it (inside the transaction, before the commit): a change throws `agent-ustate`, which rolls back.
// 7. `operatorContext` copies source, actor, runScope, signal and access (see registry.ts and define.ts).
// 8. (With M6a's LastRun recorder) actor runs never become `lastRun`.
// 9. A run whose `apply` would start during a store preview (the user's drag) is `cancelled` 'gesture in progress';
//    actor runs are never gesture-safe.
import { EkzaError } from '@ekza-animator/anim-core';
import type { AnyChange, DocumentStore, Tx } from '@ekza-animator/doc';
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
  RunActor,
  RunContext,
  SessionState,
  SessionStore,
} from '../types';
import { type AnyOperatorDef, operatorContext, unknownOperator } from './registry';

/** Runner rule 1: the reason of a run its `signal` stopped. */
export const CANCELLED_BY_AGENT = 'cancelled by the agent';
/** Runner rule 9 (and the shipped rule): the reason of a run refused while the user drags. */
export const GESTURE_IN_PROGRESS = 'gesture in progress';
/** Runner rule 2: the prefix of every actor step label, and the label's maximum length. */
export const AI_LABEL_PREFIX = 'AI: ';
export const AI_LABEL_MAX = 80;

/** Runner rule 2: `AI: <label>`, at most 80 characters (a label that already carries the prefix keeps it once). */
export function actorLabel(label: string): string {
  const full = label.startsWith(AI_LABEL_PREFIX) ? label : `${AI_LABEL_PREFIX}${label}`;
  return full.length <= AI_LABEL_MAX ? full : `${full.slice(0, AI_LABEL_MAX - 1)}…`;
}

/**
 * Runner rule 6: the session fields an actor run must leave as they were (by reference), M6a's included when the
 * session has them. `prefs` is compared as the whole preferences state object.
 */
export const AGENT_PROTECTED_SESSION_FIELDS = [
  'selection',
  'time',
  'overrides',
  'activeCharacter',
  'activeClip',
  'tools',
  'clipboard',
  'curveBuffers',
  'hiddenControls',
  'showSecondary',
  'viewportLayout',
  'maximizedPane',
  'dialog',
  'feetPins',
  // M6a (present once its session fields land)
  'workspace',
  'model',
  'workspaceViews',
] as const;

interface SessionRecord {
  readonly fields: ReadonlyMap<string, unknown>;
  readonly prefs: unknown;
}

function recordSession(app: EditorApp): SessionRecord {
  const state = app.session.getState() as unknown as Readonly<Record<string, unknown>>;
  const fields = new Map<string, unknown>();
  for (const field of AGENT_PROTECTED_SESSION_FIELDS) if (field in state) fields.set(field, state[field]);
  return { fields, prefs: app.prefs.getState() };
}

/** Throws `agent-ustate` when an actor run changed a protected session field or the preferences. */
function checkSession(app: EditorApp, id: string, recorded: SessionRecord): void {
  const state = app.session.getState() as unknown as Readonly<Record<string, unknown>>;
  for (const [field, value] of recorded.fields) {
    if (state[field] !== value) {
      throw new EkzaError('agent-ustate', `${id} changed session.${field} during an agent run`);
    }
  }
  if (app.prefs.getState() !== recorded.prefs) {
    throw new EkzaError('agent-ustate', `${id} changed the preferences during an agent run`);
  }
}

/** Runner rule 2: a view of `tx` whose `annotate({label})` adds the actor prefix. */
function actorTx(tx: Tx): Tx {
  const annotate: Tx['annotate'] = (meta) =>
    tx.annotate(meta.label === undefined ? meta : { ...meta, label: actorLabel(meta.label) });
  return new Proxy(tx, {
    get(target, prop) {
      if (prop === 'annotate') return annotate;
      const value: unknown = Reflect.get(target, prop, target);
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
}

function aborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

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
    attribution: { readonly actor: RunActor; readonly changes: readonly AnyChange[] } | null,
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
    if (attribution !== null) {
      // Runner rule 3: the actor and the document changes of its transaction (none when the step is override-only).
      const changes = docTxId === null || attribution.changes.length === 0 ? null : attribution.changes;
      history.record({ label: stepLabel, docTxId, overrides: delta, actor: attribution.actor, changes });
    } else if (coalescing === null) history.record({ label: stepLabel, docTxId, overrides: delta });
    else {
      history.record({ label: stepLabel, docTxId, overrides: delta, coalesceKey: coalescing.key }, coalescing.ms);
    }
  };

  const execute = async (def: AnyOperatorDef, args: unknown, ctx: RunContext | undefined) => {
    const app = deps.app();
    const opCtx = operatorContext(app, ctx);
    const actor = ctx?.actor ?? null;
    const signal = ctx?.signal;
    // Runner rule 6: 'view' runs may change what the user sees; every other actor run is checked.
    const checked = actor !== null && ctx?.access !== 'view';
    let rollback: SessionState | null = null;
    try {
      if (aborted(signal)) return cancelled(CANCELLED_BY_AGENT);
      const first = def.poll?.(opCtx, args) ?? true;
      if (first !== true) return cancelled(first.reason);
      const prepared = def.prepare === undefined ? undefined : await def.prepare(opCtx, args);
      if (aborted(signal)) return cancelled(CANCELLED_BY_AGENT);
      const second = def.poll?.(opCtx, args) ?? true;
      if (second !== true) return cancelled(second.reason);
      // A gesture-safe operator run during a gesture records no step: the overrides it sees are the gesture's
      // transient values, and cancelling the gesture is not an edit. Actor runs are never gesture-safe (rule 9).
      const duringGesture = store.preview?.active === true;
      if (duringGesture && (actor !== null || !GESTURE_SAFE_OPERATORS.has(def.id))) {
        return cancelled(GESTURE_IN_PROGRESS);
      }
      if (aborted(signal)) return cancelled(CANCELLED_BY_AGENT);

      rollback = session.getState();
      const where = deps.location();
      const baseLabel = def.undoLabel?.(args) ?? def.label;
      const label = actor === null ? baseLabel : actorLabel(baseLabel);
      // Runner rule 4: actor runs never coalesce.
      const coalescing = actor === null ? coalescingOf(def, args) : null;
      const navigations = history.navigations;
      const scope = capture.begin();
      // Runner rule 6: recorded right before apply, by reference.
      const recorded = checked ? recordSession(app) : null;
      let value: unknown;
      let outcome: CaptureOutcome = { kind: 'none' };
      applying++;
      try {
        if (def.flags?.undo === true) {
          // Runner rule 5: actor runs carry no selection snapshots.
          const meta = {
            label,
            ...(actor === null ? { selectionBefore: selectionSnapshot(rollback.selection) } : {}),
            ...(coalescing === null ? {} : { coalesceKey: coalescing.key, coalesceMs: coalescing.ms }),
          };
          value = store.transact(meta, (tx) => {
            const result = def.apply({ ...opCtx, tx: actor === null ? tx : actorTx(tx) }, args, prepared);
            // Inside the transaction, before the commit: the keeper's reactions to the batch are not counted.
            if (recorded !== null) checkSession(app, def.id, recorded);
            if (actor === null) tx.annotate({ selectionAfter: selectionSnapshot(session.getState().selection) });
            return result;
          });
        } else {
          value = def.apply({ ...opCtx, tx: null }, args, prepared);
          if (recorded !== null) checkSession(app, def.id, recorded);
        }
      } finally {
        applying--;
        outcome = capture.end(scope);
      }
      // An operator that navigated the history (edit.undo/redo) adds no step: its doc undo and restored overrides
      // are the navigation itself, and a new step would clear the redo stack.
      if (history.navigations === navigations && !scope.loaded && !duringGesture) {
        const attribution = actor === null ? null : { actor, changes: scope.batches.flatMap((batch) => batch.changes) };
        recordStep(label, rollback, where, outcome, coalescing, attribution);
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
