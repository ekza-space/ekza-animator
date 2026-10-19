// M6A-SPEC §5.12 Average Vertices (B4): Laplacian steps toward the edge-neighbour average by `strength`, borders and
// non-manifold vertices pinned, iterations, `adjust`, symmetry (partners averaged then re-mirrored; seam vertices stay
// on the plane with and without Preserve Seam). Also `mesh.applyTransform` (Freeze): positions, inverse-transpose
// custom normals, morph deltas, reversed winding for det < 0, refusals.
import { describe, expect, it } from 'vitest';
import {
  BUILTIN_LAYERS,
  editMeshFrom,
  isRefusal,
  MESH_OPS,
  morphLayer,
  primitive,
  selectionOf,
  topologyStats,
} from '../../../src';
import { buildMeshData, cubeData, signedVolume } from '../../../src/testing';
import { context, position, refusedCode, runOk, vertexAt } from '../harness';
import { asymmetry, testSymmetryMap } from '../symmetry-fixture';

const average = MESH_OPS['mesh.averageVertices'] as NonNullable<(typeof MESH_OPS)[string]>;
const apply = MESH_OPS['mesh.applyTransform'] as NonNullable<(typeof MESH_OPS)[string]>;

const grid = () =>
  editMeshFrom(primitive('plane', { width: 4, height: 4, subdivisionsWidth: 4, subdivisionsHeight: 4 }));

function lift(m: ReturnType<typeof editMeshFrom>, v: number, dy: number): void {
  m.begin('lift');
  const p = position(m, v);
  m.setPosition(v, p[0], p[1] + dy, p[2]);
  m.end();
}

describe('mesh.averageVertices', () => {
  it('a lifted vertex moves halfway to its neighbours’ average; borders stay bit-equal', () => {
    const m = grid();
    const centre = vertexAt(m, [0, 0, 0]);
    lift(m, centre, 1);
    const before = m.snapshot();
    runOk(m, average, null, { iterations: 1, strength: 0.5 });
    expect(position(m, centre)[1]).toBeCloseTo(0.5, 6);
    // Neighbours of the centre moved up by a quarter of 0.5 · (1/4).
    expect(position(m, vertexAt(m, [1, 0.125, 0]))[1]).toBeCloseTo(0.125, 6);
    const border = [...Array(m.counts.points).keys()].filter((v) => {
      const p = position(before, v);
      return Math.abs(p[0]) === 2 || Math.abs(p[2]) === 2;
    });
    expect(border).toHaveLength(16);
    expect(border.map((v) => position(m, v))).toEqual(border.map((v) => position(before, v)));
  });

  it('iterations and strength; adjust re-solves from the pre-op positions', () => {
    const m = grid();
    const centre = vertexAt(m, [0, 0, 0]);
    lift(m, centre, 1);
    m.begin('avg');
    const result = average.run(m, selectionOf('vertex', [centre], m.counts), { iterations: 1, strength: 1 }, context());
    m.end();
    if (isRefusal(result) || result.adjust === undefined) throw new Error('no adjust');
    expect(position(m, centre)[1]).toBe(0);
    m.begin('adjust');
    expect(result.adjust({ strength: 0.25, iterations: 2 })).toBe(true);
    m.end();
    // Only the centre moves: 1 → 0.75 → 0.5625.
    expect(position(m, centre)[1]).toBeCloseTo(0.5625, 6);
  });

  it('pins border and non-manifold vertices; refuses without vertices', () => {
    // Two triangles sharing only a vertex (a bow-tie): the shared vertex is non-manifold.
    const bow = editMeshFrom(
      buildMeshData({
        positions: [0, 0, 0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0],
        faces: [
          [0, 1, 2],
          [0, 4, 3],
        ],
      }),
    );
    const before = bow.snapshot();
    runOk(bow, average, null);
    expect(bow.snapshot().position).toEqual(before.position);
    expect(refusedCode(grid(), average, selectionOf('vertex', [], grid().counts))).toBe('averageVertices.no-vertices');
  });

  it('symmetry: a symmetric bump stays symmetric; seam vertices keep x = 0 exactly', () => {
    for (const preserveSeam of [true, false]) {
      const m = grid();
      lift(m, vertexAt(m, [1, 0, 0]), 0.7);
      lift(m, vertexAt(m, [-1, 0, 0]), 0.7);
      // Push a seam vertex off-centre in y (not x), so it has something to average.
      lift(m, vertexAt(m, [0, 0, 1]), -0.4);
      const map = testSymmetryMap(m);
      runOk(m, average, null, { iterations: 3, strength: 0.6 }, context({ symmetry: { map, preserveSeam } }));
      expect(asymmetry(m, map)).toBeLessThan(1e-6);
      const seam = [...Array(m.counts.points).keys()].filter((v) => map.vertex[v] === v);
      expect(seam).toHaveLength(5);
      expect(seam.map((v) => position(m, v)[0])).toEqual(seam.map(() => 0));
    }
  });
});

describe('mesh.applyTransform (Freeze)', () => {
  const T = (x: number, y: number, z: number) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
  const S = (x: number, y: number, z: number) => [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1];

  it('translates positions; the winding is unchanged', () => {
    const m = editMeshFrom(cubeData());
    runOk(m, apply, null, { matrix: T(1, 2, 3) });
    expect(position(m, 0)).toEqual([0.5, 1.5, 3.5]);
    expect(signedVolume(m)).toBeCloseTo(1, 12);
  });

  it('det < 0 (scale X −1) reverses every face: still closed and outward', () => {
    const m = editMeshFrom(cubeData());
    runOk(m, apply, null, { matrix: S(-1, 1, 1) });
    expect(position(m, 1)).toEqual([-0.5, -0.5, 0.5]);
    expect(signedVolume(m)).toBeCloseTo(1, 12);
    expect(topologyStats(m).boundaryLoops).toBe(0);
  });

  it('custom normals by the inverse transpose, morph deltas by the linear part', () => {
    const m = editMeshFrom(cubeData());
    m.begin('layers');
    const n = m.addLayer(BUILTIN_LAYERS.normalCustom);
    n.set(0, 0, Math.SQRT1_2);
    n.set(0, 1, Math.SQRT1_2);
    const morph = m.addLayer(morphLayer('smile'));
    morph.set(0, 0, 1);
    morph.set(0, 1, 1);
    m.end();
    runOk(m, apply, null, { matrix: [2, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 5, 5, 1] });
    const nn = m.layer('normal.custom');
    const l = Math.hypot(0.5, 1);
    expect(nn?.get(0, 0)).toBeCloseTo(0.5 / l, 6);
    expect(nn?.get(0, 1)).toBeCloseTo(1 / l, 6);
    expect(nn?.get(1, 0)).toBe(0);
    const d = m.layer('morph:smile');
    expect([d?.get(0, 0), d?.get(0, 1), d?.get(0, 2)]).toEqual([2, 1, 0]);
  });

  it('refuses skinned meshes, non-matrices and singular matrices', () => {
    const m = editMeshFrom(cubeData());
    expect(refusedCode(m, apply, null, { matrix: S(0, 1, 1) })).toBe('freeze.singular');
    expect(refusedCode(m, apply, null, { matrix: [1, 2, 3] })).toBe('freeze.invalid-matrix');
    m.begin('skin');
    m.addLayer(BUILTIN_LAYERS.skinJoints);
    m.addLayer(BUILTIN_LAYERS.skinWeights);
    m.end();
    expect(refusedCode(m, apply, null, { matrix: T(1, 0, 0) })).toBe('freeze.skinned');
  });
});
