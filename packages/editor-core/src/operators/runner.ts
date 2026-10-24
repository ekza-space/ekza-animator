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
import { coerceArgs, EkzaError } from '@ekza-studio/anim-core';
import type { AnyChange, DocumentStore } from '@ekza-studio/doc';
import { bindCapture } from '../edit/capture';
import { rigRunRefusal } from '../evaluation/rigSource';
import type { CaptureOutcome, DocCapture } from '../history/capture';
import type { KernelHistory } from '../history/history';
import { type OverrideLocation, overrideDelta, sameLocation } from '../history/overrides';
import { runSeedOf } from '../mesh/seed';
import { migrateLegacyArgs } from '../prefs/legacy';
import { ownerOfControl } from '../session/location';
import { selectionSnapshot } from '../session/selection';
import type {
  EditorApp,
  OperatorAction,
  OperatorDef,
  OperatorRegistry,
  OperatorResult,
  RunActor,
  RunContext,
  RunSource,
  SessionState,
  SessionStore,
} from '../types';
import { extrudeAfterRun, extrudeBeforeRun } from './builtin/extrudeSession';
import { adjustingOperator, attachLastRunTracker, recordLastRun as recordLastRunOf } from './builtin/lastop';
import { pendingModelOperator } from './builtin/modelOps';
import { type AnyOperatorDef, beforeDocumentRun, operatorContext, unknownOperator } from './registry';
import { lazyOperatorChunk } from '../workspaces/rig';
import { loadActorKit } from './scope';

/** Runner rule 1: the reason of a run its `signal` stopped. */
export const CANCELLED_BY_AGENT = 'cancelled by the agent';
/** Runner rule 9 (and the shipped rule): the reason of a run refused while the user drags. */
export const GESTURE_IN_PROGRESS = 'gesture in progress';
/** Runner rule 2: the prefix of every actor step label, and the label's maximum length. */
export const AI_LABEL_PREFIX = 'AI: ';
export const AI_LABEL_MAX = 80;

function aborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

/** Consecutive runs with the same `key` within `ms` merge into one undo step (Channels panel ↑/↓ nudges). */
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

/** The way out an operator's error offers (`details.action`: a label and an operator id), else undefined. */
function actionOf(details: unknown): OperatorAction | undefined {
  if (!isPlainRecord(details) || !isPlainRecord(details['action'])) return undefined;
  const { label, op, args } = details['action'];
  if (typeof label !== 'string' || typeof op !== 'string' || !op.includes('.')) return undefined;
  const id = op as OperatorAction['op'];
  return args === undefined ? { label, op: id } : { label, op: id, args };
}

/**
 * The args an operator with `params` runs with (§4.6): the option box's defaults for UI runs, the given args over
 * them, validated by `coerceArgs` (clamping, int rounding, enum/axis membership, `data` schemas; `extraArgs` passed
 * through untouched, every other unknown key dropped). Only the keys the run was given (or the option box supplied)
 * reach the operator: the defaults of absent params stay the operator's to resolve (the kernel's nullable "auto"
 * and selection-bound values, the primitives' `prefs.modeling.primitiveDefaults` set; M6A-B11-2).
 */
export function coerceRunArgs(app: EditorApp, def: AnyOperatorDef, raw: unknown, ctx: RunContext | undefined): unknown {
  if (def.params === undefined) return migrateLegacyArgs(def.id, raw);
  const source = ctx?.source;
  const defaults =
    source !== undefined && UI_SOURCES.has(source) ? app.prefs.getState().modeling.optionDefaults[def.id] : undefined;
  const given: Readonly<Record<string, unknown>> = isPlainRecord(raw) ? raw : {};
  // Renamed enum ids (DECISIONS-OPEN TM-1) in the given args or the saved option box read as their current ids.
  const input = migrateLegacyArgs(def.id, defaults === undefined ? given : { ...defaults, ...given }) as Readonly<
    Record<string, unknown>
  >;
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

  const execute = async (def: AnyOperatorDef, rawArgs: unknown, ctx: RunContext | undefined) => {
    // M6a (M6A-INT-13): a Model operator proxy runs once its chunk has loaded (the proxy is then the operator).
    const loading = pendingModelOperator(def);
    if (loading !== null) {
      try {
        await loading;
      } catch (error) {
        return {
          status: 'failed',
          error: { code: 'unavailable', message: error instanceof Error ? error.message : String(error) },
        } as const;
      }
    }
    const app = deps.app();
    // The card's tracker binds here once its chunk has loaded (the recorder loads it, §5.27).
    attachLastRunTracker(app, false);
    bindCapture(app);
    const opCtx = operatorContext(app, ctx);
    const actor = ctx?.actor ?? null;
    const signal = ctx?.signal;
    // Runner rule 6: 'view' runs may change what the user sees; every other actor run is checked.
    const checked = actor !== null && ctx?.access !== 'view';
    const before = session.getState();
    const seedBefore = runSeedOf(app);
    let rollback: SessionState | null = null;
    let applied = false;
    try {
      if (aborted(signal)) return cancelled(CANCELLED_BY_AGENT);
      // Actor runs load their helpers first (a lazy chunk; MCP-SPEC §0.4), then check the signal again.
      const kit = actor === null ? null : await loadActorKit();
      if (aborted(signal)) return cancelled(CANCELLED_BY_AGENT);
      const args = coerceRunArgs(app, def, rawArgs, ctx);
      // M6b C7 (§5.17, §5.24): keying and curve edits are refused in Rig & Skin, whichever surface runs them (and
      // every document edit while the window is narrower than 1024 px).
      const refused = rigRunRefusal(app, def);
      if (refused !== null) return cancelled(refused);
      const first = def.poll?.(opCtx, args) ?? true;
      if (first !== true) return cancelled(first.reason);
      // M6a (§5.8; B12b): the extrude session ends at the start of the gesture that ends it, before it reads the mesh.
      extrudeBeforeRun(app, def, args, ctx);
      // M6b C0 hook (§0.5): before a document run (and edit.undo / edit.redo) the listeners run, e.g. the clip
      // library stops its preview so a key is never sampled from the preview pose.
      if (def.flags?.undo === true || def.id === 'edit.undo' || def.id === 'edit.redo') {
        beforeDocumentRun(deps.registry, def.id);
      }
      let prepared = def.prepare === undefined ? undefined : def.prepare(opCtx, args);
      if (isThenable(prepared)) prepared = await prepared;
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
      // §5.7: the re-run of `edit.adjustLast` replaces the step under the label "<label> (adjusted)".
      const label =
        kit !== null
          ? kit.actorLabel(baseLabel)
          : ctx?.source === 'card' && adjustingOperator(app) === def.id
            ? `${baseLabel} (adjusted)`
            : baseLabel;
      // Runner rule 4: actor runs never coalesce.
      const coalescing = actor === null ? coalescingOf(def, args) : null;
      const navigations = history.navigations;
      const scope = capture.begin();
      // Runner rule 6: recorded right before apply, by reference.
      const recorded = checked && kit !== null ? kit.recordSession(app) : null;
      let value: unknown;
      let outcome: CaptureOutcome = { kind: 'none' };
      applying++;
      applied = true;
      try {
        if (def.flags?.undo === true) {
          // Runner rule 5: actor runs carry no selection snapshots.
          const meta = {
            label,
            ...(actor === null ? { selectionBefore: selectionSnapshot(rollback.selection, rollback.model) } : {}),
            ...(coalescing === null ? {} : { coalesceKey: coalescing.key, coalesceMs: coalescing.ms }),
          };
          value = store.transact(meta, (tx) => {
            const result = def.apply({ ...opCtx, tx: kit === null ? tx : kit.actorTx(tx) }, args, prepared);
            // Inside the transaction, before the commit: the keeper's reactions to the batch are not counted.
            if (recorded !== null && kit !== null) kit.checkSession(app, def.id, recorded);
            if (actor === null) {
              const after = session.getState();
              tx.annotate({ selectionAfter: selectionSnapshot(after.selection, after.model) });
            }
            return result;
          });
        } else {
          value = def.apply({ ...opCtx, tx: null }, args, prepared);
          if (recorded !== null && kit !== null) kit.checkSession(app, def.id, recorded);
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
        const attribution = actor === null ? null : { actor, changes: scope.batches.flatMap((batch) => batch.changes) };
        recordStep(label, rollback, where, outcome, coalescing, attribution);
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
      const action = error instanceof EkzaError ? actionOf(error.details) : undefined;
      return {
        status: 'failed',
        error: {
          code: error instanceof EkzaError ? error.code : 'internal',
          message: error instanceof Error ? error.message : String(error),
          ...(action === undefined ? {} : { action }),
        },
      } as const;
    }
  };

  return {
    run(id: string, args: unknown, ctx: RunContext | undefined): Promise<OperatorResult<unknown>> {
      if (applying > 0) throw new EkzaError('nested-run', `app.run('${id}') inside an operator's apply`);
      const def = deps.registry.get(id);
      if (def === undefined) {
        // M6b (§2.1): an id of a lazy chunk (rig-workspace, clip-library) loads its chunk first, then runs.
        const chunk = lazyOperatorChunk(deps.app(), id);
        if (chunk === null) return Promise.resolve(cancelled(unknownOperator(id)));
        return chunk.then(
          () => {
            const loaded = deps.registry.get(id);
            return loaded === undefined ? cancelled(unknownOperator(id)) : execute(loaded, args, ctx);
          },
          (error: unknown) =>
            ({
              status: 'failed',
              error: { code: 'unavailable', message: error instanceof Error ? error.message : String(error) },
            }) as const,
        );
      }
      return execute(def, args, ctx);
    },
  };
}

function cancelled(reason: string): OperatorResult<never> {
  return { status: 'cancelled', reason };
}
