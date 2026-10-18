// Store performance (MVP-SPEC §7 WP-2 bench, ARCHITECTURE §14): a 1,000-key commit ≤ 4 ms and its undo ≤ 5 ms are
// budgets to REPORT, not CI gates (shared runners vary). The measured medians are attached to the test as
// annotations; the assertions only catch pathological regressions (10× the budget).
import { describe, expect, it } from 'vitest';
import { createMemoryStore, type KeyRecord, makeKey, newId, seededIdSource } from '../src';
import { makeTestDocument, seedScene } from '../src/testing';

function median(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] as number;
}

describe('bench (reported)', () => {
  it('commit 1,000 new keys, undo and redo them', async ({ annotate }) => {
    const commit: number[] = [];
    const undo: number[] = [];
    const redo: number[] = [];
    for (let round = 0; round < 15; round++) {
      const store = createMemoryStore();
      const scene = await seedScene(store, round + 1);
      const ids = seededIdSource(round + 100);
      const keys: KeyRecord[] = Array.from({ length: 1000 }, (_, i) =>
        makeKey({ id: newId('key', ids), clip: scene.clip, curve: scene.curve, t: 100 + i, v: Math.sin(i) }),
      );
      let start = performance.now();
      store.transact({ label: 'Set 1,000 keys' }, (tx) => {
        for (const key of keys) tx.put('keys', key);
      });
      commit.push(performance.now() - start);
      start = performance.now();
      store.undo.undo();
      undo.push(performance.now() - start);
      start = performance.now();
      store.undo.redo();
      redo.push(performance.now() - start);
      expect(store.query.keysOfCurve(scene.curve)).toHaveLength(1003);
    }
    const result = { commitMs: median(commit), undoMs: median(undo), redoMs: median(redo) };
    await annotate(
      `1,000-key commit ${result.commitMs.toFixed(2)} ms (budget 4), undo ${result.undoMs.toFixed(2)} ms (budget 5), redo ${result.redoMs.toFixed(2)} ms`,
      'bench',
    );
    expect(result.commitMs).toBeLessThan(40);
    expect(result.undoMs).toBeLessThan(50);
  });

  it('move 1,000 existing keys in one drag (preview update + commit) and query a 30k-key document', async ({
    annotate,
  }) => {
    const store = createMemoryStore();
    store.load(makeTestDocument({ characters: 2, controlsPerRig: 56, keysPerCurve: 90 }));
    const keys = store.list('keys').slice(0, 1000);
    const preview = store.beginPreview('Move keys');
    const updates: number[] = [];
    for (let step = 1; step <= 10; step++) {
      const start = performance.now();
      preview.update((tx) => {
        for (const key of keys) tx.patch('keys', key.id, { v: key.v + step * 0.01 });
      });
      updates.push(performance.now() - start);
    }
    let start = performance.now();
    preview.commit();
    const commitMs = performance.now() - start;
    const curves = store.list('curves');
    start = performance.now();
    let total = 0;
    for (const curve of curves) total += store.query.keysOfCurve(curve.id).length;
    const queryMs = performance.now() - start;
    expect(total).toBe(store.list('keys').length);
    await annotate(
      `drag 1,000 keys: preview update ${median(updates).toFixed(2)} ms, commit ${commitMs.toFixed(2)} ms; keysOfCurve over ${curves.length} curves / ${total} keys (cold) ${queryMs.toFixed(2)} ms`,
      'bench',
    );
    expect(median(updates)).toBeLessThan(80);
  });
});
