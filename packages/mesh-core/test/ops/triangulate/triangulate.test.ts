// M6A-SPEC §5.13 Triangulate / Quadrangulate (B4): the cube oracle 8/18/12, the written triangles equal the shared
// triangulation (WYSIWYG), H1 on the new edges, Quadrangulate as the inverse that keeps the visible diagonal, the keep*
// options and the symmetric pairing (P10 with the test map).
import { describe, expect, it } from 'vitest';
import {
  EDGE_HARD,
  editMeshFrom,
  FACE_FLIP_DIAGONAL,
  MESH_OPS,
  primitive,
  selectionOf,
  topologyStats,
  triangulate,
} from '../../../src';
import { buildMeshData, cubeData, signedVolume, vef } from '../../../src/testing';
import { context, faceVertList, refusedCode, runOk } from '../harness';
import { asymmetry, expand, testSymmetryMap } from '../symmetry-fixture';

const op = (id: string) => MESH_OPS[id] as NonNullable<(typeof MESH_OPS)[string]>;

/** The rendered triangles as sorted vertex triples (what the viewport and export show). */
function shownTriangles(m: ReturnType<typeof editMeshFrom>): string[] {
  const t = triangulate(m);
  const out: string[] = [];
  for (let i = 0; i < t.triFace.length; i++) {
    out.push(
      [0, 1, 2]
        .map((k) => m.cornerVert(t.tris[3 * i + k] as number))
        .sort((a, b) => a - b)
        .join(','),
    );
  }
  return out.sort();
}

describe('mesh.triangulate', () => {
  it('cube → 8/18/12, closed, outward; the triangles are the ones the viewport showed', () => {
    const m = editMeshFrom(primitive('cube', {}));
    const shown = shownTriangles(m);
    const result = runOk(m, op('mesh.triangulate'), null);
    expect(vef(m)).toBe('8/18/12');
    expect(topologyStats(m).boundaryLoops).toBe(0);
    expect(signedVolume(m)).toBeCloseTo(1, 12);
    expect(shownTriangles(m)).toEqual(shown);
    expect(result.selection.kind).toBe('face');
    expect(result.selection.faces.count()).toBe(12);
    for (let f = 0; f < m.counts.faces; f++) expect(m.faceFlags(f) & FACE_FLIP_DIAGONAL).toBe(0);
  });

  it('H1: new edges are hard only where every edge of the face was hard', () => {
    const m = editMeshFrom(cubeData({ hard: false }));
    runOk(m, op('mesh.triangulate'), selectionOf('face', [0], m.counts));
    expect(vef(m)).toBe('8/13/7');
    for (let e = 0; e < m.counts.edges; e++) expect(m.edgeFlags(e) & EDGE_HARD).toBe(0);
    const hard = editMeshFrom(cubeData());
    runOk(hard, op('mesh.triangulate'), selectionOf('face', [0], hard.counts));
    expect(hard.edgeFlags(12) & EDGE_HARD).toBe(EDGE_HARD);
  });

  it('n-gons: the 8-gon caps of a cylinder become 6 triangles each; corner values travel with their vertex', () => {
    const m = editMeshFrom(primitive('cylinder', {}));
    const uv = m.layer('uv0');
    const before = new Map<string, number>();
    for (const f of [8, 9]) {
      let c = m.faceCorner(f);
      const s = c;
      do {
        before.set(`${f}:${m.cornerVert(c)}`, uv?.get(c, 0) as number);
        c = m.cornerNext(c);
      } while (c !== s);
    }
    runOk(m, op('mesh.triangulate'), selectionOf('face', [8, 9], m.counts));
    expect(vef(m)).toBe('16/34/20');
    // Every triangle of a cap carries its cap's UVs at each vertex.
    const caps = new Set<number>([8, 9, ...Array.from({ length: 10 }, (_, i) => 10 + i)]);
    for (const f of caps) {
      const verts = faceVertList(m, f);
      expect(verts).toHaveLength(3);
      let c = m.faceCorner(f);
      const s = c;
      do {
        const v = m.cornerVert(c);
        const values = [8, 9].map((g) => before.get(`${g}:${v}`)).filter((x) => x !== undefined);
        expect(values).toContain(uv?.get(c, 0));
        c = m.cornerNext(c);
      } while (c !== s);
    }
  });

  it('refuses without faces; a triangle-only selection changes nothing', () => {
    const m = editMeshFrom(primitive('cube', {}));
    expect(refusedCode(m, op('mesh.triangulate'), selectionOf('face', [], m.counts))).toBe('triangulate.no-faces');
    runOk(m, op('mesh.triangulate'), null);
    const before = m.snapshot();
    runOk(m, op('mesh.triangulate'), null);
    expect(m.snapshot()).toEqual(before);
  });

  it('P10: a symmetric mesh stays topologically symmetric (partner quads get the mirrored diagonal)', () => {
    const m = editMeshFrom(primitive('cube', { subdivisionsWidth: 2, subdivisionsHeight: 2, subdivisionsDepth: 2 }));
    const map = testSymmetryMap(m);
    const sel = expand(selectionOf('face', [...Array(m.counts.faces).keys()], m.counts), map);
    runOk(m, op('mesh.triangulate'), sel, {}, context({ symmetry: { map, preserveSeam: true } }));
    const after = testSymmetryMap(m);
    expect(asymmetry(m, after)).toBe(0);
    // Every edge off the seam has a partner edge (topological symmetry), seam faces excepted.
    let missing = 0;
    for (let e = 0; e < m.counts.edges; e++) if ((after.edge[e] as number) < 0) missing++;
    expect(missing).toBe(0);
  });
});

describe('mesh.quadrangulate', () => {
  it('inverts Triangulate on a smooth cube and keeps the shown diagonal', () => {
    const m = editMeshFrom(cubeData({ hard: false }));
    runOk(m, op('mesh.triangulate'), null);
    const shown = shownTriangles(m);
    const result = runOk(m, op('mesh.quadrangulate'), null);
    expect(vef(m)).toBe('8/12/6');
    expect(shownTriangles(m)).toEqual(shown);
    expect(result.selection.faces.count()).toBe(6);
    expect(signedVolume(m)).toBeCloseTo(1, 12);
  });

  it('keepHardEdges refuses on a faceted mesh with the reason; off, it joins', () => {
    const m = editMeshFrom(primitive('cube', {}));
    runOk(m, op('mesh.triangulate'), null);
    expect(refusedCode(m, op('mesh.quadrangulate'), null)).toBe('quadrangulate.no-pairs');
    runOk(m, op('mesh.quadrangulate'), null, { keepHardEdges: false });
    expect(vef(m)).toBe('8/12/6');
  });

  it('respects the angle, material and paint borders', () => {
    // Two triangles folded 60° along their shared edge.
    const fold = editMeshFrom(
      buildMeshData({
        positions: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0.3, -0.5, Math.sqrt(3) / 2],
        faces: [
          [0, 1, 2],
          [1, 0, 3],
        ],
      }),
    );
    expect(refusedCode(fold, op('mesh.quadrangulate'), null)).toBe('quadrangulate.no-pairs');
    runOk(fold, op('mesh.quadrangulate'), null, { angle: Math.PI * 0.75 });
    expect(vef(fold)).toBe('4/4/1');
    const flat = buildMeshData({
      positions: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0],
      faces: [
        [0, 1, 2],
        [0, 2, 3],
      ],
    });
    const m = editMeshFrom(flat);
    m.begin('material');
    m.setFaceMaterial(1, 1);
    m.end();
    expect(refusedCode(m, op('mesh.quadrangulate'), null)).toBe('quadrangulate.no-pairs');
    runOk(m, op('mesh.quadrangulate'), null, { keepMaterials: false });
    expect(vef(m)).toBe('4/4/1');
  });

  it('P10: symmetric pairs are joined with their mirror images', () => {
    const m = editMeshFrom(primitive('plane', { width: 4, height: 2, subdivisionsWidth: 4, subdivisionsHeight: 2 }));
    runOk(m, op('mesh.triangulate'), null);
    const map = testSymmetryMap(m);
    const sel = expand(selectionOf('face', [...Array(m.counts.faces).keys()], m.counts), map);
    runOk(
      m,
      op('mesh.quadrangulate'),
      sel,
      { keepHardEdges: false },
      context({ symmetry: { map, preserveSeam: true } }),
    );
    const after = testSymmetryMap(m);
    let missing = 0;
    for (let e = 0; e < m.counts.edges; e++) if ((after.edge[e] as number) < 0) missing++;
    expect(missing).toBe(0);
    for (let f = 0; f < m.counts.faces; f++) expect(after.face[f]).toBeGreaterThanOrEqual(0);
  });
});
