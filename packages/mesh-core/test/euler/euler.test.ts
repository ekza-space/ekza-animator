// M6A-SPEC §4.3 Euler operators, §5.1 invariants, §5.2 layer rules, §5.3 H1/H3/H4 (B1): each operator on small
// fixtures — counts, connectivity, canonical cycles, the [survivors][created] removal order and its remap, the layer
// values it writes, the flags it sets, and its refusals (`EkzaError('mesh-euler')` before any write).
import { describe, expect, it } from 'vitest';
import {
  BUILTIN_LAYERS,
  EDGE_HARD,
  EDGE_SEAM,
  type EditMesh,
  editMeshFrom,
  emptyMesh,
  groupLayer,
  type LayerDef,
  morphLayer,
  primitive,
  topologyStats,
  validateMesh,
} from '../../src';
import { buildMeshData, cubeData, diffStored, linkArray, signedVolume, vef } from '../../src/testing';

const code = (fn: () => unknown): string | null => {
  try {
    fn();
    return null;
  } catch (error) {
    return (error as { code?: string }).code ?? 'other';
  }
};

/** Runs `fn` in a transaction and returns its value with the delta. */
function edit<T>(m: EditMesh, fn: () => T): T {
  m.begin('test');
  const out = fn();
  m.end();
  return out;
}

function cornersOf(m: EditMesh, f: number): number[] {
  const out: number[] = [];
  const start = m.faceCorner(f);
  let c = start;
  do {
    out.push(c);
    c = m.cornerNext(c);
  } while (c !== start);
  return out;
}

const vertsOf = (m: EditMesh, f: number): number[] => cornersOf(m, f).map((c) => m.cornerVert(c));

function diskOf(m: EditMesh, v: number): number[] {
  const out: number[] = [];
  const start = m.vertEdge(v);
  if (start === -1) return out;
  let e = start;
  do {
    out.push(e);
    e = m.edgeDiskNext(e, v);
  } while (e !== start);
  return out;
}

function radialOf(m: EditMesh, e: number): number[] {
  const out: number[] = [];
  const start = m.edgeCorner(e);
  if (start === -1) return out;
  let c = start;
  do {
    out.push(c);
    c = m.cornerRadialNext(c);
  } while (c !== start);
  return out;
}

const ascending = (list: readonly number[]): boolean => list.every((x, i) => i === 0 || (list[i - 1] as number) < x);

/** The face whose Newell normal points along `axis` (±1) on a cube. */
function faceTowards(m: EditMesh, axis: 0 | 1 | 2, sign: 1 | -1): number {
  for (let f = 0; f < m.counts.faces; f++) {
    const c = cornersOf(m, f).map((x) => m.cornerVert(x));
    const mean = c.reduce((s, v) => s + (m.position[3 * v + axis] as number), 0) / c.length;
    if (Math.sign(mean) === sign && Math.abs(mean) > 0.4) return f;
  }
  throw new Error('no such face');
}

describe('makeVert / makeEdge / makeFace / killFace', () => {
  it('builds a quad from scratch with sorted cycles; makeEdge returns the existing edge', () => {
    const m = emptyMesh();
    const f = edit(m, () => {
      const v = [m.makeVert(0, 0, 0), m.makeVert(1, 0, 0), m.makeVert(1, 1, 0), m.makeVert(0, 1, 0)];
      expect(m.makeEdge(v[0] as number, v[2] as number)).toBe(0); // a wire diagonal first
      expect(m.makeEdge(v[2] as number, v[0] as number)).toBe(0);
      return m.makeFace(v);
    });
    expect(vef(m)).toBe('4/5/1');
    expect(m.counts.corners).toBe(4);
    expect(m.edgeFaceCount(0)).toBe(0); // the diagonal stays wire
    for (let v = 0; v < 4; v++) expect(ascending(diskOf(m, v))).toBe(true);
    expect(vertsOf(m, f)).toEqual([0, 1, 2, 3]);
    expect(validateMesh(m)).toEqual([]);
    expect(m.isManifoldVert(0)).toBe(false); // a wire edge touches the face fan
    expect(m.isManifoldVert(1)).toBe(true);
  });

  it('makeFace copies the example face: material, face layers, and corner layers at shared vertices', () => {
    const m = editMeshFrom(primitive('plane', { subdivisionsWidth: 2 }));
    edit(m, () => {
      m.setFaceMaterial(0, 3);
      m.layer('paint')?.set(0, 0, 7);
      m.addLayer(BUILTIN_LAYERS.normalCustom).set(0, 2, 1);
    });
    const [a, b, c] = vertsOf(m, 0) as [number, number, number, number];
    const f = edit(m, () => {
      m.killFace(1);
      return m.makeFace([a, c, b], { example: 0 });
    });
    expect(m.faceMaterial(f)).toBe(3);
    expect(m.layer('paint')?.get(f)).toBe(7);
    const uv = m.layer('uv0');
    for (const corner of cornersOf(m, f)) {
      const v = m.cornerVert(corner);
      const source = cornersOf(m, 0).find((x) => m.cornerVert(x) === v) as number;
      expect([uv?.get(corner, 0), uv?.get(corner, 1)]).toEqual([uv?.get(source, 0), uv?.get(source, 1)]);
      expect(m.layer('normal.custom')?.get(corner, 2)).toBe(0); // 'clear' layers are cleared on new corners
    }
    expect(edit(m, () => m.makeFace([a, b, c], { material: 9 }))).toBe(m.counts.faces - 1);
    expect(m.faceMaterial(m.counts.faces - 1)).toBe(9);
  });

  it('refuses short or repeated cycles, bad indices and slots before any write', () => {
    const m = editMeshFrom(cubeData());
    const before = linkArray(m);
    m.begin('refusals');
    expect(code(() => m.makeFace([0, 1]))).toBe('mesh-euler');
    expect(code(() => m.makeFace([0, 1, 1, 2]))).toBe('mesh-euler');
    expect(code(() => m.makeFace([0, 1, 2, 0]))).toBe('mesh-euler');
    expect(code(() => m.makeFace([0, 1, 99]))).toBe('out-of-range');
    expect(code(() => m.makeFace([0, 1, 2], { material: 70_000 }))).toBe('mesh-euler');
    expect(code(() => m.makeFace([0, 1, 2], { example: 6 }))).toBe('out-of-range');
    expect(code(() => m.makeEdge(3, 3))).toBe('mesh-euler');
    m.end();
    expect(linkArray(m)).toEqual(before);
    expect(code(() => m.makeVert(0, 0, 0))).toBe('mesh-no-transaction');
  });

  it('killFace keeps its edges (wire where nothing else uses them) and compacts faces and corners', () => {
    const m = editMeshFrom(cubeData());
    edit(m, () => m.killFace(0));
    expect(vef(m)).toBe('8/12/5');
    expect(m.counts.corners).toBe(20);
    expect(topologyStats(m)).toMatchObject({ boundaryLoops: 1, euler: 1 });
    edit(m, () => m.killFace(0));
    expect(vef(m)).toBe('8/12/4');
  });
});

describe('killVert / killEdge', () => {
  it('killVert removes the vertex with its edges and their faces', () => {
    const m = editMeshFrom(cubeData());
    edit(m, () => m.killVert(0));
    expect(vef(m)).toBe('7/9/3');
    expect(validateMesh(m)).toEqual([]);
  });

  it('killEdge removes the faces on both sides', () => {
    const m = editMeshFrom(cubeData());
    edit(m, () => m.killEdge(0));
    expect(vef(m)).toBe('8/11/4');
  });

  it('kills every face of a non-manifold edge, including faces that use it twice', () => {
    const fin = buildMeshData({
      positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
      faces: [
        [0, 1, 2],
        [0, 1, 0, 1, 2],
        [0, 2, 0, 2, 1],
        [2, 0, 1],
      ],
    });
    const m = editMeshFrom(fin);
    edit(m, () => m.killEdge(1));
    expect(m.counts.faces).toBe(0);
    expect(validateMesh(m)).toEqual([]);
  });
});

describe('the removal order and the remap', () => {
  it('keeps [survivors][created]: a removed pre-op element takes the last survivor, then the last created', () => {
    const m = editMeshFrom(primitive('plane', { subdivisionsWidth: 3 })); // 8 points
    m.begin('mixed');
    const created = [m.makeVert(5, 0, 0), m.makeVert(6, 0, 0)]; // 8, 9
    expect(created).toEqual([8, 9]);
    const p2 = Array.from(m.position.slice(6, 9));
    const p7 = Array.from(m.position.slice(21, 24));
    m.killVert(2); // survivor 7 → 2, created 9 → 7
    expect(Array.from(m.position.slice(6, 9))).toEqual(p7);
    expect(Array.from(m.position.slice(21, 24))).toEqual([6, 0, 0]);
    expect(p2).not.toEqual(p7);
    const delta = m.end();
    expect(m.counts.points).toBe(9);
    expect(delta.remap.point.createdFrom).toBe(7);
    expect([...(delta.remap.point.forward as Int32Array)]).toEqual([0, 1, -1, 3, 4, 5, 6, 2]);
    expect(delta.remap.face.forward).not.toBeNull();
    expect(delta.dirty.topology).toBe(true);
  });

  it('descending removals never invalidate the indices still to be removed', () => {
    const m = editMeshFrom(primitive('cube', { subdivisionsWidth: 3, subdivisionsHeight: 2 }));
    const faces = [0, 3, 5, 9, 13];
    const keep = new Set<number>();
    for (let f = 0; f < m.counts.faces; f++) if (!faces.includes(f)) keep.add(f);
    const materials = [...keep];
    m.begin('tag');
    for (const f of keep) m.setFaceMaterial(f, f);
    m.end();
    edit(m, () => {
      for (const f of [...faces].sort((a, b) => b - a)) m.killFace(f);
    });
    expect(m.counts.faces).toBe(keep.size);
    const seen = new Set<number>();
    for (let f = 0; f < m.counts.faces; f++) seen.add(m.faceMaterial(f));
    expect([...seen].sort((a, b) => a - b)).toEqual(materials);
    expect(validateMesh(m)).toEqual([]);
  });
});

describe('splitEdgeMakeVert (§5.2 split rules, H4)', () => {
  it('inserts a vertex at t from edgeVert(e, 0) into every face side; both halves keep the flags', () => {
    const m = editMeshFrom(cubeData());
    const e = 0;
    const [a, b] = [m.edgeVert(e, 0), m.edgeVert(e, 1)];
    edit(m, () => m.setEdgeFlags(e, EDGE_HARD | EDGE_SEAM));
    const faces = radialOf(m, e).map((c) => m.cornerFace(c));
    const v = edit(m, () => m.splitEdgeMakeVert(e, 0.25));
    expect(vef(m)).toBe('9/13/6');
    expect(m.counts.corners).toBe(26);
    for (let k = 0; k < 3; k++) {
      const pa = m.position[3 * a + k] as number;
      const pb = m.position[3 * b + k] as number;
      expect(m.position[3 * v + k]).toBe(Math.fround(pa + (pb - pa) * 0.25));
    }
    expect([m.edgeVert(e, 0), m.edgeVert(e, 1)]).toEqual([a, v]);
    const e2 = m.findEdge(v, b);
    expect(e2).toBe(12);
    expect(m.edgeFlags(e)).toBe(EDGE_HARD | EDGE_SEAM);
    expect(m.edgeFlags(e2)).toBe(EDGE_HARD | EDGE_SEAM);
    for (const f of faces) expect(m.faceLen(f)).toBe(5);
    expect(signedVolume(m)).toBeCloseTo(1, 6);
  });

  it('interpolates corner layers per face side (seams kept) and point layers by their rules', () => {
    const m = editMeshFrom(primitive('cube', {}));
    const morph = morphLayer('Smile');
    const groupBits = groupLayer('Arm', 'point', 'bit');
    const groupWeight = groupLayer('Soft', 'point', 'weight');
    const e = 0;
    const [a, b] = [m.edgeVert(e, 0), m.edgeVert(e, 1)];
    edit(m, () => {
      m.addLayer(morph);
      m.addLayer(groupBits);
      m.addLayer(groupWeight);
      m.layer(morph.name)?.set(a, 1, 1);
      m.layer(morph.name)?.set(b, 1, 3);
      m.layer(groupBits.name)?.set(a, 0, 1);
      m.layer(groupBits.name)?.set(b, 0, 2);
      m.layer(groupWeight.name)?.set(b, 0, 0.5);
    });
    const sides = radialOf(m, e).map((c) => {
      const next = m.cornerNext(c);
      const atA = m.cornerVert(c) === a ? c : next;
      const atB = atA === c ? next : c;
      return { face: m.cornerFace(c), atA, atB };
    });
    const uv = m.layer('uv0') as NonNullable<ReturnType<EditMesh['layer']>>;
    const before = sides.map(({ atA, atB }) => [uv.get(atA, 0), uv.get(atA, 1), uv.get(atB, 0), uv.get(atB, 1)]);
    const v = edit(m, () => m.splitEdgeMakeVert(e, 0.5));
    expect(m.layer(morph.name)?.get(v, 1)).toBe(2);
    expect(m.layer(groupBits.name)?.get(v)).toBe(3);
    expect(m.layer(groupWeight.name)?.get(v)).toBe(0.25);
    sides.forEach(({ face }, i) => {
      const corner = cornersOf(m, face).find((c) => m.cornerVert(c) === v) as number;
      const [ua, va, ub, vb] = before[i] as [number, number, number, number];
      expect(uv.get(corner, 0)).toBe(Math.fround((ua + ub) / 2));
      expect(uv.get(corner, 1)).toBe(Math.fround((va + vb) / 2));
    });
    // The two sides of the cube edge have different UVs (a seam): the new corners differ too.
    const [c0, c1] = sides.map(({ face }) => cornersOf(m, face).find((c) => m.cornerVert(c) === v) as number);
    expect([uv.get(c0 as number, 0), uv.get(c0 as number, 1)]).not.toEqual([
      uv.get(c1 as number, 0),
      uv.get(c1 as number, 1),
    ]);
  });

  it('blends skin weights over the union of joints, keeps the top 4 and renormalizes (P7)', () => {
    const m = editMeshFrom(primitive('cube', {}));
    const e = 0;
    const [a, b] = [m.edgeVert(e, 0), m.edgeVert(e, 1)];
    edit(m, () => {
      m.addLayer(BUILTIN_LAYERS.skinJoints);
      m.addLayer(BUILTIN_LAYERS.skinWeights);
      const joints = m.layer('skin.joints');
      const weights = m.layer('skin.weights');
      for (let p = 0; p < m.counts.points; p++) weights?.set(p, 0, 1);
      [1, 2, 3, 4].forEach((j, k) => joints?.set(a, k, j));
      [0.4, 0.3, 0.2, 0.1].forEach((w, k) => weights?.set(a, k, w));
      [5, 6, 1, 7].forEach((j, k) => joints?.set(b, k, j));
      [0.5, 0.25, 0.15, 0.1].forEach((w, k) => weights?.set(b, k, w));
    });
    const v = edit(m, () => m.splitEdgeMakeVert(e, 0.5));
    const joints = [0, 1, 2, 3].map((k) => m.layer('skin.joints')?.get(v, k));
    const weights = [0, 1, 2, 3].map((k) => m.layer('skin.weights')?.get(v, k) as number);
    // Union: 1 → 0.275, 5 → 0.25, 2 → 0.15, 6 → 0.125, 3 → 0.1, … top 4 = 1, 5, 2, 6.
    expect(joints).toEqual([1, 5, 2, 6]);
    const sum = weights.reduce((s, w) => s + w, 0);
    expect(Math.abs(sum - 1)).toBeLessThanOrEqual(1e-6);
    expect(weights[0]).toBeCloseTo(0.275 / 0.8, 6);
    expect(validateMesh(m)).toEqual([]);
  });

  it('splits a wire edge and an edge with three faces', () => {
    const m = editMeshFrom(
      buildMeshData({
        positions: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1],
        faces: [
          [0, 1, 2],
          [1, 0, 3],
          [0, 1, 4],
        ],
      }),
    );
    edit(m, () => m.splitEdgeMakeVert(0, 0.5));
    expect(m.counts.corners).toBe(12);
    const w = editMeshFrom(cubeData());
    edit(w, () => {
      const e = w.makeEdge(0, 6);
      w.splitEdgeMakeVert(e, 0.5);
    });
    expect(vef(w)).toBe('9/14/6');
  });
});

describe('joinEdgeKillVert (H3)', () => {
  it('dissolves a valence-2 vertex; the smaller edge survives with merged flags', () => {
    const m = editMeshFrom(cubeData());
    const v = edit(m, () => m.splitEdgeMakeVert(0, 0.5));
    edit(m, () => {
      m.setEdgeFlags(0, EDGE_SEAM);
      m.setEdgeFlags(m.counts.edges - 1, EDGE_HARD);
    });
    const kept = edit(m, () => m.joinEdgeKillVert(v));
    expect(kept).toBe(0);
    expect(vef(m)).toBe('8/12/6');
    expect(m.edgeFlags(0)).toBe(EDGE_HARD | EDGE_SEAM);
    expect(diffStored(m, cubeData())).toContain('edgeFlags');
  });

  it('refuses a vertex of another valence or a join that would duplicate an edge; a quad corner becomes a triangle', () => {
    const cube = editMeshFrom(cubeData());
    cube.begin('refuse');
    expect(code(() => cube.joinEdgeKillVert(0))).toBe('mesh-euler'); // valence 3
    cube.abort();
    // A triangle fan: vertex 3 has valence 2 but its face is a triangle.
    const tri = editMeshFrom(buildMeshData({ positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], faces: [[0, 1, 2]] }));
    tri.begin('refuse');
    expect(code(() => tri.joinEdgeKillVert(0))).toBe('mesh-euler'); // a and b already joined
    tri.abort();
    const before = linkArray(tri);
    expect(before).toEqual(linkArray(editMeshFrom(tri.snapshot())));
    const quad = editMeshFrom(
      buildMeshData({ positions: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], faces: [[0, 1, 2, 3]] }),
    );
    const kept = edit(quad, () => quad.joinEdgeKillVert(1));
    expect(vef(quad)).toBe('3/3/1');
    expect(vertsOf(quad, 0)).toHaveLength(3);
    // 0–1 reroutes to 0–2; vertex 3 moves into the hole of 1 (the last survivor fills it).
    expect([quad.edgeVert(kept, 0), quad.edgeVert(kept, 1)]).toEqual([0, 2]);
    // A vertex on a spike (both edges lead back to one vertex) has valence 1: refused.
    const spike = editMeshFrom(
      buildMeshData({ positions: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], faces: [[0, 1, 2, 1, 3]] }),
    );
    spike.begin('refuse');
    expect(code(() => spike.joinEdgeKillVert(2))).toBe('mesh-euler');
    spike.abort();
    // A face through v twice ([a, v, b, v]) would keep only a and b: refused (found by the soup property).
    const twice = editMeshFrom(buildMeshData({ positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], faces: [[0, 1, 2, 1]] }));
    twice.begin('refuse');
    expect(code(() => twice.joinEdgeKillVert(1))).toBe('mesh-euler');
    twice.abort();
  });
});

describe('splitFaceMakeEdge (H1) / joinFaceKillEdge', () => {
  it('cuts a quad between opposite corners; f keeps cA side, the new face takes cB side', () => {
    const m = editMeshFrom(cubeData());
    const top = faceTowards(m, 1, 1);
    const [c0, , c2] = cornersOf(m, top) as [number, number, number, number];
    const e = edit(m, () => m.splitFaceMakeEdge(top, c0, c2));
    expect(vef(m)).toBe('8/13/7');
    expect(m.edgeFlags(e) & EDGE_HARD).toBe(EDGE_HARD); // every edge of the face was hard (H1)
    expect(m.faceLen(top)).toBe(3);
    expect(m.faceLen(6)).toBe(3);
    expect(m.faceCorner(6)).toBe(c2);
    expect(cornersOf(m, top)).toContain(c0);
    expect(signedVolume(m)).toBeCloseTo(1, 6);
    expect(radialOf(m, e)).toHaveLength(2);
  });

  it('a chord in a face with a soft edge is soft (H1)', () => {
    const m = editMeshFrom(cubeData());
    const top = faceTowards(m, 1, 1);
    const [c0, c1, c2] = cornersOf(m, top) as [number, number, number, number];
    edit(m, () => m.setEdgeFlags(m.cornerEdge(c1), 0));
    const e = edit(m, () => m.splitFaceMakeEdge(top, c0, c2));
    expect(m.edgeFlags(e)).toBe(0);
  });

  it('joinFaceKillEdge undoes a split; refuses border, same-face and mis-wound edges', () => {
    const m = editMeshFrom(cubeData());
    const before = m.snapshot();
    const top = faceTowards(m, 1, 1);
    const [c0, , c2] = cornersOf(m, top) as [number, number, number, number];
    const e = edit(m, () => m.splitFaceMakeEdge(top, c0, c2));
    const s = edit(m, () => m.joinFaceKillEdge(e));
    expect(s).toBe(top);
    expect(vef(m)).toBe('8/12/6');
    expect(m.faceLen(top)).toBe(4);
    expect(signedVolume(m)).toBeCloseTo(signedVolume(before), 6);
    const plane = editMeshFrom(primitive('plane', {}));
    plane.begin('refuse');
    expect(code(() => plane.joinFaceKillEdge(0))).toBe('mesh-euler'); // a border edge
    plane.abort();
    const flipped = editMeshFrom(
      buildMeshData({
        positions: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0],
        faces: [[0, 1, 2], [0, 2, 3].reverse()].map((f, i) => (i === 1 ? [3, 2, 0].reverse().reverse() : f)),
      }),
    );
    const shared = flipped.findEdge(0, 2);
    flipped.begin('refuse');
    // [0,1,2] runs 2→0; [3,2,0] runs 2→0 too: the same direction (inconsistent winding).
    expect(code(() => flipped.joinFaceKillEdge(shared))).toBe('mesh-euler');
    flipped.abort();
  });

  it('refuses adjacent or foreign corners and a chord between two corners of one vertex', () => {
    const m = editMeshFrom(cubeData());
    const [c0, c1] = cornersOf(m, 0) as [number, number, number, number];
    m.begin('refuse');
    expect(code(() => m.splitFaceMakeEdge(0, c0, c1))).toBe('mesh-euler');
    expect(code(() => m.splitFaceMakeEdge(0, c0, c0))).toBe('mesh-euler');
    expect(code(() => m.splitFaceMakeEdge(1, c0, cornersOf(m, 1)[2] as number))).toBe('mesh-euler');
    m.abort();
    const spike = editMeshFrom(
      buildMeshData({ positions: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], faces: [[0, 1, 2, 1, 3]] }),
    );
    const corners = cornersOf(spike, 0);
    spike.begin('refuse');
    expect(code(() => spike.splitFaceMakeEdge(0, corners[1] as number, corners[3] as number))).toBe('mesh-euler');
    spike.abort();
  });
});

describe('reverseFace', () => {
  it('flips the winding; corners keep their vertex and values; twice is the identity on the stored form', () => {
    const m = editMeshFrom(primitive('cube', {}));
    const before = m.snapshot();
    const uv = m.layer('uv0');
    const values = cornersOf(m, 0).map((c) => [m.cornerVert(c), uv?.get(c, 0), uv?.get(c, 1)]);
    const [v0, v1, v2, v3] = values.map((x) => x[0]);
    edit(m, () => m.reverseFace(0));
    expect(vertsOf(m, 0)).toEqual([v0, v3, v2, v1]);
    for (const c of cornersOf(m, 0)) {
      const entry = values.find((x) => x[0] === m.cornerVert(c));
      expect([uv?.get(c, 0), uv?.get(c, 1)]).toEqual([entry?.[1], entry?.[2]]);
    }
    expect(topologyStats(m).nonManifoldEdges).toBe(0);
    edit(m, () => m.reverseFace(0));
    expect(diffStored(m, before)).toBeNull();
  });
});

describe('layers through the Euler operators', () => {
  it('every operator keeps every layer at count × comps values and new elements at their rules', () => {
    const defs: LayerDef[] = [
      BUILTIN_LAYERS.color0,
      BUILTIN_LAYERS.crease,
      groupLayer('Bit', 'face', 'bit'),
      morphLayer('A'),
    ];
    const m = editMeshFrom(primitive('cylinder', { subdivisionsHeight: 2 }));
    edit(m, () => {
      for (const def of defs) m.addLayer(def);
    });
    edit(m, () => {
      const v = m.splitEdgeMakeVert(0, 0.5);
      m.makeFace([v, m.makeVert(9, 9, 9), m.makeVert(9, 8, 9)], { example: 0 });
      m.killFace(1);
      m.reverseFace(2);
    });
    expect(validateMesh(m)).toEqual([]);
    const color = m.layer('color0');
    const last = m.counts.corners - 1;
    expect([0, 1, 2, 3].map((k) => color?.get(last, k))).toEqual([1, 1, 1, 1]);
  });
});
