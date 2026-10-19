// mesh.bevel (M6A-SPEC §5.9, §9 B5 Tests): the count oracles (one cube edge with 1/2/3 segments, all 12 edges, one
// face in face mode = its four edges), Maya fraction semantics (0.3 on a 1 m cube edge = 0.15 m along the adjacent
// edges), absolute offsets, the clamp (0.98 when both ends of an edge are bevelled, the clamp property: no inverted
// faces and no coincident points for any fraction), profiles (chamfer, roundness), hardness (H2 rows, hardened
// borders, H1 fan spokes, P7-hard), attribute propagation (uv0 lerps and stays continuous, skin weights, paint and
// materials), refusals, selection′ and the frame. Every run goes through the op harness (P1, P5, P8).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  BUILTIN_LAYERS,
  type EditMesh,
  EDGE_HARD,
  editMeshFrom,
  isRefusal,
  MESH_OPS,
  type MeshOp,
  primitive,
  selectionOf,
  topologyStats,
} from '../../../src';
import { buildMeshData, cubeData, diffStored, signedVolume, vef } from '../../../src/testing';
import { at, consistentlyWound, ctxOf, edgeBetween, faceVerts, minVertexGap, runChecked, runOk } from './harness';

const bevel = MESH_OPS['mesh.bevel'] as MeshOp;

const cube = (): EditMesh => editMeshFrom(primitive('cube', {}));
/** The top-front edge of the 1 m cube, along X at y = z = 0.5. */
const topFront = (m: EditMesh): number => edgeBetween(m, [-0.5, 0.5, 0.5], [0.5, 0.5, 0.5]);
const edgeSel = (m: EditMesh, edges: readonly number[]) => selectionOf('edge', edges, m.counts);
const allEdges = (m: EditMesh): number[] => Array.from({ length: m.counts.edges }, (_, e) => e);

function hasPoint(m: EditMesh, q: readonly number[], tol = 1e-6): boolean {
  for (let v = 0; v < m.counts.points; v++) {
    const p = at(m, v);
    if (Math.hypot(p[0] - (q[0] as number), p[1] - (q[1] as number), p[2] - (q[2] as number)) <= tol) return true;
  }
  return false;
}

function faceNormal(m: EditMesh, f: number): [number, number, number] {
  const vs = faceVerts(m, f);
  let x = 0;
  let y = 0;
  let z = 0;
  for (let i = 0; i < vs.length; i++) {
    const a = at(m, vs[i] as number);
    const b = at(m, vs[(i + 1) % vs.length] as number);
    x += (a[1] - b[1]) * (a[2] + b[2]);
    y += (a[2] - b[2]) * (a[0] + b[0]);
    z += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return [x, y, z];
}

function centroid(m: EditMesh, f: number): [number, number, number] {
  const vs = faceVerts(m, f);
  const c: [number, number, number] = [0, 0, 0];
  for (const v of vs) {
    const p = at(m, v);
    for (let k = 0; k < 3; k++) c[k] = (c[k] as number) + (p[k] as number) / vs.length;
  }
  return c;
}

/** Every face of a convex mesh around `centre` faces away from it (no inverted faces). */
function allFacesOutward(m: EditMesh, centre: readonly [number, number, number] = [0, 0, 0]): boolean {
  for (let f = 0; f < m.counts.faces; f++) {
    const n = faceNormal(m, f);
    const c = centroid(m, f);
    const dot = n[0] * (c[0] - centre[0]) + n[1] * (c[1] - centre[1]) + n[2] * (c[2] - centre[2]);
    if (!(dot > 0)) return false;
  }
  return true;
}

/**
 * No inverted or collapsed faces on a non-convex result: every face has area, and no two faces sharing an edge fold
 * onto each other (their normals more than 120° apart; a flipped face makes them nearly opposite).
 */
function noFolds(m: EditMesh): boolean {
  const unit = (f: number): [number, number, number] | null => {
    const n = faceNormal(m, f);
    const l = Math.hypot(...n);
    return l > 0 ? [n[0] / l, n[1] / l, n[2] / l] : null;
  };
  for (let f = 0; f < m.counts.faces; f++) if (unit(f) === null) return false;
  for (let e = 0; e < m.counts.edges; e++) {
    if (m.edgeFaceCount(e) !== 2) continue;
    const c = m.edgeCorner(e);
    const a = unit(m.cornerFace(c)) as number[];
    const b = unit(m.cornerFace(m.cornerRadialNext(c))) as number[];
    if (
      !(
        (a[0] as number) * (b[0] as number) +
          (a[1] as number) * (b[1] as number) +
          (a[2] as number) * (b[2] as number) >
        -0.5
      )
    ) {
      return false;
    }
  }
  return true;
}

describe('count oracles (§5.29)', () => {
  it.each([
    [1, '10/15/7'],
    [2, '12/18/8'],
    [3, '14/21/9'],
  ])('one cube edge, %i segment(s) → %s', (segments, counts) => {
    const m = cube();
    runOk(bevel, m, edgeSel(m, [topFront(m)]), { segments });
    expect(vef(m)).toBe(counts);
    expect(topologyStats(m)).toMatchObject({ boundaryLoops: 0, nonManifoldEdges: 0, euler: 2 });
  });

  it('all 12 edges at the default fraction 0.5 → 24/48/26 with no coincident vertices', () => {
    const m = cube();
    const result = runOk(bevel, m, edgeSel(m, allEdges(m)), {});
    expect(vef(m)).toBe('24/48/26');
    expect(minVertexGap(m)).toBeGreaterThan(0.1);
    expect(result.warnings).toEqual([]);
    // Eight corner triangles, twelve strips, six shrunk faces.
    const sizes = Array.from({ length: m.counts.faces }, (_, f) => m.faceLen(f)).sort((a, b) => a - b);
    expect(sizes.filter((n) => n === 3)).toHaveLength(8);
    expect(sizes.filter((n) => n === 4)).toHaveLength(18);
    expect(allFacesOutward(m)).toBe(true);
  });

  it('one cube face in face mode bevels exactly its four edges', () => {
    const a = cube();
    const top = Array.from({ length: a.counts.faces }, (_, f) => f).find((f) => faceNormal(a, f)[1] > 0.5) as number;
    const faceRun = runOk(bevel, a, selectionOf('face', [top], a.counts), { fraction: 0.4 });
    const b = cube();
    const edges = faceVerts(b, top).map((v, i, vs) => b.findEdge(v, vs[(i + 1) % vs.length] as number));
    runOk(bevel, b, edgeSel(b, edges), { fraction: 0.4 });
    expect(vef(a)).toBe('12/20/10');
    expect(diffStored(a, b)).toBeNull();
    // selection′: the four strips plus the shrunk top face (Maya).
    expect(faceRun.selection.kind).toBe('face');
    expect(faceRun.selection.faces.count()).toBe(5);
  });
});

describe('width (Maya fraction semantics)', () => {
  it('fraction 0.3 on a 1 m cube edge puts the new vertices 0.15 m along the adjacent edges', () => {
    const m = cube();
    runOk(bevel, m, edgeSel(m, [topFront(m)]), { fraction: 0.3 });
    for (const x of [-0.5, 0.5]) {
      expect(hasPoint(m, [x, 0.35, 0.5])).toBe(true);
      expect(hasPoint(m, [x, 0.5, 0.35])).toBe(true);
      expect(hasPoint(m, [x, 0.5, 0.5])).toBe(false);
    }
  });

  it('the default 0.5 is a quarter of the shortest adjacent edge', () => {
    const m = editMeshFrom(primitive('cube', { width: 2, height: 1, depth: 1 }));
    runOk(bevel, m, edgeSel(m, [edgeBetween(m, [-1, 0.5, 0.5], [1, 0.5, 0.5])]), {});
    // L = 1 (the 1 m edges at each end), so the slides are 0.25 m.
    expect(hasPoint(m, [1, 0.25, 0.5])).toBe(true);
    expect(hasPoint(m, [1, 0.5, 0.25])).toBe(true);
  });

  it('an absolute offset is metres along the adjacent edges', () => {
    const m = cube();
    runOk(bevel, m, edgeSel(m, [topFront(m)]), { offsetAsFraction: false, offset: 0.1 });
    expect(hasPoint(m, [0.5, 0.4, 0.5])).toBe(true);
    expect(hasPoint(m, [-0.5, 0.5, 0.4])).toBe(true);
  });

  it('an absolute offset past the next vertex is clamped with bevel.clamped', () => {
    const m = cube();
    const result = runOk(bevel, m, edgeSel(m, [topFront(m)]), { offsetAsFraction: false, offset: 0.8 });
    expect(result.warnings.map((w) => w.code)).toEqual(['bevel.clamped']);
    expect(hasPoint(m, [0.5, 0, 0.5])).toBe(true);
  });

  it('fraction 1 with both ends of every edge bevelled clamps to 0.98', () => {
    const m = cube();
    const result = runOk(bevel, m, edgeSel(m, allEdges(m)), { fraction: 1 });
    expect(result.warnings.map((w) => w.code)).toEqual(['bevel.clamped']);
    expect(vef(m)).toBe('24/48/26');
    // Miters at 0.98 × ½ × 1 = 0.49 from each corner: the shrunk top face is 0.02 m wide.
    expect(hasPoint(m, [0.01, 0.5, 0.01])).toBe(true);
    expect(minVertexGap(m)).toBeGreaterThan(0.019);
  });

  it('clamp property: no inverted faces and no coincident points for any fraction in (0, 1]', () => {
    fc.assert(
      fc.property(
        fc.record({
          width: fc.double({ min: 0.2, max: 3, noNaN: true }),
          height: fc.double({ min: 0.2, max: 3, noNaN: true }),
          depth: fc.double({ min: 0.2, max: 3, noNaN: true }),
          subdivisionsWidth: fc.integer({ min: 1, max: 3 }),
          subdivisionsHeight: fc.integer({ min: 1, max: 3 }),
          subdivisionsDepth: fc.integer({ min: 1, max: 3 }),
        }),
        fc.array(fc.nat(), { minLength: 1, maxLength: 16 }),
        fc.double({ min: 0.001, max: 1, noNaN: true }),
        fc.integer({ min: 1, max: 3 }),
        fc.boolean(),
        (params, seeds, fraction, segments, faceMode) => {
          const m = editMeshFrom(primitive('cube', params));
          const volume = signedVolume(m);
          const n = faceMode ? m.counts.faces : m.counts.edges;
          const sel = selectionOf(
            faceMode ? 'face' : 'edge',
            seeds.map((s) => s % n),
            m.counts,
          );
          const ctx = ctxOf(m);
          const { result } = runChecked(bevel, m, sel, { fraction, segments }, ctx);
          expect(isRefusal(result)).toBe(false);
          expect(minVertexGap(m)).toBeGreaterThan(ctx.epsilon);
          expect(noFolds(m)).toBe(true);
          // Without subdivisions every bevelled edge runs corner to corner: the result stays convex.
          const plain = params.subdivisionsWidth + params.subdivisionsHeight + params.subdivisionsDepth === 3;
          expect(!plain || allFacesOutward(m)).toBe(true);
          expect(consistentlyWound(m)).toBe(true);
          expect(topologyStats(m)).toMatchObject({ boundaryLoops: 0, nonManifoldEdges: 0, euler: 2 });
          expect(signedVolume(m)).toBeGreaterThan(0);
          // A bevel only cuts material away (edges between coplanar faces cut nothing).
          expect(signedVolume(m)).toBeLessThanOrEqual(volume * (1 + 1e-6));
        },
      ),
      { numRuns: 120, seed: 5 },
    );
  });
});

describe('profiles', () => {
  it('two segments with chamfer: the middle row on the chord', () => {
    const m = cube();
    runOk(bevel, m, edgeSel(m, [topFront(m)]), { segments: 2 });
    expect(hasPoint(m, [-0.5, 0.375, 0.375])).toBe(true);
    expect(hasPoint(m, [0.5, 0.375, 0.375])).toBe(true);
  });

  it('chamfer off: the quadratic Bézier A → C′ → B with C′ = M + 2·roundness·(C − M)', () => {
    for (const [roundness, expected] of [
      [0, 0.375],
      [0.5, 0.4375],
      [1, 0.5],
    ] as const) {
      const m = cube();
      runOk(bevel, m, edgeSel(m, [topFront(m)]), { segments: 2, chamfer: false, roundness });
      expect(hasPoint(m, [0.5, expected, expected]), `roundness ${roundness}`).toBe(true);
    }
  });

  it('three or more bevelled edges with segments > 1 make a fan corner (bevel.fan-corner)', () => {
    const m = cube();
    const result = runOk(bevel, m, edgeSel(m, allEdges(m)), { segments: 2 });
    expect(vef(m)).toBe('56/132/78');
    const fan = result.warnings.find((w) => w.code === 'bevel.fan-corner');
    expect(fan?.count).toBe(8);
    expect(Array.from(fan?.elements ?? [])).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(fan?.message).toMatch(/vertex 0, 1, 2, 3, 4/);
    expect(allFacesOutward(m)).toBe(true);
  });

  it('roundness 1 with even segments meets at a corner and refuses with a reason', () => {
    const m = cube();
    const { result } = runChecked(bevel, m, edgeSel(m, allEdges(m)), { segments: 2, chamfer: false, roundness: 1 });
    expect(isRefusal(result) && result.code).toBe('bevel.zero-width');
    expect(isRefusal(result) && result.reason).toMatch(/Roundness 1/);
  });
});

describe('hardness (§5.3)', () => {
  it('P7-hard: a faceted cube stays all hard for every segment count and profile', () => {
    for (const segments of [1, 2, 3]) {
      for (const chamfer of [true, false]) {
        const m = cube();
        runOk(bevel, m, edgeSel(m, [0, 3, 5, 7]), { segments, chamfer });
        for (let e = 0; e < m.counts.edges; e++) expect(m.edgeFlags(e) & EDGE_HARD).toBe(EDGE_HARD);
      }
    }
  });

  it('smooth mesh: hardened strip borders, H2 rows (coplanar chamfer rows stay soft)', () => {
    const m = editMeshFrom(cubeData({ hard: false }));
    const e = edgeBetween(m, [-0.5, 0.5, 0.5], [0.5, 0.5, 0.5]);
    const result = runOk(bevel, m, edgeSel(m, [e]), { segments: 3 }, ctxOf(m, { faceted: false }));
    expect(result.resolvedArgs['smoothingAngle']).toBeCloseTo(Math.PI / 6, 12);
    const strip = new Set(result.selection.faces.toArray());
    let rows = 0;
    let borders = 0;
    for (let edge = 0; edge < m.counts.edges; edge++) {
      const faces: number[] = [];
      const c0 = m.edgeCorner(edge);
      let c = c0;
      do {
        faces.push(m.cornerFace(c));
        c = m.cornerRadialNext(c);
      } while (c !== c0);
      const inStrip = faces.filter((f) => strip.has(f)).length;
      if (inStrip === 2) rows++;
      if (inStrip === 1) borders++;
      // Borders hard (hardenBorders); rows between coplanar chamfer faces and every other edge soft.
      expect(m.edgeFlags(edge) & EDGE_HARD, `edge ${edge}`).toBe(inStrip === 1 ? EDGE_HARD : 0);
    }
    // The two long sides and the three short edges at each end.
    expect(rows).toBe(2);
    expect(borders).toBe(2 + 2 * 3);
  });

  it('hardenBorders off: borders follow H2 (a 45° fold is hard at 30°, soft at 60°)', () => {
    for (const [angle, hard] of [
      [Math.PI / 6, EDGE_HARD],
      [Math.PI / 3, 0],
    ] as const) {
      const m = editMeshFrom(cubeData({ hard: false }));
      const e = edgeBetween(m, [-0.5, 0.5, 0.5], [0.5, 0.5, 0.5]);
      runOk(bevel, m, edgeSel(m, [e]), { hardenBorders: false, smoothingAngle: angle }, ctxOf(m, { faceted: false }));
      const side = edgeBetween(m, [-0.5, 0.5, 0.25], [0.5, 0.5, 0.25]);
      expect(side).not.toBe(-1);
      expect(m.edgeFlags(side) & EDGE_HARD, `angle ${angle}`).toBe(hard);
    }
  });

  it('fan spokes follow H1 over the fan boundary', () => {
    const hard = cube();
    runOk(bevel, hard, edgeSel(hard, allEdges(hard)), { segments: 2 });
    for (let e = 0; e < hard.counts.edges; e++) expect(hard.edgeFlags(e) & EDGE_HARD).toBe(EDGE_HARD);
    const soft = editMeshFrom(cubeData({ hard: false }));
    runOk(
      bevel,
      soft,
      edgeSel(soft, allEdges(soft)),
      { segments: 2, hardenBorders: false, smoothingAngle: 3 },
      ctxOf(soft, { faceted: false }),
    );
    for (let e = 0; e < soft.counts.edges; e++) expect(soft.edgeFlags(e) & EDGE_HARD).toBe(0);
  });
});

describe('attributes (§5.2, P7)', () => {
  it('uv0 lerps along the split edges inside each face', () => {
    const m = cube();
    runOk(bevel, m, edgeSel(m, [topFront(m)]), { fraction: 0.3 });
    const uv = m.layer('uv0');
    // The front face (+Z) has u = x + 0.5, v = y + 0.5: its corner at (−0.5, 0.35, 0.5) is (0, 0.85).
    const front = Array.from({ length: m.counts.faces }, (_, f) => f).find((f) => faceNormal(m, f)[2] > 0.5) as number;
    expect(m.faceLen(front)).toBe(4);
    const start = m.faceCorner(front);
    let c = start;
    let found = -1;
    do {
      const p = at(m, m.cornerVert(c));
      if (Math.abs(p[0] + 0.5) < 1e-6 && Math.abs(p[1] - 0.35) < 1e-6) found = c;
      c = m.cornerNext(c);
    } while (c !== start);
    expect(found).not.toBe(-1);
    expect(uv?.get(found, 0)).toBeCloseTo(0, 6);
    expect(uv?.get(found, 1)).toBeCloseTo(0.85, 6);
  });

  it('continuous uv0 stays continuous across every edge (invariant 6) on a flat grid', () => {
    fc.assert(
      fc.property(
        fc.array(fc.nat(), { minLength: 1, maxLength: 10 }),
        fc.integer({ min: 1, max: 3 }),
        fc.boolean(),
        fc.double({ min: 0.05, max: 1, noNaN: true }),
        (seeds, segments, chamfer, fraction) => {
          const data = primitive('plane', { width: 4, height: 4, subdivisionsWidth: 5, subdivisionsHeight: 5 });
          const m = editMeshFrom(data);
          const interior = allEdges(m).filter((e) => m.edgeFaceCount(e) === 2);
          const picks = seeds.map((s) => interior[s % interior.length] as number);
          const { result } = runChecked(bevel, m, edgeSel(m, picks), { segments, chamfer, fraction });
          expect(isRefusal(result)).toBe(false);
          const uv = m.layer('uv0');
          for (let e = 0; e < m.counts.edges; e++) {
            if (m.edgeFaceCount(e) !== 2) continue;
            const c = m.edgeCorner(e);
            const d = m.cornerRadialNext(c);
            // c runs a → b; d runs b → a: compare the corners at a and at b.
            const pairs: [number, number][] = [
              [c, m.cornerNext(d)],
              [m.cornerNext(c), d],
            ];
            for (const [x, y] of pairs) {
              expect(m.cornerVert(x)).toBe(m.cornerVert(y));
              expect([uv?.get(x, 0), uv?.get(x, 1)]).toEqual([uv?.get(y, 0), uv?.get(y, 1)]);
            }
          }
        },
      ),
      { numRuns: 60, seed: 11 },
    );
  });

  it('skin weights of new vertices stay normalized with at most four influences', () => {
    const data = primitive('cube', { subdivisionsWidth: 2 });
    const joints = new Uint16Array(data.counts.points * 4);
    const weights = new Float32Array(data.counts.points * 4);
    for (let v = 0; v < data.counts.points; v++) {
      joints.set([v % 6, (v + 1) % 6, (v + 2) % 6, (v + 3) % 6], 4 * v);
      weights.set([0.4, 0.3, 0.2, 0.1], 4 * v);
    }
    const layers = new Map(data.layers);
    layers.set('skin.joints', { def: BUILTIN_LAYERS.skinJoints, data: joints });
    layers.set('skin.weights', { def: BUILTIN_LAYERS.skinWeights, data: weights });
    const m = editMeshFrom({ ...data, layers });
    runOk(bevel, m, edgeSel(m, allEdges(m)), { segments: 2 });
    const w = m.layer('skin.weights');
    const out = new Float64Array(4);
    for (let v = 0; v < m.counts.points; v++) {
      w?.read(v, out);
      expect(out[0]! + out[1]! + out[2]! + out[3]!).toBeCloseTo(1, 6);
      expect([...out].filter((x) => x > 0).length).toBeLessThanOrEqual(4);
    }
  });

  it('rebuilt faces keep their paint slot and material; strips take their first face’s', () => {
    const data = primitive('cube', {});
    const paint = new Uint16Array(6).map((_, f) => f + 1);
    const layers = new Map(data.layers);
    layers.set('paint', { def: BUILTIN_LAYERS.paint, data: paint });
    const m = editMeshFrom({ ...data, layers, faceMaterial: Uint16Array.from([0, 1, 2, 3, 4, 5]) });
    const e = topFront(m);
    const c1 = m.edgeCorner(e);
    const first = m.cornerFace(c1);
    /** The face's unit normal rounded to an axis (the key of the cube side it lies on). */
    const side = (f: number): string => {
      const n = faceNormal(m, f);
      return n.map((x) => Math.round(x / Math.hypot(...n))).join(',');
    };
    const before = Array.from({ length: 6 }, (_, f) => [side(f), f + 1] as const);
    const result = runOk(bevel, m, edgeSel(m, [e]), {});
    const strip = result.selection.faces.toArray()[0] as number;
    expect(m.layer('paint')?.get(strip, 0)).toBe(first + 1);
    expect(m.faceMaterial(strip)).toBe(first);
    for (let f = 0; f < m.counts.faces; f++) {
      if (f === strip) continue;
      const key = side(f);
      const slot = before.find(([k]) => k === key)?.[1];
      expect(m.layer('paint')?.get(f, 0), `face ${f}`).toBe(slot);
      expect(m.faceMaterial(f)).toBe((slot as number) - 1);
    }
  });
});

describe('refusals', () => {
  it('border edges: "Bevel needs edges with two faces" (edge and face mode)', () => {
    const m = editMeshFrom(primitive('plane', {}));
    const edge = runChecked(bevel, m, edgeSel(m, [0]), {}).result;
    expect(isRefusal(edge) && edge.code).toBe('bevel.border-edge');
    expect(isRefusal(edge) && edge.reason).toMatch(/Bevel needs edges with two faces/);
    const face = runChecked(bevel, m, selectionOf('face', [0], m.counts), {}).result;
    expect(isRefusal(face) && face.code).toBe('bevel.border-edge');
  });

  it('non-manifold edges, inconsistent winding and non-manifold vertices', () => {
    const fin = editMeshFrom(
      buildMeshData({
        positions: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1],
        faces: [
          [0, 1, 2],
          [1, 0, 3],
          [0, 1, 4],
        ],
      }),
    );
    const three = runChecked(bevel, fin, edgeSel(fin, [fin.findEdge(0, 1)]), {}).result;
    expect(isRefusal(three) && three.code).toBe('bevel.non-manifold');
    const flipped = editMeshFrom(
      buildMeshData({
        positions: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0],
        faces: [
          [0, 1, 2],
          [2, 0, 3],
        ],
      }),
    );
    const winding = runChecked(bevel, flipped, edgeSel(flipped, [flipped.findEdge(0, 2)]), {}).result;
    expect(isRefusal(winding) && winding.code).toBe('bevel.non-manifold');
    // Two tetrahedra sharing vertex 0: the edges are manifold, the vertex is not.
    const tetra = (o: number, a: number, b: number, c: number): number[][] => [
      [o, b, a],
      [o, c, b],
      [o, a, c],
      [a, b, c],
    ];
    const pinched = editMeshFrom(
      buildMeshData({
        positions: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, -1, 0, 0, 0, -1, 0, 0, 0, -1],
        faces: [...tetra(0, 1, 2, 3), ...tetra(0, 4, 6, 5)],
      }),
    );
    const vertex = runChecked(bevel, pinched, edgeSel(pinched, [pinched.findEdge(0, 1)]), {}).result;
    expect(isRefusal(vertex) && vertex.code).toBe('bevel.non-manifold');
  });

  it('zero width, too wide without Clamp, nothing selected', () => {
    const m = cube();
    const zero = runChecked(bevel, m, edgeSel(m, [0]), { fraction: 0 }).result;
    expect(isRefusal(zero) && zero.code).toBe('bevel.zero-width');
    const offset = runChecked(bevel, m, edgeSel(m, [0]), { offsetAsFraction: false, offset: 0 }).result;
    expect(isRefusal(offset) && offset.code).toBe('bevel.zero-width');
    const wide = runChecked(bevel, m, edgeSel(m, [0]), { offsetAsFraction: false, offset: 2, clamp: false }).result;
    expect(isRefusal(wide) && wide.code).toBe('bevel.too-wide');
    const ctx = ctxOf(m);
    for (const sel of [null, selectionOf('vertex', [0], m.counts), edgeSel(m, [])]) {
      const verdict = bevel.poll(m, sel, ctx);
      expect(verdict !== true && verdict.code).toBe('bevel.no-selection');
    }
  });

  it('hidden edges and faces are not bevelled', () => {
    const m = cube();
    const hidden = {
      verts: selectionOf('vertex', [], m.counts).verts,
      edges: selectionOf('edge', [0], m.counts).edges,
      faces: selectionOf('face', [0], m.counts).faces,
    };
    const ctx = ctxOf(m, { hidden });
    expect(bevel.poll(m, edgeSel(m, [0]), ctx)).toMatchObject({ code: 'bevel.no-selection' });
    expect(bevel.poll(m, selectionOf('face', [0], m.counts), ctx)).toMatchObject({ code: 'bevel.no-selection' });
  });
});

describe('results', () => {
  it('selection′ = the new bevel faces; resolvedArgs record the resolved smoothing angle; a handle frame', () => {
    const m = cube();
    const result = runOk(bevel, m, edgeSel(m, [topFront(m)]), { segments: 3 });
    expect(result.selection.kind).toBe('face');
    expect(result.selection.faces.count()).toBe(3);
    expect(result.resolvedArgs).toMatchObject({ fraction: 0.5, segments: 3, smoothingAngle: 0 });
    const frame = result.frame;
    expect(frame?.pivot[0]).toBeCloseTo(0, 9);
    expect(frame?.pivot[1]).toBeGreaterThan(0.3);
    expect(frame?.pivot[2]).toBeGreaterThan(0.3);
    const z = frame?.axes[2] ?? [0, 0, 0];
    expect(z[1]).toBeCloseTo(Math.SQRT1_2, 6);
    expect(z[2]).toBeCloseTo(Math.SQRT1_2, 6);
  });

  it('P1–P4 on random primitives and edge or face sets (manifold, χ, closed and outward)', () => {
    let ran = 0;
    fc.assert(
      fc.property(
        fc.constantFrom('cube', 'sphere', 'cylinder', 'cone', 'torus', 'plane'),
        fc.array(fc.nat(), { minLength: 1, maxLength: 12 }),
        fc.record({
          fraction: fc.double({ min: 0.01, max: 1, noNaN: true }),
          segments: fc.integer({ min: 1, max: 3 }),
          chamfer: fc.boolean(),
          roundness: fc.double({ min: 0, max: 0.9, noNaN: true }),
        }),
        fc.boolean(),
        (kind, seeds, args, faceMode) => {
          const data = primitive(kind, {});
          const m = editMeshFrom(data);
          const n = faceMode ? m.counts.faces : m.counts.edges;
          const sel = selectionOf(
            faceMode ? 'face' : 'edge',
            seeds.map((s) => s % n),
            m.counts,
          );
          const { result } = runChecked(bevel, m, sel, args);
          // The only refusal on primitives: the border edges of the plane (and of nothing else).
          expect(isRefusal(result) ? `${kind}:${result.code}` : 'ran').toMatch(/^(ran|plane:bevel\.border-edge)$/);
          if (isRefusal(result)) return;
          ran++;
          expect(consistentlyWound(m)).toBe(true);
          const before = topologyStats(data);
          const after = topologyStats(m);
          expect(after.euler).toBe(before.euler);
          expect(after.nonManifoldEdges).toBe(0);
          expect(after.boundaryLoops).toBe(before.boundaryLoops);
          expect(before.boundaryLoops > 0 || signedVolume(m) > 0).toBe(true);
          for (let e = 0; e < m.counts.edges; e++) expect(m.edgeFlags(e) & EDGE_HARD).toBe(EDGE_HARD);
        },
      ),
      { numRuns: 200, seed: 7 },
    );
    expect(ran).toBeGreaterThan(120);
  });
});
