// Mirrored selection and the helpers every symmetric op shares (M6A-SPEC §5.6, §5.14): expandSelection, the
// unmatched-partner warning, the mirror space (an involution that is the local image of the world reflection), the
// in-plane projection, symmetrizing a region, the source side of a pair, Preserve Seam checks and crossing parameters.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildSymmetryMap, editMeshFrom, expandSelection, primitive, type SymmetryMap } from '../../src';
import {
  emptySetFor,
  partnersOf,
  selectionUnmatchedWarning,
  UNMATCHED_PARTNER_MESSAGE,
  unmatchedOf,
  unmatchedPartnerWarning,
} from '../../src/symmetry/expand';
import { crossingParameter, mirrorVertex } from '../../src/symmetry/pointer';
import {
  centroidPlaneDistance,
  isSourceOfPair,
  seamRefusal,
  seamVertices,
  seamViolation,
  symmetrizeVertices,
} from '../../src/symmetry/seam';
import {
  inPlanePart,
  mirrorSpace,
  mirrorSpaceOf,
  placementAffine,
  planeDistance,
  projectOntoPlane,
  reflectPoint,
  reflectVector,
} from '../../src/symmetry/space';
import { buildMeshData, cubeData } from '../../src/testing';
import { faceCentroid, IDENTITY, members, mesh, position, sel, vertexAt } from '../select/fixtures';

const X = { axis: 'x', space: 'object', placement: IDENTITY, tolerance: 0.001 } as const;

describe('expandSelection', () => {
  it('adds every matched partner in every kind; pick order and the active pick stay', () => {
    const m = mesh('cube', { subdivisionsWidth: 2 });
    const map = buildSymmetryMap(m, X);
    const right = [...Array(m.counts.faces).keys()].filter((f) => faceCentroid(m, f)[0] > 0.1);
    const s = sel(m, 'face', right.slice(0, 2));
    s.verts.add(vertexAt(m, 0.5, 0.5, 0.5));
    const e = m.findEdge(vertexAt(m, 0.5, 0.5, 0.5), vertexAt(m, 0.5, -0.5, 0.5));
    s.edges.add(e);
    const x = expandSelection(s, map);
    expect(members(x.faces).length).toBe(4);
    for (const f of members(x.faces)) expect(members(x.faces)).toContain(map.face[f]);
    expect(members(x.verts)).toEqual([vertexAt(m, -0.5, 0.5, 0.5), vertexAt(m, 0.5, 0.5, 0.5)].sort((a, b) => a - b));
    expect(members(x.edges).length).toBe(2);
    expect(Array.from(x.order ?? [])).toEqual(Array.from(s.order ?? []));
    expect(x.active).toBe(s.active);
    // The input is untouched.
    expect(members(s.faces).length).toBe(2);
  });

  it('components without a partner stay one-sided; the warning counts them', () => {
    const base = cubeData();
    const positions = Array.from(base.position);
    positions[3 * 1 + 2] = (positions[3 * 1 + 2] as number) + 0.01;
    const faces: number[][] = [];
    for (let f = 0; f < 6; f++) faces.push([0, 1, 2, 3].map((c) => base.cornerVert[4 * f + c] as number));
    const m = editMeshFrom(buildMeshData({ positions, faces }));
    const map = buildSymmetryMap(m, X);
    const s = sel(m, 'vertex', [1, 2]);
    expect(members(expandSelection(s, map).verts)).toEqual([1, 2, 3]);
    expect(Array.from(unmatchedOf(s.verts, map, 'vertex'))).toEqual([1]);
    expect(selectionUnmatchedWarning(s, map)).toEqual({
      code: 'symmetry.unmatched-partner',
      message: UNMATCHED_PARTNER_MESSAGE,
      count: 1,
      elements: Uint32Array.of(1),
    });
    expect(unmatchedPartnerWarning(0)).toBeNull();
    expect(unmatchedPartnerWarning(3)).toEqual({
      code: 'symmetry.unmatched-partner',
      message: UNMATCHED_PARTNER_MESSAGE,
      count: 3,
    });
    expect(partnersOf(map, 'edge')).toBe(map.edge);
    expect(emptySetFor(map, 'face').size).toBe(6);
    expect(mirrorVertex(map, 2)).toBe(3);
    expect(mirrorVertex(map, 1)).toBe(-1);
  });

  it('seam components are their own partners: the expansion adds nothing for them', () => {
    const m = mesh('cube', { subdivisionsWidth: 2 });
    const map = buildSymmetryMap(m, X);
    const seam = Array.from(seamVertices(map));
    expect(seam.length).toBe(4);
    expect(members(expandSelection(sel(m, 'vertex', seam), map).verts)).toEqual(seam);
  });
});

describe('the mirror space', () => {
  const arbXf = fc.record({
    t: fc.tuple(
      fc.double({ min: -3, max: 3, noNaN: true }),
      fc.double({ min: -3, max: 3, noNaN: true }),
      fc.double({ min: -3, max: 3, noNaN: true }),
    ),
    q: fc.tuple(
      fc.double({ min: -1, max: 1, noNaN: true }),
      fc.double({ min: -1, max: 1, noNaN: true }),
      fc.double({ min: -1, max: 1, noNaN: true }),
      fc.double({ min: 0.1, max: 1, noNaN: true }),
    ),
    s: fc.tuple(
      fc.double({ min: 0.2, max: 3, noNaN: true }),
      fc.double({ min: -3, max: -0.2, noNaN: true }),
      fc.double({ min: 0.2, max: 3, noNaN: true }),
    ),
  });
  const arbPoint = fc.tuple(
    fc.double({ min: -5, max: 5, noNaN: true }),
    fc.double({ min: -5, max: 5, noNaN: true }),
    fc.double({ min: -5, max: 5, noNaN: true }),
  );

  it('S is an involution and flips the signed distance; projections lie on the plane', () => {
    fc.assert(
      fc.property(
        arbXf,
        arbPoint,
        fc.constantFrom('x' as const, 'y' as const, 'z' as const),
        fc.constantFrom('object' as const, 'world' as const),
        (placement, [x, y, z], axis, space) => {
          const ms = mirrorSpace({ axis, space, placement });
          const a = new Float64Array(3);
          const b = new Float64Array(3);
          reflectPoint(ms, x, y, z, a);
          reflectPoint(ms, a[0] as number, a[1] as number, a[2] as number, b);
          expect(Math.hypot((b[0] as number) - x, (b[1] as number) - y, (b[2] as number) - z)).toBeLessThan(1e-9);
          expect(planeDistance(ms, a[0] as number, a[1] as number, a[2] as number)).toBeCloseTo(
            -planeDistance(ms, x, y, z),
            9,
          );
          // The midpoint (projection) lies on the plane; the in-plane part of a delta has no normal component.
          projectOntoPlane(ms, x, y, z, a);
          expect(planeDistance(ms, a[0] as number, a[1] as number, a[2] as number)).toBeCloseTo(0, 9);
          inPlanePart(ms, x, y, z, a);
          expect(ms.n[0] * (a[0] as number) + ms.n[1] * (a[1] as number) + ms.n[2] * (a[2] as number)).toBeCloseTo(
            0,
            9,
          );
          reflectVector(ms, x, y, z, a);
          reflectVector(ms, a[0] as number, a[1] as number, a[2] as number, b);
          expect(Math.hypot((b[0] as number) - x, (b[1] as number) - y, (b[2] as number) - z)).toBeLessThan(1e-9);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('World mode is the local image of the world reflection; the signed distance is the world axis coordinate', () => {
    let checked = 0;
    fc.assert(
      fc.property(
        arbXf,
        arbPoint,
        fc.constantFrom('x' as const, 'y' as const, 'z' as const),
        (placement, [x, y, z], axis) => {
          const ms = mirrorSpace({ axis, space: 'world', placement });
          const a = new Float64Array(3);
          // world(S(p)) = reflect_k(world(p)), and the signed distance is the world coordinate on the axis.
          const A = placementAffine(placement);
          const w = (px: number, py: number, pz: number): number[] =>
            [0, 1, 2].map(
              (i) =>
                (A[4 * i] as number) * px +
                (A[4 * i + 1] as number) * py +
                (A[4 * i + 2] as number) * pz +
                (A[4 * i + 3] as number),
            );
          const k = { x: 0, y: 1, z: 2 }[axis];
          reflectPoint(ms, x, y, z, a);
          const wp = w(x, y, z);
          const ws = w(a[0] as number, a[1] as number, a[2] as number);
          for (let i = 0; i < 3; i++)
            expect(ws[i] as number).toBeCloseTo(i === k ? -(wp[i] as number) : (wp[i] as number), 7);
          expect(planeDistance(ms, x, y, z)).toBeCloseTo(wp[k] as number, 7);
          checked++;
        },
      ),
      { numRuns: 300 },
    );
    expect(checked).toBe(300);
  });

  it('a hand-made map falls back to the axis plane at `plane` in local units', () => {
    const map: SymmetryMap = {
      axis: 'y',
      space: 'object',
      plane: 0.25,
      tolerance: 0.001,
      vertex: new Int32Array(0),
      edge: new Int32Array(0),
      edgeReversed: new Uint8Array(0),
      edgeSelf: new Uint8Array(0),
      face: new Int32Array(0),
      unmatched: 0,
    };
    const ms = mirrorSpaceOf(map);
    expect(planeDistance(ms, 0, 1, 0)).toBe(0.75);
    const out = new Float64Array(3);
    reflectPoint(ms, 0, 1, 0, out);
    expect(Array.from(out)).toEqual([0, -0.5, 0]);
  });
});

describe('seam helpers', () => {
  it('symmetrizeVertices: pairs meet at the mean of p and S·p(partner); seam vertices land on the plane', () => {
    const m = mesh('cube', { subdivisionsWidth: 2 });
    const map = buildSymmetryMap(m, X);
    const a = vertexAt(m, 0.5, 0.5, 0.5);
    const b = map.vertex[a] as number;
    const c = vertexAt(m, 0, 0.5, 0.5);
    m.begin('test');
    m.setPosition(a, 0.6, 0.5, 0.5);
    m.setPosition(b, -0.4, 0.5, 0.52);
    m.setPosition(c, 0.0004, 0.5, 0.5);
    symmetrizeVertices(m, [a, c], map.vertex, mirrorSpaceOf(map));
    m.end();
    expect(position(m, a)[0]).toBeCloseTo(0.5, 6);
    expect(position(m, a)[2]).toBeCloseTo(0.51, 6);
    expect(position(m, b)[0]).toBeCloseTo(-0.5, 6);
    expect(position(m, b)[2]).toBeCloseTo(0.51, 6);
    expect(position(m, c)[0]).toBe(0);
    // A lookup function works as well; −1 leaves a vertex alone.
    m.begin('test2');
    m.setPosition(a, 0.7, 0.5, 0.5);
    symmetrizeVertices(m, [a], () => -1, mirrorSpaceOf(map));
    m.end();
    expect(position(m, a)[0]).toBeCloseTo(0.7, 6);
  });

  it('the source of a pair is the element on the positive side; seam elements and unmatched ones are sources', () => {
    const m = mesh('cube', { subdivisionsWidth: 2 });
    const map = buildSymmetryMap(m, X);
    const ms = mirrorSpaceOf(map);
    const faces = [...Array(m.counts.faces).keys()];
    expect(faces.map((f) => isSourceOfPair(m, map, 'face', f))).toEqual(
      faces.map((f) => centroidPlaneDistance(m, ms, 'face', f) > 0),
    );
    // Exactly one edge of a mirrored pair is the source; self-partner edges always are.
    const edges = [...Array(m.counts.edges).keys()];
    const wrong = edges.filter((e) => {
      const p = map.edge[e] as number;
      const src = isSourceOfPair(m, map, 'edge', e);
      return p === e ? !src : src === isSourceOfPair(m, map, 'edge', p);
    });
    expect(wrong).toEqual([]);
    expect(isSourceOfPair(m, map, 'vertex', vertexAt(m, 0, 0.5, 0.5))).toBe(true);
  });

  it('seamViolation finds a seam vertex pulled off the plane; seamRefusal is the §5.14 refusal', () => {
    const m = mesh('cube', { subdivisionsWidth: 2 });
    const map = buildSymmetryMap(m, X);
    const seam = seamVertices(map);
    expect(seamViolation(m, map, seam)).toBe(-1);
    m.begin('pull');
    m.setPosition(seam[1] as number, 0.01, 0.5, 0.5);
    m.end();
    expect(seamViolation(m, map, seam)).toBe(seam[1]);
    expect(seamRefusal()).toEqual({
      refused: true,
      code: 'symmetry.seam',
      reason: 'This would pull the centre line off the mirror plane',
    });
  });

  it('crossingParameter: where the plane cuts an edge, null when it does not', () => {
    const m = editMeshFrom(primitive('cube', {}));
    const map = buildSymmetryMap(m, X);
    const ts = [...Array(12).keys()].map((e) => crossingParameter(m, map, e));
    expect(ts).toEqual([...Array(12).keys()].map((e) => (map.edgeSelf[e] === 1 ? 0.5 : null)));
    expect(() => crossingParameter(m, map, 12)).toThrow(expect.objectContaining({ code: 'out-of-range' }));
    const stale = buildSymmetryMap(mesh('cube', { subdivisionsWidth: 2 }), X);
    expect(() => crossingParameter(m, stale, 0)).toThrow(expect.objectContaining({ code: 'symmetry-stale' }));
  });
});
