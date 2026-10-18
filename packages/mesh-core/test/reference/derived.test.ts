// M6A-SPEC §5.1, §5.4, §5.29 (B0a reference derived data): triangulation and normals goldens on the reference
// primitives (`test/goldens/reference-primitives.json`; `UPDATE_GOLDENS=1` rewrites them), the quad rules (shorter
// diagonal, ties to the smaller vertex index, FACE_FLIP_DIAGONAL, concave quads), earcut n-gons with the face's
// winding, corner normals in smooth fans bounded by hard/border/non-manifold edges, custom normals, validateMesh on
// the broken fixtures and topologyStats.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  BUILTIN_LAYERS,
  computeNormals,
  editMeshFrom,
  FACE_FLIP_DIAGONAL,
  type MeshData,
  primitive,
  resolveSmoothingAngle,
  topologyStats,
  triangulate,
  validateMesh,
  writeRevision,
} from '../../src';
import { brokenMeshes, buildMeshData, cubeData } from '../../src/testing';

const GOLDENS = join(dirname(fileURLToPath(import.meta.url)), '../goldens/reference-primitives.json');
const round = (values: ArrayLike<number>): number[] => Array.from(values, (v) => Math.round(v * 1e6) / 1e6 + 0);

const PRIMITIVES: Readonly<Record<string, MeshData>> = {
  cube: primitive('cube', {}),
  'cube-2x1x1': primitive('cube', { subdivisionsWidth: 2 }),
  plane: primitive('plane', {}),
  'plane-2x1': primitive('plane', { width: 2, subdivisionsWidth: 2 }),
  cylinder: primitive('cylinder', {}),
  'cylinder-caps2': primitive('cylinder', { subdivisionsCaps: 2, subdivisionsHeight: 2 }),
};

function goldenOf(data: MeshData): unknown {
  const tri = triangulate(data);
  const normals = computeNormals(data);
  return {
    counts: data.counts,
    tris: [...tri.tris],
    triFace: [...tri.triFace],
    faceTriStart: [...tri.faceTriStart],
    faceNormals: round(normals.face),
    cornerNormals: round(normals.corner),
    manifest: writeRevision(data).manifestId,
  };
}

describe('goldens on the reference primitives', () => {
  const computed = Object.fromEntries(Object.entries(PRIMITIVES).map(([name, data]) => [name, goldenOf(data)]));
  if (process.env['UPDATE_GOLDENS'] === '1' || !existsSync(GOLDENS)) {
    writeFileSync(GOLDENS, `${JSON.stringify(computed, null, 1)}\n`);
  }
  const goldens = JSON.parse(readFileSync(GOLDENS, 'utf8')) as Record<string, unknown>;
  it.each(Object.keys(PRIMITIVES))('%s matches its golden (triangles, normals, revision id)', (name) => {
    expect(computed[name]).toEqual(goldens[name]);
  });
});

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

describe('validateMesh (§5.1 invariants 1–5)', () => {
  it('finds nothing on valid meshes', () => {
    for (const data of Object.values(PRIMITIVES)) {
      expect(validateMesh(data)).toEqual([]);
      expect(validateMesh(editMeshFrom(data))).toEqual([]);
    }
  });

  it.each(Object.entries(brokenMeshes()))('reports %s on the broken fixture (and never throws)', (codeName, data) => {
    const problems = validateMesh(data);
    expect(problems.map((problem) => problem.code)).toContain(codeName);
    for (const problem of problems) expect(problem.message.length).toBeGreaterThan(0);
  });

  it('reports a corner that is in no face and a missing corner edge', () => {
    const cube = cubeData();
    const missingEdge = {
      ...cube,
      counts: { ...cube.counts, edges: 11 },
      edgeVerts: cube.edgeVerts.slice(0, 22),
      edgeFlags: cube.edgeFlags.slice(0, 11),
    };
    expect(validateMesh(missingEdge).map((p) => p.code)).toContain('corner.no-edge');
    const orphan = {
      ...cube,
      counts: { ...cube.counts, faces: 5 },
      faceCorner: cube.faceCorner.slice(0, 5),
      faceMaterial: cube.faceMaterial.slice(0, 5),
      faceFlags: cube.faceFlags.slice(0, 5),
    };
    expect(validateMesh(orphan).map((p) => p.code)).toContain('corner.orphan');
  });
});

describe('topologyStats', () => {
  it('cube, plane, cylinder', () => {
    expect(topologyStats(primitive('cube', {}))).toEqual({
      shells: 1,
      boundaryLoops: 0,
      euler: 2,
      nonManifoldEdges: 0,
      nonManifoldVerts: 0,
      genus: 0,
      triangles: 12,
      ngons: 0,
    });
    expect(topologyStats(primitive('plane', { subdivisionsWidth: 3 }))).toMatchObject({
      shells: 1,
      boundaryLoops: 1,
      euler: 1,
      genus: null,
      triangles: 6,
    });
    expect(topologyStats(primitive('cylinder', {}))).toMatchObject({ euler: 2, genus: 0, triangles: 28, ngons: 2 });
  });

  it('counts shells, non-manifold edges and vertices', () => {
    const two = buildMeshData({
      positions: [0, 0, 0, 1, 0, 0, 0, 1, 0, 5, 0, 0, 6, 0, 0, 5, 1, 0],
      faces: [
        [0, 1, 2],
        [3, 4, 5],
      ],
    });
    expect(topologyStats(two)).toMatchObject({ shells: 2, boundaryLoops: 2, euler: 2 });
    // Three triangles around one edge: a non-manifold edge.
    const fin = buildMeshData({
      positions: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1],
      faces: [
        [0, 1, 2],
        [1, 0, 3],
        [0, 1, 4],
      ],
    });
    expect(topologyStats(fin)).toMatchObject({ nonManifoldEdges: 1, genus: null });
    const bowtie = buildMeshData({
      positions: [0, 0, 0, 1, 0, 0, 1, 1, 0, -1, 0, 0, -1, -1, 0],
      faces: [
        [0, 1, 2],
        [0, 3, 4],
      ],
    });
    expect(topologyStats(bowtie)).toMatchObject({ nonManifoldVerts: 1, shells: 1 });
  });
});
