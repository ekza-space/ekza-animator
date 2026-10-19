// The B4 symmetry helpers (M6A-SPEC §5.14; ./src/subset/symmetry.ts): vertex partners (mutual, seam, ties), the pointer
// rule for `{edge, t}` (ordinary, crossing with the t* snap, in-seam never snapped), the partner expansion of the
// pointer-class ops with its unmatched list. Behind READY.b2: the same answers as B2's `buildSymmetryMap`,
// `mirrorEdgePoint` and `expandSelection`, and the symmetric Multi-Cut and Slide cases on B2's own maps.
import { describe, expect, it } from 'vitest';
import {
  buildSymmetryMap,
  editMeshFrom,
  expandSelection,
  MESH_OPS,
  type MeshOp,
  mirrorEdgePoint,
  primitive,
  selectionOf,
} from '../../src';
import { expandWithPartners, mirrorEdgePointOf, vertexPartners } from '../../src/subset/symmetry';
import { READY } from '../ready';
import { context, edgeAt, position, runOk, vertexAt } from './harness';
import { asymmetry, testSymmetryMap } from './symmetry-fixture';

const IDENTITY = { t: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] } as const;

describe('vertex partners (§5.14 rule)', () => {
  it('a 2×1×1 cube: seam vertices are their own partners, the others mutual pairs', () => {
    const m = editMeshFrom(primitive('cube', { width: 2, subdivisionsWidth: 2 }));
    const { partner, unmatched } = vertexPartners(m, 'x', 0, 0.001);
    expect(unmatched).toBe(0);
    for (let v = 0; v < m.counts.points; v++) {
      const p = position(m, v);
      const q = partner[v] as number;
      // Seam vertices pair with themselves; the mirror image of p is p itself there.
      expect(position(m, q)).toEqual([0 - p[0], p[1], p[2]]);
      expect(p[0] === 0 ? q === v : q !== v).toBe(true);
      expect(partner[q]).toBe(v);
    }
  });

  it('a non-mutual match is refused (−1); the mutual nearest pair matches', () => {
    // x = 1 has two candidates on the other side (x = −1.0003 and x = −0.9998); the nearer one is mutual.
    const data = primitive('plane', {});
    const m = editMeshFrom(data);
    m.begin('extra');
    m.makeVert(1, 0, 0);
    m.makeVert(-1.0003, 0, 0);
    m.makeVert(-0.9998, 0, 0.0007);
    m.end();
    const { partner } = vertexPartners(m, 'x', 0, 0.001);
    expect(partner[4]).toBe(5);
    expect(partner[5]).toBe(4);
    expect(partner[6]).toBe(-1);
  });
});

describe('the pointer rule (mirrorEdgePointOf)', () => {
  const m = editMeshFrom(primitive('cube', {}));
  const map = testSymmetryMap(m);

  it('a crossing edge maps t ↦ 1 − t, and a point near the plane snaps to t*', () => {
    const e = edgeAt(m, [-0.5, 0.5, 0.5], [0.5, 0.5, 0.5]);
    expect(map.edgeSelf[e]).toBe(1);
    expect(mirrorEdgePointOf(m, map, { edge: e, t: 0.3 })).toEqual({ edge: e, t: 0.7, self: false });
    expect(mirrorEdgePointOf(m, map, { edge: e, t: 0.50005 })).toEqual({ edge: e, t: 0.5, self: true });
  });

  it('an ordinary edge maps to its partner, reversed when the partner runs the other way', () => {
    const e = edgeAt(m, [0.5, -0.5, 0.5], [0.5, 0.5, 0.5]);
    const mapped = mirrorEdgePointOf(m, map, { edge: e, t: 0.25 });
    const partner = map.edge[e] as number;
    expect(mapped?.edge).toBe(partner);
    expect(mapped?.t).toBe(map.edgeReversed[e] === 1 ? 0.75 : 0.25);
  });

  it('an in-seam edge maps t ↦ t and never snaps', () => {
    const c = editMeshFrom(primitive('cube', { width: 2, subdivisionsWidth: 2 }));
    const cmap = testSymmetryMap(c);
    const e = edgeAt(c, [0, -0.5, 0.5], [0, 0.5, 0.5]);
    expect(cmap.edgeSelf[e]).toBe(2);
    expect(mirrorEdgePointOf(c, cmap, { edge: e, t: 0.3 })).toEqual({ edge: e, t: 0.3, self: true });
  });

  it('the expansion adds partners and lists components without one', () => {
    const c = editMeshFrom(primitive('cube', { width: 2, subdivisionsWidth: 2 }));
    const cmap = testSymmetryMap(c);
    const v = vertexAt(c, [1, 0.5, 0.5]);
    const { selection, unmatched } = expandWithPartners(selectionOf('vertex', [v], c.counts), cmap);
    expect(selection.verts.count()).toBe(2);
    expect(unmatched).toEqual([]);
    const lonely = { ...cmap, vertex: Int32Array.from(cmap.vertex, (p, i) => (i === v ? -1 : p)) };
    expect(expandWithPartners(selectionOf('vertex', [v], c.counts), lonely).unmatched).toEqual([v]);
  });
});

describe.skipIf(!READY.b2)('agreement with B2 (READY.b2)', () => {
  const meshes = [
    () => primitive('cube', {}),
    () => primitive('cube', { width: 2, subdivisionsWidth: 2, subdivisionsHeight: 2 }),
    () => primitive('sphere', {}),
    () => primitive('torus', {}),
  ];

  it('buildSymmetryMap gives the partners, edge kinds and face partners of the B4 test maps', () => {
    for (const make of meshes) {
      const m = editMeshFrom(make());
      const theirs = buildSymmetryMap(m, { axis: 'x', space: 'object', placement: IDENTITY, tolerance: 1e-4 });
      const ours = testSymmetryMap(m, { tolerance: 1e-4 });
      expect(Array.from(theirs.vertex)).toEqual(Array.from(ours.vertex));
      expect(Array.from(theirs.edge)).toEqual(Array.from(ours.edge));
      expect(Array.from(theirs.edgeReversed)).toEqual(Array.from(ours.edgeReversed));
      expect(Array.from(theirs.edgeSelf)).toEqual(Array.from(ours.edgeSelf));
      expect(Array.from(theirs.face)).toEqual(Array.from(ours.face));
    }
  });

  it('mirrorEdgePoint and expandSelection agree with the B4 helpers', () => {
    for (const make of meshes) {
      const m = editMeshFrom(make());
      const map = buildSymmetryMap(m, { axis: 'x', space: 'object', placement: IDENTITY, tolerance: 1e-4 });
      for (let e = 0; e < m.counts.edges; e++) {
        for (const t of [0.1, 0.5, 0.73]) {
          expect(mirrorEdgePoint(m, map, { edge: e, t })).toEqual(mirrorEdgePointOf(m, map, { edge: e, t }));
        }
      }
      const sel = selectionOf(
        'edge',
        [0, 3, 5].filter((e) => e < m.counts.edges),
        m.counts,
      );
      expect(expandSelection(sel, map).edges.toArray()).toEqual(expandWithPartners(sel, map).selection.edges.toArray());
    }
  });

  it('P10 on B2 maps: a symmetric cut through the seam', () => {
    const m = editMeshFrom(primitive('cube', { width: 2, subdivisionsWidth: 2 }));
    const map = buildSymmetryMap(m, { axis: 'x', space: 'object', placement: IDENTITY, tolerance: 0.001 });
    const leftTop = edgeAt(m, [0, 0.5, 0.5], [1, 0.5, 0.5]);
    const seam = edgeAt(m, [0, -0.5, 0.5], [0, 0.5, 0.5]);
    const rightBottom = edgeAt(m, [-1, -0.5, 0.5], [0, -0.5, 0.5]);
    runOk(
      m,
      MESH_OPS['mesh.cut'] as MeshOp,
      null,
      {
        points: [
          { kind: 'edge', edge: leftTop, t: 0.4 },
          { kind: 'edge', edge: seam, t: 0.3 },
          { kind: 'edge', edge: rightBottom, t: 0.5 },
        ],
      },
      context({ symmetry: { map, preserveSeam: true } }),
    );
    expect(asymmetry(m)).toBeLessThan(1e-6);
    const after = buildSymmetryMap(m, { axis: 'x', space: 'object', placement: IDENTITY, tolerance: 0.001 });
    expect(after.unmatched).toBe(0);
  });

  it('P10 on B2 maps: symmetric slides (a loop and its mirror; vertices; a row through a seam vertex)', () => {
    const b2 = (m: ReturnType<typeof editMeshFrom>) =>
      buildSymmetryMap(m, { axis: 'x', space: 'object', placement: IDENTITY, tolerance: 0.001 });
    const slide = MESH_OPS['mesh.slide'] as MeshOp;
    // A loop at x = 0.5 on a 2-wide cube cut in four along X: the op adds the mirrored loop at x = −0.5 itself.
    const m = editMeshFrom(primitive('cube', { width: 2, subdivisionsWidth: 4 }));
    const map = b2(m);
    const loop: number[] = [];
    for (let e = 0; e < m.counts.edges; e++) {
      if (position(m, m.edgeVert(e, 0))[0] === 0.5 && position(m, m.edgeVert(e, 1))[0] === 0.5) loop.push(e);
    }
    expect(loop).toHaveLength(4);
    const v = m.edgeVert(loop[0] as number, 0);
    const rail = m.findEdge(v, vertexAt(m, [1, position(m, v)[1], position(m, v)[2]]));
    const looped = runOk(
      m,
      slide,
      selectionOf('edge', loop, m.counts),
      { percent: 0.4, reference: { vertex: v, rail } },
      context({ symmetry: { map, preserveSeam: true } }),
    );
    expect(looped.warnings.map((w) => w.code)).not.toContain('symmetry.unmatched-partner');
    expect(position(m, v)[0]).toBeCloseTo(0.7, 6);
    expect(position(m, map.vertex[v] as number)[0]).toBeCloseTo(-0.7, 6);
    expect(asymmetry(m, b2(m))).toBeLessThan(1e-6);
    expect(b2(m).unmatched).toBe(0);
    // Vertex mode: one vertex on the +X side; its partner slides along the mirrored rail.
    const g = editMeshFrom(primitive('plane', { width: 4, height: 2, subdivisionsWidth: 4, subdivisionsHeight: 2 }));
    const gmap = b2(g);
    const east = vertexAt(g, [1, 0, 0]);
    runOk(
      g,
      slide,
      selectionOf('vertex', [east], g.counts),
      { percent: 0.3, reference: { vertex: east, rail: g.findEdge(east, vertexAt(g, [2, 0, 0])) } },
      context({ symmetry: { map: gmap, preserveSeam: true } }),
    );
    expect(position(g, east)[0]).toBeCloseTo(1.3, 6);
    expect(position(g, gmap.vertex[east] as number)[0]).toBeCloseTo(-1.3, 6);
    expect(asymmetry(g, b2(g))).toBeLessThan(1e-6);
    expect(b2(g).unmatched).toBe(0);
    // A row through the seam: the seam vertex slides only along its rail in the plane (x stays 0).
    const s = editMeshFrom(primitive('plane', { width: 2, height: 2, subdivisionsWidth: 2, subdivisionsHeight: 2 }));
    const smap = b2(s);
    const centre = vertexAt(s, [0, 0, 0]);
    const seamEast = vertexAt(s, [1, 0, 0]);
    const row = [s.findEdge(centre, seamEast), s.findEdge(centre, vertexAt(s, [-1, 0, 0]))];
    runOk(
      s,
      slide,
      selectionOf('edge', row, s.counts),
      { percent: 0.5, reference: { vertex: seamEast, rail: s.findEdge(seamEast, vertexAt(s, [1, 0, 1])) } },
      context({ symmetry: { map: smap, preserveSeam: true } }),
    );
    expect(position(s, centre)).toEqual([0, 0, 0.5]);
    expect(asymmetry(s, b2(s))).toBeLessThan(1e-6);
    expect(b2(s).unmatched).toBe(0);
  });
});
