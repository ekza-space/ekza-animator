// M6A-SPEC §5.29 count oracles of B3's ops (research 10 §9), each run through the checked runner (validity, exact
// undo/redo, revisions, P4 winding), plus the spec rows' named positions.
import { describe, expect, it } from 'vitest';
import { editMeshFrom } from '../../src';
import {
  combined,
  cylinderData,
  edgeNear,
  edgesAlong,
  fromFaces,
  openCylinderData,
  planeData,
  topOf,
  vertexNear,
} from './fixtures';
import {
  counts,
  ctxOf,
  cube,
  faceArea,
  faceCentroid,
  faceToward,
  faceVerts,
  position,
  referenceSymmetryMap,
  runOk,
  runRefused,
  sel,
  windingProblems,
} from './support';

describe('§5.29 oracles: extrude', () => {
  it('one cube face, together: 12/20/10; divisions 2: 16/28/14; divisions 3: 20/36/18', () => {
    for (const [divisions, expected] of [
      [1, '12/20/10'],
      [2, '16/28/14'],
      [3, '20/36/18'],
    ] as const) {
      const m = cube();
      runOk(m, 'mesh.extrude', sel(m, 'face', [topOf(m)]), { divisions, localTranslateZ: 0.5 });
      expect(counts(m)).toBe(expected);
      expect(windingProblems(m)).toEqual([]);
    }
  });

  it('two adjacent faces together 14/24/12, individually 16/28/14', () => {
    const together = cube();
    const top = topOf(together);
    const front = faceToward(together, [0, 0, 1]);
    runOk(together, 'mesh.extrude', sel(together, 'face', [top, front]), { localTranslateZ: 0.2 });
    expect(counts(together)).toBe('14/24/12');
    const apart = cube();
    runOk(apart, 'mesh.extrude', sel(apart, 'face', [topOf(apart), faceToward(apart, [0, 0, 1])]), {
      localTranslateZ: 0.2,
      keepFacesTogether: false,
    });
    expect(counts(apart)).toBe('16/28/14');
    expect(windingProblems(apart)).toEqual([]);
  });

  it('typed 0.5 moves the cap along its normal with unchanged area; the cap keeps its face index', () => {
    const m = cube();
    const top = topOf(m);
    const before = faceCentroid(m, top);
    const result = runOk(m, 'mesh.extrude', sel(m, 'face', [top]), { localTranslateZ: 0.5 });
    const after = faceCentroid(m, top);
    expect(after[0] - before[0]).toBeCloseTo(0, 12);
    expect(after[1] - before[1]).toBeCloseTo(0.5, 12);
    expect(after[2] - before[2]).toBeCloseTo(0, 12);
    expect(Math.abs(faceArea(m, top) - 1)).toBeLessThan(1e-6);
    for (const v of faceVerts(m, top)) expect(position(m, v)[1]).toBe(1);
    expect([...result.selection.faces.toArray()]).toEqual([top]);
    expect(result.selection.kind).toBe('face');
  });
});

describe('§5.29 oracles: insert edge loop', () => {
  it('around the four sides: 12/20/10', () => {
    const m = cube();
    const seed = edgesAlong(m, 1)[0] as number;
    const result = runOk(m, 'mesh.insertLoop', sel(m, 'edge', [seed]), { weight: 0.5 });
    expect(counts(m)).toBe('12/20/10');
    expect(result.selection.edges.count()).toBe(4);
    expect(windingProblems(m)).toEqual([]);
  });

  const xRing = (weight: number) => {
    const m = cube();
    const seed = edgesAlong(m, 0)[0] as number;
    const map = referenceSymmetryMap(m, 'x');
    expect(map.edgeSelf[seed]).toBe(1);
    const result = runOk(m, 'mesh.insertLoop', sel(m, 'edge', [seed]), { weight }, ctxOf({ symmetry: map }));
    const xs: number[] = [];
    for (let v = 8; v < m.counts.points; v++) xs.push(position(m, v)[0]);
    return { m, result, xs };
  };

  it('Object X symmetry on an X-ring at weight 0.3: two loops at x = ±0.2, 16/28/14, every vertex partnered', () => {
    const { m, result, xs } = xRing(0.3);
    expect(counts(m)).toBe('16/28/14');
    expect(xs.map((x) => Math.abs(Math.abs(x) - 0.2) < 1e-6)).toEqual(xs.map(() => true));
    expect(xs.filter((x) => x < 0).length).toBe(4);
    expect(result.warnings).toEqual([]);
    expect(referenceSymmetryMap(m, 'x').unmatched).toBe(0);
  });

  it('Object X symmetry on an X-ring at weight 0.5: one loop at x = 0 exactly, 12/20/10', () => {
    const { m, xs } = xRing(0.5);
    expect(counts(m)).toBe('12/20/10');
    expect(xs).toEqual([0, 0, 0, 0]);
    expect(referenceSymmetryMap(m, 'x').unmatched).toBe(0);
  });

  it('8-sided cylinder, multiple 3: 16/24/10 → 40/72/34', () => {
    const m = editMeshFrom(cylinderData());
    expect(counts(m)).toBe('16/24/10');
    const seed = edgesAlong(m, 1)[0] as number;
    runOk(m, 'mesh.insertLoop', sel(m, 'edge', [seed]), { mode: 'multiple', divisions: 3 });
    expect(counts(m)).toBe('40/72/34');
    expect(windingProblems(m)).toEqual([]);
  });
});

describe('§5.29 oracles: delete family', () => {
  it('one edge: plain 8/11/5, Delete Edge/Vertex 6/9/5', () => {
    const plain = cube();
    const e = edgesAlong(plain, 0)[0] as number;
    runOk(plain, 'mesh.delete', sel(plain, 'edge', [e]));
    expect(counts(plain)).toBe('8/11/5');
    const dissolve = cube();
    runOk(dissolve, 'mesh.deleteEdgeVertex', sel(dissolve, 'edge', [edgesAlong(dissolve, 0)[0] as number]));
    expect(counts(dissolve)).toBe('6/9/5');
    expect(windingProblems(dissolve)).toEqual([]);
  });

  it('a cube corner vertex: plain refuses delete.not-winged (8/12/6), Delete Edge/Vertex 7/9/4', () => {
    const plain = cube();
    runRefused(plain, 'mesh.delete', sel(plain, 'vertex', [0]), 'delete.not-winged');
    expect(counts(plain)).toBe('8/12/6');
    const dissolve = cube();
    runOk(dissolve, 'mesh.deleteEdgeVertex', sel(dissolve, 'vertex', [0]));
    expect(counts(dissolve)).toBe('7/9/4');
    expect(windingProblems(dissolve)).toEqual([]);
  });
});

describe('§5.29 oracles: merge family', () => {
  it('Merge to Center on the top face: 5/8/5 with the apex at (0, 0.5, 0)', () => {
    const m = cube();
    const result = runOk(m, 'mesh.mergeToCenter', sel(m, 'face', [topOf(m)]));
    expect(counts(m)).toBe('5/8/5');
    const apex = result.selection.verts.toArray()[0] as number;
    expect(position(m, apex)).toEqual([0, 0.5, 0]);
    expect(windingProblems(m)).toEqual([]);
  });

  it('Collapse one edge: 7/11/6; Target Weld two adjacent vertices: 7/11/6 with the target unmoved', () => {
    const c = cube();
    runOk(c, 'mesh.collapse', sel(c, 'edge', [0]));
    expect(counts(c)).toBe('7/11/6');
    const w = cube();
    const a = w.edgeVert(0, 0);
    const b = w.edgeVert(0, 1);
    const target = position(w, b);
    const result = runOk(w, 'mesh.targetWeld', sel(w, 'vertex', []), { pairs: [[a, b]] });
    expect(counts(w)).toBe('7/11/6');
    const kept = result.selection.verts.toArray()[0] as number;
    expect(position(w, kept)).toEqual(target);
  });

  it('two side-by-side planes combined → Merge by Distance: 8/8/2 → 6/7/2', () => {
    const m = editMeshFrom(combined(planeData(), planeData(), [1, 0, 0]));
    expect(counts(m)).toBe('8/8/2');
    const result = runOk(m, 'mesh.mergeByDistance', null, { distance: 0.001 });
    expect(counts(m)).toBe('6/7/2');
    expect(result.warnings.find((w) => w.code === 'mergeByDistance.merged')?.count).toBe(2);
    expect(windingProblems(m)).toEqual([]);
  });

  it('half cube and its X mirror (reversed winding) combined → Merge by Distance: 16/24/10 → 12/20/10', () => {
    // The half cube: the x ≥ 0 half of a cube cut by a centre loop (8/12/5, open at x = 0).
    const half = fromFaces(
      [
        0, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, 0, 0.5, 0.5, 0, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0,
        0.5, -0.5,
      ],
      [
        [0, 1, 2, 3],
        [3, 2, 6, 7],
        [7, 6, 5, 4],
        [4, 5, 1, 0],
        [1, 5, 6, 2],
      ],
    );
    const m = editMeshFrom(combined(half, half, [0, 0, 0], true));
    expect(counts(m)).toBe('16/24/10');
    expect(windingProblems(m)).toEqual([]);
    runOk(m, 'mesh.mergeByDistance', null, { distance: 0.001 });
    expect(counts(m)).toBe('12/20/10');
    expect(windingProblems(m)).toEqual([]);
  });
});

describe('§5.29 oracles: fill and bridge', () => {
  it('open 8-sided cylinder → Fill Hole ×2: 16/24/8 → 16/24/10', () => {
    const m = editMeshFrom(openCylinderData());
    expect(counts(m)).toBe('16/24/8');
    const top = vertexNear(m, [0.5, 0.5, 0]);
    runOk(m, 'mesh.fillHole', sel(m, 'vertex', [top]));
    expect(counts(m)).toBe('16/24/9');
    const bottom = vertexNear(m, [0.5, -0.5, 0]);
    runOk(m, 'mesh.fillHole', sel(m, 'vertex', [bottom]));
    expect(counts(m)).toBe('16/24/10');
    expect(windingProblems(m)).toEqual([]);
  });

  it('two open-ended 8-sided cylinders combined → Bridge divisions 2: 32/48/18 → 48/88/42, closed', () => {
    // A without its top cap, B (2 m up) without its bottom cap.
    const a = editMeshFrom(cylinderData());
    const b = editMeshFrom(cylinderData());
    const aTop = faceToward(a, [0, 1, 0]);
    const bBottom = faceToward(b, [0, -1, 0]);
    runOk(a, 'mesh.delete', sel(a, 'face', [aTop]));
    runOk(b, 'mesh.delete', sel(b, 'face', [bBottom]));
    const m = editMeshFrom(combined(a.snapshot(), b.snapshot(), [0, 2, 0]));
    expect(counts(m)).toBe('32/48/18');
    const border: number[] = [];
    for (let e = 0; e < m.counts.edges; e++) if (m.edgeFaceCount(e) === 1) border.push(e);
    expect(border.length).toBe(16);
    const result = runOk(m, 'mesh.bridge', sel(m, 'edge', border), { divisions: 2 });
    expect(counts(m)).toBe('48/88/42');
    expect(result.selection.faces.count()).toBe(24);
    for (let e = 0; e < m.counts.edges; e++) expect(m.edgeFaceCount(e)).toBe(2);
    expect(windingProblems(m)).toEqual([]);
    // The edge named in fixtures stays reachable (sanity of the lookup helper).
    expect(edgeNear(m, [0.5, -0.5, 0], [0.5, 0.5, 0])).toBeGreaterThanOrEqual(0);
  });
});
