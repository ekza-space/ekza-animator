// The Chromium run (Vitest browser mode, M6A-SPEC §9 B1): P6 — the same manifests and digests as Node (the golden
// file the Node run keeps); P1 and P5 — Euler sequences through the property harness, one step per transaction and
// 2–40 steps per transaction with layer events (abort, undo and redo, rebuilt runtimes); P4 — primitive orientation.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { editMeshFrom, primitive, topologyStats } from '../../src';
import { arbEulerStep, arbPrimitive, arbSoup, signedVolume } from '../../src/testing';
import goldens from '../goldens/primitives-determinism.json?raw';
import { determinismValues } from './determinism';
import { checkSequence, checkTransactions } from './harness';

describe('Chromium', () => {
  it('runs in a browser (not Node)', () => {
    expect(typeof (globalThis as { readonly document?: unknown }).document).toBe('object');
  });

  it('P6: the same manifests and digests as Node', () => {
    expect(determinismValues()).toEqual(JSON.parse(goldens) as Record<string, string>);
  });

  it('P1 + P5: Euler sequences on primitives and soups', () => {
    let applied = 0;
    fc.assert(
      fc.property(
        arbPrimitive(),
        fc.array(arbEulerStep(), { minLength: 50, maxLength: 200 }),
        ({ kind, params }, steps) => {
          applied += checkSequence(primitive(kind, params), steps).tally.applied;
        },
      ),
      { numRuns: 6 },
    );
    fc.assert(
      fc.property(arbSoup(), fc.array(arbEulerStep(), { minLength: 50, maxLength: 200 }), (soup, steps) => {
        applied += checkSequence(soup, steps).tally.applied;
      }),
      { numRuns: 6 },
    );
    expect(applied).toBeGreaterThan(200);
  });

  it('P1 + P5: multi-step transactions with layer events on primitives and soups', () => {
    let applied = 0;
    const transactions = fc.array(fc.array(arbEulerStep(), { minLength: 2, maxLength: 40, size: 'max' }), {
      minLength: 1,
      maxLength: 8,
    });
    fc.assert(
      fc.property(arbPrimitive(), transactions, ({ kind, params }, txs) => {
        applied += checkTransactions(primitive(kind, params), txs).tally.applied;
      }),
      { numRuns: 6 },
    );
    fc.assert(
      fc.property(arbSoup(), transactions, (soup, txs) => {
        applied += checkTransactions(soup, txs).tally.applied;
      }),
      { numRuns: 6 },
    );
    fc.assert(
      fc.property(arbPrimitive(), fc.array(arbEulerStep(), { minLength: 200, maxLength: 300, size: 'max' }), (p, s) => {
        applied += checkTransactions(primitive(p.kind, p.params), [s]).tally.applied;
      }),
      { numRuns: 2 },
    );
    expect(applied).toBeGreaterThan(200);
  });

  it('P4: random primitives are closed (but the plane), outward and consistently wound', () => {
    fc.assert(
      fc.property(arbPrimitive(), ({ kind, params }) => {
        const data = primitive(kind, params);
        const stats = topologyStats(data);
        const m = editMeshFrom(data);
        let opposite = true;
        for (let e = 0; e < m.counts.edges; e++) {
          const c = m.edgeCorner(e);
          if (m.edgeFaceCount(e) === 2 && m.cornerVert(c) === m.cornerVert(m.cornerRadialNext(c))) opposite = false;
        }
        expect(opposite).toBe(true);
        expect(stats.boundaryLoops).toBe(kind === 'plane' ? 1 : 0);
        expect(kind === 'plane' || signedVolume(data) > 0).toBe(true);
      }),
      { numRuns: 40 },
    );
  });
});
