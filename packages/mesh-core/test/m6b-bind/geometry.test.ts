// C4 `skinGeometryOf` (M6B-SPEC §4.2): positions, M6a's triangulation mapped corners → points, angle-weighted point
// normals and the fixed X partner map (never a user's Model symmetry), cached per stored MeshData.
import { describe, expect, it } from 'vitest';
import { editMeshFrom, pointGraph, pointTriangles, skinGeometryOf, skinIslands, triangulate } from '../../src';
import { cubeData } from '../../src/testing';
import { body, cubeLad } from './fixtures';
import { cubeLadTruth } from './goldens';

describe('skinGeometryOf', () => {
  it('the unit cube: 8 points, 12 triangles over points, corner normals (±1, ±1, ±1)/√3, every point paired', () => {
    const data = cubeData();
    const geom = skinGeometryOf(data, 1);
    expect(geom.positions.length).toBe(24);
    expect(geom.tris.length).toBe(36);
    const corners = triangulate(data).tris;
    for (let i = 0; i < corners.length; i++) expect(geom.tris[i]).toBe(data.cornerVert[corners[i] as number]);
    for (let p = 0; p < 8; p++) {
      for (let d = 0; d < 3; d++) {
        const expected = Math.sign(geom.positions[3 * p + d] as number) / Math.sqrt(3);
        expect(geom.normals[3 * p + d]).toBeCloseTo(expected, 12);
      }
      const partner = geom.partner[p] as number;
      expect(geom.positions[3 * partner]).toBe(-(geom.positions[3 * p] as number));
    }
    expect(geom.paired).toBe(1);
  });

  it('the generated bodies are fully paired (seam points are their own partner); the map is an involution', () => {
    for (const style of ['smooth', 'segmented'] as const) {
      const geom = skinGeometryOf(body(style), 1.6);
      expect(geom.paired).toBe(1);
      const all = [...Array(geom.partner.length).keys()];
      expect(all.filter((p) => geom.partner[geom.partner[p] as number] !== p)).toEqual([]);
      const seam = all.filter((p) => geom.partner[p] === p);
      expect(seam.filter((p) => Math.abs(geom.positions[3 * p] as number) > 1.6e-4)).toEqual([]);
    }
  });

  it('the same geometry from the stored and the edit form; the stored form is cached per height', () => {
    const data = body('smooth');
    const a = skinGeometryOf(data, 1.6);
    expect(skinGeometryOf(data, 1.6)).toBe(a);
    const b = skinGeometryOf(editMeshFrom(data), 1.6);
    expect(b).not.toBe(a);
    expect(Array.from(b.positions)).toEqual(Array.from(a.positions));
    expect(Array.from(b.tris)).toEqual(Array.from(a.tris));
    expect(Array.from(b.normals)).toEqual(Array.from(a.normals));
    expect(Array.from(b.partner)).toEqual(Array.from(a.partner));
    // A different height is a different tolerance: recomputed (and the new one cached).
    expect(skinGeometryOf(data, 3.2)).not.toBe(a);
  });

  it('islands, incident triangles and the point graph of the Cube Lad: 16 boxes of 8 points', () => {
    const { mesh } = cubeLad(cubeLadTruth());
    const geom = skinGeometryOf(mesh, 1.7);
    const islands = skinIslands(geom);
    expect(islands.count).toBe(16);
    for (let i = 0; i < 16; i++) {
      expect((islands.start[i + 1] as number) - (islands.start[i] as number)).toBe(8);
      expect(islands.points[islands.start[i] as number]).toBe(8 * i);
    }
    // The torso box centroid (area-weighted) is its centre.
    expect(islands.centroid[1]).toBeCloseTo(1.2, 6);
    const incident = pointTriangles(geom);
    for (let p = 0; p < 8; p++) {
      const n = (incident.start[p + 1] as number) - (incident.start[p] as number);
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(6);
    }
    const graph = pointGraph(geom);
    for (let p = 0; p < 8; p++) {
      const next = Array.from(graph.next.subarray(graph.start[p] as number, graph.start[p + 1] as number));
      expect(next.every((q) => q < 8 && q !== p)).toBe(true);
      expect([...next].sort((x, y) => x - y)).toEqual(next);
    }
  });
});
