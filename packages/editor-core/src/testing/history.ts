// Editor history of the fake app (ADR 0013, MVP-SPEC §4.11.0): steps own a document undo entry and/or a session
// override delta. A step's document part is undone only while its entry is still on top of the doc undo stack.
import type { Disposer, Frame } from '@ekza-animator/anim-core';
import type { ChannelValues, ClipId, ControlId, DocumentStore, UndoResult } from '@ekza-animator/doc';
import type { EditorHistory, HistoryResult, HistoryStep, OverrideDelta, SessionStore } from '../types';
import { selectionFromSnapshot } from './session';

export interface HistoryContext {
  readonly store: DocumentStore;
  readonly session: SessionStore;
  readonly now: () => number;
  /** Active clip and clip frame of a character (null without an active clip). */
  readonly clipFrameOf: (
    character: OverrideDelta['character'],
  ) => { readonly clip: ClipId; readonly frame: Frame } | null;
}

/** The fake history plus a count of `undo`/`redo` calls, which the operator runner reads (see `operators.ts`). */
export interface FakeEditorHistory extends EditorHistory {
  readonly navigations: number;
}

export function createFakeHistory(ctx: HistoryContext): FakeEditorHistory {
  const undoSteps: HistoryStep[] = [];
  const redoSteps: HistoryStep[] = [];
  const listeners = new Set<() => void>();
  let nextId = 1;
  let navigations = 0;
  const notify = (): void => {
    for (const listener of listeners) listener();
  };

  const restoreOverrides = (delta: OverrideDelta, values: ReadonlyMap<ControlId, ChannelValues>): boolean => {
    const where = ctx.clipFrameOf(delta.character);
    if (where === null || where.clip !== delta.clip || where.frame !== delta.clipFrame) return false;
    const overrides = new Map(ctx.session.getState().overrides);
    for (const control of new Set([...delta.before.keys(), ...delta.after.keys()])) {
      const value = values.get(control);
      if (value === undefined) overrides.delete(control);
      else overrides.set(control, value);
    }
    ctx.session.setState({ overrides });
    return true;
  };

  const apply = (step: HistoryStep, direction: 'undo' | 'redo'): HistoryResult => {
    const warnings: string[] = [];
    let doc: UndoResult | null = null;
    if (step.docTxId !== null) {
      const undo = ctx.store.undo;
      const top = direction === 'undo' ? undo.peekUndo() : undo.peekRedo();
      if (top?.txId === step.docTxId) {
        doc = direction === 'undo' ? undo.undo() : undo.redo();
        const selection = selectionFromSnapshot(doc?.selection);
        if (selection !== null) ctx.session.setState({ selection });
      } else {
        warnings.push(`'${step.label}': the document change is no longer on top of the undo stack; skipped`);
      }
    }
    let overridesRestored = false;
    if (step.overrides !== null) {
      const values = direction === 'undo' ? step.overrides.before : step.overrides.after;
      overridesRestored = restoreOverrides(step.overrides, values);
      if (!overridesRestored) warnings.push(`'${step.label}': the pose edit belongs to another frame or clip; skipped`);
    }
    return { label: step.label, doc, overridesRestored, warnings };
  };

  return {
    get navigations() {
      return navigations;
    },
    canUndo: () => undoSteps.length > 0,
    canRedo: () => redoSteps.length > 0,
    peekUndo: () => undoSteps.at(-1) ?? null,
    peekRedo: () => redoSteps.at(-1) ?? null,
    undo(): HistoryResult | null {
      const step = undoSteps.pop();
      if (step === undefined) return null;
      navigations++;
      const result = apply(step, 'undo');
      redoSteps.push(step);
      notify();
      return result;
    },
    redo(): HistoryResult | null {
      const step = redoSteps.pop();
      if (step === undefined) return null;
      navigations++;
      const result = apply(step, 'redo');
      undoSteps.push(step);
      notify();
      return result;
    },
    record(step: Omit<HistoryStep, 'id' | 'at'>): void {
      const top = undoSteps.at(-1);
      // The store coalesced the transaction into the top doc entry, or an override-only edit repeats the top
      // step's coalesce key (e.g. Channel Box nudges): extend the top step instead of adding one.
      const sameDocEntry = step.docTxId !== null && top?.docTxId === step.docTxId;
      const sameKey = step.docTxId === null && step.coalesceKey !== undefined && top?.coalesceKey === step.coalesceKey;
      if (top !== undefined && (sameDocEntry || sameKey)) {
        undoSteps[undoSteps.length - 1] = {
          ...top,
          docTxId: step.docTxId ?? top.docTxId,
          overrides: mergeOverrides(top.overrides, step.overrides),
          at: ctx.now(),
        };
      } else {
        undoSteps.push({ ...step, id: nextId++, at: ctx.now() });
      }
      redoSteps.length = 0;
      notify();
    },
    dropOverrides(where): void {
      const matches = (delta: OverrideDelta): boolean =>
        (where.character === undefined || delta.character === where.character) &&
        (where.clip === undefined || delta.clip === where.clip);
      const prune = (steps: HistoryStep[]): void => {
        for (let i = steps.length - 1; i >= 0; i--) {
          const step = steps[i] as HistoryStep;
          if (step.overrides === null || !matches(step.overrides)) continue;
          const overrides = where.controls === undefined ? null : withoutControls(step.overrides, where.controls);
          if (overrides === null && step.docTxId === null) steps.splice(i, 1);
          else steps[i] = { ...step, overrides };
        }
      };
      prune(undoSteps);
      prune(redoSteps);
      notify();
    },
    clear(): void {
      undoSteps.length = 0;
      redoSteps.length = 0;
      notify();
    },
    subscribe(listener: () => void): Disposer {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** Two consecutive deltas as one: the earliest `before` and the latest `after` of every touched control. */
function mergeOverrides(first: OverrideDelta | null, second: OverrideDelta | null): OverrideDelta | null {
  if (first === null) return second;
  if (second === null) return first;
  const touchedFirst = new Set([...first.before.keys(), ...first.after.keys()]);
  const before = new Map(first.before);
  for (const [control, values] of second.before) if (!touchedFirst.has(control)) before.set(control, values);
  const after = new Map(first.after);
  for (const control of new Set([...second.before.keys(), ...second.after.keys()])) {
    const values = second.after.get(control);
    if (values === undefined) after.delete(control);
    else after.set(control, values);
  }
  return { ...second, before, after };
}

/** The delta without the given controls; null when nothing is left. */
function withoutControls(delta: OverrideDelta, controls: readonly ControlId[]): OverrideDelta | null {
  const drop = new Set(controls);
  const before = new Map([...delta.before].filter(([control]) => !drop.has(control)));
  const after = new Map([...delta.after].filter(([control]) => !drop.has(control)));
  return before.size === 0 && after.size === 0 ? null : { ...delta, before, after };
}
