// The Chromium run of B3's ops (Vitest browser mode, M6A-SPEC §5.29): P6 — the same counts and manifest ids as Node
// (test/goldens/ops-core.json, which the Node run keeps); P1–P5 and P7-hard — single op steps and op sequences on
// random primitives through the checked runner (validity, exact undo/redo on the same and rebuilt meshes, incremental
// revisions, χ, closed manifolds, winding, all-hard).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { editMeshFrom, primitive, topologyStats } from '../../src';
import { arbPrimitive } from '../../src/testing';
import goldens from '../goldens/ops-core.json?raw';
import { checkStep } from './checks';
import { opsCoreValues, SPEC_COUNTS } from './goldens';
import { arbOpStep } from './steps';

describe('Chromium (B3 ops)', () => {
  it('runs in a browser (not Node)', () => {
    expect(typeof (globalThis as { readonly document?: unknown }).document).toBe('object');
  });

  it('P6: the same counts and manifests as Node; the §5.29 rows of B3 hold', () => {
    const computed = opsCoreValues();
    expect(computed).toEqual(JSON.parse(goldens) as unknown);
    for (const [name, value] of Object.entries(SPEC_COUNTS)) expect(computed[name]?.counts).toBe(value);
  });

  it('P1–P5, P7-hard: single steps on random primitives', () => {
    let ran = 0;
    fc.assert(
      fc.property(arbPrimitive(), arbOpStep(), (prim, step) => {
        if (checkStep(editMeshFrom(primitive(prim.kind, prim.params)), step, true)) ran++;
      }),
      { numRuns: 200 },
    );
    expect(ran).toBeGreaterThan(50);
  });

  it('P1–P5, P7-hard: op sequences on random primitives', () => {
    let ran = 0;
    fc.assert(
      fc.property(arbPrimitive(), fc.array(arbOpStep(), { minLength: 50, maxLength: 120 }), (prim, steps) => {
        const m = editMeshFrom(primitive(prim.kind, prim.params));
        for (const step of steps) {
          const stats = topologyStats(m);
          const manifold = stats.nonManifoldEdges === 0 && stats.nonManifoldVerts === 0;
          if (checkStep(m, step, manifold && step.id !== 'mesh.bridge')) ran++;
          if (m.counts.faces > 400) break;
        }
      }),
      { numRuns: 6 },
    );
    expect(ran).toBeGreaterThan(40);
  });
});
