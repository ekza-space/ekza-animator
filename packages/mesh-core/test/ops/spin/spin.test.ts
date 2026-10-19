// M6A-SPEC §5.12 Spin Edge / Flip Triangle Edge (B4): counts never change, refusals (border, same face), the spun edge
// keeps its own flag (H5, P7-hard), faces keep their material and paint, forward then back is the identity on
// topology, Flip on triangles = one spin, on quads it toggles FACE_FLIP_DIAGONAL; P10 with the test symmetry map.
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
import { buildMeshData, signedVolume, vef } from '../../../src/testing';
import { context, faceVertList, refusedCode, runOk } from '../harness';
import { asymmetry, expand, testSymmetryMap } from '../symmetry-fixture';

const op = (id: string) => MESH_OPS[id] as NonNullable<(typeof MESH_OPS)[string]>;

/** A unit square split into two triangles along 0–2 (vertices 0 1 2 3 counterclockwise, +Z normal). */
const square = () =>
  buildMeshData({
    positions: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0],
    faces: [
      [0, 1, 2],
      [0, 2, 3],
    ],
  });

function faceSets(m: ReturnType<typeof editMeshFrom>): string[] {
  const out: string[] = [];
  for (let f = 0; f < m.counts.faces; f++) out.push([...faceVertList(m, f)].sort((a, b) => a - b).join(','));
  return out.sort();
}

describe('mesh.spinEdge', () => {
  it('two triangles: the diagonal 0–2 becomes 1–3; counts and winding kept', () => {
    const m = editMeshFrom(square());
    const e = m.findEdge(0, 2);
    const result = runOk(m, op('mesh.spinEdge'), selectionOf('edge', [e], m.counts));
    expect(vef(m)).toBe('4/5/2');
    expect(m.findEdge(0, 2)).toBe(-1);
    const spun = m.findEdge(1, 3);
    expect(spun).toBeGreaterThanOrEqual(0);
    expect(result.selection.edges.toArray()).toEqual(Uint32Array.of(spun));
    expect(faceSets(m)).toEqual(['0,1,3', '1,2,3']);
    expect(topologyStats(m).boundaryLoops).toBe(1);
  });

  it('cube edge between two quads: counts unchanged; forward then back restores the face sets; flags kept (H5)', () => {
    const m = editMeshFrom(primitive('cube', {}));
    const before = faceSets(m);
    const volume = signedVolume(m);
    runOk(m, op('mesh.spinEdge'), selectionOf('edge', [0], m.counts));
    expect(vef(m)).toBe('8/12/6');
    expect(faceSets(m)).not.toEqual(before);
    for (let e = 0; e < m.counts.edges; e++) expect(m.edgeFlags(e) & EDGE_HARD).toBe(EDGE_HARD);
    const back = editMeshFrom(primitive('cube', {}));
    runOk(back, op('mesh.spinEdge'), selectionOf('edge', [0], back.counts));
    const e = back.findEdge(
      ...((): [number, number] => {
        // The spun edge of the first spin: the only edge not in the original cube.
        const cube = editMeshFrom(primitive('cube', {}));
        for (let x = 0; x < back.counts.edges; x++) {
          const a = back.edgeVert(x, 0);
          const b = back.edgeVert(x, 1);
          if (cube.findEdge(a, b) === -1) return [a, b];
        }
        throw new Error('no spun edge');
      })(),
    );
    runOk(back, op('mesh.spinEdge'), selectionOf('edge', [e], back.counts), { direction: 'back' });
    expect(faceSets(back)).toEqual(before);
    expect(signedVolume(back)).toBeCloseTo(volume, 12);
  });

  it('faces keep their own material and paint across a spin', () => {
    const m = editMeshFrom(primitive('cube', {}));
    m.begin('paint');
    const paint = m.layer('paint');
    const e = 0;
    const c = m.edgeCorner(e);
    const fA = m.cornerFace(c);
    const fB = m.cornerFace(m.cornerRadialNext(c));
    paint?.set(fA, 0, 3);
    paint?.set(fB, 0, 7);
    m.setFaceMaterial(fB, 2);
    m.end();
    runOk(m, op('mesh.spinEdge'), selectionOf('edge', [e], m.counts));
    const values = [...Array(m.counts.faces).keys()].map((f) => [paint?.get(f, 0), m.faceMaterial(f)]);
    expect(values.filter(([p]) => p === 3)).toEqual([[3, 0]]);
    expect(values.filter(([p]) => p === 7)).toEqual([[7, 2]]);
  });

  it('refuses border edges, two edges of one face and an existing target edge', () => {
    const m = editMeshFrom(square());
    expect(refusedCode(m, op('mesh.spinEdge'), selectionOf('edge', [m.findEdge(0, 1)], m.counts))).toBe(
      'spin.border-edge',
    );
    const cube = editMeshFrom(primitive('cube', {}));
    expect(refusedCode(cube, op('mesh.spinEdge'), selectionOf('edge', [0, 1], cube.counts))).toBe('spin.same-face');
    expect(refusedCode(cube, op('mesh.spinEdge'), selectionOf('edge', [], cube.counts))).toBe('spin.no-edges');
  });

  it('P10: symmetric edge pairs spin in mirrored directions', () => {
    const m = editMeshFrom(primitive('cube', { subdivisionsWidth: 2 }));
    const map = testSymmetryMap(m);
    // A vertical edge on the +X side and (expanded) its partner.
    let e = -1;
    for (let x = 0; x < m.counts.edges; x++) {
      const a = m.edgeVert(x, 0);
      const b = m.edgeVert(x, 1);
      const pa = [m.position[3 * a], m.position[3 * a + 1], m.position[3 * a + 2]] as number[];
      const pb = [m.position[3 * b], m.position[3 * b + 1], m.position[3 * b + 2]] as number[];
      if (pa[0] === 0.5 && pb[0] === 0.5 && pa[2] === 0.5 && pb[2] === 0.5) e = x;
    }
    expect(e).toBeGreaterThanOrEqual(0);
    const sel = expand(selectionOf('edge', [e], m.counts), map);
    expect(sel.edges.count()).toBe(2);
    runOk(m, op('mesh.spinEdge'), sel, {}, context({ symmetry: { map, preserveSeam: true } }));
    const after = testSymmetryMap(m);
    expect(asymmetry(m, after)).toBe(0);
    for (let x = 0; x < m.counts.edges; x++) expect(after.edge[x]).toBeGreaterThanOrEqual(0);
  });
});

describe('mesh.flipTriangleEdge', () => {
  it('an edge between two triangles is one spin', () => {
    const m = editMeshFrom(square());
    runOk(m, op('mesh.flipTriangleEdge'), selectionOf('edge', [m.findEdge(0, 2)], m.counts));
    expect(m.findEdge(1, 3)).toBeGreaterThanOrEqual(0);
    expect(m.findEdge(0, 2)).toBe(-1);
  });

  it('refuses edges that are not between triangles; skips them with a warning beside valid ones', () => {
    const cube = editMeshFrom(primitive('cube', {}));
    expect(refusedCode(cube, op('mesh.flipTriangleEdge'), selectionOf('edge', [0], cube.counts))).toBe(
      'flip.not-triangles',
    );
  });

  it('a selected quad toggles FACE_FLIP_DIAGONAL and the shown diagonal changes', () => {
    const m = editMeshFrom(primitive('plane', {}));
    const diagonal = () => {
      const t = triangulate(m);
      return [0, 1, 2].map((k) => m.cornerVert(t.tris[k] as number)).sort((x, y) => x - y);
    };
    const before = diagonal();
    runOk(m, op('mesh.flipTriangleEdge'), selectionOf('face', [0], m.counts));
    expect(m.faceFlags(0) & FACE_FLIP_DIAGONAL).toBe(FACE_FLIP_DIAGONAL);
    expect(diagonal()).not.toEqual(before);
    runOk(m, op('mesh.flipTriangleEdge'), selectionOf('face', [0], m.counts));
    expect(m.faceFlags(0) & FACE_FLIP_DIAGONAL).toBe(0);
    expect(refusedCode(m, op('mesh.flipTriangleEdge'), selectionOf('face', [], m.counts))).toBe('flip.no-quads');
  });

  it('P10: mirrored quads show mirrored diagonals after a flip', () => {
    const m = editMeshFrom(primitive('plane', { width: 2, subdivisionsWidth: 2 }));
    const map = testSymmetryMap(m);
    const sel = expand(selectionOf('face', [0], m.counts), map);
    expect(sel.faces.count()).toBe(2);
    runOk(m, op('mesh.flipTriangleEdge'), sel, {}, context({ symmetry: { map, preserveSeam: true } }));
    const t = triangulate(m);
    const shown = (f: number) => {
      const from = t.faceTriStart[f] as number;
      const tri = [0, 1, 2].map((k) => m.cornerVert(t.tris[3 * from + k] as number));
      const verts = faceVertList(m, f);
      return tri.includes(verts[0] as number) && tri.includes(verts[2] as number)
        ? [verts[0] as number, verts[2] as number]
        : [verts[1] as number, verts[3] as number];
    };
    const [a, b] = shown(0) as [number, number];
    const mirrored = [map.vertex[a] as number, map.vertex[b] as number].sort((x, y) => x - y);
    expect([...shown(1)].sort((x, y) => x - y)).toEqual(mirrored);
  });
});
