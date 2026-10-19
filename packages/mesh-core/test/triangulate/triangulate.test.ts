// M6A-SPEC §5.4 (moved from B0a's reference tests): the one triangulation — n − 2 triangles per face in face order,
// CCW like the face; quads on the shorter diagonal with ties to the smaller vertex index, FACE_FLIP_DIAGONAL, concave
// quads; earcut n-gons with the face's winding.
import { describe, expect, it } from 'vitest';
import { computeNormals, FACE_FLIP_DIAGONAL, type MeshData, primitive, triangulate } from '../../src';
import { buildMeshData } from '../../src/testing';

const PRIMITIVES: Readonly<Record<string, MeshData>> = {
  cube: primitive('cube', {}),
  'cube-2x1x1': primitive('cube', { subdivisionsWidth: 2 }),
  plane: primitive('plane', {}),
  'plane-2x1': primitive('plane', { width: 2, subdivisionsWidth: 2 }),
  cylinder: primitive('cylinder', {}),
  'cylinder-caps2': primitive('cylinder', { subdivisionsCaps: 2, subdivisionsHeight: 2 }),
};

describe('triangulate (§5.4)', () => {
  it('emits n − 2 triangles per face in face order, CCW like the face (positive dot with its Newell normal)', () => {
    for (const data of Object.values(PRIMITIVES)) {
      const tri = triangulate(data);
      const normals = computeNormals(data);
      const p = data.position;
      expect(tri.faceTriStart.length).toBe(data.counts.faces + 1);
      for (let f = 0; f < data.counts.faces; f++) {
        let n = 0;
        let c = data.faceCorner[f] as number;
        do {
          n++;
          c = data.cornerNext[c] as number;
        } while (c !== data.faceCorner[f]);
        expect((tri.faceTriStart[f + 1] as number) - (tri.faceTriStart[f] as number)).toBe(n - 2);
      }
      for (let t = 0; t < tri.triFace.length; t++) {
        const [a, b, c] = [0, 1, 2].map((k) => data.cornerVert[tri.tris[3 * t + k] as number] as number) as [
          number,
          number,
          number,
        ];
        const u = [0, 1, 2].map((k) => (p[3 * b + k] as number) - (p[3 * a + k] as number));
        const v = [0, 1, 2].map((k) => (p[3 * c + k] as number) - (p[3 * a + k] as number));
        const cross = [
          (u[1] as number) * (v[2] as number) - (u[2] as number) * (v[1] as number),
          (u[2] as number) * (v[0] as number) - (u[0] as number) * (v[2] as number),
          (u[0] as number) * (v[1] as number) - (u[1] as number) * (v[0] as number),
        ];
        const f = tri.triFace[t] as number;
        const dot = cross.reduce((sum, x, k) => sum + x * (normals.face[3 * f + k] as number), 0);
        expect(dot).toBeGreaterThan(0);
      }
    }
  });

  const quad = (positions: number[], flags = 0): MeshData =>
    buildMeshData({ positions, faces: [[0, 1, 2, 3]], faceFlags: [flags] });
  const diagonal = (data: MeshData): string => {
    const t = triangulate(data);
    const shared = Array.from(t.tris.slice(0, 3))
      .filter((c) => t.tris.slice(3, 6).includes(c))
      .sort((a, b) => a - b);
    return shared.join('-');
  };

  it('splits quads along the shorter diagonal, ties to the diagonal with the smaller vertex index', () => {
    // A rhombus longer along x: diagonal 1–3 (vertical) is shorter.
    expect(diagonal(quad([-2, 0, 0, 0, -1, 0, 2, 0, 0, 0, 1, 0]))).toBe('1-3');
    // A square: tie → the diagonal holding vertex 0.
    expect(diagonal(quad([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]))).toBe('0-2');
  });

  it('FACE_FLIP_DIAGONAL inverts the choice; a concave quad always uses the other diagonal', () => {
    expect(diagonal(quad([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], FACE_FLIP_DIAGONAL))).toBe('1-3');
    // Arrowhead with a notch at vertex 2: the shorter diagonal 1–3 crosses the notch (outside the face), so the
    // concave rule takes 0–2, with or without the flip flag.
    const dart = [-4, 0, 0, 1, -1, 0, 0, 0, 0, 1, 1, 0];
    expect(diagonal(quad(dart))).toBe('0-2');
    expect(diagonal(quad(dart, FACE_FLIP_DIAGONAL))).toBe('0-2');
  });

  it('triangulates n-gons by earcut on the dominant plane, keeping concave shapes inside', () => {
    // An L-shaped hexagon in the XZ plane facing +Y (concave at vertex 3).
    const l = buildMeshData({
      positions: [0, 0, 0, 0, 0, 2, 1, 0, 2, 1, 0, 1, 2, 0, 1, 2, 0, 0],
      faces: [[0, 1, 2, 3, 4, 5]],
    });
    const tri = triangulate(l);
    expect(tri.tris.length / 3).toBe(4);
    // Total triangle area equals the L's area (3).
    let area = 0;
    for (let t = 0; t < 4; t++) {
      const [a, b, c] = [0, 1, 2].map((k) => tri.tris[3 * t + k] as number) as [number, number, number];
      const ax = l.position[3 * a] as number;
      const az = l.position[3 * a + 2] as number;
      const bx = l.position[3 * b] as number;
      const bz = l.position[3 * b + 2] as number;
      const cx = l.position[3 * c] as number;
      const cz = l.position[3 * c + 2] as number;
      area += Math.abs((bx - ax) * (cz - az) - (cx - ax) * (bz - az)) / 2;
    }
    expect(area).toBeCloseTo(3, 12);
  });
});
