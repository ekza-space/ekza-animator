// M6A-SPEC §5.3, §5.4 (B1): smooth fans bounded by non-manifold edges and bow-tie vertices, the faceted cube, the
// incremental path (cached normals updated for a DirtySet equal a full computation), and the hard-flag helpers
// (H1 precondition, H2 dihedral rule, H3 merge, P7-hard check, resolveSmoothingAngle).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  BUILTIN_LAYERS,
  computeNormals,
  EDGE_CREASE,
  EDGE_HARD,
  EDGE_SEAM,
  type EditMesh,
  editMeshFrom,
  primitive,
  resolveSmoothingAngle,
} from '../../src';
import {
  allEdgesHard,
  applySmoothingAngle,
  dihedralAngle,
  isAllHard,
  isHardByAngle,
  mergeEdgeFlags,
} from '../../src/normals/hard';
import { buildMeshData, nonManifoldCorpus } from '../../src/testing';

const normalOf = (n: Float32Array, i: number): number[] => [
  n[3 * i] as number,
  n[3 * i + 1] as number,
  n[3 * i + 2] as number,
];

describe('fans', () => {
  it('a bow-tie vertex keeps one fan per triangle', () => {
    const data = buildMeshData({
      positions: [0, 0, 0, 1, 0, 0, 1, 1, 0, -1, 0, 0, 0, 0, 1],
      faces: [
        [0, 1, 2],
        [0, 3, 4],
      ],
    });
    const n = computeNormals(data);
    // Corner 0 (face 0) and corner 3 (face 1) sit at vertex 0 but take their own faces' normals.
    expect(normalOf(n.corner, 0)).toEqual(normalOf(n.face, 0));
    expect(normalOf(n.corner, 3)).toEqual(normalOf(n.face, 1));
    expect(normalOf(n.face, 0)).not.toEqual(normalOf(n.face, 1));
  });

  it('a non-manifold edge bounds the fans around it', () => {
    const fin = nonManifoldCorpus()['three-face-edge'];
    const n = computeNormals(fin as NonNullable<typeof fin>);
    for (let c = 0; c < 9; c++) {
      const f = Math.floor(c / 3);
      expect(normalOf(n.corner, c)).toEqual(normalOf(n.face, f));
    }
  });

  it('a smooth closed shape gives every corner of a vertex one normal; hard edges split it', () => {
    const soft = editMeshFrom(primitive('sphere', {}));
    soft.begin('soften');
    for (let e = 0; e < soft.counts.edges; e++) soft.setEdgeFlags(e, 0);
    soft.end();
    const n = computeNormals(soft);
    const byVertex = new Map<number, Set<string>>();
    for (let c = 0; c < soft.counts.corners; c++) {
      const v = soft.cornerVert(c);
      const keys = byVertex.get(v) ?? new Set<string>();
      keys.add(normalOf(n.corner, c).join(','));
      byVertex.set(v, keys);
    }
    expect([...byVertex.values()].filter((keys) => keys.size !== 1)).toEqual([]);
  });
});

describe('incremental', () => {
  function softCylinder(): EditMesh {
    const m = editMeshFrom(primitive('cylinder', { subdivisionsHeight: 2, subdivisionsAxis: 10 }));
    m.begin('soften');
    for (let e = 0; e < m.counts.edges; e += 2) m.setEdgeFlags(e, 0);
    m.addLayer(BUILTIN_LAYERS.normalCustom);
    m.end();
    return m;
  }

  it('updating a cache for a non-topology DirtySet equals a full computation (property)', () => {
    const edit = fc.oneof(
      fc.record({ kind: fc.constant('pos' as const), i: fc.nat(), d: fc.double({ min: -0.3, max: 0.3, noNaN: true }) }),
      fc.record({ kind: fc.constant('flag' as const), i: fc.nat(), hard: fc.boolean() }),
      fc.record({ kind: fc.constant('custom' as const), i: fc.nat(), x: fc.double({ min: -1, max: 1, noNaN: true }) }),
    );
    fc.assert(
      fc.property(fc.array(edit, { minLength: 1, maxLength: 10 }), (edits) => {
        const m = softCylinder();
        const cache = computeNormals(m);
        m.begin('edits');
        for (const e of edits) {
          if (e.kind === 'pos') {
            const v = e.i % m.counts.points;
            const p = m.position;
            m.setPosition(v, (p[3 * v] as number) + e.d, (p[3 * v + 1] as number) - e.d, p[3 * v + 2] as number);
          } else if (e.kind === 'flag') {
            m.setEdgeFlags(e.i % m.counts.edges, e.hard ? EDGE_HARD : 0);
          } else {
            m.layer('normal.custom')?.set(e.i % m.counts.corners, 1, e.x);
          }
        }
        const delta = m.end();
        expect(computeNormals(m, cache, delta.dirty)).toEqual(computeNormals(m));
      }),
      { numRuns: 120 },
    );
  });

  it('falls back to a full computation for topology edits and mismatched caches', () => {
    const m = softCylinder();
    const cache = computeNormals(m);
    m.begin('split');
    m.splitEdgeMakeVert(1, 0.5);
    const delta = m.end();
    expect(computeNormals(m, cache, delta.dirty)).toEqual(computeNormals(m));
    expect(computeNormals(m, { face: new Float32Array(3), corner: new Float32Array(3) }, delta.dirty)).toEqual(
      computeNormals(m),
    );
  });
});

describe('hard-flag helpers (§5.3)', () => {
  it('dihedral angles: cube edges π/2, a flat interior edge 0, a border 0', () => {
    const cube = editMeshFrom(primitive('cube', {}));
    for (let e = 0; e < cube.counts.edges; e++) expect(dihedralAngle(cube, e)).toBeCloseTo(Math.PI / 2, 12);
    const plane = editMeshFrom(primitive('plane', { subdivisionsWidth: 2 }));
    const interior = [...Array(plane.counts.edges).keys()].find((e) => plane.edgeFaceCount(e) === 2) as number;
    expect(dihedralAngle(plane, interior)).toBe(0);
    expect(dihedralAngle(plane, 0)).toBe(0);
  });

  it('H2: hard iff the angle is 0 or the dihedral exceeds it; applySmoothingAngle sets and clears the bit only', () => {
    const m = editMeshFrom(primitive('cylinder', { subdivisionsAxis: 8 })); // side dihedral 45°
    const side = [...Array(m.counts.edges).keys()].filter(
      (e) => Math.abs(dihedralAngle(m, e) - Math.PI / 4) < 1e-5, // float32 positions
    );
    expect(side).toHaveLength(8);
    expect(isHardByAngle(m, side[0] as number, 0)).toBe(true);
    expect(isHardByAngle(m, side[0] as number, Math.PI / 6)).toBe(true);
    expect(isHardByAngle(m, side[0] as number, Math.PI / 3)).toBe(false);
    m.begin('h2');
    m.setEdgeFlags(side[0] as number, EDGE_HARD | EDGE_SEAM);
    applySmoothingAngle(m, side, Math.PI / 3);
    m.end();
    expect(m.edgeFlags(side[0] as number)).toBe(EDGE_SEAM);
    expect(side.every((e) => (m.edgeFlags(e) & EDGE_HARD) === 0)).toBe(true);
    expect(isAllHard(m)).toBe(false);
    m.begin('h2 again');
    applySmoothingAngle(m, side, resolveSmoothingAngle(null, true));
    m.end();
    expect(isAllHard(m)).toBe(true);
  });

  it('H1 precondition and H3 merge', () => {
    const m = editMeshFrom(primitive('cube', {}));
    expect(allEdgesHard(m, 0)).toBe(true);
    m.begin('soft');
    m.setEdgeFlags(m.cornerEdge(m.faceCorner(0)), 0);
    m.end();
    expect(allEdgesHard(m, 0)).toBe(false);
    expect(mergeEdgeFlags(EDGE_HARD, EDGE_SEAM)).toBe(EDGE_HARD | EDGE_SEAM);
    expect(mergeEdgeFlags(0, EDGE_CREASE)).toBe(EDGE_CREASE);
    expect(mergeEdgeFlags(0, 0)).toBe(0);
  });

  it('resolveSmoothingAngle: null → 0 faceted, 30° otherwise; a value wins', () => {
    expect(resolveSmoothingAngle(null, true)).toBe(0);
    expect(resolveSmoothingAngle(null, false)).toBe(Math.PI / 6);
    expect(resolveSmoothingAngle(0.5, true)).toBe(0.5);
    expect(resolveSmoothingAngle(Number.NaN, false)).toBe(Math.PI / 6);
  });
});
