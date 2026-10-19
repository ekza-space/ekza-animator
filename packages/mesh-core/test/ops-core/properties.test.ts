// M6A-SPEC §5.29 properties of B3's ops on primitives with random divisions, random selections and random args, and
// on synthetic soups: P1 (a valid mesh or a refusal, never a throw; on manifold primitives never the `.topology`
// safety refusal), P2 (χ for the ops that keep it; Fill Hole +1 per hole), P3 (closed manifold stays closed manifold
// for the manifold-preserving ops), P4 (consistent winding; outward volume kept by outward-only steps), P5 and P8
// (inside `runChecked`: exact undo/redo on the same and rebuilt meshes, incremental revisions), P6 (the same step on
// a copy gives the same manifest), P7-hard (an all-hard mesh stays all-hard) — single steps and model-based sequences.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { editMeshFrom, primitive, topologyStats } from '../../src';
import { arbPrimitive, arbSoup } from '../../src/testing';
import { addTestLayers, checkStep, layerEnvelope, layerProblems } from './checks';
import { arbOpStep } from './steps';

/** Heavier local runs: B3_PROPERTY_SCALE=10 multiplies every run count (report-only; CI runs scale 1). */
const SCALE = Math.max(1, Number(process.env['B3_PROPERTY_SCALE'] ?? '1') || 1);

describe('B3 properties on primitives (P1–P7)', () => {
  it('single steps', () => {
    let ran = 0;
    fc.assert(
      fc.property(arbPrimitive(), arbOpStep(), (prim, step) => {
        const m = editMeshFrom(primitive(prim.kind, prim.params));
        if (checkStep(m, step, true)) ran++;
      }),
      { numRuns: 600 * SCALE },
    );
    expect(ran).toBeGreaterThan(200);
  });

  it('model-based sequences of 50–500 steps', () => {
    let ran = 0;
    fc.assert(
      fc.property(arbPrimitive(), fc.array(arbOpStep(), { minLength: 50, maxLength: 500 }), (prim, steps) => {
        const m = editMeshFrom(primitive(prim.kind, prim.params));
        for (const step of steps) {
          // Later steps run on whatever the earlier ones made (merges may leave non-manifold edges).
          const stats = topologyStats(m);
          const manifold = stats.nonManifoldEdges === 0 && stats.nonManifoldVerts === 0;
          if (checkStep(m, step, manifold && step.id !== 'mesh.bridge')) ran++;
          if (m.counts.faces > 600) break;
        }
      }),
      { numRuns: 8 * SCALE },
    );
    expect(ran).toBeGreaterThan(100);
  });

  it('P7: layer values stay inside their starting envelope (morph, bits, skin, paint, uv0)', () => {
    let ran = 0;
    fc.assert(
      fc.property(
        arbPrimitive(),
        fc.array(arbOpStep(), { minLength: 1, maxLength: 12 }),
        fc.nat({ max: 1000 }),
        (prim, steps, salt) => {
          const m = editMeshFrom(primitive(prim.kind, prim.params));
          addTestLayers(m, salt);
          const envelope = layerEnvelope(m);
          for (const step of steps) {
            const stats = topologyStats(m);
            const manifold = stats.nonManifoldEdges === 0 && stats.nonManifoldVerts === 0;
            if (checkStep(m, step, manifold && step.id !== 'mesh.bridge')) ran++;
            expect(layerProblems(m, envelope).map((problem) => `${step.id}: ${problem}`)).toEqual([]);
          }
        },
      ),
      { numRuns: 60 * SCALE },
    );
    expect(ran).toBeGreaterThan(80);
  });
});

describe('B3 refusal policy on synthetic soups (P1)', () => {
  it('a valid mesh or a refusal, never a throw', () => {
    let tried = 0;
    fc.assert(
      fc.property(arbSoup({ maxVerts: 8, maxFaces: 8 }), arbOpStep(), (data, step) => {
        const m = editMeshFrom(data);
        checkStep(m, step, false);
        tried++;
      }),
      { numRuns: 400 * SCALE },
    );
    expect(tried).toBe(400 * SCALE);
  });
});
