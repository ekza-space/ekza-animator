// M6A-SPEC §5.4 (moved from B0a's reference tests): corner normals in smooth fans bounded by hard and border edges,
// angle weights, custom normals, degenerate faces, resolveSmoothingAngle.
import { describe, expect, it } from 'vitest';
import { BUILTIN_LAYERS, computeNormals, editMeshFrom, primitive, resolveSmoothingAngle } from '../../src';
import { buildMeshData, cubeData } from '../../src/testing';

describe('computeNormals (§5.4)', () => {
  it('a faceted cube has corner normals equal to its face normals', () => {
    const normals = computeNormals(primitive('cube', {}));
    const data = primitive('cube', {});
    for (let c = 0; c < data.counts.corners; c++) {
      let f = 0;
      while (f + 1 < data.counts.faces && (data.faceCorner[f + 1] as number) <= c) f++;
      expect(Array.from(normals.corner.slice(3 * c, 3 * c + 3))).toEqual(
        Array.from(normals.face.slice(3 * f, 3 * f + 3)),
      );
    }
  });

  it('a smooth cube averages its three faces at each corner (angle-weighted)', () => {
    const smooth = cubeData({ hard: false });
    const normals = computeNormals(smooth);
    const s = 1 / Math.sqrt(3);
    for (let c = 0; c < smooth.counts.corners; c++) {
      const v = smooth.cornerVert[c] as number;
      const expected = [0, 1, 2].map((k) => Math.sign(smooth.position[3 * v + k] as number) * s);
      for (let k = 0; k < 3; k++) expect(normals.corner[3 * c + k]).toBeCloseTo(expected[k] as number, 6);
    }
  });

  it('smooth fans stop at hard edges and borders; unit length everywhere', () => {
    // Plane 2×1, all edges smooth: the shared middle edge is smooth, the outline is border.
    const data = buildMeshData({
      positions: primitive('plane', { width: 2, subdivisionsWidth: 2 }).position,
      faces: [
        [0, 3, 4, 1],
        [1, 4, 5, 2],
      ],
    });
    const n = computeNormals(data);
    for (let c = 0; c < data.counts.corners; c++) {
      const length = Math.hypot(
        n.corner[3 * c] as number,
        n.corner[3 * c + 1] as number,
        n.corner[3 * c + 2] as number,
      );
      expect(length).toBeCloseTo(1, 6);
      expect(n.corner[3 * c + 1]).toBeCloseTo(1, 6);
    }
    // A smooth cylinder side: neighbouring side faces blend, the caps stay separate (hard rims stay hard).
    const cylinder = primitive('cylinder', {});
    const m = editMeshFrom(cylinder);
    m.begin('soften sides');
    for (let e = 0; e < m.counts.edges; e++) {
      const a = m.edgeVert(e, 0);
      const b = m.edgeVert(e, 1);
      // vertical side edges join a bottom-ring and a top-ring vertex
      if (Math.sign(m.position[3 * a + 1] as number) !== Math.sign(m.position[3 * b + 1] as number))
        m.setEdgeFlags(e, 0);
    }
    m.end();
    const soft = computeNormals(m);
    const corner0 = Array.from(soft.corner.slice(0, 3));
    expect(corner0[1]).toBeCloseTo(0, 6); // a side corner: horizontal normal
    expect(Math.hypot(corner0[0] as number, corner0[2] as number)).toBeCloseTo(1, 6);
  });

  it('uses non-zero normal.custom values', () => {
    const data = buildMeshData({
      positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
      faces: [[0, 1, 2]],
      layers: [{ def: BUILTIN_LAYERS.normalCustom, data: [0, 0, 2, 0, 0, 0, 1, 0, 0] }],
    });
    const n = computeNormals(data);
    expect([...n.corner]).toEqual([0, 0, 1, 0, 0, 1, 1, 0, 0]);
  });

  it('a degenerate face gets the normal [0, 1, 0]', () => {
    const data = buildMeshData({ positions: [0, 0, 0, 1, 0, 0, 2, 0, 0], faces: [[0, 1, 2]] });
    expect([...computeNormals(data).face]).toEqual([0, 1, 0]);
  });

  it('resolveSmoothingAngle: null → 0 on faceted meshes, 30° otherwise', () => {
    expect(resolveSmoothingAngle(null, true)).toBe(0);
    expect(resolveSmoothingAngle(null, false)).toBeCloseTo(Math.PI / 6, 15);
    expect(resolveSmoothingAngle(0.2, true)).toBe(0.2);
  });
});
