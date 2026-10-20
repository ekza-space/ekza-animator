// The Chromium run of B5's tests (Vitest browser mode, M6A-SPEC §5.29 P6): the same bevel, cleanup, Mesh Check and
// projection values as Node (the golden files the Node runs keep), and P1/P4/P5 of the bevel, the cleanup fixes on
// polygon soups and the projections through the op harness in the browser.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { editMeshFrom, isRefusal, MESH_OPS, type MeshOp, primitive, selectionOf, topologyStats } from '../../../src';
import { arbSoup, signedVolume } from '../../../src/testing';
import determinism from '../../goldens/b5-determinism.json?raw';
import uvGoldens from '../../goldens/b5-uv.json?raw';
import { uvGoldenValues } from '../uv/goldens';
import { b5DeterminismValues } from './b5-determinism';
import { consistentlyWound, runChecked } from './harness';

describe('Chromium (B5)', () => {
  it('runs in a browser (not Node)', () => {
    expect(typeof (globalThis as { readonly document?: unknown }).document).toBe('object');
  });

  it('P6: the same manifests and digests as Node', () => {
    expect(b5DeterminismValues()).toEqual(JSON.parse(determinism) as Record<string, string>);
  });

  it('P6: the same UV goldens as Node', () => {
    expect(JSON.parse(JSON.stringify(uvGoldenValues()))).toEqual(JSON.parse(uvGoldens) as unknown);
  });

  it('P1 + P4 + P5: bevels on random primitives and edge or face sets', () => {
    const bevel = MESH_OPS['mesh.bevel'] as MeshOp;
    let ran = 0;
    fc.assert(
      fc.property(
        fc.constantFrom('cube', 'sphere', 'cylinder', 'cone', 'torus'),
        fc.array(fc.nat(), { minLength: 1, maxLength: 10 }),
        fc.record({
          fraction: fc.double({ min: 0.01, max: 1, noNaN: true }),
          segments: fc.integer({ min: 1, max: 3 }),
          chamfer: fc.boolean(),
        }),
        fc.boolean(),
        (kind, seeds, args, faceMode) => {
          const m = editMeshFrom(primitive(kind, { subdivisionsWidth: 2 }));
          const n = faceMode ? m.counts.faces : m.counts.edges;
          const sel = selectionOf(
            faceMode ? 'face' : 'edge',
            seeds.map((s) => s % n),
            m.counts,
          );
          const { result } = runChecked(bevel, m, sel, args);
          expect(isRefusal(result)).toBe(false);
          ran++;
          expect(consistentlyWound(m)).toBe(true);
          expect(topologyStats(m)).toMatchObject({
            boundaryLoops: 0,
            nonManifoldEdges: 0,
            euler: 2 - (kind === 'torus' ? 2 : 0),
          });
          expect(signedVolume(m)).toBeGreaterThan(0);
        },
      ),
      { numRuns: 40 },
    );
    expect(ran).toBe(40);
  });

  it('P1 + P5: cleanup fixes on polygon soups and projections on primitives', () => {
    const cleanup = MESH_OPS['mesh.cleanup'] as MeshOp;
    const fixes = ['select', 'deleteLamina', 'collapse', 'conform', 'triangulate', 'dissolve', 'deleteLoose'];
    fc.assert(
      fc.property(arbSoup(), fc.constantFrom(...fixes), (soup, fix) => {
        const { result } = runChecked(cleanup, editMeshFrom(soup), null, { fix, selectOnly: false });
        expect(isRefusal(result)).toBe(false);
      }),
      { numRuns: 60 },
    );
    const ops = ['mesh.uv.planar', 'mesh.uv.box', 'mesh.uv.cylindrical'].map((id) => MESH_OPS[id] as MeshOp);
    fc.assert(
      fc.property(
        fc.constantFrom('cube', 'sphere', 'cylinder', 'cone', 'plane', 'torus'),
        fc.constantFrom(...ops),
        fc.boolean(),
        (kind, op, fit) => {
          const { result } = runChecked(op, editMeshFrom(primitive(kind, {})), null, { fit });
          expect(isRefusal(result)).toBe(false);
        },
      ),
      { numRuns: 30 },
    );
  });
});
