// The operator runner (MVP-SPEC §4.11.0, ADR 0008 §1): poll → prepare (async, no document writes) → poll again →
// apply (sync; for `flags.undo` exactly one transaction) → one editor-history step. `app.run` inside `apply` throws
// `nested-run`; a failing apply rolls the document back (the store) and the session back (the runner).
//
// M6a (M6A-SPEC §4.6, §5.7; B11): `ParamValues` args are validated by `coerceArgs(def.params, raw, { passThrough:
// def.extraArgs })` before `poll` (operators without `params` are not coerced, shipped behaviour); runs from the UI
// (keyboard, menus, marking menus, Toolkit, palette, tools) start from the option box's defaults
// (`prefs.modeling.optionDefaults[id]`) under the given args; the re-run of `edit.adjustLast` is labelled
// "<label> (adjusted)"; after every finished run the LastRun recorder (lastop.ts) records `session.lastRun`; after a
// failed run the mesh runtimes settle an aborted commit (`reconcile`, M6A-B7-26) before the result is reported. A
// `prepare` that returns a plain value (not a promise) keeps the run synchronous up to `apply`.
// M6a (M6A-SPEC §5.8; B12b): the extrude session's hooks run after the first poll (an ending run ends the session
// before it reads the mesh) and after every finished run (an extrude opens a session; an adjusted one steps it).
import { coerceArgs, EkzaError } from '@ekza-animator/anim-core';
import type { DocumentStore } from '@ekza-animator/doc';
import { bindCapture } from '../edit/capture';
import type { CaptureOutcome, DocCapture } from '../history/capture';
import type { KernelHistory } from '../history/history';
import { type OverrideLocation, overrideDelta, sameLocation } from '../history/overrides';
import { runSeedOf } from '../mesh/seed';
import { ownerOfControl } from '../session/location';
import { selectionSnapshot } from '../session/selection';
import type {
  EditorApp,
  OperatorDef,
  OperatorRegistry,
  OperatorResult,
  RunContext,
  RunSource,
  SessionState,
  SessionStore,
} from '../types';
import { extrudeAfterRun, extrudeBeforeRun } from './builtin/extrudeSession';
import { adjustingOperator, attachLastRunTracker, recordLastRun as recordLastRunOf } from './builtin/lastop';
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
 * M6a (M6A-SPEC §5.7; B11): called after every finished run with the step it recorded (null when none), the args after
 * coercion, the session before the run and the step seed of the latest mesh run before it started.
 */
export type LastRunRecorder = (run: {
  readonly def: AnyOperatorDef;
  readonly args: unknown;
  readonly ctx: RunContext | undefined;
  readonly value: unknown;
  readonly stepId: number | null;
  readonly before?: SessionState;
  readonly seedBefore?: object | null;
}) => void;

/** Records nothing (`session.lastRun` stays null): for hosts and tests that opt out. */
export const recordNoLastRun: LastRunRecorder = () => {};

/** Run sources that start from the option box's defaults (§8.5: "defaults for the next run"). */
const UI_SOURCES: ReadonlySet<RunSource> = new Set(['keyboard', 'menu', 'marking-menu', 'toolkit', 'palette', 'tool']);

const isThenable = (value: unknown): value is PromiseLike<unknown> =>
  typeof value === 'object' && value !== null && typeof (value as { then?: unknown }).then === 'function';

const isPlainRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The args an operator with `params` runs with (§4.6): the option box's defaults for UI runs, the given args over
 * them, validated by `coerceArgs` (clamping, int rounding, enum/axis membership, `data` schemas; `extraArgs` passed
 * through untouched, every other unknown key dropped). Only the keys the run was given (or the option box supplied)
 * reach the operator: the defaults of absent params stay the operator's to resolve (the kernel's nullable "auto"
 * and selection-bound values, the primitives' `prefs.modeling.primitiveDefaults` set; M6A-B11-2).
 */
export function coerceRunArgs(app: EditorApp, def: AnyOperatorDef, raw: unknown, ctx: RunContext | undefined): unknown {
  if (def.params === undefined) return raw;
  const source = ctx?.source;
  const defaults =
    source !== undefined && UI_SOURCES.has(source) ? app.prefs.getState().modeling.optionDefaults[def.id] : undefined;
  const given: Readonly<Record<string, unknown>> = isPlainRecord(raw) ? raw : {};
  const input: Readonly<Record<string, unknown>> = defaults === undefined ? given : { ...defaults, ...given };
  const coerced = coerceArgs(def.params, input, { passThrough: def.extraArgs ?? [] }).args;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(coerced)) {
    if (Object.hasOwn(input, key) && input[key] !== undefined) out[key] = value;
  }
  return out;
}

/** M6A-B7-26: settle a commit whose transaction aborted, before the failure is reported. */
function reconcileMeshes(app: EditorApp): void {
  const meshes = app.meshes as { reconcile?: () => void };
  try {
    meshes.reconcile?.();
  } catch {
    // Reconciling is best effort; the next store batch or microtask settles it anyway.
  }
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
  /** M6a: the LastRun recorder (default: `recordNoLastRun`). */
  readonly lastRun?: LastRunRecorder;
}): OperatorRunner {
  const recordLastRun: LastRunRecorder =
    deps.lastRun ??
    ((run) =>
      recordLastRunOf(deps.app(), {
        ...run,
        before: run.before ?? deps.session.getState(),
        seedBefore: run.seedBefore ?? null,
      }));
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

  const execute = async (def: AnyOperatorDef, rawArgs: unknown, ctx: RunContext | undefined) => {
    const app = deps.app();
    // The card's tracker binds here once its chunk has loaded (the recorder loads it, §5.27).
    attachLastRunTracker(app, false);
    bindCapture(app);
    const opCtx = operatorContext(app, ctx);
    const before = session.getState();
    const seedBefore = runSeedOf(app);
    let rollback: SessionState | null = null;
    let applied = false;
    try {
      const args = coerceRunArgs(app, def, rawArgs, ctx);
      const first = def.poll?.(opCtx, args) ?? true;
      if (first !== true) return cancelled(first.reason);
      // M6a (§5.8; B12b): the extrude session ends at the start of the gesture that ends it, before it reads the mesh.
      extrudeBeforeRun(app, def, args, ctx);
      let prepared = def.prepare === undefined ? undefined : def.prepare(opCtx, args);
      if (isThenable(prepared)) prepared = await prepared;
      const second = def.poll?.(opCtx, args) ?? true;
      if (second !== true) return cancelled(second.reason);
      // A gesture-safe operator run during a gesture records no step: the overrides it sees are the gesture's
      // transient values, and cancelling the gesture is not an edit.
      const duringGesture = store.preview?.active === true;
      if (duringGesture && !GESTURE_SAFE_OPERATORS.has(def.id)) return cancelled('gesture in progress');

      rollback = session.getState();
      const where = deps.location();
      const baseLabel = def.undoLabel?.(args) ?? def.label;
      // §5.7: the re-run of `edit.adjustLast` replaces the step under the label "<label> (adjusted)".
      const label = ctx?.source === 'card' && adjustingOperator(app) === def.id ? `${baseLabel} (adjusted)` : baseLabel;
      const coalescing = coalescingOf(def, args);
      const navigations = history.navigations;
      const scope = capture.begin();
      let value: unknown;
      let outcome: CaptureOutcome = { kind: 'none' };
      applying++;
      applied = true;
      try {
        if (def.flags?.undo === true) {
          const meta = {
            label,
            selectionBefore: selectionSnapshot(rollback.selection, rollback.model),
            ...(coalescing === null ? {} : { coalesceKey: coalescing.key, coalesceMs: coalescing.ms }),
          };
          value = store.transact(meta, (tx) => {
            const result = def.apply({ ...opCtx, tx }, args, prepared);
            const after = session.getState();
            tx.annotate({ selectionAfter: selectionSnapshot(after.selection, after.model) });
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
      let stepId: number | null = null;
      if (history.navigations === navigations && !scope.loaded && !duringGesture) {
        const topBefore = history.topId();
        recordStep(label, rollback, where, outcome, coalescing);
        const top = history.topId();
        // A coalesced run keeps the top step's id: it is still the step this run recorded into.
        if (top !== null && (top !== topBefore || outcome.kind === 'coalesced')) stepId = top;
      }
      recordLastRun({ def, args, ctx, value, stepId, before, seedBefore });
      extrudeAfterRun(app, def, ctx, stepId);
      return { status: 'finished', value } as const;
    } catch (error) {
      if (rollback !== null) session.setState(rollback, true);
      if (applied) reconcileMeshes(app);
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
