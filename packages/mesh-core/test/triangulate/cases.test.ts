// M6A-SPEC §5.4 triangulation goldens and the incremental path (B1): exact triangles for the quad diagonal tie, the
// concave quad, the flip flag and an earcut n-gon facing down; the degenerate n-gon fan (`isDegenerateNgon`); cached
// triangulations updated for dirty faces equal a full recomputation.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { type EditMesh, editMeshFrom, FACE_FLIP_DIAGONAL, type MeshData, primitive, triangulate } from '../../src';
import { buildMeshData, nonManifoldCorpus } from '../../src/testing';
import { isDegenerateNgon } from '../../src/triangulate/triangulate';

const vertTris = (data: MeshData): number[][] => {
  const t = triangulate(data);
  const out: number[][] = [];
  for (let i = 0; i < t.triFace.length; i++) {
    out.push([0, 1, 2].map((k) => data.cornerVert[t.tris[3 * i + k] as number] as number));
  }
  return out;
};

describe('goldens', () => {
  const quad = (positions: number[], flags = 0): MeshData =>
    buildMeshData({ positions, faces: [[0, 1, 2, 3]], faceFlags: [flags] });
  const square = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0];

  it('a square ties: the diagonal holding the smaller vertex index (0–2)', () => {
    expect(vertTris(quad(square))).toEqual([
      [0, 1, 2],
      [0, 2, 3],
    ]);
  });

  it('a tie is decided by the vertex index, not by the corner order', () => {
    // The same square with its corner cycle starting at vertex 2: still the diagonal 0–2.
    const data = buildMeshData({ positions: square, faces: [[2, 3, 0, 1]] });
    expect(vertTris(data)).toEqual([
      [2, 3, 0],
      [2, 0, 1],
    ]);
  });

  it('FACE_FLIP_DIAGONAL takes the other diagonal (1–3)', () => {
    expect(vertTris(quad(square, FACE_FLIP_DIAGONAL))).toEqual([
      [1, 2, 3],
      [1, 3, 0],
    ]);
  });

  it('a concave quad always uses the diagonal inside it, flipped or not', () => {
    const dart = [-4, 0, 0, 1, -1, 0, 0, 0, 0, 1, 1, 0];
    const expected = [
      [0, 1, 2],
      [0, 2, 3],
    ];
    expect(vertTris(quad(dart))).toEqual(expected);
    expect(vertTris(quad(dart, FACE_FLIP_DIAGONAL))).toEqual(expected);
  });

  it('a downward-facing L hexagon: earcut triangles turned to the face winding', () => {
    // The L in the XZ plane wound clockwise seen from +Y, so its Newell normal is −Y.
    const l = buildMeshData({
      positions: [0, 0, 0, 2, 0, 0, 2, 0, 1, 1, 0, 1, 1, 0, 2, 0, 0, 2],
      faces: [[0, 1, 2, 3, 4, 5]],
    });
    const tris = vertTris(l);
    expect(tris).toHaveLength(4);
    for (const [a, b, c] of tris as [number, number, number][]) {
      const p = l.position;
      const ux = (p[3 * b] as number) - (p[3 * a] as number);
      const uz = (p[3 * b + 2] as number) - (p[3 * a + 2] as number);
      const vx = (p[3 * c] as number) - (p[3 * a] as number);
      const vz = (p[3 * c + 2] as number) - (p[3 * a + 2] as number);
      // y of (u × v): negative = facing −Y like the face.
      expect(uz * vx - ux * vz).toBeLessThan(0);
    }
    expect(tris).toEqual(vertTris(l)); // deterministic
  });

  it('a degenerate n-gon falls back to a fan from its first corner', () => {
    const line = buildMeshData({
      positions: [0, 0, 0, 1, 0, 0, 2, 0, 0, 3, 0, 0, 4, 0, 0],
      faces: [[0, 1, 2, 3, 4]],
    });
    expect(isDegenerateNgon(line, 0)).toBe(true);
    expect(vertTris(line)).toEqual([
      [0, 1, 2],
      [0, 2, 3],
      [0, 3, 4],
    ]);
    expect(isDegenerateNgon(primitive('cylinder', {}), 8)).toBe(false);
    for (const data of Object.values(nonManifoldCorpus())) {
      const t = triangulate(data);
      expect(t.triFace.length).toBe(data.counts.corners - 2 * data.counts.faces);
    }
  });
});

describe('incremental', () => {
  /** Faces touching the given points (what a caller passes after a position edit). */
  function facesAround(m: EditMesh, points: ReadonlySet<number>): Uint32Array {
    const out = new Set<number>();
    for (let c = 0; c < m.counts.corners; c++) if (points.has(m.cornerVert(c))) out.add(m.cornerFace(c));
    return Uint32Array.from([...out].sort((a, b) => a - b));
  }

  it('updating dirty faces of a cache equals a full triangulation (property)', () => {
    const base = primitive('cylinder', { subdivisionsHeight: 3, subdivisionsCaps: 0 });
    fc.assert(
      fc.property(
        fc.array(fc.record({ v: fc.nat(), d: fc.double({ min: -0.4, max: 0.4, noNaN: true }) }), {
          minLength: 1,
          maxLength: 8,
        }),
        fc.boolean(),
        (edits, flip) => {
          const m = editMeshFrom(base);
          const cache = triangulate(m);
          const moved = new Set<number>();
          m.begin('nudge');
          for (const { v, d } of edits) {
            const i = v % m.counts.points;
            moved.add(i);
            const p = m.position;
            m.setPosition(i, (p[3 * i] as number) + d, p[3 * i + 1] as number, (p[3 * i + 2] as number) - d);
          }
          if (flip) m.setFaceFlags(0, FACE_FLIP_DIAGONAL);
          m.end();
          const dirty = facesAround(m, moved);
          const faces = flip ? Uint32Array.from(new Set([0, ...dirty])) : dirty;
          expect(triangulate(m, cache, faces)).toEqual(triangulate(m));
        },
      ),
      { numRuns: 80 },
    );
  });

  it('ignores a cache whose face layout no longer matches, and handles "all"', () => {
    const m = editMeshFrom(primitive('cube', {}));
    const cache = triangulate(m);
    m.begin('split');
    m.splitEdgeMakeVert(0, 0.5);
    m.end();
    const full = triangulate(m);
    expect(triangulate(m, cache, Uint32Array.of(0))).toEqual(full);
    expect(triangulate(m, cache, 'all')).toEqual(full);
    expect(triangulate(m, triangulate(m), Uint32Array.of(99))).toEqual(full);
  });
});
