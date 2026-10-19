// Walker goldens (M6A-SPEC §9 B2 Tests, §5.6, research 10 §4.1): edge loops, rings, vertex and face loops on the cube,
// a cylinder with loops, the torus; partial loops on vertices, edges and faces; pole, triangle, n-gon, border,
// non-manifold and hidden stops. Exact index lists are kept in the B2 golden file (goldens.test.ts); this file
// asserts the structure every list must have.
import { describe, expect, it } from 'vitest';
import { edgeLoop, edgeRing, editMeshFrom, faceLoop, partialLoop, vertexLoop } from '../../src';
import { nonManifoldCorpus } from '../../src/testing';
import {
  edgeFaces,
  edgesChain,
  facesChain,
  faceVerts,
  hiddenSet,
  hideFaces,
  mesh,
  openCylinder,
  position,
  sorted,
  vertexAt,
} from './fixtures';

const torus = (): ReturnType<typeof mesh> => mesh('torus'); // 12 × 6: 72/144/72

describe('edge loops', () => {
  it('torus: every edge lies on a closed loop of 12 (around the axis) or 6 (around the section)', () => {
    const m = torus();
    const lengths = new Map<number, number>();
    for (let e = 0; e < m.counts.edges; e++) {
      const loop = edgeLoop(m, e);
      expect(loop[0]).toBe(e);
      expect(new Set(loop).size).toBe(loop.length);
      expect(edgesChain(m, loop, true)).toBe(true);
      lengths.set(loop.length, (lengths.get(loop.length) ?? 0) + 1);
      // A closed loop starts at the seed and runs towards edgeVert(seed, 1).
      const next = loop[1] as number;
      expect([m.edgeVert(next, 0), m.edgeVert(next, 1)]).toContain(m.edgeVert(e, 1));
    }
    expect(lengths.get(12)).toBe(72);
    expect(lengths.get(6)).toBe(72);
    expect(lengths.size).toBe(2);
  });

  it('cube: every vertex is a valence-3 pole, so a loop is the edge itself', () => {
    const m = mesh('cube');
    for (let e = 0; e < 12; e++) expect(Array.from(edgeLoop(m, e))).toEqual([e]);
  });

  it('cylinder (8 sides, 3 height spans, n-gon caps): middle rings close, verticals stop at the cap poles', () => {
    const m = mesh('cylinder', { subdivisionsHeight: 3 }); // 32/56/26
    expect(m.counts).toMatchObject({ points: 32, edges: 56, faces: 26 });
    const y = 1 / 6;
    // A horizontal edge of the ring at y = 1/6 (interior, valence-4 vertices, four quads): a closed loop of 8.
    let ring = -1;
    let vertical = -1;
    for (let e = 0; e < m.counts.edges; e++) {
      const a = position(m, m.edgeVert(e, 0));
      const b = position(m, m.edgeVert(e, 1));
      if (ring < 0 && Math.abs(a[1] - y) < 1e-6 && Math.abs(b[1] - y) < 1e-6) ring = e;
      if (vertical < 0 && Math.abs(a[1] - b[1]) > 0.3 && Math.abs(Math.min(a[1], b[1]) + 1 / 6) < 1e-6) vertical = e;
    }
    const loop = edgeLoop(m, ring);
    expect(loop.length).toBe(8);
    expect(edgesChain(m, loop, true)).toBe(true);
    // The vertical loop runs from cap rim to cap rim (3 edges) and stops at the valence-3 rim vertices (n-gon caps).
    const up = edgeLoop(m, vertical);
    expect(up.length).toBe(3);
    expect(edgesChain(m, up, false)).toBe(true);
    const ys = Array.from(up).flatMap((e) => [position(m, m.edgeVert(e, 0))[1], position(m, m.edgeVert(e, 1))[1]]);
    expect(Math.min(...ys)).toBeCloseTo(-0.5, 6);
    expect(Math.max(...ys)).toBeCloseTo(0.5, 6);
    // The top rim touches the n-gon cap: its vertices have valence 3, so its loop is the edge alone.
    const rim = [...Array(m.counts.edges).keys()].find(
      (e) => position(m, m.edgeVert(e, 0))[1] > 0.49 && position(m, m.edgeVert(e, 1))[1] > 0.49,
    ) as number;
    expect(Array.from(edgeLoop(m, rim))).toEqual([rim]);
  });

  it('sphere: vertical loops stop at the rings next to the poles (triangle fans)', () => {
    const m = mesh('sphere'); // 12 × 8: 86/180/96, triangles at both poles
    const north = vertexAt(m, 0, 0.5, 0);
    expect(north).toBeGreaterThanOrEqual(0);
    // A meridian edge between ring 3 and ring 4 (equator band).
    let meridian = -1;
    for (let e = 0; e < m.counts.edges && meridian < 0; e++) {
      const a = position(m, m.edgeVert(e, 0));
      const b = position(m, m.edgeVert(e, 1));
      // Same azimuth (a meridian), between the ring below the equator and the equator.
      const sameAzimuth = Math.abs(a[0] * b[2] - a[2] * b[0]) < 1e-6 && a[0] * b[0] + a[2] * b[2] > 0;
      if (sameAzimuth && Math.min(a[1], b[1]) < -0.1 && Math.abs(Math.max(a[1], b[1])) < 1e-6) meridian = e;
    }
    expect(meridian).toBeGreaterThanOrEqual(0);
    const loop = edgeLoop(m, meridian);
    // Rings 1…7 hold the quads; the walk stops at ring 1 and ring 7, whose vertices touch triangles: 6 edges.
    expect(loop.length).toBe(6);
    expect(edgesChain(m, loop, false)).toBe(true);
    for (const e of loop) {
      expect(m.edgeVert(e, 0)).not.toBe(north);
      expect(m.edgeVert(e, 1)).not.toBe(north);
    }
  });

  it('border: a plane border runs round the corners (vertices with exactly two border edges)', () => {
    const m = mesh('plane', { subdivisionsWidth: 3, subdivisionsHeight: 3 }); // 16/24/9
    const borderEdges: number[] = [];
    for (let e = 0; e < m.counts.edges; e++) if (m.edgeFaceCount(e) === 1) borderEdges.push(e);
    expect(borderEdges.length).toBe(12);
    const loop = edgeLoop(m, borderEdges[0] as number);
    expect(sorted(loop)).toEqual(sorted(borderEdges));
    expect(edgesChain(m, loop, true)).toBe(true);
    // An interior edge's loop ends at the border vertices (not interior): it spans the plane, 3 edges.
    const interior = [...Array(m.counts.edges).keys()].find((e) => m.edgeFaceCount(e) === 2) as number;
    const across = edgeLoop(m, interior);
    expect(across.length).toBe(3);
    expect(edgesChain(m, across, false)).toBe(true);
  });

  it('an open cylinder: both rims are closed border loops of 8; the side loops cross the band', () => {
    const m = editMeshFrom(openCylinder(8, 3)); // 24/40/16
    const rim = m.findEdge(0, 1);
    expect(sorted(edgeLoop(m, rim))).toEqual(sorted([0, 1, 2, 3, 4, 5, 6, 7].map((i) => m.findEdge(i, (i + 1) % 8))));
    const mid = m.findEdge(8, 9);
    expect(edgeLoop(m, mid).length).toBe(8);
    expect(Array.from(edgeLoop(m, m.findEdge(0, 8)))).toEqual([m.findEdge(0, 8), m.findEdge(8, 16)]);
  });

  it('non-manifold and wire seeds are a loop of one; a non-manifold edge stops a ring', () => {
    const fin = editMeshFrom(nonManifoldCorpus()['three-face-edge'] as never);
    const e01 = fin.findEdge(0, 1);
    expect(Array.from(edgeLoop(fin, e01))).toEqual([e01]);
    expect(Array.from(edgeRing(fin, e01))).toEqual([e01]);
    const loose = editMeshFrom(nonManifoldCorpus()['loose'] as never);
    const wire = loose.findEdge(2, 3);
    expect(Array.from(edgeLoop(loose, wire))).toEqual([wire]);
    expect(Array.from(edgeRing(loose, wire))).toEqual([wire]);
  });

  it('out-of-range seeds throw out-of-range (a caller error)', () => {
    const m = mesh('cube');
    expect(() => edgeLoop(m, 12)).toThrow(expect.objectContaining({ code: 'out-of-range' }));
    expect(() => edgeRing(m, -1)).toThrow(expect.objectContaining({ code: 'out-of-range' }));
    expect(() => vertexLoop(m, 8, 0)).toThrow(expect.objectContaining({ code: 'out-of-range' }));
    expect(() => faceLoop(m, 0, 99)).toThrow(expect.objectContaining({ code: 'out-of-range' }));
  });
});

describe('edge rings', () => {
  it('cube: the four parallel edges, closed', () => {
    const m = mesh('cube');
    for (let e = 0; e < 12; e++) {
      const ring = edgeRing(m, e);
      expect(ring.length).toBe(4);
      expect(ring[0]).toBe(e);
      // Parallel: every ring edge has the seed's direction.
      const d = (x: number): number[] => {
        const a = position(m, m.edgeVert(x, 0));
        const b = position(m, m.edgeVert(x, 1));
        return [Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2])];
      };
      for (const r of ring) expect(d(r)).toEqual(d(e));
    }
  });

  it('torus: rings are 6 or 12, complementary to the loop through the same edge', () => {
    const m = torus();
    for (let e = 0; e < m.counts.edges; e++) {
      const ring = edgeRing(m, e);
      expect(ring.length + edgeLoop(m, e).length).toBe(18);
      // Consecutive ring edges are opposite sides of one quad.
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i] as number;
        const b = ring[(i + 1) % ring.length] as number;
        const shared = edgeFaces(m, a).filter((f) => edgeFaces(m, b).includes(f));
        expect(shared.length).toBe(1);
      }
    }
  });

  it('cylinder: a vertical ring goes round (8, closed); a horizontal ring stops at the n-gon caps', () => {
    const m = mesh('cylinder', { subdivisionsHeight: 3 });
    const v0 = vertexAt(m, 0, -1 / 6, -0.5);
    const v1 = vertexAt(m, 0, 1 / 6, -0.5);
    const vertical = m.findEdge(v0, v1);
    expect(edgeRing(m, vertical).length).toBe(8);
    // A horizontal edge of the ring at y = 1/6: the ring climbs to both rims (4 edges at y = −0.5, −1/6, 1/6, 0.5)
    // and stops there, because the rims' other faces are the n-gon caps.
    const v2 = vertexAt(m, 0.5 * Math.sin(Math.PI / 4), 1 / 6, -0.5 * Math.cos(Math.PI / 4));
    const horizontal = m.findEdge(v1, v2);
    expect(horizontal).toBeGreaterThanOrEqual(0);
    const ring = Array.from(edgeRing(m, horizontal));
    expect(ring.length).toBe(4);
    expect(sorted(ring.map((e) => Math.round(position(m, m.edgeVert(e, 0))[1] * 6)))).toEqual([-3, -1, 1, 3]);
    expect(m.edgeFaceCount(ring[0] as number)).toBe(2);
    for (const end of [ring[0] as number, ring.at(-1) as number]) {
      expect(edgeFaces(m, end).some((f) => m.faceLen(f) === 8)).toBe(true);
    }
  });

  it('a plane: rings stop at the border', () => {
    const m = mesh('plane', { subdivisionsWidth: 3, subdivisionsHeight: 2 });
    for (let e = 0; e < m.counts.edges; e++) {
      const ring = edgeRing(m, e);
      const along = m.edgeFaceCount(ring[0] as number) === 1 && m.edgeFaceCount(ring.at(-1) as number) === 1;
      expect(along).toBe(true);
    }
  });
});

describe('vertex and face loops', () => {
  it('torus: a vertex loop along each edge has 12 or 6 vertices, starting at the vertex along the edge', () => {
    const m = torus();
    for (let v = 0; v < 6; v++) {
      const first = m.vertEdge(v);
      let e = first;
      do {
        const loop = vertexLoop(m, v, e);
        expect([12, 6]).toContain(loop.length);
        expect(loop[0]).toBe(v);
        expect(loop[1]).toBe(m.edgeOther(e, v));
        for (let i = 0; i < loop.length; i++)
          expect(m.findEdge(loop[i] as number, loop[(i + 1) % loop.length] as number)).toBeGreaterThanOrEqual(0);
        e = m.edgeDiskNext(e, v);
      } while (e !== first);
    }
  });

  it('a vertex loop needs `along` at the vertex (else the vertex alone)', () => {
    const m = torus();
    const far = [...Array(m.counts.edges).keys()].find(
      (e) => m.edgeVert(e, 0) !== 0 && m.edgeVert(e, 1) !== 0,
    ) as number;
    expect(Array.from(vertexLoop(m, 0, far))).toEqual([0]);
  });

  it('torus: face loops across each edge of a face are closed strips of 12 or 6 starting at the face', () => {
    const m = torus();
    const f = 5;
    const vs = faceVerts(m, f);
    for (let i = 0; i < 4; i++) {
      const across = m.findEdge(vs[i] as number, vs[(i + 1) % 4] as number);
      const loop = faceLoop(m, f, across);
      expect([12, 6]).toContain(loop.length);
      expect(loop[0]).toBe(f);
      // The first step crosses `across`.
      expect(edgeFaces(m, across)).toContain(loop[1]);
      expect(facesChain(m, loop)).toBe(true);
    }
  });

  it('cylinder: a vertical face loop stops before the n-gon caps; `across` not on the face gives the face alone', () => {
    const m = mesh('cylinder', { subdivisionsHeight: 3 });
    const side = [...Array(m.counts.faces).keys()].find((f) => m.faceLen(f) === 4) as number;
    const vs = faceVerts(m, side);
    const lengths: number[] = [];
    for (let i = 0; i < 4; i++)
      lengths.push(faceLoop(m, side, m.findEdge(vs[i] as number, vs[(i + 1) % 4] as number)).length);
    expect(sorted(lengths)).toEqual([3, 3, 8, 8]);
    const notMine = [...Array(m.counts.edges).keys()].find((e) => !edgeFaces(m, e).includes(side)) as number;
    expect(Array.from(faceLoop(m, side, notMine))).toEqual([side]);
  });
});

describe('partial loops', () => {
  it('edges: the shorter arc of the loop, ordered from a; ties run towards edgeVert(a, 1); off-loop → null', () => {
    const m = torus();
    const loop = Array.from(edgeLoop(m, 0)); // closed, 12 or 6
    const n = loop.length;
    expect(Array.from(partialLoop(m, 0, loop[3] as number, 'edge') ?? [])).toEqual(loop.slice(0, 4));
    expect(Array.from(partialLoop(m, 0, loop[n - 3] as number, 'edge') ?? [])).toEqual([
      0,
      ...loop.slice(n - 3).reverse(),
    ]);
    const half = n / 2;
    expect(Array.from(partialLoop(m, 0, loop[half] as number, 'edge') ?? [])).toEqual(loop.slice(0, half + 1));
    const ringEdge = edgeRing(m, 0)[1] as number;
    expect(partialLoop(m, 0, ringEdge, 'edge')).toBeNull();
    expect(Array.from(partialLoop(m, 0, 0, 'edge') ?? [])).toEqual([0]);
  });

  it('edges on an open loop: the run between them', () => {
    const m = mesh('plane', { subdivisionsWidth: 4, subdivisionsHeight: 4 });
    const interior = [...Array(m.counts.edges).keys()].find(
      (e) => m.edgeFaceCount(e) === 2 && edgeLoop(m, e).length === 4,
    ) as number;
    const loop = Array.from(edgeLoop(m, interior));
    expect(Array.from(partialLoop(m, loop[3] as number, loop[1] as number, 'edge') ?? [])).toEqual([
      loop[3],
      loop[2],
      loop[1],
    ]);
  });

  it('vertices: the shorter arc along the common loop', () => {
    const m = torus();
    const v = 0;
    const along = m.vertEdge(v);
    const loop = Array.from(vertexLoop(m, v, along));
    const b = loop[2] as number;
    expect(Array.from(partialLoop(m, v, b, 'vertex') ?? [])).toEqual([v, loop[1], b]);
    const c = loop[loop.length - 2] as number;
    expect(Array.from(partialLoop(m, v, c, 'vertex') ?? [])).toEqual([v, loop.at(-1), c]);
    // A vertex on neither loop through v.
    const others = new Set<number>(vertexLoop(m, v, along));
    const e2 = m.edgeDiskNext(along, v);
    for (const u of vertexLoop(m, v, e2)) others.add(u);
    const off = [...Array(m.counts.points).keys()].find((u) => !others.has(u)) as number;
    expect(partialLoop(m, v, off, 'vertex')).toBeNull();
  });

  it('faces: the shorter arc along the common face loop', () => {
    const m = torus();
    const f = 0;
    const vs = faceVerts(m, f);
    const across = m.findEdge(vs[0] as number, vs[1] as number);
    const loop = Array.from(faceLoop(m, f, across));
    const target = loop[2] as number;
    expect(Array.from(partialLoop(m, f, target, 'face') ?? [])).toEqual([f, loop[1], target]);
  });
});

describe('hidden components stop walkers', () => {
  it('a hidden edge on a torus loop opens the loop just before it; a hidden seed gives nothing', () => {
    const m = torus();
    const loop = Array.from(edgeLoop(m, 0));
    const hidden = hiddenSet(m, { edges: [loop[4] as number] });
    const cut = Array.from(edgeLoop(m, 0, hidden));
    expect(cut).not.toContain(loop[4]);
    expect(cut.length).toBe(loop.length - 1);
    expect(edgesChain(m, cut, false)).toBe(true);
    expect(Array.from(edgeLoop(m, loop[4] as number, hidden))).toEqual([]);
  });

  it('a hidden vertex stops the loop at it (the edge into it stays, no edge beyond it)', () => {
    const m = torus();
    const loop = Array.from(edgeLoop(m, 0));
    const shared = [m.edgeVert(loop[3] as number, 0), m.edgeVert(loop[3] as number, 1)].find((x) =>
      [m.edgeVert(loop[4] as number, 0), m.edgeVert(loop[4] as number, 1)].includes(x),
    ) as number;
    const cut = Array.from(edgeLoop(m, 0, hiddenSet(m, { verts: [shared] })));
    expect(cut).toContain(loop[3]);
    expect(cut).toContain(loop[4]);
    expect(cut.length).toBe(loop.length);
    expect(edgesChain(m, cut, false)).toBe(true);
    // The vertex loop drops the hidden vertex.
    expect(Array.from(vertexLoop(m, m.edgeVert(0, 0), 0, hiddenSet(m, { verts: [shared] })))).not.toContain(shared);
  });

  it('hidden faces stop rings and face loops; face-mode hiding stops edge loops at the hidden edges', () => {
    const m = torus();
    const ring = Array.from(edgeRing(m, 0));
    const between = edgeFaces(m, ring[2] as number).filter((f) => edgeFaces(m, ring[3] as number).includes(f));
    const h = hiddenSet(m, { faces: between });
    // The walk stops at the hidden quad from both sides: every edge stays, the ring opens between ring[2] and ring[3].
    const cutRing = Array.from(edgeRing(m, 0, h));
    expect(sorted(cutRing)).toEqual(sorted(ring));
    expect(cutRing[0]).toBe(ring[3]);
    expect(cutRing.at(-1)).toBe(ring[2]);
    const f = between[0] as number;
    const vs = faceVerts(m, f);
    const across = m.findEdge(vs[0] as number, vs[1] as number);
    const strip = faceLoop(m, f, across);
    const other = strip[3] as number;
    const cutStrip = Array.from(
      faceLoop(m, other, m.findEdge(faceVerts(m, other)[0] as number, faceVerts(m, other)[1] as number), h),
    );
    expect(cutStrip).not.toContain(f);
    expect(Array.from(faceLoop(m, f, across, h))).toEqual([]);
    // Hiding a band of faces (face mode) hides the edges only they use: loops through them stop.
    const band = Array.from(faceLoop(m, 0, m.findEdge(faceVerts(m, 0)[0] as number, faceVerts(m, 0)[1] as number)));
    const hb = hideFaces(m, band.slice(0, 3));
    for (let e = 0; e < m.counts.edges; e++) {
      if (hb.edges.has(e)) continue;
      for (const x of edgeLoop(m, e, hb)) expect(hb.edges.has(x)).toBe(false);
    }
  });
});
