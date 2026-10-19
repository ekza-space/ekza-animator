// Symmetry partner maps (M6A-SPEC §5.14, §9 B2 Tests): goldens for a cube (crossing X-ring edges), an off-centre
// plane (t* ≠ 0.5), in-seam centre-line edges, an unmatched vertex and the mutual-match rule; World mode under
// rotated, translated and non-uniformly scaled placements; P9 (the vertex map is an involution) as a property.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildSymmetryMap, editMeshFrom, mirrorEdgePoint, primitive, type SymmetryMap } from '../../src';
import { mirrorSpaceOf, planeDistance, reflectPoint, worldDistance } from '../../src/symmetry/space';
import { arbPrimitive, arbSoup, buildMeshData, cubeData } from '../../src/testing';
import { READY } from '../ready';
import { edgeAt, faceCentroid, IDENTITY, mesh, position, vertexAt } from '../select/fixtures';

const X = (tolerance = 0.001, placement = IDENTITY, space: 'object' | 'world' = 'object') =>
  ({ axis: 'x', space, placement, tolerance }) as const;

/** A box with corners at x ∈ {x0, x1}, y, z ∈ {−0.5, 0.5} (8/12/6). */
function box(x0: number, x1: number): ReturnType<typeof editMeshFrom> {
  const base = cubeData();
  const positions = Array.from(base.position, (v, i) => (i % 3 === 0 ? (v < 0 ? x0 : x1) : v));
  const faces: number[][] = [];
  for (let f = 0; f < 6; f++) faces.push([0, 1, 2, 3].map((c) => base.cornerVert[4 * f + c] as number));
  return editMeshFrom(buildMeshData({ positions, faces }));
}

/** An X-direction edge of a box (y = z = 0.5). */
const xEdge = (m: ReturnType<typeof editMeshFrom>, x0: number, x1: number): number =>
  edgeAt(m, [x0, 0.5, 0.5], [x1, 0.5, 0.5]);

describe('cube, Object X', () => {
  const m = mesh('cube');
  const map = buildSymmetryMap(m, X());

  it('pairs every vertex with its mirror, edges and faces through them', () => {
    expect(map.unmatched).toBe(0);
    for (let v = 0; v < 8; v++) {
      const p = position(m, v);
      expect(position(m, map.vertex[v] as number)).toEqual([-p[0], p[1], p[2]]);
    }
    // ±X faces swap; the other four straddle the plane and are their own partners.
    for (let f = 0; f < 6; f++) {
      const c = faceCentroid(m, f);
      if (Math.abs(c[0]) > 0.4) expect(faceCentroid(m, map.face[f] as number)[0]).toBeCloseTo(-c[0], 9);
      else expect(map.face[f]).toBe(f);
    }
    expect(map.plane).toBe(0);
    expect(map.axis).toBe('x');
    expect(map.space).toBe('object');
  });

  it('X-ring edges are crossing (edgeSelf 1, reversed); the others pair across the plane', () => {
    for (let e = 0; e < 12; e++) {
      const a = position(m, m.edgeVert(e, 0));
      const b = position(m, m.edgeVert(e, 1));
      const crossing = Math.abs(a[0] - b[0]) > 0.5;
      expect(map.edgeSelf[e]).toBe(crossing ? 1 : 0);
      if (crossing) {
        expect(map.edge[e]).toBe(e);
        expect(map.edgeReversed[e]).toBe(1);
      } else {
        const p = map.edge[e] as number;
        expect(p).not.toBe(e);
        expect(map.edge[p]).toBe(e);
        // edgeReversed: the partner's end 0 is the partner of this edge's end 1.
        expect(map.edgeReversed[e]).toBe(m.edgeVert(p, 0) === map.vertex[m.edgeVert(e, 1)] ? 1 : 0);
      }
    }
  });

  it('pointer rule on a crossing edge: t ↦ 1 − t; a point near x = 0 snaps to t* = 0.5', () => {
    const e = xEdge(m, -0.5, 0.5);
    const from = position(m, m.edgeVert(e, 0))[0] < 0 ? 0 : 1;
    const t = (x: number): number => (from === 0 ? x + 0.5 : 0.5 - x); // parameter of the point at world x
    expect(mirrorEdgePoint(m, map, { edge: e, t: 0.2 })).toEqual({ edge: e, t: 0.8, self: false });
    expect(mirrorEdgePoint(m, map, { edge: e, t: t(0.0004) })).toEqual({ edge: e, t: 0.5, self: true });
    expect(mirrorEdgePoint(m, map, { edge: e, t: t(-0.00099) })).toEqual({ edge: e, t: 0.5, self: true });
    const far = mirrorEdgePoint(m, map, { edge: e, t: t(0.0011) });
    expect(far?.self).toBe(false);
    expect(far?.t).toBeCloseTo(1 - t(0.0011), 12);
    // An ordinary edge maps to its partner (reversed here: t ↦ 1 − t).
    const side = [...Array(12).keys()].find((x) => map.edgeSelf[x] === 0) as number;
    expect(mirrorEdgePoint(m, map, { edge: side, t: 0.25 })).toEqual({
      edge: map.edge[side],
      t: map.edgeReversed[side] === 1 ? 0.75 : 0.25,
      self: false,
    });
  });
});

describe('off-centre plane: the plane does not bisect the crossing edges (t* ≠ 0.5)', () => {
  it('Object X with a 0.1 m tolerance on a box from x = −0.45 to 0.5', () => {
    const m = box(-0.45, 0.5);
    const map = buildSymmetryMap(m, X(0.1));
    expect(map.unmatched).toBe(0);
    const e = xEdge(m, -0.45, 0.5);
    expect(map.edgeSelf[e]).toBe(1);
    const fromLeft = position(m, m.edgeVert(e, 0))[0] < 0;
    const tStar = fromLeft ? 0.45 / 0.95 : 0.5 / 0.95;
    const snapped = mirrorEdgePoint(m, map, { edge: e, t: tStar + 0.05 / 0.95 }); // 0.05 m off the plane
    expect(snapped?.self).toBe(true);
    expect(snapped?.t).toBeCloseTo(tStar, 6);
    expect(snapped?.t).not.toBeCloseTo(0.5, 3);
    expect(mirrorEdgePoint(m, map, { edge: e, t: 0.1 })).toEqual({ edge: e, t: 0.9, self: false });
  });

  it('World X with the cube moved 0.02 m along X (tolerance 0.05): t* = 0.48 from the −X end', () => {
    const m = mesh('cube');
    const placement = { t: [0.02, 3, -1], q: [0, 0, 0, 1], s: [1, 1, 1] } as const;
    const map = buildSymmetryMap(m, X(0.05, placement, 'world'));
    expect(map.unmatched).toBe(0);
    expect(map.plane).toBeCloseTo(-0.02, 9);
    const e = xEdge(m, -0.5, 0.5);
    const fromLeft = position(m, m.edgeVert(e, 0))[0] < 0;
    const near = mirrorEdgePoint(m, map, { edge: e, t: 0.5 });
    expect(near?.self).toBe(true);
    expect(near?.t).toBeCloseTo(fromLeft ? 0.48 : 0.52, 6);
  });
});

describe('in-seam edges: t ↦ t, never snapped', () => {
  it('the centre loop of a cube with two width spans lies in the plane', () => {
    const m = mesh('cube', { subdivisionsWidth: 2 }); // 12/20/10
    const map = buildSymmetryMap(m, X());
    expect(map.unmatched).toBe(0);
    let inSeam = 0;
    for (let e = 0; e < m.counts.edges; e++) {
      const a = position(m, m.edgeVert(e, 0));
      const b = position(m, m.edgeVert(e, 1));
      if (Math.abs(a[0]) < 1e-9 && Math.abs(b[0]) < 1e-9) {
        inSeam++;
        expect(map.edgeSelf[e]).toBe(2);
        expect(map.edge[e]).toBe(e);
        expect(map.edgeReversed[e]).toBe(0);
        for (const t of [0, 0.3, 0.5, 0.9])
          expect(mirrorEdgePoint(m, map, { edge: e, t })).toEqual({ edge: e, t, self: true });
      }
    }
    expect(inSeam).toBe(4);
    for (let v = 0; v < m.counts.points; v++) {
      if (Math.abs(position(m, v)[0]) < 1e-9) expect(map.vertex[v]).toBe(v);
    }
    // The split faces pair across the plane; none is its own partner except none (each half has a partner).
    for (let f = 0; f < m.counts.faces; f++) expect(map.face[f]).not.toBe(-1);
  });

  describe.skipIf(!READY.b13)('humanoid body (B13 template)', () => {
    it('a centre-line edge of the body is in-seam: t ↦ t, no snap', () => {
      const m = editMeshFrom(primitive('humanoidBody', { height: 1.6, style: 'smooth' }));
      const map = buildSymmetryMap(m, X());
      const e = [...Array(m.counts.edges).keys()].find(
        (x) => Math.abs(position(m, m.edgeVert(x, 0))[0]) < 1e-6 && Math.abs(position(m, m.edgeVert(x, 1))[0]) < 1e-6,
      ) as number;
      expect(e).toBeGreaterThanOrEqual(0);
      expect(map.edgeSelf[e]).toBe(2);
      expect(mirrorEdgePoint(m, map, { edge: e, t: 0.37 })).toEqual({ edge: e, t: 0.37, self: true });
    });
  });
});

describe('unmatched vertices and the mutual rule', () => {
  it('a vertex nudged beyond the tolerance and its would-be partner both get −1', () => {
    const base = cubeData();
    const positions = Array.from(base.position);
    positions[3 * 1 + 2] = (positions[3 * 1 + 2] as number) + 0.01; // vertex 1 (x = +0.5) moves 1 cm in z
    const faces: number[][] = [];
    for (let f = 0; f < 6; f++) faces.push([0, 1, 2, 3].map((c) => base.cornerVert[4 * f + c] as number));
    const m = editMeshFrom(buildMeshData({ positions, faces }));
    const map = buildSymmetryMap(m, X());
    expect(map.vertex[1]).toBe(-1);
    expect(map.vertex[0]).toBe(-1);
    expect(map.unmatched).toBe(2);
    for (let v = 2; v < 8; v++) expect(map.vertex[map.vertex[v] as number]).toBe(v);
    // Edges and faces through them lose their partners.
    for (let e = 0; e < m.counts.edges; e++) {
      const ends = [m.edgeVert(e, 0), m.edgeVert(e, 1)];
      if (ends.includes(0) || ends.includes(1)) expect(map.edge[e]).toBe(-1);
    }
  });

  it('a pair is accepted only when the nearest match is mutual; ties go to the smaller index', () => {
    // v0 at x = 0.5; v2 (−0.4999) is nearer to its mirror than v1 (−0.5004): (v0, v2) pair, v1 is left alone.
    const m = editMeshFrom(buildMeshData({ positions: [0.5, 0, 0, -0.5004, 0, 0, -0.4999, 0, 0], faces: [] }));
    const map = buildSymmetryMap(m, X());
    expect(Array.from(map.vertex)).toEqual([2, -1, 0]);
    expect(map.unmatched).toBe(1);
    // Two candidates at the same distance: the smaller index wins (and only its pair is mutual).
    const tie = editMeshFrom(buildMeshData({ positions: [0.5, 0, 0, -0.5, 0, 0.0005, -0.5, 0, -0.0005], faces: [] }));
    const tmap = buildSymmetryMap(tie, X());
    expect(Array.from(tmap.vertex)).toEqual([1, 0, -1]);
  });

  it('vertices within the tolerance of the plane are their own partners (the seam)', () => {
    const m = editMeshFrom(buildMeshData({ positions: [0.0009, 0, 0, -0.0011, 1, 0, 0, 2, 0], faces: [] }));
    const map = buildSymmetryMap(m, X());
    expect(Array.from(map.vertex)).toEqual([0, -1, 2]);
    expect(map.unmatched).toBe(1);
    // A zero tolerance accepts exact mirrors and exact seam vertices only.
    const exact = buildSymmetryMap(mesh('cube'), X(0));
    expect(exact.unmatched).toBe(0);
  });
});

describe('World mode', () => {
  it('a placement rotated 90° about Y: World X pairs like Object Z', () => {
    const m = mesh('cube', { width: 1, depth: 2, subdivisionsDepth: 2 });
    const s = Math.SQRT1_2;
    const placement = { t: [0, 0, 0], q: [0, s, 0, s], s: [1, 1, 1] } as const;
    const world = buildSymmetryMap(m, X(0.001, placement, 'world'));
    const objectZ = buildSymmetryMap(m, { axis: 'z', space: 'object', placement: IDENTITY, tolerance: 0.001 });
    expect(Array.from(world.vertex)).toEqual(Array.from(objectZ.vertex));
    expect(Array.from(world.edge)).toEqual(Array.from(objectZ.edge));
    expect(Array.from(world.face)).toEqual(Array.from(objectZ.face));
  });

  it('a mesh away from the world plane has no partners; non-uniform scale keeps a centred mesh symmetric', () => {
    const m = mesh('cube');
    const away = buildSymmetryMap(m, X(0.001, { t: [1, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] }, 'world'));
    expect(away.unmatched).toBe(8);
    const scaled = buildSymmetryMap(m, X(0.001, { t: [0, 2, 0], q: [0.2, 0, 0, 0.98], s: [3, 0.5, 2] }, 'world'));
    expect(scaled.unmatched).toBe(0);
    // Object space with a scale: the tolerance is in world metres (0.001 m = 0.0005 local units at scale 2).
    const nudged = editMeshFrom(buildMeshData({ positions: [0.5, 0, 0, -0.5007, 0, 0], faces: [] }));
    const big = { t: [0, 0, 0], q: [0, 0, 0, 1], s: [2, 2, 2] } as const;
    expect(Array.from(buildSymmetryMap(nudged, X(0.001, big)).vertex)).toEqual([-1, -1]);
    expect(Array.from(buildSymmetryMap(nudged, X(0.001)).vertex)).toEqual([1, 0]);
  });

  it('rejects a negative or non-finite tolerance and unknown axes or spaces', () => {
    const m = mesh('cube');
    expect(() => buildSymmetryMap(m, X(-1))).toThrow(expect.objectContaining({ code: 'invalid-argument' }));
    expect(() => buildSymmetryMap(m, X(Number.NaN))).toThrow(expect.objectContaining({ code: 'invalid-argument' }));
    expect(() => buildSymmetryMap(m, { ...X(), axis: 'w' as never })).toThrow(
      expect.objectContaining({ code: 'invalid-argument' }),
    );
    expect(() => buildSymmetryMap(m, { ...X(), space: 'topology' as never })).toThrow(
      expect.objectContaining({ code: 'invalid-argument' }),
    );
  });
});

/** Every structural rule a map must satisfy (P9 and the §5.14 definitions). */
function checkMap(m: ReturnType<typeof editMeshFrom>, map: SymmetryMap): void {
  const space = mirrorSpaceOf(map);
  const q = new Float64Array(3);
  let unmatched = 0;
  for (let v = 0; v < m.counts.points; v++) {
    const p = map.vertex[v] as number;
    const [x, y, z] = position(m, v);
    const d = planeDistance(space, x, y, z);
    if (Math.abs(d) <= map.tolerance) {
      expect(p).toBe(v);
      continue;
    }
    if (p < 0) {
      unmatched++;
      continue;
    }
    // P9: an involution between off-seam vertices within the tolerance of each other's mirror.
    expect(p).not.toBe(v);
    expect(map.vertex[p]).toBe(v);
    reflectPoint(space, x, y, z, q);
    const [px, py, pz] = position(m, p);
    expect(worldDistance(space, q[0] as number, q[1] as number, q[2] as number, px, py, pz)).toBeLessThanOrEqual(
      map.tolerance + 1e-12,
    );
  }
  expect(map.unmatched).toBe(unmatched);
  for (let e = 0; e < m.counts.edges; e++) {
    const p = map.edge[e] as number;
    if (p < 0) continue;
    expect(map.edge[p]).toBe(e);
    const ends = [map.vertex[m.edgeVert(e, 0)] as number, map.vertex[m.edgeVert(e, 1)] as number];
    expect(ends.sort((a, b) => a - b)).toEqual([m.edgeVert(p, 0), m.edgeVert(p, 1)].sort((a, b) => a - b));
    if (map.edgeSelf[e] !== 0) expect(p).toBe(e);
  }
  for (let f = 0; f < m.counts.faces; f++) {
    const g = map.face[f] as number;
    if (g >= 0) expect(map.face[g]).toBe(f);
  }
}

describe('P9 and the map rules (properties)', () => {
  const arbPlacement = fc.record({
    t: fc.tuple(
      fc.double({ min: -2, max: 2, noNaN: true }),
      fc.double({ min: -2, max: 2, noNaN: true }),
      fc.double({ min: -2, max: 2, noNaN: true }),
    ),
    q: fc.tuple(
      fc.double({ min: -1, max: 1, noNaN: true }),
      fc.double({ min: -1, max: 1, noNaN: true }),
      fc.double({ min: -1, max: 1, noNaN: true }),
      fc.double({ min: 0.1, max: 1, noNaN: true }),
    ),
    s: fc.tuple(
      fc.double({ min: 0.2, max: 3, noNaN: true }),
      fc.double({ min: 0.2, max: 3, noNaN: true }),
      fc.double({ min: 0.2, max: 3, noNaN: true }),
    ),
  });
  const arbOpts = fc.record({
    axis: fc.constantFrom('x' as const, 'y' as const, 'z' as const),
    space: fc.constantFrom('object' as const, 'world' as const),
    tolerance: fc.constantFrom(0, 1e-4, 0.001, 0.01, 0.05, 0.3),
  });

  it('on primitives (symmetric about every axis) in Object mode nothing is unmatched', () => {
    fc.assert(
      fc.property(
        arbPrimitive(),
        fc.constantFrom('x' as const, 'y' as const, 'z' as const),
        ({ kind, params }, axis) => {
          const m = editMeshFrom(primitive(kind, params));
          const map = buildSymmetryMap(m, { axis, space: 'object', placement: IDENTITY, tolerance: 1e-4 });
          checkMap(m, map);
          // Round primitives with an odd side count are not symmetric about Z (rings start on −Z); a cone not about Y.
          const oddRound = kind !== 'cube' && kind !== 'plane' && (params['subdivisionsAxis'] as number) % 2 === 1;
          const symmetric = !(axis === 'z' && oddRound) && !(axis === 'y' && kind === 'cone');
          if (symmetric) expect(map.unmatched).toBe(0);
          else expect(map.unmatched).toBeGreaterThan(0);
        },
      ),
      { numRuns: 120 },
    );
  });

  it('on primitives with jitter, random placements, axes, spaces and tolerances', () => {
    fc.assert(
      fc.property(
        arbPrimitive(),
        arbPlacement,
        arbOpts,
        fc.array(fc.tuple(fc.nat(), fc.double({ min: -0.02, max: 0.02, noNaN: true })), { maxLength: 6 }),
        ({ kind, params }, placement, opts, jitter) => {
          const data = primitive(kind, params);
          const position = data.position.slice();
          for (const [i, d] of jitter) {
            const k = i % position.length;
            position[k] = Math.fround((position[k] as number) + d);
          }
          const m = editMeshFrom({ ...data, position });
          checkMap(m, buildSymmetryMap(m, { ...opts, placement }));
        },
      ),
      { numRuns: 150 },
    );
  });

  it('on soups (duplicate positions, ties, non-manifold faces)', () => {
    fc.assert(
      fc.property(arbSoup({ maxVerts: 12, maxFaces: 10 }), arbOpts, (soup, opts) => {
        const m = editMeshFrom(soup);
        checkMap(m, buildSymmetryMap(m, { ...opts, placement: IDENTITY }));
      }),
      { numRuns: 200 },
    );
  });

  it('a rebuilt map is identical (deterministic) and does not depend on vertex history', () => {
    const m = mesh('torus');
    const a = buildSymmetryMap(m, X());
    const b = buildSymmetryMap(editMeshFrom(m.snapshot()), X());
    expect(Array.from(a.vertex)).toEqual(Array.from(b.vertex));
    expect(Array.from(a.face)).toEqual(Array.from(b.face));
    expect(vertexAt(m, 0, 0, 0)).toBe(-1);
  });
});
