// Recording operator registry and runner of the fake app (MVP-SPEC §4.11.0 operator runner): every run is recorded,
// registered operators run through poll → prepare → poll → apply (one transaction when flags.undo) → history.
import { type Disposer, EkzaError } from '@ekza-animator/anim-core';
import type { CharacterId, ChannelValues, ControlId, DocumentStore, UndoEntry } from '@ekza-animator/doc';
import type {
  EditorApp,
  OperatorContext,
  OperatorDef,
  OperatorRegistry,
  OperatorResult,
  OverrideDelta,
  PollResult,
  RunContext,
  SessionState,
  SessionStore,
} from '../types';
import type { FakeEditorHistory } from './history';
import { snapshotSelection } from './session';

type AnyOperator = OperatorDef<unknown, unknown, unknown>;

export interface RecordedCall {
  readonly id: string;
  readonly args: unknown;
}

export interface FakeOperators {
  readonly registry: OperatorRegistry;
  readonly calls: readonly RecordedCall[];
  /** `app.runUntyped`: synchronous `nested-run` check, then the asynchronous runner. */
  run(id: string, args: unknown, ctx: RunContext | undefined): Promise<OperatorResult<unknown>>;
}

export function createFakeOperators(deps: {
  readonly app: () => EditorApp;
  readonly store: DocumentStore;
  readonly session: SessionStore;
  readonly history: FakeEditorHistory;
  /** Active clip and clip frame of a character, for override deltas. */
  readonly clipFrameOf: (
    character: CharacterId,
  ) => { readonly clip: OverrideDelta['clip']; readonly frame: number } | null;
}): FakeOperators {
  const operators = new Map<string, AnyOperator>();
  const calls: RecordedCall[] = [];
  let applying = 0;

  const contextOf = (ctx: RunContext | undefined): OperatorContext => ({
    app: deps.app(),
    panel: ctx?.panel ?? null,
    paneId: ctx?.paneId ?? null,
  });

  const registry: OperatorRegistry = {
    register<A, R, P>(def: OperatorDef<A, R, P>): Disposer {
      if (operators.has(def.id)) throw new EkzaError('unsupported', `Operator '${def.id}' is already registered`);
      const stored = def as unknown as AnyOperator;
      operators.set(def.id, stored);
      return () => {
        if (operators.get(def.id) === stored) operators.delete(def.id);
      };
    },
    get: (id: string) => operators.get(id),
    list: () => [...operators.values()],
    poll(id: string, ctx?: RunContext, args?: unknown): PollResult {
      const def = operators.get(id);
      if (def === undefined) return { ok: false, reason: `unknown operator '${id}'` };
      return def.poll?.(contextOf(ctx), args) ?? true;
    },
  };

  const execute = async (
    def: AnyOperator,
    args: unknown,
    ctx: RunContext | undefined,
  ): Promise<OperatorResult<unknown>> => {
    const opCtx = contextOf(ctx);
    let rollback: SessionState | null = null;
    try {
      const first = def.poll?.(opCtx, args) ?? true;
      if (first !== true) return { status: 'cancelled', reason: first.reason };
      const prepared = await def.prepare?.(opCtx, args);
      const second = def.poll?.(opCtx, args) ?? true;
      if (second !== true) return { status: 'cancelled', reason: second.reason };
      if (deps.store.preview?.active === true) return { status: 'cancelled', reason: 'gesture in progress' };

      rollback = deps.session.getState();
      const undoTop = deps.store.undo.peekUndo();
      const navigations = deps.history.navigations;
      const label = def.undoLabel?.(args) ?? def.label;
      const localTxIds = new Set<string>();
      const unsubscribe = deps.store.subscribe((batch) => {
        if (batch.origin === 'local') localTxIds.add(batch.txId);
      });
      applying++;
      let value: unknown;
      try {
        if (def.flags?.undo === true) {
          value = deps.store.transact({ label, selectionBefore: snapshotSelection(rollback.selection) }, (tx) => {
            const result = def.apply({ ...opCtx, tx }, args, prepared);
            tx.annotate({ selectionAfter: snapshotSelection(deps.session.getState().selection) });
            return result;
          });
        } else {
          value = def.apply({ ...opCtx, tx: null }, args, prepared);
        }
      } finally {
        applying--;
        unsubscribe();
      }

      // An operator that navigated the editor history (edit.undo/redo) adds no step of its own: the restored
      // overrides and the doc undo/redo would otherwise be recorded as a new step and clear the redo stack.
      if (deps.history.navigations === navigations) {
        const docTxId = newDocEntry(undoTop, deps.store.undo.peekUndo(), localTxIds);
        const overrides = overrideDelta(rollback, deps.session.getState(), deps.clipFrameOf);
        if (docTxId !== null || overrides !== null) deps.history.record({ label, docTxId, overrides });
      }
      return { status: 'finished', value };
    } catch (error) {
      if (rollback !== null) deps.session.setState(rollback, true);
      return {
        status: 'failed',
        error: {
          code: error instanceof EkzaError ? error.code : 'internal',
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  };

  return {
    registry,
    calls,
    run(id: string, args: unknown, ctx: RunContext | undefined): Promise<OperatorResult<unknown>> {
      if (applying > 0) throw new EkzaError('nested-run', `app.run('${id}') inside an operator's apply`);
      calls.push({ id, args });
      const def = operators.get(id);
      if (def === undefined) return Promise.resolve({ status: 'cancelled', reason: `unknown operator '${id}'` });
      return execute(def, args, ctx);
    },
  };
}

/**
 * The txId of the doc undo entry that `apply` created or extended: the top entry after apply, if a local batch
 * committed during apply produced it or was coalesced into it in place (same txId, new entry object). Undo/redo
 * batches and `undoable: false` commits never qualify.
 */
function newDocEntry(
  before: UndoEntry | null,
  after: UndoEntry | null,
  localTxIds: ReadonlySet<string>,
): string | null {
  if (after === null || localTxIds.size === 0) return null;
  if (localTxIds.has(after.txId)) return after.txId;
  return after !== before && after.txId === before?.txId ? after.txId : null;
}

/** Override changes between two session states, for the active character's clip frame; null when unchanged. */
function overrideDelta(
  before: SessionState,
  after: SessionState,
  clipFrameOf: (character: CharacterId) => { readonly clip: OverrideDelta['clip']; readonly frame: number } | null,
): OverrideDelta | null {
  if (before.overrides === after.overrides) return null;
  const character = after.activeCharacter;
  const where = character === null ? null : clipFrameOf(character);
  if (character === null || where === null) return null;
  const changedBefore = new Map<ControlId, ChannelValues>();
  const changedAfter = new Map<ControlId, ChannelValues>();
  for (const control of new Set([...before.overrides.keys(), ...after.overrides.keys()])) {
    const a = before.overrides.get(control);
    const b = after.overrides.get(control);
    if (a === b) continue;
    if (a !== undefined) changedBefore.set(control, a);
    if (b !== undefined) changedAfter.set(control, b);
  }
  if (changedBefore.size === 0 && changedAfter.size === 0) return null;
  return { character, clip: where.clip, clipFrame: where.frame, before: changedBefore, after: changedAfter };
}
