// M6A-SPEC §5.6, §9 B0a (3): EditorHistory selection parts — one step per gesture, auto-repeat coalescing, a
// selection step clears the doc redo, selection-only steps survive pruning, onDrop reasons, dropOldest and limit drops
// paired with UndoManager.evictOldest, doc evictions taking the doc part away.
import { EkzaError } from '@ekza-animator/anim-core';
import { createMemoryStore, type DocumentStore, type MeshId } from '@ekza-animator/doc';
import { makeTestMesh } from '@ekza-animator/doc/testing';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createStore } from 'zustand/vanilla';
import { createEditorHistory, type KernelHistory } from '../../src/history/history';
import { defaultSession } from '../../src/session/defaults';
import type {
  HideSnapshot,
  HistoryDropReason,
  HistoryStep,
  SceneObjectId,
  SelectionGesture,
  SelectionPart,
  SelectionSnapshot,
  SessionState,
} from '../../src/types';
import { waveApp } from '../kernel/support';

const snap = (objects: readonly string[], controls: readonly string[] = []): SelectionSnapshot => ({
  controls: controls as SelectionSnapshot['controls'],
  objects: objects as readonly SceneObjectId[],
  componentMode: 'object',
  hilite: [],
  meshes: {},
});
const select = (gesture: SelectionGesture, before: readonly string[], after: readonly string[]): SelectionPart => ({
  kind: 'select',
  gesture,
  before: snap(before),
  after: snap(after),
});
const hidden = (objects: readonly string[]): HideSnapshot => ({ objects: objects as SceneObjectId[], meshes: {} });
const hide = (before: readonly string[], after: readonly string[]): SelectionPart => ({
  kind: 'hide',
  before: hidden(before),
  after: hidden(after),
});

interface Harness {
  readonly store: DocumentStore;
  readonly history: KernelHistory;
  readonly restored: { readonly part: SelectionPart; readonly side: 'before' | 'after' }[];
  readonly drops: { readonly labels: readonly string[]; readonly reason: HistoryDropReason }[];
  /** One doc transaction recorded as a history step (what the runner does for an undoable operator). */
  docStep(label: string): string;
}

function harness(opts: { readonly limit?: number; readonly undoLimit?: number } = {}): Harness {
  const store = createMemoryStore(opts.undoLimit === undefined ? {} : { undoLimit: opts.undoLimit });
  const session = createStore<SessionState>()(() => defaultSession());
  const restored: { part: SelectionPart; side: 'before' | 'after' }[] = [];
  let clock = 0;
  const history = createEditorHistory({
    store,
    session,
    now: () => (clock += 10),
    locate: () => null,
    restoreSelection: () => {},
    restoreSelectionPart: (part, side) => {
      restored.push({ part, side });
      return [];
    },
    reconcile: () => {},
    navigated: () => {},
    ...(opts.limit === undefined ? {} : { limit: opts.limit }),
  });
  const drops: { labels: readonly string[]; reason: HistoryDropReason }[] = [];
  history.onDrop((steps, reason) => drops.push({ labels: steps.map((s) => s.label), reason }));
  let n = 0;
  return {
    store,
    history,
    restored,
    drops,
    docStep(label: string): string {
      const id = `msh_${label}${n++}`;
      store.transact({ label }, (tx) => tx.put('meshes', makeTestMesh(id, { name: `${label}${n}` })));
      const txId = store.undo.peekUndo()?.txId as string;
      history.record({ label, docTxId: txId, overrides: null });
      return txId;
    },
  };
}

const labels = (h: Harness): string[] => {
  const out: string[] = [];
  const undone: HistoryStep[] = [];
  for (let step = h.history.peekUndo(); step !== null; step = h.history.peekUndo()) {
    out.push(step.label);
    undone.push(step);
    h.history.undo();
  }
  for (let i = 0; i < undone.length; i++) h.history.redo();
  return out.reverse();
};

describe('history selection parts (§5.6)', () => {
  it('records one step per selection gesture and restores before/after on undo/redo', () => {
    const h = harness();
    h.history.recordSelection(select('replace', [], ['msh_A']), 'Select');
    h.history.recordSelection(select('additive', ['msh_A'], ['msh_A', 'msh_B']), 'Select');
    h.history.recordSelection(hide([], ['msh_B']), 'Hide');
    expect(labels(h)).toEqual(['Select', 'Select', 'Hide']);
    h.restored.length = 0;

    const undone = h.history.undo();
    expect(undone).toMatchObject({ label: 'Hide', doc: null, overridesRestored: false, warnings: [] });
    expect(h.restored.at(-1)).toEqual({ part: hide([], ['msh_B']), side: 'before' });
    h.history.undo();
    expect(h.restored.at(-1)).toEqual({ part: select('additive', ['msh_A'], ['msh_A', 'msh_B']), side: 'before' });
    h.history.redo();
    expect(h.restored.at(-1)).toEqual({ part: select('additive', ['msh_A'], ['msh_A', 'msh_B']), side: 'after' });
  });

  it('merges auto-repeated parts of the same gesture into the top step, keeping its first before', () => {
    const h = harness();
    h.history.recordSelection(select('grow', ['a'], ['a', 'b']), 'Select');
    h.history.recordSelection(select('grow', ['a', 'b'], ['a', 'b', 'c']), 'Select', { repeat: true });
    h.history.recordSelection(select('grow', ['a', 'b', 'c'], ['a', 'b', 'c', 'd']), 'Select', { repeat: true });
    expect(labels(h)).toEqual(['Select']);
    const top = h.history.peekUndo()?.selection as Extract<SelectionPart, { kind: 'select' }>;
    expect(top.before.objects).toEqual(['a']);
    expect(top.after.objects).toEqual(['a', 'b', 'c', 'd']);
  });

  it('never merges a new gesture, another gesture kind, a non-repeat part or a part after navigation', () => {
    const h = harness();
    h.history.recordSelection(select('grow', [], ['a']), 'Select');
    h.history.recordSelection(select('grow', ['a'], ['a', 'b']), 'Select'); // a new key press
    h.history.recordSelection(select('shrink', ['a', 'b'], ['a']), 'Select', { repeat: true }); // other gesture
    h.history.recordSelection(hide([], ['a']), 'Hide', { repeat: true }); // other kind
    expect(labels(h)).toHaveLength(4);
    h.history.undo();
    h.history.redo();
    h.history.recordSelection(hide(['a'], ['a', 'b']), 'Hide', { repeat: true }); // after navigation
    expect(labels(h)).toHaveLength(5);
    h.docStep('Edit');
    h.history.recordSelection(hide(['a', 'b'], []), 'Show', { repeat: true }); // after a doc step
    expect(labels(h)).toEqual(['Select', 'Select', 'Select', 'Hide', 'Hide', 'Edit', 'Show']);
  });

  it('clears the redo stacks of the history and of the document', () => {
    const h = harness();
    h.docStep('Create');
    h.history.undo();
    expect(h.store.undo.canRedo()).toBe(true);
    expect(h.history.canRedo()).toBe(true);
    h.history.recordSelection(select('replace', [], ['a']), 'Select');
    expect(h.history.canRedo()).toBe(false);
    expect(h.store.undo.canRedo()).toBe(false);
    expect(h.drops).toEqual([{ labels: ['Create'], reason: 'redo-cleared' }]);
  });

  it('keeps selection-only steps through pruning (forgetDocEntries, dropOverrides) and records them via record()', () => {
    const h = harness();
    h.history.record({ label: 'Select', docTxId: null, overrides: null, selection: select('replace', [], ['a']) });
    h.docStep('Create');
    h.history.recordSelection(select('replace', ['a'], ['b']), 'Select');
    h.history.forgetDocEntries();
    h.history.dropOverrides({});
    expect(labels(h)).toEqual(['Select', 'Select']);
    // A step with no part at all is still empty.
    h.history.record({ label: 'Nothing', docTxId: null, overrides: null, selection: null });
    expect(labels(h)).toEqual(['Select', 'Select']);
  });

  it('rejects malformed parts', () => {
    const h = harness();
    expect(() => h.history.recordSelection({ kind: 'select' } as unknown as SelectionPart, 'Select')).toThrow(
      EkzaError,
    );
    expect(h.history.canUndo()).toBe(false);
  });
});

describe('history drops (onDrop, dropOldest, the step limit)', () => {
  it('pairs limit drops with evictOldest: no doc entry outlives its step', () => {
    const h = harness({ limit: 3 });
    const evicted: string[] = [];
    h.store.undo.onEvict((entries) => evicted.push(...entries.map((e) => e.txId)));
    const a = h.docStep('A');
    h.history.recordSelection(select('replace', [], ['x']), 'Select');
    const b = h.docStep('B');
    h.docStep('C');
    // 4 steps, limit 3: 'A' leaves, and its doc entry with it.
    expect(h.drops).toEqual([{ labels: ['A'], reason: 'limit' }]);
    expect(evicted).toEqual([a]);
    expect(h.store.undo.entries().undo.map((e) => e.txId)).not.toContain(a);
    // The selection step leaves next; it owns no doc entry, so the doc stack stays.
    h.docStep('D');
    expect(h.drops.at(-1)).toEqual({ labels: ['Select'], reason: 'limit' });
    expect(evicted).toEqual([a]);
    h.docStep('E');
    expect(h.drops.at(-1)).toEqual({ labels: ['B'], reason: 'limit' });
    expect(evicted).toEqual([a, b]);
    expect(labels(h)).toEqual(['C', 'D', 'E']);
    expect(h.store.undo.entries().undo).toHaveLength(3);
  });

  it('dropOldest drops the oldest steps with their doc entries for the budget', () => {
    const h = harness();
    h.docStep('A');
    h.history.recordSelection(select('replace', [], ['x']), 'Select');
    h.docStep('B');
    h.docStep('C');
    h.history.dropOldest(3);
    expect(h.drops).toEqual([{ labels: ['A', 'Select', 'B'], reason: 'budget' }]);
    expect(labels(h)).toEqual(['C']);
    expect(h.store.undo.entries().undo.map((e) => e.label)).toEqual(['C']);
    h.history.dropOldest(0);
    h.history.dropOldest(10);
    expect(h.history.canUndo()).toBe(false);
    expect(h.drops.at(-1)).toEqual({ labels: ['C'], reason: 'budget' });
    expect(() => h.history.dropOldest(-1)).toThrow(EkzaError);
    expect(() => h.history.dropOldest(1.5)).toThrow(EkzaError);
  });

  it('reports clear with every step, undo stack first then redo (next redo first)', () => {
    const h = harness();
    h.docStep('A');
    h.docStep('B');
    h.history.recordSelection(select('replace', [], ['x']), 'Select');
    h.history.undo();
    h.history.undo();
    h.history.clear();
    expect(h.drops).toEqual([{ labels: ['A', 'B', 'Select'], reason: 'clear' }]);
    h.history.clear();
    expect(h.drops).toHaveLength(1);
  });

  it('takes the doc part away from steps whose doc entries the document evicts on its own', () => {
    const h = harness({ undoLimit: 2 });
    h.docStep('A');
    h.history.recordSelection(select('replace', [], ['x']), 'Select');
    h.docStep('B');
    h.docStep('C'); // the doc keeps 2 entries: A's leaves, the step 'A' is now empty and disappears
    expect(labels(h)).toEqual(['Select', 'B', 'C']);
    expect(h.drops).toEqual([{ labels: ['A'], reason: 'limit' }]);
    h.store.undo.clear();
    expect(labels(h)).toEqual(['Select']);
    expect(h.drops.at(-1)).toEqual({ labels: ['B', 'C'], reason: 'clear' });
    expect(h.drops).toHaveLength(2);
  });

  it('reports the redo steps a new doc transaction clears (doc step after undo)', () => {
    const h = harness();
    h.docStep('A');
    h.history.undo();
    h.docStep('B');
    expect(h.drops).toEqual([{ labels: ['A'], reason: 'redo-cleared' }]);
    expect(h.history.steps().redo).toEqual([]);
    expect(labels(h)).toEqual(['B']);
  });

  it('clears the whole history redo in one call when the doc clears its redo, next redo first', () => {
    const h = harness();
    h.docStep('A');
    h.history.recordSelection(select('replace', [], ['x']), 'Select');
    h.docStep('C');
    h.history.undo();
    h.history.undo();
    h.history.undo();
    expect(h.history.steps().redo.map((s) => s.label)).toEqual(['A', 'Select', 'C']);
    h.docStep('D');
    expect(h.drops).toEqual([{ labels: ['A', 'Select', 'C'], reason: 'redo-cleared' }]);
    expect(labels(h)).toEqual(['D']);
    // `UndoManager.clearRedo()` called by someone else: the same.
    h.history.recordSelection(select('replace', ['x'], ['y']), 'Select');
    h.history.undo();
    h.history.undo();
    h.store.undo.clearRedo();
    expect(h.drops.at(-1)).toEqual({ labels: ['D', 'Select'], reason: 'redo-cleared' });
    expect(h.history.canRedo()).toBe(false);
  });

  it('pairs a redo drop by a step without a doc part with the doc redo (no doc entry outlives its step)', () => {
    const h = harness();
    const evicted: string[] = [];
    h.store.undo.onEvict((entries, reason) => evicted.push(...entries.map((e) => `${e.label}:${reason}`)));
    h.docStep('A');
    h.history.undo();
    // What the runner records for an override-only edit (here a part-only step through record()).
    h.history.record({ label: 'Pose', docTxId: null, overrides: null, selection: select('replace', [], ['p']) });
    expect(h.drops).toEqual([{ labels: ['A'], reason: 'redo-cleared' }]);
    expect(h.store.undo.canRedo()).toBe(false);
    expect(evicted).toEqual(['A:redo-cleared']);
    // With the doc redo empty, recording never calls clearRedo, so coalescing doc steps still merge.
    h.store.transact({ label: 'Make' }, (tx) => tx.put('meshes', makeTestMesh('msh_N', { name: 'N' })));
    h.history.record({ label: 'Make', docTxId: h.store.undo.peekUndo()?.txId as string, overrides: null });
    const nudge = (name: string): string => {
      h.store.transact({ label: 'Nudge', coalesceKey: 'nudge', coalesceMs: 60_000 }, (tx) =>
        tx.patch('meshes', 'msh_N' as MeshId, { name }),
      );
      const txId = h.store.undo.peekUndo()?.txId as string;
      h.history.record({ label: 'Nudge', docTxId: txId, overrides: null });
      return txId;
    };
    expect(nudge('N1')).toBe(nudge('N2'));
    expect(labels(h)).toEqual(['Pose', 'Make', 'Nudge']);
    expect(h.drops).toHaveLength(1);
  });

  it('keeps redo steps whose doc entries survive (a selection step after undo reports once)', () => {
    const h = harness();
    h.docStep('A');
    h.docStep('B');
    h.history.undo();
    h.history.recordSelection(select('replace', [], ['x']), 'Select');
    // The history clears its redo first; the doc's own redo-cleared event then finds nothing left to report.
    expect(h.drops).toEqual([{ labels: ['B'], reason: 'redo-cleared' }]);
    expect(labels(h)).toEqual(['A', 'Select']);
  });

  it('reports steps emptied by the doc limit with reason limit (doc limit below the history limit)', () => {
    const h = harness({ undoLimit: 1 });
    h.docStep('A');
    h.docStep('B');
    expect(labels(h)).toEqual(['B']);
    expect(h.drops).toEqual([{ labels: ['A'], reason: 'limit' }]);
  });

  it('reports steps emptied by a direct evictOldest with reason budget; override parts keep a step', () => {
    const h = harness();
    h.docStep('A');
    h.history.record({ label: 'Pose', docTxId: null, overrides: null, selection: select('replace', [], ['p']) });
    h.docStep('B');
    // A step that owns a doc entry and a selection part loses only the doc part.
    h.store.transact({ label: 'C' }, (tx) => tx.put('meshes', makeTestMesh('msh_C', { name: 'C' })));
    const c = h.store.undo.peekUndo()?.txId as string;
    h.history.record({ label: 'C', docTxId: c, overrides: null, selection: select('replace', ['p'], ['q']) });
    h.store.undo.evictOldest(3);
    expect(h.drops).toEqual([{ labels: ['A', 'B'], reason: 'budget' }]);
    expect(h.history.steps().undo.map((s) => [s.label, s.docTxId])).toEqual([
      ['Pose', null],
      ['C', null],
    ]);
  });

  it('reports every step on a document load with reason clear (undo first, then redo next first)', () => {
    const h = harness();
    const snapshot = h.store.snapshot();
    h.docStep('A');
    h.history.recordSelection(select('replace', [], ['x']), 'Select');
    h.docStep('B');
    h.docStep('C');
    h.history.undo();
    h.history.undo();
    h.store.load(snapshot);
    // Doc-only steps are emptied; the selection-only step keeps its part (the kernel's capture clears it on load).
    expect(h.drops).toEqual([{ labels: ['A', 'B', 'C'], reason: 'clear' }]);
    expect(h.history.steps().undo.map((s) => s.label)).toEqual(['Select']);
  });

  it('collects steps a history drop empties through evictOldest into the same onDrop call', () => {
    const h = harness({ limit: 1 });
    const evicted: string[] = [];
    h.store.undo.onEvict((entries, reason) => evicted.push(...entries.map((e) => `${e.label}:${reason}`)));
    h.store.transact({ label: 'one' }, (tx) => tx.put('meshes', makeTestMesh('msh_one')));
    const one = h.store.undo.peekUndo()?.txId as string;
    h.store.transact({ label: 'two' }, (tx) => tx.put('meshes', makeTestMesh('msh_two', { name: 'Two' })));
    const two = h.store.undo.peekUndo()?.txId as string;
    // Steps out of the doc order (not something the runner records, but the history must stay paired): X owns the
    // newer entry, Y the older one. The limit drops X, which evicts both entries, so Y is left empty too.
    h.history.record({ label: 'X', docTxId: two, overrides: null });
    h.history.record({ label: 'Y', docTxId: one, overrides: null });
    expect(h.drops).toEqual([{ labels: ['X', 'Y'], reason: 'limit' }]);
    expect(evicted).toEqual(['one:budget', 'two:budget']);
    expect(h.history.canUndo()).toBe(false);
  });

  it('property: steps and doc entries stay paired and every step leaving is reported once', () => {
    type Op =
      | 'doc'
      | 'select'
      | 'repeat'
      | 'undo'
      | 'redo'
      | 'drop'
      | 'clear'
      | 'docClear'
      | 'docEvict'
      | 'docClearRedo';
    const ops = fc.constantFrom<Op>(
      'doc',
      'doc',
      'select',
      'repeat',
      'repeat',
      'undo',
      'undo',
      'redo',
      'drop',
      'clear',
      'docClear',
      'docEvict',
      'docClearRedo',
    );
    fc.assert(
      fc.property(fc.array(ops, { maxLength: 60 }), (sequence) => {
        const h = harness({ limit: 6, undoLimit: 4 });
        const reported: { readonly id: number; readonly reason: HistoryDropReason }[] = [];
        h.history.onDrop((steps, reason) => reported.push(...steps.map((s) => ({ id: s.id, reason }))));
        const ids = (): Set<number> => {
          const { undo, redo } = h.history.steps();
          return new Set([...undo, ...redo].map((s) => s.id));
        };
        let n = 0;
        for (const op of sequence) {
          const before = ids();
          reported.length = 0;
          if (op === 'doc') h.docStep(`D${n++}`);
          else if (op === 'select') h.history.recordSelection(select('grow', [], [`o${n++}`]), 'Select');
          else if (op === 'repeat') {
            h.history.recordSelection(select('grow', [], [`o${n++}`]), 'Select', { repeat: true });
          } else if (op === 'undo') h.history.undo();
          else if (op === 'redo') h.history.redo();
          else if (op === 'drop') h.history.dropOldest(1);
          else if (op === 'clear') h.history.clear();
          else if (op === 'docClear') h.store.undo.clear();
          else if (op === 'docEvict') h.store.undo.evictOldest(1);
          else h.store.undo.clearRedo();
          const after = ids();
          // Every step that disappeared was reported, exactly once, and nothing still present was.
          const gone = [...before].filter((id) => !after.has(id)).sort((a, b) => a - b);
          const reportedIds = reported.map((r) => r.id);
          expect([...reportedIds].sort((a, b) => a - b)).toEqual(gone);
          expect(new Set(reportedIds).size).toBe(reportedIds.length);
          // Every step that owns a doc entry finds it in the doc (undo steps on the undo stack): no step outlives its
          // entry, and no doc entry outlives its step through a history drop. The limits hold.
          const docUndo = new Set(h.store.undo.entries().undo.map((e) => e.txId));
          const docAll = new Set([...docUndo, ...h.store.undo.entries().redo.map((e) => e.txId)]);
          const { undo, redo } = h.history.steps();
          expect(undo.filter((step) => step.docTxId !== null && !docUndo.has(step.docTxId))).toEqual([]);
          expect(redo.filter((step) => step.docTxId !== null && !docAll.has(step.docTxId))).toEqual([]);
          expect(undo.length).toBeLessThanOrEqual(6);
          expect(h.store.undo.entries().undo.length).toBeLessThanOrEqual(4);
        }
      }),
      { numRuns: 300 },
    );
  });
});

describe('history selection parts in the kernel app', () => {
  it('restores objects (live ones only) and hidden objects, never the mode or the hilite', () => {
    const app = waveApp();
    app.store.transact({ label: 'Create' }, (tx) => {
      tx.put('meshes', makeTestMesh('msh_A'));
      tx.put('meshes', makeTestMesh('msh_B', { name: 'Other' }));
    });
    const model = app.session.getState().model;
    app.session.setState({ model: { ...model, componentMode: 'face', hilite: ['msh_A' as MeshId] } });
    app.history.recordSelection(select('replace', ['msh_A'], ['msh_B', 'msh_gone']), 'Select');
    app.history.recordSelection(hide([], ['msh_A', 'msh_gone']), 'Hide');
    app.history.undo();
    expect([...app.session.getState().model.hiddenObjects]).toEqual([]);
    app.history.redo();
    expect([...app.session.getState().model.hiddenObjects]).toEqual(['msh_A']);
    app.history.undo();
    app.history.undo();
    expect(app.session.getState().selection.objects).toEqual(['msh_A']);
    app.history.redo();
    expect(app.session.getState().selection.objects).toEqual(['msh_B']);
    expect(app.session.getState().model.componentMode).toBe('face');
    expect(app.session.getState().model.hilite).toEqual(['msh_A']);
  });
});
