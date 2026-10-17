// Editor history (ADR 0013, MVP-SPEC §4.11.0): steps that own a document undo entry (`docTxId`) and/or a session
// override delta. A step's document part is undone only while its entry is the top of the doc undo stack; its
// override part only while the character still shows the same clip at the same clip frame.
import type { Disposer } from '@ekza-animator/anim-core';
import type { CharacterId, DocumentStore, UndoResult } from '@ekza-animator/doc';
import type { EditorHistory, HistoryResult, HistoryStep, OverrideDelta, SessionStore } from '../types';
import { applyOverrideValues, mergeDeltas, type OverrideLocation, sameLocation, withoutControls } from './overrides';

/** Default window in which override-only steps with the same coalesce key merge (doc steps follow the store's). */
export const HISTORY_COALESCE_MS = 1_000;
/** Oldest steps beyond this are dropped (the doc undo stack keeps 500 entries by default). */
export const HISTORY_LIMIT = 1_000;

export interface KernelHistory extends EditorHistory {
  /** Number of undo/redo navigations so far (the runner records no step for an operator that navigated). */
  readonly navigations: number;
  /** `record` with the coalescing window of override-only steps (default `HISTORY_COALESCE_MS`). */
  record(step: Omit<HistoryStep, 'id' | 'at'>, coalesceMs?: number): void;
  /** True when a step owns the doc entry. */
  owns(docTxId: string): boolean;
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
}

export function createEditorHistory(ctx: HistoryContext): KernelHistory {
  const undoSteps: HistoryStep[] = [];
  const redoSteps: HistoryStep[] = [];
  const listeners = new Set<() => void>();
  const limit = ctx.limit ?? HISTORY_LIMIT;
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

  const prune = (steps: HistoryStep[], edit: (step: HistoryStep) => HistoryStep): boolean => {
    let changed = false;
    for (let i = steps.length - 1; i >= 0; i--) {
      const step = steps[i] as HistoryStep;
      const next = edit(step);
      if (next === step) continue;
      changed = true;
      if (isEmpty(next)) steps.splice(i, 1);
      else steps[i] = next;
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
        step.coalesceKey !== undefined &&
        top.coalesceKey === step.coalesceKey &&
        now - top.at <= coalesceMs;
      if (top !== undefined && (sameDocEntry || sameKey)) {
        undoSteps[undoSteps.length - 1] = { ...top, overrides: mergeDeltas(top.overrides, step.overrides), at: now };
      } else {
        // A doc entry belongs to one step: a later step that extends it (store coalescing past an override-only
        // step) takes it over.
        if (step.docTxId !== null) history.forgetDocEntry(step.docTxId);
        undoSteps.push({ ...step, id: nextId++, at: now });
        if (undoSteps.length > limit) undoSteps.splice(0, undoSteps.length - limit);
      }
      redoSteps.length = 0;
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
    owns: (docTxId: string) =>
      undoSteps.some((step) => step.docTxId === docTxId) || redoSteps.some((step) => step.docTxId === docTxId),
    forgetDocEntry(docTxId: string): void {
      const edit = (step: HistoryStep): HistoryStep => (step.docTxId === docTxId ? { ...step, docTxId: null } : step);
      const changedUndo = prune(undoSteps, edit);
      const changedRedo = prune(redoSteps, edit);
      if (changedUndo || changedRedo) notify();
    },
    forgetDocEntries(): void {
      const edit = (step: HistoryStep): HistoryStep => (step.docTxId === null ? step : { ...step, docTxId: null });
      const changedUndo = prune(undoSteps, edit);
      const changedRedo = prune(redoSteps, edit);
      if (changedUndo || changedRedo) notify();
    },
  };
  return history;
}
