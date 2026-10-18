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
    h.store.undo.clear();
    expect(labels(h)).toEqual(['Select']);
  });

  it('property: steps and doc entries stay paired under random record/select/undo/redo/drop sequences', () => {
    type Op = 'doc' | 'select' | 'repeat' | 'undo' | 'redo' | 'drop';
    const ops = fc.constantFrom<Op>('doc', 'select', 'repeat', 'undo', 'redo', 'drop');
    fc.assert(
      fc.property(fc.array(ops, { maxLength: 60 }), (sequence) => {
        const h = harness({ limit: 6, undoLimit: 8 });
        let n = 0;
        for (const op of sequence) {
          if (op === 'doc') h.docStep(`D${n++}`);
          else if (op === 'select') h.history.recordSelection(select('grow', [], [`o${n++}`]), 'Select');
          else if (op === 'repeat') {
            h.history.recordSelection(select('grow', [], [`o${n++}`]), 'Select', { repeat: true });
          } else if (op === 'undo') h.history.undo();
          else if (op === 'redo') h.history.redo();
          else h.history.dropOldest(1);
          // Every undo step that owns a doc entry finds it on the doc undo stack, and the limit holds.
          const docUndo = new Set(h.store.undo.entries().undo.map((e) => e.txId));
          const steps: HistoryStep[] = [];
          for (let step = h.history.peekUndo(); step !== null; step = h.history.peekUndo()) {
            steps.push(step);
            h.history.undo();
          }
          for (let i = 0; i < steps.length; i++) h.history.redo();
          expect(steps.filter((step) => step.docTxId !== null && !docUndo.has(step.docTxId))).toEqual([]);
          expect(steps.length).toBeLessThanOrEqual(6);
        }
      }),
      { numRuns: 200 },
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
