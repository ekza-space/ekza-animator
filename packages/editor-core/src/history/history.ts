// Editor history (ADR 0013, MVP-SPEC §4.11.0): steps that own a document undo entry (`docTxId`) and/or a session
// override delta. A step's document part is undone only while its entry is the top of the doc undo stack; its
// override part only while the character still shows the same clip at the same clip frame.
//
// M6a (M6A-SPEC §4.6, §5.6; ADR 0013 extended by ADR 0016 D12):
// - Selection parts: `recordSelection` records a selection-only step ('Select', 'Hide', 'Show'). Every discrete
//   gesture is its own step; only a part that continues the previous gesture (`opts.repeat`: an auto-repeated
//   grow/shrink key, a continuous drag) merges into the top step when that step is a selection-only step of the same
//   kind and gesture and nothing was recorded or navigated since. A selection step clears redo in the history and in
//   the doc (`UndoManager.clearRedo()`). Undo restores the part's `before`, redo its `after` (through the context).
// - A step with only a selection part is not empty: `isEmpty` and pruning keep it.
// - Drops: steps leaving the history for good are reported to `onDrop` listeners (undo steps oldest first, then redo
//   steps next redo first; one call per event) with the reason — 'limit' (the step limit), 'clear', 'budget'
//   (`dropOldest`, the undo byte budget) and 'redo-cleared' (a new step cleared redo). Dropping undo steps that own
//   doc entries evicts the doc entries up to the newest of them (`UndoManager.evictOldest`), so no doc entry outlives
//   its step. Doc entries the doc evicts on its own (`onEvict`: its limit, `evictOldest`, `clear`, a load, a new
//   transaction or `clearRedo` clearing redo) take the doc part away from the steps that owned them; a step left
//   without any part leaves and is reported with the mapped reason (`DROP_REASON`). A doc 'redo-cleared' means a new
//   change was made: the whole history redo goes with it, as `record` would clear it next.
// - Pruning is not a drop: a step that loses its last part to pruning outside a doc eviction (its doc entry taken
//   over by a later step, cancelled out by coalescing, `forgetDocEntries`, `dropOverrides`) disappears without
//   `onDrop`; it holds nothing a drop listener releases (M6A-B0A-25).
//
// M6b (M6B-SPEC §4.6, §5.17; C0 working baseline): test-pose parts. `recordTestPose` records one step per gesture
// ('Test Pose'); undo applies the part's `before`, redo its `after` through the context (`restoreTestPose`, which
// writes the test pose without recording). `dropTestPoses` (leaving Rig & Skin) removes the parts like
// `dropOverrides`: steps left empty are pruned without `onDrop`.
//
// M-AI (MCP-SPEC §4.1, runner rules 3–4):
// - A step recorded by an actor run carries `actor` and `changes` (the document changes of its transaction, for
//   `edit.revertSteps`). The history keeps at most `CHANGE_JOURNAL_CAP` change records across all steps; above that
//   the oldest steps lose their `changes` (they can no longer be reverted selectively; plain undo still works). A step
//   takes its `changes` with it when it leaves the history, and loses them with its doc part.
// - Override-only coalescing requires both steps to have no actor, so a user nudge never merges into an agent step
//   and an agent step never merges into a user step.
// - `entries()` returns frozen copies of both stacks, oldest first (redo: the next redo first).
import { type Disposer, EkzaError } from '@ekza-studio/anim-core';
import type { CharacterId, DocumentStore, UndoEntry, UndoEvictReason, UndoResult } from '@ekza-studio/doc';
import type {
  EditorHistory,
  HistoryDropReason,
  HistoryResult,
  HistoryStep,
  OverrideDelta,
  SelectionPart,
  SessionStore,
  TestPosePart,
} from '../types';
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
  /** Id of the top undo step without reconciling first (the runner's LastRun hook), null when empty. */
  topId(): number | null;
  /** The steps, oldest first (undo: the next undo last; redo: the next redo first). */
  steps(): { readonly undo: readonly HistoryStep[]; readonly redo: readonly HistoryStep[] };
  /** Step labels, oldest first (undo: the next undo last; redo: the next redo first); the e2e `history()` read. */
  labels(): { readonly undo: readonly string[]; readonly redo: readonly string[] };
  /** The doc entry no longer exists (coalesced edits cancelled out): steps lose their doc part. */
  forgetDocEntry(docTxId: string): void;
  /** The doc undo stacks were emptied: every step loses its doc part; steps left empty disappear. */
  forgetDocEntries(): void;
  /** Stops listening to the doc undo manager. */
  dispose(): void;
}

export interface HistoryContext {
  readonly store: DocumentStore;
  readonly session: SessionStore;
  readonly now: () => number;
  /** Current clip and clip frame of a character (null without an active clip). */
  locate(character: CharacterId): OverrideLocation | null;
  /** Applies a doc entry's selection snapshot (undo: selectionBefore, redo: selectionAfter). */
  restoreSelection(snapshot: unknown): void;
  /** M6a: applies one side of a selection part (undo: `before`, redo: `after`); never changes mode or hilite. */
  restoreSelectionPart?(part: SelectionPart, side: 'before' | 'after'): readonly string[];
  /** M6b: applies one side of a test-pose part (undo: `before`, redo: `after`) without recording a step. */
  restoreTestPose?(part: TestPosePart, side: 'before' | 'after'): void;
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

type DropListener = (steps: readonly HistoryStep[], reason: HistoryDropReason) => void;

/** How a doc eviction is reported for the steps it empties (a document load clears like `clear`). */
const DROP_REASON: Readonly<Record<UndoEvictReason, HistoryDropReason>> = {
  limit: 'limit',
  budget: 'budget',
  'redo-cleared': 'redo-cleared',
  clear: 'clear',
  load: 'clear',
};

function isSelectionPart(part: unknown): part is SelectionPart {
  if (typeof part !== 'object' || part === null) return false;
  const kind = (part as { readonly kind?: unknown }).kind;
  const record = part as Readonly<Record<string, unknown>>;
  return (kind === 'select' || kind === 'hide') && 'before' in record && 'after' in record;
}

export function createEditorHistory(ctx: HistoryContext): KernelHistory {
  const undoSteps: HistoryStep[] = [];
  const redoSteps: HistoryStep[] = [];
  const listeners = new Set<() => void>();
  const dropListeners = new Set<DropListener>();
  const limit = ctx.limit ?? HISTORY_LIMIT;
  const journalCap = ctx.journalCap ?? CHANGE_JOURNAL_CAP;
  let nextId = 1;
  let navigations = 0;
  /** Id of the step `recordSelection` may merge a continuing part into (reset by any other recording or navigation). */
  let continuable: number | null = null;

  const notify = (): void => {
    for (const listener of listeners) listener();
  };

  const dropped = (steps: readonly HistoryStep[], reason: HistoryDropReason): void => {
    if (steps.length === 0) return;
    const frozen = Object.freeze([...steps]);
    for (const listener of Array.from(dropListeners)) listener(frozen, reason);
  };

  /** Doc entries owned by `steps` leave the doc undo stack too: everything up to the newest of them. */
  const evictDocEntriesOf = (steps: readonly HistoryStep[]): void => {
    const owned = new Set<string>();
    for (const step of steps) if (step.docTxId !== null) owned.add(step.docTxId);
    if (owned.size === 0) return;
    const entries: readonly UndoEntry[] = ctx.store.undo.entries().undo;
    let last = -1;
    for (let i = 0; i < entries.length; i++) if (owned.has((entries[i] as UndoEntry).txId)) last = i;
    if (last >= 0) ctx.store.undo.evictOldest(last + 1);
  };

  /** While the history evicts doc entries itself: steps the doc eviction empties, reported with the history's drop. */
  let collecting: HistoryStep[] | null = null;

  /** Drops the `n` oldest undo steps (and their doc entries) for `reason`. */
  const dropOldestSteps = (n: number, reason: 'limit' | 'budget'): void => {
    if (n <= 0 || undoSteps.length === 0) return;
    const removed = undoSteps.splice(0, Math.min(n, undoSteps.length));
    const outer = collecting;
    collecting = removed;
    try {
      evictDocEntriesOf(removed);
    } finally {
      collecting = outer;
    }
    dropped(removed, reason);
  };

  /** Drops every redo step ('redo-cleared'); true when there was any. */
  const clearRedoSteps = (): boolean => {
    if (redoSteps.length === 0) return false;
    // Next redo first, like the doc's `entries().redo`.
    const removed = [...redoSteps].reverse();
    redoSteps.length = 0;
    dropped(removed, 'redo-cleared');
    return true;
  };

  const push = (step: HistoryStep): void => {
    undoSteps.push(step);
    if (undoSteps.length > limit) dropOldestSteps(undoSteps.length - limit, 'limit');
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
    continuable = null;
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
    if (step.selection !== undefined && step.selection !== null && ctx.restoreSelectionPart !== undefined) {
      warnings.push(...ctx.restoreSelectionPart(step.selection, direction === 'undo' ? 'before' : 'after'));
    }
    if (step.testPose !== undefined && step.testPose !== null) {
      ctx.restoreTestPose?.(step.testPose, direction === 'undo' ? 'before' : 'after');
    }
    notify();
    return { label: step.label, doc, overridesRestored, warnings };
  };

  const isEmpty = (step: HistoryStep): boolean =>
    step.docTxId === null &&
    step.overrides === null &&
    (step.selection === undefined || step.selection === null) &&
    (step.testPose === undefined || step.testPose === null);

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
      steps[i] = { ...step, changes: null };
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
      else steps[i] = next;
    }
    return changed;
  };

  const forgetDocEntry = (docTxId: string): void => {
    const edit = (step: HistoryStep): HistoryStep => (step.docTxId === docTxId ? withoutDocPart(step) : step);
    const changedUndo = prune(undoSteps, edit);
    const changedRedo = prune(redoSteps, edit);
    if (changedUndo || changedRedo) notify();
  };

  // Doc entries that leave the doc undo manager take the doc part away from the steps that owned them; steps left
  // without any part leave the history and are reported (one `onDrop` call per doc event).
  const disposeEvict = ctx.store.undo.onEvict((entries, reason) => {
    const txIds = new Set<string>();
    for (const entry of entries) txIds.add(entry.txId);
    const removed: HistoryStep[] = [];
    let changed = false;
    /** Strips the evicted doc parts from `steps[i]`; true when the step was left empty and removed. */
    const strip = (steps: HistoryStep[], i: number): boolean => {
      const step = steps[i] as HistoryStep;
      if (step.docTxId === null || !txIds.has(step.docTxId)) return false;
      changed = true;
      const next: HistoryStep = withoutDocPart(step);
      if (!isEmpty(next)) {
        steps[i] = next;
        return false;
      }
      steps.splice(i, 1);
      removed.push(step);
      return true;
    };
    // Undo steps oldest first.
    for (let i = 0; i < undoSteps.length; ) if (!strip(undoSteps, i)) i++;
    if (reason === 'redo-cleared') {
      // The doc redo is gone because a new change was made: the history redo goes with it (next redo first).
      if (redoSteps.length > 0) {
        changed = true;
        removed.push(...[...redoSteps].reverse());
        redoSteps.length = 0;
      }
    } else {
      // Redo steps next redo first (the end of the array).
      for (let i = redoSteps.length - 1; i >= 0; i--) strip(redoSteps, i);
    }
    if (!changed) return;
    if (collecting !== null) collecting.push(...removed);
    else dropped(removed, DROP_REASON[reason]);
    notify();
  });

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
      if (isEmpty(step as HistoryStep)) return;
      continuable = null;
      const now = ctx.now();
      const top = undoSteps.at(-1);
      const sameDocEntry = step.docTxId !== null && top?.docTxId === step.docTxId;
      const sameKey =
        step.docTxId === null &&
        top !== undefined &&
        top.docTxId === null &&
        (top.selection === undefined || top.selection === null) &&
        !hasActor(step) &&
        !hasActor(top) &&
        step.coalesceKey !== undefined &&
        top.coalesceKey === step.coalesceKey &&
        now - top.at <= coalesceMs;
      if (top !== undefined && (sameDocEntry || sameKey)) {
        undoSteps[undoSteps.length - 1] = { ...top, overrides: mergeDeltas(top.overrides, step.overrides), at: now };
      } else {
        // A doc entry belongs to one step: a later step that extends it (store coalescing past an override-only
        // step) takes it over.
        if (step.docTxId !== null) history.forgetDocEntry(step.docTxId);
        push({ ...step, id: nextId++, at: now });
      }
      // A redo drop pairs with the doc's redo (§12 S20), so no doc redo entry outlives its step (an override-only
      // step after undoing a doc step). The doc redo is non-empty only right after navigation, when the doc is not
      // capturing, so this never changes coalescing.
      if (clearRedoSteps() && ctx.store.undo.canRedo()) ctx.store.undo.clearRedo();
      if (step.changes !== undefined && step.changes !== null && step.changes.length > 0) capJournal();
      notify();
    },
    recordSelection(
      part: SelectionPart,
      label: 'Select' | 'Hide' | 'Show',
      opts?: { readonly repeat?: boolean },
    ): void {
      if (!isSelectionPart(part)) throw new EkzaError('unsupported', 'recordSelection: not a selection part');
      ctx.reconcile();
      const now = ctx.now();
      const top = undoSteps.at(-1);
      const topPart = top?.selection;
      const merge =
        opts?.repeat === true &&
        top !== undefined &&
        top.id === continuable &&
        redoSteps.length === 0 &&
        top.docTxId === null &&
        top.overrides === null &&
        topPart !== undefined &&
        topPart !== null &&
        topPart.kind === part.kind &&
        (part.kind === 'hide' || (topPart.kind === 'select' && topPart.gesture === part.gesture));
      if (merge && top !== undefined && topPart !== undefined && topPart !== null) {
        const merged = { ...part, before: topPart.before } as SelectionPart;
        undoSteps[undoSteps.length - 1] = { ...top, selection: merged, at: now };
      } else {
        const id = nextId++;
        push({ id, label, docTxId: null, overrides: null, selection: part, at: now });
        continuable = id;
      }
      clearRedoSteps();
      // A selection step clears the document's redo like a transaction does (§5.6).
      ctx.store.undo.clearRedo();
      notify();
    },
    onDrop(listener: DropListener): Disposer {
      dropListeners.add(listener);
      return () => {
        dropListeners.delete(listener);
      };
    },
    dropOldest(n: number): void {
      if (!Number.isSafeInteger(n) || n < 0)
        throw new EkzaError('unsupported', `dropOldest: n must be an integer ≥ 0, got ${n}`);
      const before = undoSteps.length;
      dropOldestSteps(n, 'budget');
      if (undoSteps.length !== before) notify();
    },
    recordTestPose(part: TestPosePart, label: string): void {
      if (part === null || typeof part !== 'object' || part.kind !== 'testPose') {
        throw new EkzaError('unsupported', 'recordTestPose: not a test-pose part');
      }
      ctx.reconcile();
      history.record({ label, docTxId: null, overrides: null, testPose: part });
    },
    dropTestPoses(character?: CharacterId): void {
      const edit = (step: HistoryStep): HistoryStep =>
        step.testPose === undefined ||
        step.testPose === null ||
        (character !== undefined && step.testPose.character !== character)
          ? step
          : { ...step, testPose: null };
      const changedUndo = prune(undoSteps, edit);
      const changedRedo = prune(redoSteps, edit);
      if (changedUndo || changedRedo) notify();
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
      const removed = [...undoSteps, ...[...redoSteps].reverse()];
      undoSteps.length = 0;
      redoSteps.length = 0;
      continuable = null;
      dropped(removed, 'clear');
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
      const frozen = (steps: readonly HistoryStep[]) => Object.freeze(steps.map((step) => Object.freeze(step)));
      return { undo: frozen(undoSteps), redo: frozen([...redoSteps].reverse()) };
    },
    topId: () => undoSteps.at(-1)?.id ?? null,
    steps() {
      ctx.reconcile();
      return { undo: [...undoSteps], redo: [...redoSteps].reverse() };
    },
    labels() {
      const { undo, redo } = history.steps();
      return { undo: undo.map((step) => step.label), redo: redo.map((step) => step.label) };
    },
    owns: (docTxId: string) =>
      undoSteps.some((step) => step.docTxId === docTxId) || redoSteps.some((step) => step.docTxId === docTxId),
    forgetDocEntry,
    forgetDocEntries(): void {
      const edit = (step: HistoryStep): HistoryStep => (step.docTxId === null ? step : withoutDocPart(step));
      const changedUndo = prune(undoSteps, edit);
      const changedRedo = prune(redoSteps, edit);
      if (changedUndo || changedRedo) notify();
    },
    dispose(): void {
      disposeEvict();
      dropListeners.clear();
    },
  };
  return history;
}

/** The labels of an app's history steps, oldest first (an `EditorApp` built by `createKernelApp`). */
export function historyLabels(history: EditorHistory): {
  readonly undo: readonly string[];
  readonly redo: readonly string[];
} {
  const labels = (history as Partial<KernelHistory>).labels;
  if (labels === undefined) throw new EkzaError('unsupported', 'historyLabels: not a kernel history');
  return labels.call(history);
}
