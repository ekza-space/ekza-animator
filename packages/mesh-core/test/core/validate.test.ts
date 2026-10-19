// M6A-SPEC §5.1 (moved from B0a's reference tests): validateMesh on valid meshes and the broken fixtures (never
// throws), layer lengths, orphan corners and missing corner edges; topologyStats.
import { describe, expect, it } from 'vitest';
import { BUILTIN_LAYERS, editMeshFrom, type MeshData, primitive, topologyStats, validateMesh } from '../../src';
import { brokenMeshes, buildMeshData, cubeData } from '../../src/testing';

const PRIMITIVES: Readonly<Record<string, MeshData>> = {
  cube: primitive('cube', {}),
  'cube-2x1x1': primitive('cube', { subdivisionsWidth: 2 }),
  plane: primitive('plane', {}),
  'plane-2x1': primitive('plane', { width: 2, subdivisionsWidth: 2 }),
  cylinder: primitive('cylinder', {}),
  'cylinder-caps2': primitive('cylinder', { subdivisionsCaps: 2, subdivisionsHeight: 2 }),
};

describe('validateMesh (§5.1 invariants 1–5)', () => {
  it('finds nothing on valid meshes', () => {
    for (const data of Object.values(PRIMITIVES)) {
      expect(validateMesh(data)).toEqual([]);
      expect(validateMesh(editMeshFrom(data))).toEqual([]);
    }
  });

  it.each(Object.entries(brokenMeshes()))('reports %s on the broken fixture (and never throws)', (key, data) => {
    const problems = validateMesh(data);
    expect(problems.map((problem) => problem.code)).toContain(key.split(' ')[0]);
    for (const problem of problems) expect(problem.message.length).toBeGreaterThan(0);
  });

  it('checks attribute layer lengths against their domain counts (invariant 1)', () => {
    const data = brokenMeshes()['counts.length (layer)'] as MeshData;
    expect(validateMesh(data)).toEqual([{ code: 'counts.length', message: 'layer paint has 5 values, expected 6' }]);
    expect(() => editMeshFrom(data)).toThrow(/layer paint/);
    // A well-formed layer passes.
    const good = { ...data, layers: new Map([['paint', { def: BUILTIN_LAYERS.paint, data: new Uint16Array(6) }]]) };
    expect(validateMesh(good)).toEqual([]);
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
