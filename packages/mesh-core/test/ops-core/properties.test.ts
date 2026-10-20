// M6A-SPEC §5.29 properties of B3's ops on primitives with random divisions, random selections and random args, and
// on synthetic soups: P1 (a valid mesh or a refusal, never a throw; on manifold primitives never the `.topology`
// safety refusal), P2 (χ for the ops that keep it; Fill Hole +1 per hole), P3 (closed manifold stays closed manifold
// for the manifold-preserving ops), P4 (consistent winding; outward volume kept by outward-only steps), P5 and P8
// (inside `runChecked`: exact undo/redo on the same and rebuilt meshes, incremental revisions), P6 (the same step on
// a copy gives the same manifest), P7-hard (an all-hard mesh stays all-hard) — single steps and model-based sequences.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { type ComponentKind, editMeshFrom, primitive, type PrimitiveKind, topologyStats } from '../../src';
import { arbPrimitive, arbSoup, signedVolume } from '../../src/testing';
import { addTestLayers, checkStep, layerEnvelope, layerProblems } from './checks';
import { combined, cylinderData } from './fixtures';
import { arbOpStep, GROWTH } from './steps';
import { faceToward, runOk, sel, windingProblems } from './support';

/** Heavier local runs: B3_PROPERTY_SCALE=10 multiplies every run count (report-only; CI runs scale 1). */
const SCALE = Math.max(1, Number(process.env['B3_PROPERTY_SCALE'] ?? '1') || 1);
/** Sequences stop growing the mesh above this many faces (each step's checks rebuild and compare the whole mesh). */
const FACE_CAP = 400;

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
    let attempted = 0;
    fc.assert(
      fc.property(
        arbPrimitive(),
        fc.array(arbOpStep(), { minLength: 50, maxLength: 500, size: 'max' }),
        (prim, steps) => {
          const m = editMeshFrom(primitive(prim.kind, prim.params));
          for (const step of steps) {
            // Above the face cap growth steps are skipped (the rest still run), so every sequence runs to its end.
            if (m.counts.faces > FACE_CAP && GROWTH.has(step.id)) continue;
            attempted++;
            // Later steps run on whatever the earlier ones made (merges may leave non-manifold edges).
            const stats = topologyStats(m);
            const manifold = stats.nonManifoldEdges === 0 && stats.nonManifoldVerts === 0;
            if (checkStep(m, step, manifold && step.id !== 'mesh.bridge')) ran++;
          }
        },
      ),
      { numRuns: 8 * SCALE },
    );
    expect(attempted).toBeGreaterThan(8 * SCALE * 50);
    expect(ran).toBeGreaterThan(100);
    // `size: 'max'`: lengths spread over 50–500 (fast-check's default size would keep them near 50).
  }, 180_000);

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

/** Low-poly closed primitives, where a few vertices reach around the whole shell (cones, tiny spheres, tori, cubes). */
function arbLowPolyClosed(): fc.Arbitrary<{ kind: PrimitiveKind; params: Record<string, number> }> {
  const n = (min: number, max: number) => fc.integer({ min, max });
  return fc.oneof(
    fc.record({
      kind: fc.constant<PrimitiveKind>('cone'),
      params: fc.record({ subdivisionsAxis: n(3, 8), subdivisionsHeight: n(1, 2), subdivisionsCaps: n(0, 1) }),
    }),
    fc.record({
      kind: fc.constant<PrimitiveKind>('sphere'),
      params: fc.record({ subdivisionsAxis: n(3, 6), subdivisionsHeight: n(2, 4) }),
    }),
    fc.record({
      kind: fc.constant<PrimitiveKind>('torus'),
      params: fc.record({ subdivisionsAxis: n(3, 6), subdivisionsHeight: n(3, 5) }),
    }),
    fc.record({
      kind: fc.constant<PrimitiveKind>('cube'),
      params: fc.record({ subdivisionsWidth: n(1, 2), subdivisionsHeight: n(1, 2), subdivisionsDepth: n(1, 2) }),
    }),
    fc.record({
      kind: fc.constant<PrimitiveKind>('cylinder'),
      params: fc.record({ subdivisionsAxis: n(3, 8), subdivisionsHeight: n(1, 2), subdivisionsCaps: n(0, 1) }),
    }),
  );
}

describe('B3 delete family on low-poly closed primitives (P1–P3)', () => {
  it('vertex, edge and face sets of 1–8: χ as §5.29 P2 states, dissolves keep the shell closed', () => {
    const outcomes = { ran: 0, refused: 0 };
    fc.assert(
      fc.property(
        arbLowPolyClosed(),
        fc.constantFrom('mesh.delete', 'mesh.deleteEdgeVertex'),
        fc.constantFrom<ComponentKind>('vertex', 'edge', 'face'),
        fc.array(fc.nat({ max: 1_000_000 }), { minLength: 1, maxLength: 8 }),
        (prim, id, kind, seeds) => {
          const m = editMeshFrom(primitive(prim.kind, prim.params));
          expect(topologyStats(m)).toMatchObject({ boundaryLoops: 0, nonManifoldEdges: 0, nonManifoldVerts: 0 });
          const step = {
            id,
            kind: id === 'mesh.deleteEdgeVertex' && kind === 'face' ? 'vertex' : kind,
            seeds,
            args: {},
            outward: false,
          } as const;
          if (checkStep(m, step, true)) outcomes.ran++;
          else outcomes.refused++;
        },
      ),
      { numRuns: 1500 * SCALE },
    );
    expect(outcomes.ran).toBeGreaterThan(500);
    expect(outcomes.refused).toBeGreaterThan(50);
  });
});

describe('B3 Bridge of two holes (P2, P3, P4, P5)', () => {
  it('two open-ended cylinders, any sides, offsets and args: closed manifold, χ kept, two loops fewer', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 3, max: 12 }),
        fc.record({ x: fc.double({ min: -1, max: 1, noNaN: true }), y: fc.double({ min: 1.2, max: 3, noNaN: true }) }),
        fc.record({
          divisions: fc.integer({ min: 0, max: 4 }),
          twist: fc.integer({ min: -3, max: 3 }),
          offset: fc.integer({ min: -3, max: 3 }),
          taper: fc.double({ min: 0.2, max: 3, noNaN: true }),
        }),
        (sides, shift, args) => {
          const a = editMeshFrom(cylinderData({ subdivisionsAxis: sides }));
          const b = editMeshFrom(cylinderData({ subdivisionsAxis: sides }));
          runOk(a, 'mesh.delete', sel(a, 'face', [faceToward(a, [0, 1, 0])]));
          runOk(b, 'mesh.delete', sel(b, 'face', [faceToward(b, [0, -1, 0])]));
          const m = editMeshFrom(combined(a.snapshot(), b.snapshot(), [shift.x, shift.y, 0]));
          const before = topologyStats(m);
          expect(before.boundaryLoops).toBe(2);
          const border: number[] = [];
          for (let e = 0; e < m.counts.edges; e++) if (m.edgeFaceCount(e) === 1) border.push(e);
          const result = runOk(m, 'mesh.bridge', sel(m, 'edge', border), args);
          const after = topologyStats(m);
          expect([after.boundaryLoops, after.nonManifoldEdges, after.nonManifoldVerts]).toEqual([0, 0, 0]);
          expect(after.euler).toBe(before.euler);
          expect(windingProblems(m)).toEqual([]);
          expect(signedVolume(m)).toBeGreaterThan(0);
          expect(result.selection.faces.count()).toBe(sides * (args.divisions + 1));
        },
      ),
      { numRuns: 60 * SCALE },
    );
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
