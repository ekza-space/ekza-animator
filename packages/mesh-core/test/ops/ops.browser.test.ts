// The Chromium run of the B4 op gates (Vitest browser mode, M6A-SPEC §5.29): P6 — the same oracle counts and
// manifests as Node (test/goldens/ops-shape.json, kept by the Node run); P1, P5, P8 — random B4 op sequences on
// primitives and soups through the B4 harness; the Multi-Cut fuzz; P10 on a symmetric cube.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { editMeshFrom, isRefusal, primitive, selectionOf } from '../../src';
import { arbPrimitive, arbSoup } from '../../src/testing';
import goldens from '../goldens/ops-shape.json?raw';
import { opsShapeValues } from './determinism';
import { runOp } from './harness';
import { arbOpStep, resolveOpStep } from './steps';
import { asymmetry, expand, testSymmetryMap } from './symmetry-fixture';

describe('Chromium (B4 ops)', () => {
  it('runs in a browser (not Node)', () => {
    expect(typeof (globalThis as { readonly document?: unknown }).document).toBe('object');
  });

  it('P6: the same oracle counts and manifests as Node', () => {
    expect(opsShapeValues()).toEqual(JSON.parse(goldens) as Record<string, string>);
  });

  it('P1 + P5 + P8: random B4 op sequences on primitives and soups', () => {
    let ran = 0;
    const sequences = fc.array(arbOpStep(), { minLength: 10, maxLength: 30 });
    const steps = (m: ReturnType<typeof editMeshFrom>, list: readonly Parameters<typeof resolveOpStep>[1][]) => {
      for (const step of list) {
        const { op, sel, args, ctx } = resolveOpStep(m, step);
        if (!isRefusal(runOp(m, op, sel, args, ctx, { maySoften: true }).result)) ran++;
      }
    };
    fc.assert(
      fc.property(arbPrimitive(), sequences, ({ kind, params }, list) =>
        steps(editMeshFrom(primitive(kind, params)), list),
      ),
      { numRuns: 12, seed: 21 },
    );
    fc.assert(
      fc.property(arbSoup(), sequences, (soup, list) => steps(editMeshFrom(soup), list)),
      { numRuns: 12, seed: 22 },
    );
    expect(ran).toBeGreaterThan(100);
  });

  it('P10: a symmetric cut and slide on a symmetric cube stay symmetric', () => {
    const m = editMeshFrom(primitive('cube', { width: 2, subdivisionsWidth: 2, subdivisionsHeight: 2 }));
    const map = testSymmetryMap(m);
    const ctx = { symmetry: { map, preserveSeam: true } };
    const step = { op: 12, kind: 3, picks: [3, 5, 9], values: [1, 2, 3, 4, 5, 6, 7, 8], symmetric: true };
    const resolved = resolveOpStep(m, step);
    runOp(m, resolved.op, null, resolved.args, { ...resolved.ctx, ...ctx });
    expect(asymmetry(m)).toBeLessThan(1e-6);
    const n = editMeshFrom(primitive('cube', { width: 2, subdivisionsWidth: 2, subdivisionsHeight: 2 }));
    const nmap = testSymmetryMap(n);
    const slide = resolveOpStep(n, {
      op: 11,
      kind: 1,
      picks: [4],
      values: [800, 0, 0, 0, 0, 0, 0, 0],
      symmetric: true,
    });
    const sel = expand(selectionOf('edge', [4], n.counts), nmap);
    runOp(n, slide.op, sel, slide.args, slide.ctx);
    expect(asymmetry(n)).toBeLessThan(1e-6);
  });
});
