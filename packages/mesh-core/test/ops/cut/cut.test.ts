// M6A-SPEC §5.11 Multi-Cut (`mesh.cut`, B4): the E2E-MOD-05 plane case at kernel level, cuts across and around a cube,
// vertex chords, the exact chord test on concave n-gons (an L-shape), refusals, H1, symmetric cuts (§5.14: a mirrored
// second cut, one symmetric cut through an in-seam edge, a cut that crosses the plane inside a face) and the fuzz
// property: random edge/vertex paths on random meshes never produce invalid topology.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { EDGE_HARD, type EditMesh, editMeshFrom, MESH_OPS, primitive, selectionOf, topologyStats } from '../../../src';
import { arbPrimitive, arbSoup, buildMeshData, cubeData, signedVolume, vef } from '../../../src/testing';
import { context, edgeAt, faceVertList, position, refusedCode, runOk, runOp } from '../harness';
import { asymmetry, testSymmetryMap } from '../symmetry-fixture';

const cut = MESH_OPS['mesh.cut'] as NonNullable<(typeof MESH_OPS)[string]>;
const edgePt = (edge: number, t: number) => ({ kind: 'edge', edge, t });
const vertPt = (vertex: number) => ({ kind: 'vertex', vertex });

describe('mesh.cut', () => {
  it('E2E-MOD-05 (kernel): across two quads of a 2×1 plane → 9/12/4, points at z = 0, one chord per face', () => {
    const m = editMeshFrom(primitive('plane', { width: 2, subdivisionsWidth: 2, subdivisionsHeight: 1 }));
    expect(vef(m)).toBe('6/7/2');
    const left = edgeAt(m, [-1, 0, -0.5], [-1, 0, 0.5]);
    const middle = edgeAt(m, [0, 0, -0.5], [0, 0, 0.5]);
    const right = edgeAt(m, [1, 0, -0.5], [1, 0, 0.5]);
    const result = runOk(m, cut, null, { points: [edgePt(left, 0.5), edgePt(middle, 0.5), edgePt(right, 0.5)] });
    expect(vef(m)).toBe('9/12/4');
    for (let v = 6; v < 9; v++) {
      const p = position(m, v);
      expect(Math.abs(p[1])).toBeLessThan(1e-6);
      expect(Math.abs(p[2])).toBeLessThan(1e-6);
    }
    expect(result.selection.kind).toBe('edge');
    expect(result.selection.edges.count()).toBe(2);
    for (let f = 0; f < 4; f++) expect(faceVertList(m, f)).toHaveLength(4);
  });

  it('across one cube face: 10/15/7; around the four sides (closed path): 12/20/10, closed and outward', () => {
    const m = editMeshFrom(cubeData());
    // Face 0 [0 1 2 3] (z = +0.5): edges 0–1 and 2–3 are opposite.
    runOk(m, cut, null, { points: [edgePt(m.findEdge(0, 1), 0.5), edgePt(m.findEdge(2, 3), 0.5)] });
    expect(vef(m)).toBe('10/15/7');
    const ring = editMeshFrom(cubeData());
    const verticals = [
      [0, 3],
      [1, 2],
      [5, 6],
      [4, 7],
    ].map(([a, b]) => ring.findEdge(a as number, b as number));
    // Every point at y = −0.25: t is measured from edgeVert(e, 0), the bottom (y = −0.5) or the top end.
    const points = verticals.map((e) => edgePt(e, position(ring, ring.edgeVert(e, 0))[1] < 0 ? 0.25 : 0.75));
    runOk(ring, cut, null, { points: [...points, points[0] as (typeof points)[number]] });
    expect(vef(ring)).toBe('12/20/10');
    expect(topologyStats(ring).boundaryLoops).toBe(0);
    expect(signedVolume(ring)).toBeCloseTo(1, 6);
  });

  it('vertex to vertex splits a quad along its diagonal; adjacent vertices are no cut', () => {
    const m = editMeshFrom(cubeData());
    runOk(m, cut, null, { points: [vertPt(0), vertPt(2)] });
    expect(vef(m)).toBe('8/13/7');
    expect(refusedCode(m, cut, null, { points: [vertPt(0), vertPt(1)] })).toBe('cut.nothing');
  });

  it('points within ε of an edge end are that vertex', () => {
    const m = editMeshFrom(cubeData());
    runOk(m, cut, null, { points: [edgePt(m.findEdge(0, 1), 1e-12), vertPt(2)] }, context({ epsilon: 1e-6 }));
    expect(vef(m)).toBe('8/13/7');
  });

  it('H1: chords of an all-hard face are hard, of a soft face soft; split edges keep their flags', () => {
    const hard = editMeshFrom(cubeData());
    runOk(hard, cut, null, { points: [edgePt(hard.findEdge(0, 1), 0.5), edgePt(hard.findEdge(2, 3), 0.5)] });
    for (let e = 0; e < hard.counts.edges; e++) expect(hard.edgeFlags(e) & EDGE_HARD).toBe(EDGE_HARD);
    const soft = editMeshFrom(cubeData({ hard: false }));
    runOk(soft, cut, null, { points: [edgePt(soft.findEdge(0, 1), 0.5), edgePt(soft.findEdge(2, 3), 0.5)] });
    for (let e = 0; e < soft.counts.edges; e++) expect(soft.edgeFlags(e) & EDGE_HARD).toBe(0);
  });

  it('refusals: too few points, malformed points, no common face, a chord outside a concave face', () => {
    const m = editMeshFrom(cubeData());
    expect(refusedCode(m, cut, null, { points: [vertPt(0)] })).toBe('cut.too-few-points');
    expect(refusedCode(m, cut, null, { points: [{ kind: 'edge', edge: 99, t: 0.5 }, vertPt(1)] })).toBe(
      'cut.invalid-points',
    );
    // Vertex 0 (front-bottom-left) and vertex 6 (back-top-right) share no face.
    expect(refusedCode(m, cut, null, { points: [vertPt(0), vertPt(6)] })).toBe('cut.no-common-face');
    // An L-shaped hexagon: 0(0,0) 1(2,0) 2(2,1) 3(1,1) 4(1,2) 5(0,2); chord 1–4 leaves it, 0–3 stays inside.
    const l = buildMeshData({
      positions: [0, 0, 0, 2, 0, 0, 2, 1, 0, 1, 1, 0, 1, 2, 0, 0, 2, 0],
      faces: [[0, 1, 2, 3, 4, 5]],
    });
    const shape = editMeshFrom(l);
    expect(refusedCode(shape, cut, null, { points: [vertPt(1), vertPt(4)] })).toBe('cut.outside-face');
    expect(refusedCode(shape, cut, null, { points: [vertPt(2), vertPt(4)] })).toBe('cut.outside-face');
    runOk(shape, cut, null, { points: [vertPt(0), vertPt(3)] });
    expect(vef(shape)).toBe('6/7/2');
    // An edge point on the reflex corner's edges: 2–3 at 0.5 → (1.5, 1) to 4–5 at 0.5 → (0.5, 2) crosses the notch.
    const notch = editMeshFrom(l);
    expect(
      refusedCode(notch, cut, null, {
        points: [edgePt(notch.findEdge(2, 3), 0.5), edgePt(notch.findEdge(4, 5), 0.5)],
      }),
    ).toBe('cut.outside-face');
  });

  it('chords of one path in one face must not cross', () => {
    const m = editMeshFrom(cubeData());
    // 0–1 at 0.2 → 2–3 at 0.2 → 0–1 at 0.8 → 2–3 at 0.8 zig-zags inside face 0 without crossing: fine.
    const a = m.findEdge(0, 1);
    const b = m.findEdge(2, 3);
    const run = runOp(m, cut, null, { points: [edgePt(a, 0.2), vertPt(3), edgePt(a, 0.8), vertPt(2)] });
    expect('refused' in run.result).toBe(false);
    const crossing = editMeshFrom(cubeData());
    // 0–1 at 0.2 → 2–3 at 0.2 (from 2: near 2) then 0–1 at 0.9 → 2–3 at 0.9 (near 3): the second chord crosses the first.
    expect(
      refusedCode(crossing, cut, null, {
        points: [edgePt(a, 0.2), edgePt(b, 0.2), vertPt(2), edgePt(a, 0.1)],
      }),
    ).toBe('cut.crossing');
  });
});

describe('mesh.cut under symmetry (§5.14, P10)', () => {
  /** A 2×1×1 cube: the seam (x = 0) runs through its middle loop. */
  const split = () => editMeshFrom(primitive('cube', { width: 2, subdivisionsWidth: 2 }));
  const sym = (m: EditMesh) => context({ symmetry: { map: testSymmetryMap(m), preserveSeam: true } });

  it('a path on one side is mirrored as a second cut in the same run (+4 vertices, partners for all)', () => {
    const m = split();
    const top = edgeAt(m, [0, 0.5, 0.5], [1, 0.5, 0.5]);
    const bottom = edgeAt(m, [0, -0.5, 0.5], [1, -0.5, 0.5]);
    const { points: P } = m.counts;
    runOk(m, cut, null, { points: [edgePt(top, 0.3), edgePt(bottom, 0.6)] }, sym(m));
    expect(m.counts.points).toBe(P + 4);
    expect(asymmetry(m)).toBeLessThan(1e-6);
    expect(testSymmetryMap(m).unmatched).toBe(0);
  });

  it('a path through an in-seam edge is one symmetric cut; the seam point keeps its t (no snap to 0.5)', () => {
    const m = split();
    // Front face (z = 0.5): left quad x ∈ [0, 1], right quad x ∈ [−1, 0], shared in-seam edge x = 0.
    const leftTop = edgeAt(m, [0, 0.5, 0.5], [1, 0.5, 0.5]);
    const seam = edgeAt(m, [0, -0.5, 0.5], [0, 0.5, 0.5]);
    const rightBottom = edgeAt(m, [-1, -0.5, 0.5], [0, -0.5, 0.5]);
    const { points: P } = m.counts;
    const y0 = position(m, m.edgeVert(seam, 0))[1];
    const y1 = position(m, m.edgeVert(seam, 1))[1];
    const result = runOk(
      m,
      cut,
      null,
      { points: [edgePt(leftTop, 0.4), edgePt(seam, 0.3), edgePt(rightBottom, 0.5)] },
      sym(m),
    );
    expect(m.counts.points).toBe(P + 3);
    expect(result.selection.edges.count()).toBe(2);
    const seamVertex = position(m, P + 1);
    expect(seamVertex[0]).toBe(0);
    expect(seamVertex[1]).toBeCloseTo(y0 + 0.3 * (y1 - y0), 6);
    expect(asymmetry(m)).toBeLessThan(1e-6);
    expect(testSymmetryMap(m).unmatched).toBe(0);
  });

  it('a chord crossing the plane inside a face is clipped and mirrored: one horizontal symmetric chord', () => {
    const m = editMeshFrom(cubeData());
    const right = m.findEdge(1, 2); // x = +0.5, front face
    const left = m.findEdge(0, 3); // x = −0.5
    const { points: P } = m.counts;
    runOk(m, cut, null, { points: [edgePt(right, 0.25), edgePt(left, 0.9)] }, sym(m));
    expect(m.counts.points).toBe(P + 2);
    const a = position(m, P);
    const b = position(m, P + 1);
    expect(a[1]).toBeCloseTo(b[1], 6);
    expect(a[0]).toBeCloseTo(-b[0], 6);
    expect(asymmetry(m)).toBeLessThan(1e-6);
  });

  it('points without a partner are not mirrored (`symmetry.unmatched-partner`)', () => {
    const m = split();
    const top = edgeAt(m, [0, 0.5, 0.5], [1, 0.5, 0.5]);
    const bottom = edgeAt(m, [0, -0.5, 0.5], [1, -0.5, 0.5]);
    // Cut once without symmetry: the new vertices have no partners.
    runOk(m, cut, null, { points: [edgePt(top, 0.3), edgePt(bottom, 0.3)] });
    const chord = m.counts.edges - 1;
    const { points: P } = m.counts;
    const map = testSymmetryMap(m);
    expect(map.unmatched).toBe(2);
    // From the unmatched chord's midpoint to the (shortened) top edge: the chord has no partner, so no mirror cut.
    const result = runOk(
      m,
      cut,
      null,
      { points: [edgePt(chord, 0.5), edgePt(top, 0.8)] },
      context({ symmetry: { map, preserveSeam: true } }),
    );
    expect(result.warnings.map((w) => w.code)).toContain('symmetry.unmatched-partner');
    expect(m.counts.points).toBe(P + 2);
  });
});

describe('mesh.cut fuzz (§9 B4: random paths never produce invalid topology)', () => {
  /** Builds a path by walking faces: each step picks a face around the current point and a point on another edge. */
  function walk(m: EditMesh, seeds: readonly (readonly [number, number, number, boolean])[]): unknown[] {
    const points: { kind: 'edge' | 'vertex'; edge?: number; t?: number; vertex?: number }[] = [];
    if (m.counts.faces === 0) return points;
    let face = (seeds[0]?.[0] ?? 0) % m.counts.faces;
    for (const [fSeed, eSeed, tSeed, asVertex] of seeds) {
      const corners: number[] = [];
      const start = m.faceCorner(face);
      let c = start;
      do {
        corners.push(c);
        c = m.cornerNext(c);
      } while (c !== start);
      const corner = corners[eSeed % corners.length] as number;
      if (asVertex) points.push({ kind: 'vertex', vertex: m.cornerVert(corner) });
      else points.push({ kind: 'edge', edge: m.cornerEdge(corner), t: 0.05 + (tSeed % 90) / 100 });
      // Next face: one across this corner's edge (or the same face).
      const e = m.cornerEdge(corner);
      const radial: number[] = [];
      const r0 = m.edgeCorner(e);
      let r = r0;
      do {
        radial.push(m.cornerFace(r));
        r = m.cornerRadialNext(r);
      } while (r !== r0);
      face = radial[fSeed % radial.length] as number;
    }
    return points;
  }

  it('on primitives and soups: a valid mesh or a refusal, P5 exact', () => {
    let ran = 0;
    let refused = 0;
    const step = fc.tuple(fc.nat(), fc.nat(), fc.nat(), fc.boolean());
    fc.assert(
      fc.property(
        arbPrimitive(),
        fc.array(step, { minLength: 2, maxLength: 8 }),
        fc.boolean(),
        ({ kind, params }, seeds, symmetric) => {
          const m = editMeshFrom(primitive(kind, params));
          const ctx = symmetric
            ? context({ symmetry: { map: testSymmetryMap(m), preserveSeam: true }, epsilon: 1e-7 })
            : context({ epsilon: 1e-7 });
          const run = runOp(m, cut, null, { points: walk(m, seeds) as never }, ctx);
          if ('refused' in run.result) refused++;
          else ran++;
        },
      ),
      { numRuns: 400, seed: 7 },
    );
    expect(ran).toBeGreaterThan(80);
    expect(refused).toBeGreaterThan(0);
    // Polygon soups: non-manifold edges, bow-ties, flipped and duplicate faces.
    fc.assert(
      fc.property(arbSoup(), fc.array(step, { minLength: 2, maxLength: 6 }), (soup, seeds) => {
        const m = editMeshFrom(soup);
        runOp(m, cut, null, { points: walk(m, seeds) as never }, context({ epsilon: 1e-7 }));
      }),
      { numRuns: 300, seed: 11 },
    );
  });
});
