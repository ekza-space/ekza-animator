// Editor history (ADR 0013, MVP-SPEC §4.11.0): steps that own a document undo entry (`docTxId`) and/or a session
// override delta. A step's document part is undone only while its entry is the top of the doc undo stack; its
// override part only while the character still shows the same clip at the same clip frame.
//
// M-AI (MCP-SPEC §4.1, runner rules 3–4):
// - A step recorded by an actor run carries `actor` and `changes` (the document changes of its transaction, for
//   `edit.revertSteps`). The history keeps at most `CHANGE_JOURNAL_CAP` change records across all steps; above that
//   the oldest steps lose their `changes` (they can no longer be reverted selectively; plain undo still works). A step
//   takes its `changes` with it when it leaves the history, and loses them with its doc part.
// - Override-only coalescing requires both steps to have no actor, so a user nudge never merges into an agent step
//   and an agent step never merges into a user step.
// - `entries()` returns frozen copies of both stacks, oldest first (redo: the next redo first).
import type { Disposer } from '@ekza-animator/anim-core';
import type { CharacterId, DocumentStore, UndoResult } from '@ekza-animator/doc';
import type { EditorHistory, HistoryResult, HistoryStep, OverrideDelta, SessionStore } from '../types';
import { applyOverrideValues, mergeDeltas, type OverrideLocation, sameLocation, withoutControls } from './overrides';

/** Default window in which override-only steps with the same coalesce key merge (doc steps follow the store's). */
export const HISTORY_COALESCE_MS = 1_000;
/** Oldest steps beyond this are dropped (the doc undo stack keeps 500 entries by default). */
export const HISTORY_LIMIT = 1_000;
/** M-AI runner rule 3: change records the history keeps in actor steps' `changes`, in total. */
export const CHANGE_JOURNAL_CAP = 200_000;

export interface KernelHistory extends EditorHistory {
  /** Number of undo/redo navigations so far (the runner records no step for an operator that navigated). */
  readonly navigations: number;
  /** `record` with the coalescing window of override-only steps (default `HISTORY_COALESCE_MS`). */
  record(step: Omit<HistoryStep, 'id' | 'at'>, coalesceMs?: number): void;
  /** True when a step owns the doc entry. */
  owns(docTxId: string): boolean;
  /** Id of the top undo step without reconciling first (the runner reports the step it recorded), null when empty. */
  topId(): number | null;
  /** The doc entry no longer exists (coalesced edits cancelled out): steps lose their doc part. */
  forgetDocEntry(docTxId: string): void;
  /** The doc undo stacks were emptied: every step loses its doc part; steps left empty disappear. */
  forgetDocEntries(): void;
}

export interface HistoryContext {
  readonly store: DocumentStore;
  readonly session: SessionStore;
  readonly now: () => number;
  /** Current clip and clip frame of a character (null without an active clip). */
  locate(character: CharacterId): OverrideLocation | null;
  /** Applies a doc entry's selection snapshot (undo: selectionBefore, redo: selectionAfter). */
  restoreSelection(snapshot: unknown): void;
  /** Runs before every read or navigation, so pending direct commits are attributed first. */
  reconcile(): void;
  /** Runs after the doc undo stack was navigated (whether or not the store emitted a batch). */
  navigated(): void;
  readonly limit?: number;
  /** M-AI: total change records kept in steps' `changes` (default `CHANGE_JOURNAL_CAP`). */
  readonly journalCap?: number;
}

/** Override-only coalescing never crosses actors (runner rule 4): both steps must be user steps. */
function hasActor(step: { readonly actor?: unknown }): boolean {
  return step.actor !== undefined && step.actor !== null;
}

export function createEditorHistory(ctx: HistoryContext): KernelHistory {
  const undoSteps: HistoryStep[] = [];
  const redoSteps: HistoryStep[] = [];
  const listeners = new Set<() => void>();
  const limit = ctx.limit ?? HISTORY_LIMIT;
  const journalCap = ctx.journalCap ?? CHANGE_JOURNAL_CAP;
  let nextId = 1;
  let navigations = 0;

  const notify = (): void => {
    for (const listener of listeners) listener();
  };

  const restoreOverrides = (delta: OverrideDelta, direction: 'undo' | 'redo'): boolean => {
    if (!sameLocation(ctx.locate(delta.character), delta)) return false;
    const values = direction === 'undo' ? delta.before : delta.after;
    const touched = new Set([...delta.before.keys(), ...delta.after.keys()]);
    ctx.session.setState({ overrides: applyOverrideValues(ctx.session.getState().overrides, touched, values) });
    return true;
  };

  const navigate = (direction: 'undo' | 'redo'): HistoryResult | null => {
    ctx.reconcile();
    const from = direction === 'undo' ? undoSteps : redoSteps;
    const to = direction === 'undo' ? redoSteps : undoSteps;
    const step = from.at(-1);
    if (step === undefined) return null;
    const warnings: string[] = [];
    let doc: UndoResult | null = null;
    if (step.docTxId !== null) {
      const undo = ctx.store.undo;
      const top = direction === 'undo' ? undo.peekUndo() : undo.peekRedo();
      if (top?.txId === step.docTxId) {
        // May throw (preview active, read-only store): the stacks stay unchanged then.
        doc = direction === 'undo' ? undo.undo() : undo.redo();
        ctx.navigated();
      } else {
        warnings.push(`'${step.label}': the document change is no longer on the undo stack; skipped`);
      }
    }
    from.pop();
    to.push(step);
    navigations++;
    if (doc !== null) {
      if (doc.selection !== undefined) ctx.restoreSelection(doc.selection);
      if (doc.skipped.length > 0) {
        warnings.push(`'${step.label}': ${doc.skipped.length} change(s) were edited since and were not reverted`);
      }
    }
    let overridesRestored = false;
    if (step.overrides !== null) {
      overridesRestored = restoreOverrides(step.overrides, direction);
      if (!overridesRestored) warnings.push(`'${step.label}': the pose edit belongs to another frame or clip; skipped`);
    }
    notify();
    return { label: step.label, doc, overridesRestored, warnings };
  };

  const isEmpty = (step: HistoryStep): boolean => step.docTxId === null && step.overrides === null;

  /** A step without its doc part also loses its `changes` (they describe that doc part). */
  const withoutDocPart = (step: HistoryStep): HistoryStep => {
    const next: HistoryStep = { ...step, docTxId: null };
    return next.changes === undefined || next.changes === null ? next : { ...next, changes: null };
  };

  /** Runner rule 3: above the cap, the oldest steps (undo oldest first, then redo) lose their `changes`. */
  const capJournal = (): void => {
    let total = 0;
    for (const step of undoSteps) total += step.changes?.length ?? 0;
    for (const step of redoSteps) total += step.changes?.length ?? 0;
    if (total <= journalCap) return;
    // Oldest first: the undo stack from the bottom, then the redo stack from the step undone last (its bottom).
    const order: [HistoryStep[], number][] = [
      ...undoSteps.map((_, i) => [undoSteps, i] as [HistoryStep[], number]),
      ...redoSteps.map((_, i) => [redoSteps, i] as [HistoryStep[], number]).reverse(),
    ];
    for (const [steps, i] of order) {
      if (total <= journalCap) break;
      const step = steps[i] as HistoryStep;
      const size = step.changes?.length ?? 0;
      if (size === 0) continue;
      steps[i] = Object.freeze({ ...step, changes: null });
      total -= size;
    }
  };

  const prune = (steps: HistoryStep[], edit: (step: HistoryStep) => HistoryStep): boolean => {
    let changed = false;
    for (let i = steps.length - 1; i >= 0; i--) {
      const step = steps[i] as HistoryStep;
      const next = edit(step);
      if (next === step) continue;
      changed = true;
      if (isEmpty(next)) steps.splice(i, 1);
      else steps[i] = Object.freeze(next);
    }
    return changed;
  };

  const history: KernelHistory = {
    get navigations() {
      return navigations;
    },
    canUndo(): boolean {
      ctx.reconcile();
      return undoSteps.length > 0;
    },
    canRedo(): boolean {
      ctx.reconcile();
      return redoSteps.length > 0;
    },
    peekUndo(): HistoryStep | null {
      ctx.reconcile();
      return undoSteps.at(-1) ?? null;
    },
    peekRedo(): HistoryStep | null {
      ctx.reconcile();
      return redoSteps.at(-1) ?? null;
    },
    undo: () => navigate('undo'),
    redo: () => navigate('redo'),
    record(step: Omit<HistoryStep, 'id' | 'at'>, coalesceMs: number = HISTORY_COALESCE_MS): void {
      if (step.docTxId === null && step.overrides === null) return;
      const now = ctx.now();
      const top = undoSteps.at(-1);
      const sameDocEntry = step.docTxId !== null && top?.docTxId === step.docTxId;
      const sameKey =
        step.docTxId === null &&
        top !== undefined &&
        top.docTxId === null &&
        !hasActor(step) &&
        !hasActor(top) &&
        step.coalesceKey !== undefined &&
        top.coalesceKey === step.coalesceKey &&
        now - top.at <= coalesceMs;
      if (top !== undefined && (sameDocEntry || sameKey)) {
        undoSteps[undoSteps.length - 1] = Object.freeze({
          ...top,
          overrides: mergeDeltas(top.overrides, step.overrides),
          at: now,
        });
      } else {
        // A doc entry belongs to one step: a later step that extends it (store coalescing past an override-only
        // step) takes it over.
        if (step.docTxId !== null) history.forgetDocEntry(step.docTxId);
        undoSteps.push(Object.freeze({ ...step, id: nextId++, at: now }));
        if (undoSteps.length > limit) undoSteps.splice(0, undoSteps.length - limit);
      }
      redoSteps.length = 0;
      if (step.changes !== undefined && step.changes !== null && step.changes.length > 0) capJournal();
      notify();
    },
    dropOverrides(where): void {
      const controls = where.controls === undefined ? null : new Set(where.controls);
      const matches = (delta: OverrideDelta): boolean =>
        (where.character === undefined || delta.character === where.character) &&
        (where.clip === undefined || delta.clip === where.clip);
      const touches = (delta: OverrideDelta): boolean =>
        controls === null || [...delta.before.keys(), ...delta.after.keys()].some((control) => controls.has(control));
      const edit = (step: HistoryStep): HistoryStep => {
        if (step.overrides === null || !matches(step.overrides) || !touches(step.overrides)) return step;
        return { ...step, overrides: controls === null ? null : withoutControls(step.overrides, controls) };
      };
      const changedUndo = prune(undoSteps, edit);
      const changedRedo = prune(redoSteps, edit);
      if (changedUndo || changedRedo) notify();
    },
    clear(): void {
      if (undoSteps.length === 0 && redoSteps.length === 0) return;
      undoSteps.length = 0;
      redoSteps.length = 0;
      notify();
    },
    subscribe(listener: () => void): Disposer {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    entries() {
      ctx.reconcile();
      return { undo: Object.freeze([...undoSteps]), redo: Object.freeze([...redoSteps].reverse()) };
    },
    topId: () => undoSteps.at(-1)?.id ?? null,
    owns: (docTxId: string) =>
      undoSteps.some((step) => step.docTxId === docTxId) || redoSteps.some((step) => step.docTxId === docTxId),
    forgetDocEntry(docTxId: string): void {
      const edit = (step: HistoryStep): HistoryStep => (step.docTxId === docTxId ? withoutDocPart(step) : step);
      const changedUndo = prune(undoSteps, edit);
      const changedRedo = prune(redoSteps, edit);
      if (changedUndo || changedRedo) notify();
    },
    forgetDocEntries(): void {
      const edit = (step: HistoryStep): HistoryStep => (step.docTxId === null ? step : withoutDocPart(step));
      const changedUndo = prune(undoSteps, edit);
      const changedRedo = prune(redoSteps, edit);
      if (changedUndo || changedRedo) notify();
    },
  };
  return history;
}
