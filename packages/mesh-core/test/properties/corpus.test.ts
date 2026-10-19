// Invariants on the synthetic non-manifold corpus (M6A-SPEC §9 B1 tests; research 13 §12 "synthetic nasties"):
// bow-tie, 3-face edge, flipped face, duplicate faces, zero-area, loose geometry and a degenerate n-gon are valid
// meshes (validateMesh finds nothing; Mesh Check reports them), with the stats that describe them; Euler sequences
// on them keep every invariant (P1) and undo exactly (P5).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { computeNormals, editMeshFrom, topologyStats, triangulate, validateMesh } from '../../src';
import { arbEulerStep, nonManifoldCorpus } from '../../src/testing';
import { checkSequence } from './harness';

const corpus = nonManifoldCorpus();

describe('the synthetic non-manifold corpus', () => {
  it.each(Object.entries(corpus))(
    '%s is a valid mesh (stored and edit form) with finite derived data',
    (_name, data) => {
      expect(validateMesh(data)).toEqual([]);
      const m = editMeshFrom(data);
      expect(validateMesh(m)).toEqual([]);
      const normals = computeNormals(m);
      expect([...normals.corner].every(Number.isFinite)).toBe(true);
      expect(triangulate(m).triFace.length).toBe(data.counts.corners - 2 * data.counts.faces);
    },
  );

  it('stats describe each defect', () => {
    expect(topologyStats(corpus['bowtie'] as never)).toMatchObject({ nonManifoldVerts: 1, nonManifoldEdges: 0 });
    expect(topologyStats(corpus['three-face-edge'] as never)).toMatchObject({ nonManifoldEdges: 1, genus: null });
    expect(topologyStats(corpus['duplicate-faces'] as never)).toMatchObject({ nonManifoldEdges: 4 });
    expect(topologyStats(corpus['flipped-face'] as never)).toMatchObject({ shells: 1, boundaryLoops: 1 });
    // 5 points (one loose), 4 edges (one wire), 1 face.
    expect(topologyStats(corpus['loose'] as never)).toMatchObject({ shells: 1, euler: 2 });
    expect(topologyStats(corpus['bad-ngon'] as never)).toMatchObject({ ngons: 1, triangles: 4 });
    const loose = editMeshFrom(corpus['loose'] as never);
    expect(loose.vertEdge(4)).toBe(-1);
    expect(loose.edgeFaceCount(3)).toBe(0);
    expect(loose.isManifoldVert(2)).toBe(false); // the wire edge touches the triangle's fan
  });

  it.each(Object.entries(corpus))('%s: Euler sequences keep the invariants and undo exactly', (_name, data) => {
    fc.assert(
      fc.property(fc.array(arbEulerStep(), { minLength: 50, maxLength: 150 }), (steps) => {
        const { tally } = checkSequence(data, steps);
        expect(tally.applied + tally.refused + tally.skipped).toBe(steps.length);
      }),
      { numRuns: 4 },
    );
  });
});
