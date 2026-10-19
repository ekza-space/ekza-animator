// Behaviour of B3's loop, connect, merge, delete, fill and bridge ops beyond the §5.29 counts (M6A-SPEC §5.11,
// §5.12, §5.3): placement modes and ring termination, adjust fast paths, H1/H2/H3, pick order, refusals and warnings,
// hidden components, layer rules of new faces. Every run goes through the checked runner (validity, exact undo/redo,
// incremental revisions).
import type { ParamValues } from '@ekza-animator/anim-core';
import { describe, expect, it } from 'vitest';
import {
  BitSet,
  BUILTIN_LAYERS,
  EDGE_HARD,
  type EditMesh,
  editMeshFrom,
  type HiddenSet,
  isRefusal,
  type MeshData,
  type OpContext,
  primitive,
  topologyStats,
} from '../../src';
import { cubeData, diffStored } from '../../src/testing';
import {
  combined,
  cylinderData,
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
  faceCentroid,
  faceToward,
  faceVerts,
  op,
  position,
  runOk,
  runRefused,
  sel,
  windingProblems,
} from './support';

/** Values rounded to 1e-6 (−0 written as 0) for float32-stored positions. */
const r6 = (a: readonly number[]) => a.map((x) => Math.round(x * 1e6) / 1e6 + 0);

const lerp = (a: readonly number[], b: readonly number[], t: number) => a.map((x, k) => x + ((b[k] as number) - x) * t);

const newVerts = (m: EditMesh, from: number) => {
  const out: number[] = [];
  for (let v = from; v < m.counts.points; v++) out.push(v);
  return out;
};

const hiddenFaces = (m: EditMesh, faces: readonly number[]): HiddenSet => {
  const h = {
    verts: new BitSet(m.counts.points),
    edges: new BitSet(m.counts.edges),
    faces: new BitSet(m.counts.faces),
  };
  for (const f of faces) h.faces.add(f);
  return h;
};

const hiddenVerts = (m: EditMesh, verts: readonly number[]): HiddenSet => {
  const h = {
    verts: new BitSet(m.counts.points),
    edges: new BitSet(m.counts.edges),
    faces: new BitSet(m.counts.faces),
  };
  for (const v of verts) h.verts.add(v);
  return h;
};

const allHard = (m: EditMesh) => {
  for (let e = 0; e < m.counts.edges; e++) if ((m.edgeFlags(e) & EDGE_HARD) === 0) return false;
  return true;
};

const softEdges = (m: EditMesh) => {
  const out: number[] = [];
  for (let e = 0; e < m.counts.edges; e++) if ((m.edgeFlags(e) & EDGE_HARD) === 0) out.push(e);
  return out;
};

const borderEdges = (m: EditMesh) => {
  const out: number[] = [];
  for (let e = 0; e < m.counts.edges; e++) if (m.edgeFaceCount(e) === 1) out.push(e);
  return out;
};

/** Runs `id`, then `adjust(patch)` in its own transaction, and a fresh run with the merged args for comparison. */
function adjusted(
  make: () => EditMesh,
  id: string,
  selection: (m: EditMesh) => ReturnType<typeof sel>,
  args: ParamValues,
  patch: ParamValues,
  ctx: OpContext = ctxOf(),
) {
  const m = make();
  m.begin(id);
  const result = op(id).run(m, selection(m), args, ctx);
  m.end();
  if (isRefusal(result)) throw new Error(`${id} refused: ${result.code}`);
  if (result.adjust === undefined) return { has: false, ok: false, adjusted: m, fresh: m };
  m.begin(`${id} adjust`);
  const ok = result.adjust(patch);
  if (ok) m.end();
  else m.abort();
  const fresh = make();
  fresh.begin(id);
  op(id).run(fresh, selection(fresh), { ...args, ...patch }, ctx);
  fresh.end();
  return { has: true, ok, adjusted: m, fresh };
}

/** A 2 × 1 strip: a 1 × 1 quad and a 2-tall quad beside it (ring edges of different lengths), all hard. */
function strip(): MeshData {
  // 0 (0,0) 1 (1,0) 2 (1,1) 3 (0,1); 4 (2,-0.5) 5 (2,1.5): the second quad runs 1 → 4 → 5 → 2.
  return fromFaces(
    [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 2, -0.5, 0, 2, 1.5, 0],
    [
      [0, 1, 2, 3],
      [1, 4, 5, 2],
    ],
  );
}

describe('mesh.insertLoop placement (§5.11)', () => {
  it('relative: weight from edgeVert(seed, 0) on every ring edge, a straight loop', () => {
    const m = cube();
    const seed = edgesAlong(m, 1)[0] as number;
    const a = position(m, m.edgeVert(seed, 0));
    const b = position(m, m.edgeVert(seed, 1));
    const result = runOk(m, 'mesh.insertLoop', sel(m, 'edge', [seed]), { weight: 0.25 });
    expect(result.resolvedArgs['seedEdge']).toBe(seed);
    const fresh = newVerts(m, 8);
    expect(fresh.length).toBe(4);
    const y = lerp(a, b, 0.25)[1] as number;
    for (const v of fresh) expect(position(m, v)[1]).toBeCloseTo(y, 6);
    // The new vertex on the seed edge sits exactly at the weight.
    expect(
      fresh.some((v) => position(m, v).every((x, k) => Math.abs(x - (lerp(a, b, 0.25)[k] as number)) < 1e-6)),
    ).toBe(true);
  });

  it('equal: the distance weight × length(seed) from the same side on every edge; relative scales with the edge', () => {
    const relative = editMeshFrom(strip());
    const seed = relative.findEdge(0, 3);
    runOk(relative, 'mesh.insertLoop', sel(relative, 'edge', [seed]), { weight: 0.3 });
    // The seed 0 → 3 runs up from y = 0; the far edge 4 → 5 runs from y = −0.5 to 1.5.
    const ys = (m: EditMesh) =>
      newVerts(m, 6)
        .map((v) => position(m, v))
        .sort((p, q) => p[0] - q[0] || p[1] - q[1])
        .map((p) => p[1]);
    const side = relative.edgeVert(seed, 0) === 0 ? 1 : -1;
    const at = (y0: number, len: number, t: number) => (side === 1 ? y0 + len * t : y0 + len - len * t);
    expect(r6(ys(relative))).toEqual(r6([at(0, 1, 0.3), at(0, 1, 0.3), at(-0.5, 2, 0.3)]));
    const equal = editMeshFrom(strip());
    runOk(equal, 'mesh.insertLoop', sel(equal, 'edge', [seed]), { weight: 0.3, mode: 'equal' });
    expect(r6(ys(equal))).toEqual(r6([at(0, 1, 0.3), at(0, 1, 0.3), side === 1 ? -0.5 + 0.3 : 1.5 - 0.3]));
  });

  it('multiple: divisions loops at i / (divisions + 1)', () => {
    const m = cube();
    const seed = edgesAlong(m, 1)[0] as number;
    const a = position(m, m.edgeVert(seed, 0));
    const b = position(m, m.edgeVert(seed, 1));
    runOk(m, 'mesh.insertLoop', sel(m, 'edge', [seed]), { mode: 'multiple', divisions: 2, weight: 0.9 });
    expect(counts(m)).toBe('16/28/14');
    const heights = [...new Set(newVerts(m, 8).map((v) => Math.round(position(m, v)[1] * 1e6) / 1e6))].sort(
      (x, y) => x - y,
    );
    expect(r6(heights)).toEqual(
      r6([lerp(a, b, 1 / 3)[1] as number, lerp(a, b, 2 / 3)[1] as number].sort((x, y) => x - y)),
    );
  });

  it('a non-quad face ends the ring and gains the new vertex (triangle → quad)', () => {
    // A quad and a triangle on its right edge: the ring from the left edge stops at the triangle.
    const m = editMeshFrom(
      fromFaces(
        [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 2, 0.5, 0],
        [
          [0, 1, 2, 3],
          [1, 4, 2],
        ],
      ),
    );
    runOk(m, 'mesh.insertLoop', sel(m, 'edge', [m.findEdge(0, 3)]), { weight: 0.5 });
    expect(counts(m)).toBe('7/9/3');
    const lengths = [0, 1, 2].map((f) => m.faceLen(f));
    expect(lengths).toEqual([4, 4, 4]);
    expect(windingProblems(m)).toEqual([]);
  });

  it('a hidden face ends the ring; the seed is the lowest-index visible selected edge unless seedEdge is given', () => {
    const m = cube();
    const ring = edgesAlong(m, 1);
    const seed = ring[0] as number;
    // Hide one side face of the ring: the loop crosses three faces only (an open loop of three chords).
    const sides = [
      faceToward(m, [1, 0, 0]),
      faceToward(m, [0, 0, 1]),
      faceToward(m, [-1, 0, 0]),
      faceToward(m, [0, 0, -1]),
    ];
    const ctx = ctxOf({ hidden: hiddenFaces(m, [sides[0] as number]) });
    const result = runOk(m, 'mesh.insertLoop', sel(m, 'edge', [ring[2] as number, seed]), {}, ctx);
    expect(result.resolvedArgs['seedEdge']).toBe(Math.min(seed, ring[2] as number));
    expect(result.selection.edges.count()).toBe(3);
    expect(counts(m)).toBe('12/19/9');
    const byArg = cube();
    const r2 = runOk(byArg, 'mesh.insertLoop', sel(byArg, 'edge', [seed]), { seedEdge: ring[1] as number });
    expect(r2.resolvedArgs['seedEdge']).toBe(ring[1]);
  });

  it('refuses insertLoop.no-ring without a seed or for an edge without faces', () => {
    const m = cube();
    runRefused(m, 'mesh.insertLoop', sel(m, 'edge', []), 'insertLoop.no-ring');
    expect(counts(m)).toBe('8/12/6');
    // A wire edge between two opposite corners.
    m.begin('wire');
    const wire = m.makeEdge(0, 6);
    m.end();
    runRefused(m, 'mesh.insertLoop', sel(m, 'edge', [wire]), 'insertLoop.no-ring');
    expect(counts(m)).toBe('8/13/6');
  });

  it('a seed between triangles (a triangle mesh made editable) is split; its triangles become quads', () => {
    // Two triangles sharing edge 1–2, as glTF meshes arrive.
    const m = editMeshFrom(
      fromFaces(
        [0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0],
        [
          [0, 1, 2],
          [2, 1, 3],
        ],
      ),
    );
    const seed = m.findEdge(1, 2);
    const a = position(m, m.edgeVert(seed, 0));
    const b = position(m, m.edgeVert(seed, 1));
    const result = runOk(m, 'mesh.insertLoop', sel(m, 'edge', [seed]), { weight: 0.25 });
    expect(counts(m)).toBe('5/6/2');
    expect([m.faceLen(0), m.faceLen(1)]).toEqual([4, 4]);
    expect(r6(position(m, 4))).toEqual(r6(lerp(a, b, 0.25)));
    expect(result.selection.edges.count()).toBe(2);
    expect(windingProblems(m)).toEqual([]);
  });

  it('H1: cross edges are hard on a faceted cube, soft on a smooth one', () => {
    const faceted = cube();
    runOk(faceted, 'mesh.insertLoop', sel(faceted, 'edge', [edgesAlong(faceted, 1)[0] as number]));
    expect(allHard(faceted)).toBe(true);
    const smooth = editMeshFrom(cubeData({ hard: false }));
    const result = runOk(
      smooth,
      'mesh.insertLoop',
      sel(smooth, 'edge', [edgesAlong(smooth, 1)[0] as number]),
      {},
      ctxOf({ faceted: false }),
    );
    for (const e of result.selection.edges.toArray()) expect(smooth.edgeFlags(e) & EDGE_HARD).toBe(0);
  });

  it('new vertices interpolate their point and corner layers between the edge ends', () => {
    const m = editMeshFrom(primitive('cube', {}));
    const seed = edgesAlong(m, 1)[0] as number;
    const uv = m.layer(BUILTIN_LAYERS.uv0.name);
    expect(uv).toBeDefined();
    runOk(m, 'mesh.insertLoop', sel(m, 'edge', [seed]), { weight: 0.25 });
    // Every corner at a new vertex has a UV between the UVs of the corners at its edge's ends in the same face.
    for (const v of newVerts(m, 8)) {
      for (let f = 0; f < m.counts.faces; f++) {
        const vs = faceVerts(m, f);
        const i = vs.indexOf(v);
        if (i === -1) continue;
        for (let k = 0; k < 2; k++) {
          const at = (index: number) => {
            const start = m.faceCorner(f);
            let c = start;
            for (let s = 0; s < index; s++) c = m.cornerNext(c);
            return uv?.get(c, k) as number;
          };
          const value = at(i);
          const values = vs.map((_, j) => at(j));
          expect(value).toBeGreaterThanOrEqual(Math.min(...values) - 1e-6);
          expect(value).toBeLessThanOrEqual(Math.max(...values) + 1e-6);
        }
      }
    }
  });

  it('adjust: a new weight re-places a single loop bit-identically; other args and multiple decline', () => {
    const seedOf = (m: EditMesh) => sel(m, 'edge', [edgesAlong(m, 1)[0] as number]);
    for (const mode of ['relative', 'equal'] as const) {
      const run = adjusted(
        () => editMeshFrom(primitive('cube', {})),
        'mesh.insertLoop',
        seedOf,
        { weight: 0.3, mode },
        { weight: 0.7 },
      );
      expect(run.ok).toBe(true);
      expect(diffStored(run.adjusted, run.fresh)).toBeNull();
    }
    expect(adjusted(cube, 'mesh.insertLoop', seedOf, { weight: 0.3 }, { mode: 'multiple' }).ok).toBe(false);
    expect(adjusted(cube, 'mesh.insertLoop', seedOf, { mode: 'multiple' }, { weight: 0.2 }).has).toBe(false);
  });
});

describe('mesh.offsetLoop (§5.11)', () => {
  const tallCube = () => editMeshFrom(primitive('cube', { subdivisionsHeight: 2 }));
  const middleLoop = (m: EditMesh) => {
    const out: number[] = [];
    for (let e = 0; e < m.counts.edges; e++) {
      const a = position(m, m.edgeVert(e, 0));
      const b = position(m, m.edgeVert(e, 1));
      if (Math.abs(a[1]) < 1e-9 && Math.abs(b[1]) < 1e-9) out.push(e);
    }
    return out;
  };

  it('a closed loop gets two loops at offset × the crossing edge length on either side', () => {
    const m = tallCube();
    expect(counts(m)).toBe('12/20/10');
    const loop = middleLoop(m);
    expect(loop.length).toBe(4);
    const result = runOk(m, 'mesh.offsetLoop', sel(m, 'edge', loop), { offset: 0.25 });
    expect(counts(m)).toBe('20/36/18');
    const ys = [...new Set(newVerts(m, 12).map((v) => Math.round(position(m, v)[1] * 1e6) / 1e6))].sort(
      (x, y) => x - y,
    );
    expect(ys).toEqual([-0.125, 0.125]);
    expect(result.selection.edges.count()).toBe(8);
    expect(allHard(m)).toBe(true);
    expect(windingProblems(m)).toEqual([]);
  });

  it('an open loop ending inside the mesh: deleteEnds turns the end triangles into quads', () => {
    // A 4 × 4 plane; the selected chain runs along the middle row from the border to an interior vertex.
    const make = () => editMeshFrom(planeData({ width: 4, height: 4, subdivisionsWidth: 4, subdivisionsHeight: 4 }));
    const chain = (m: EditMesh) => {
      const out: number[] = [];
      for (let e = 0; e < m.counts.edges; e++) {
        const a = position(m, m.edgeVert(e, 0));
        const b = position(m, m.edgeVert(e, 1));
        if (Math.abs(a[2]) < 1e-9 && Math.abs(b[2]) < 1e-9 && Math.max(a[0], b[0]) <= 0 + 1e-9) out.push(e);
      }
      return out;
    };
    const kept = make();
    runOk(kept, 'mesh.offsetLoop', sel(kept, 'edge', chain(kept)), { offset: 0.25, deleteEnds: false });
    const keptLens = Array.from({ length: kept.counts.faces }, (_, f) => kept.faceLen(f));
    expect(keptLens.filter((n) => n === 3).length).toBeGreaterThan(0);
    const dropped = make();
    runOk(dropped, 'mesh.offsetLoop', sel(dropped, 'edge', chain(dropped)), { offset: 0.25 });
    const droppedLens = Array.from({ length: dropped.counts.faces }, (_, f) => dropped.faceLen(f));
    expect(droppedLens.filter((n) => n === 3)).toEqual([]);
    expect(windingProblems(dropped)).toEqual([]);
    expect(topologyStats(dropped).euler).toBe(topologyStats(make()).euler);
  });

  it('refuses without an edge selection', () => {
    const m = cube();
    runRefused(m, 'mesh.offsetLoop', sel(m, 'face', [0]), 'offsetLoop.no-selection');
    expect(counts(m)).toBe('8/12/6');
  });
});

describe('mesh.connect (§5.11)', () => {
  it('vertices: a chord between two opposite corners of a face (H1: hard on a faceted cube)', () => {
    const m = cube();
    const top = topOf(m);
    const [a, , c] = faceVerts(m, top) as [number, number, number, number];
    const result = runOk(m, 'mesh.connect', sel(m, 'vertex', [a, c]));
    expect(counts(m)).toBe('8/13/7');
    const [chord] = result.selection.edges.toArray();
    expect(chord).toBe(m.findEdge(a, c));
    expect(allHard(m)).toBe(true);
  });

  it('vertices without a common face, or neighbours on every face, refuse connect.no-face', () => {
    const m = cube();
    const top = topOf(m);
    const bottom = faceToward(m, [0, -1, 0]);
    const a = faceVerts(m, top)[0] as number;
    const p = position(m, a);
    const far = faceVerts(m, bottom).find((v) => {
      const q = position(m, v);
      return q[0] === -p[0] && q[2] === -p[2];
    }) as number;
    runRefused(m, 'mesh.connect', sel(m, 'vertex', [a, far]), 'connect.no-face');
    runRefused(m, 'mesh.connect', sel(m, 'vertex', [a, faceVerts(m, top)[1] as number]), 'connect.no-face');
    runRefused(m, 'mesh.connect', sel(m, 'vertex', [a]), 'connect.no-selection');
    expect(counts(m)).toBe('8/12/6');
  });

  it('edges: two opposite edges of a face split at weight; a selected ring becomes a straight loop', () => {
    const m = cube();
    const top = topOf(m);
    const vs = faceVerts(m, top);
    const e1 = m.findEdge(vs[0] as number, vs[1] as number);
    const e2 = m.findEdge(vs[2] as number, vs[3] as number);
    runOk(m, 'mesh.connect', sel(m, 'edge', [e1, e2]), { weight: 0.3 });
    expect(counts(m)).toBe('10/15/7');
    const ring = cube();
    const vertical = edgesAlong(ring, 1);
    const result = runOk(ring, 'mesh.connect', sel(ring, 'edge', vertical), { weight: 0.3 });
    expect(counts(ring)).toBe('12/20/10');
    expect(result.selection.edges.count()).toBe(4);
    const ys = new Set(newVerts(ring, 8).map((v) => Math.round(position(ring, v)[1] * 1e6)));
    expect(ys.size).toBe(1);
    expect(windingProblems(ring)).toEqual([]);
  });

  it('faces with three or more selected edges are skipped with connect.skipped', () => {
    const m = cube();
    const top = topOf(m);
    const vs = faceVerts(m, top);
    const edges = [0, 1, 2].map((i) => m.findEdge(vs[i] as number, vs[(i + 1) % 4] as number));
    // The top holds three selected edges (skipped), each side face one: nothing is left to connect.
    runRefused(m, 'mesh.connect', sel(m, 'edge', edges), 'connect.no-face');
    const four = cube();
    const fvs = faceVerts(four, topOf(four));
    // The same three top edges and the vertical edge at their middle corner: the top is skipped, and the two side
    // faces at that corner each hold two selected edges (a top edge and the vertical one) and get a chord.
    const three = [0, 1, 2].map((i) => four.findEdge(fvs[i] as number, fvs[(i + 1) % 4] as number));
    const extra = edgesAlong(four, 1).filter((e) => {
      const a = four.edgeVert(e, 0);
      const b = four.edgeVert(e, 1);
      return a === fvs[1] || b === fvs[1];
    });
    expect(extra.length).toBe(1);
    const r = runOk(four, 'mesh.connect', sel(four, 'edge', [...three, ...extra]));
    expect(r.warnings.find((w) => w.code === 'connect.skipped')?.count).toBe(1);
    expect(r.selection.edges.count()).toBe(2);
  });
});

describe('mesh.merge family details (§5.12)', () => {
  it('merge: clusters within distance merge at their centroid into the first-picked vertex', () => {
    const m = cube();
    const top = topOf(m);
    const [a, b] = faceVerts(m, top) as [number, number];
    const pa = position(m, a);
    const pb = position(m, b);
    const result = runOk(m, 'mesh.merge', sel(m, 'vertex', [b, a]), { distance: 2, alwaysMergeTwo: false });
    expect(counts(m)).toBe('7/11/6');
    const [rep] = result.selection.verts.toArray();
    expect(r6(position(m, rep as number))).toEqual(r6(lerp(pa, pb, 0.5)));
  });

  it('merge: distance 0 merges coincident vertices only; alwaysMergeTwo merges two picks at any distance', () => {
    const m = cube();
    runRefused(m, 'mesh.merge', sel(m, 'vertex', [0, 1, 2]), 'merge.nothing', { distance: 0 });
    runRefused(m, 'mesh.merge', sel(m, 'vertex', [0, 1]), 'merge.nothing', { distance: 0.1, alwaysMergeTwo: false });
    const two = cube();
    runOk(two, 'mesh.merge', sel(two, 'vertex', [0, 6]), { distance: 0 });
    expect(two.counts.points).toBe(7);
    const coincident = editMeshFrom(combined(planeData(), planeData(), [1, 0, 0]));
    const seam = [0, 1, 2, 3, 4, 5, 6, 7].filter((v) => Math.abs(position(coincident, v)[0] - 0.5) < 1e-9);
    runOk(coincident, 'mesh.merge', sel(coincident, 'vertex', seam), { distance: 0 });
    expect(counts(coincident)).toBe('6/7/2');
  });

  it('merge by distance: visible vertices only, the merged count as a warning; nothing to merge refuses', () => {
    const m = editMeshFrom(combined(planeData(), planeData(), [1, 0, 0]));
    const seam = [0, 1, 2, 3, 4, 5, 6, 7].filter((v) => Math.abs(position(m, v)[0] - 0.5) < 1e-9);
    const result = runOk(
      m,
      'mesh.mergeByDistance',
      null,
      { distance: 0.001 },
      ctxOf({ hidden: hiddenVerts(m, [seam[0] as number]) }),
    );
    expect(counts(m)).toBe('7/8/2');
    expect(result.warnings.find((w) => w.code === 'mergeByDistance.merged')?.count).toBe(1);
    const c = cube();
    runRefused(c, 'mesh.mergeByDistance', null, 'mergeByDistance.nothing');
  });

  it('coincident duplicate faces are merged (lamina: the larger index dies)', () => {
    // A plane and a reversed copy on top of it: merging every vertex pair leaves one face.
    const a = planeData();
    const m = editMeshFrom(combined(a, a, [0, 0, 0], false));
    expect(counts(m)).toBe('8/8/2');
    runOk(m, 'mesh.mergeByDistance', null, { distance: 0.001 });
    expect(counts(m)).toBe('4/4/1');
  });

  it('merge to center: every selected vertex to their centroid; one vertex refuses', () => {
    const m = cube();
    const top = topOf(m);
    runOk(
      m,
      'mesh.mergeToCenter',
      sel(m, 'edge', [m.findEdge(faceVerts(m, top)[0] as number, faceVerts(m, top)[1] as number)]),
    );
    expect(counts(m)).toBe('7/11/6');
    const one = cube();
    runRefused(one, 'mesh.mergeToCenter', sel(one, 'vertex', [3]), 'mergeToCenter.nothing');
  });

  it('H3: a merged edge is hard when either merged edge was', () => {
    const data = cubeData({ hard: false });
    const m = editMeshFrom(data);
    const top = faceToward(m, [0, 1, 0]);
    const [a, b, c] = faceVerts(m, top) as [number, number, number];
    // Harden one of the two edges that a merge of a and c folds together.
    m.begin('harden');
    m.setEdgeFlags(m.findEdge(a, b), EDGE_HARD);
    m.end();
    const result = runOk(m, 'mesh.merge', sel(m, 'vertex', [a, c]), {}, ctxOf({ faceted: false }));
    const [rep] = result.selection.verts.toArray();
    const folded = m.findEdge(rep as number, vertexNear(m, position(m, b)));
    expect(folded).toBeGreaterThanOrEqual(0);
    expect(m.edgeFlags(folded) & EDGE_HARD).toBe(EDGE_HARD);
  });

  it('collapse: a face to its centroid; connected edges to one point', () => {
    const f = cube();
    const result = runOk(f, 'mesh.collapse', sel(f, 'face', [topOf(f)]));
    expect(counts(f)).toBe('5/8/5');
    expect(r6(position(f, result.selection.verts.toArray()[0] as number))).toEqual(r6([0, 0.5, 0]));
    const e = cube();
    const vs = faceVerts(e, topOf(e));
    const chain = [e.findEdge(vs[0] as number, vs[1] as number), e.findEdge(vs[1] as number, vs[2] as number)];
    const r = runOk(e, 'mesh.collapse', sel(e, 'edge', chain));
    expect(r.selection.verts.count()).toBe(1);
    expect(e.counts.points).toBe(6);
    const none = cube();
    runRefused(none, 'mesh.collapse', null, 'collapse.no-selection');
  });

  it('target weld: center mode welds at the midpoint; edges weld endpoint to endpoint by proximity', () => {
    const m = cube();
    const a = m.edgeVert(0, 0);
    const b = m.edgeVert(0, 1);
    const mid = lerp(position(m, a), position(m, b), 0.5);
    const result = runOk(m, 'mesh.targetWeld', sel(m, 'vertex', []), { pairs: [[a, b]], mode: 'center' });
    expect(r6(position(m, result.selection.verts.toArray()[0] as number))).toEqual(r6(mid));
    // Two planes 0.01 apart: weld the facing border edges.
    const planes = editMeshFrom(combined(planeData(), planeData(), [1.01, 0, 0]));
    const left = borderEdges(planes).find((e) =>
      ([0, 1] as const).every((k) => Math.abs(position(planes, planes.edgeVert(e, k))[0] - 0.5) < 1e-6),
    );
    const right = borderEdges(planes).find((e) =>
      ([0, 1] as const).every((k) => Math.abs(position(planes, planes.edgeVert(e, k))[0] - 0.51) < 1e-6),
    );
    runOk(planes, 'mesh.targetWeld', sel(planes, 'edge', []), { pairs: [[right as number, left as number]] });
    expect(counts(planes)).toBe('6/7/2');
    const unpaired = cube();
    runRefused(unpaired, 'mesh.targetWeld', sel(unpaired, 'vertex', []), 'targetWeld.no-pairs', { pairs: [] });
  });
});

describe('mesh.delete family details (§5.12)', () => {
  it('faces: removed with the edges and vertices only they used', () => {
    const m = cube();
    runOk(m, 'mesh.delete', sel(m, 'face', [topOf(m)]));
    expect(counts(m)).toBe('8/12/5');
    const plane = editMeshFrom(planeData({ width: 2, subdivisionsWidth: 2 }));
    const left = faceToward(plane, [0, 1, 0]);
    const leftmost = [0, 1].reduce(
      (best, f) => (faceCentroid(plane, f)[0] < faceCentroid(plane, best)[0] ? f : best),
      left,
    );
    const result = runOk(plane, 'mesh.delete', sel(plane, 'face', [leftmost]));
    expect(counts(plane)).toBe('4/4/1');
    expect(result.selection.faces.count() + result.selection.edges.count() + result.selection.verts.count()).toBe(0);
  });

  it('edges: a border edge goes with its face', () => {
    const plane = editMeshFrom(planeData({ width: 2, subdivisionsWidth: 2 }));
    const left = borderEdges(plane).find((e) =>
      ([0, 1] as const).every((k) => Math.abs(position(plane, plane.edgeVert(e, k))[0] + 1) < 1e-9),
    );
    runOk(plane, 'mesh.delete', sel(plane, 'edge', [left as number]));
    expect(counts(plane)).toBe('4/4/1');
  });

  it('vertices: a winged (valence 2) vertex dissolves into the edge joining its neighbours', () => {
    // A unit quad with an extra vertex on its right edge: a pentagon whose vertex 4 has valence 2.
    const m = editMeshFrom(fromFaces([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 0.5, 0], [[0, 1, 4, 2, 3]]));
    runOk(m, 'mesh.delete', sel(m, 'vertex', [4]));
    expect(counts(m)).toBe('4/4/1');
    expect(m.findEdge(1, 2)).toBeGreaterThanOrEqual(0);
  });

  it('Delete Edge/Vertex: border edges refuse; a border corner vertex joins its two neighbours', () => {
    const plane = editMeshFrom(planeData());
    runRefused(plane, 'mesh.deleteEdgeVertex', sel(plane, 'edge', [0]), 'delete.border-edge');
    const corner = editMeshFrom(planeData());
    runOk(corner, 'mesh.deleteEdgeVertex', sel(corner, 'vertex', [0]));
    expect(counts(corner)).toBe('3/3/1');
  });

  it('a deletion that would leave a face with a hole refuses delete.hole', () => {
    // The 8 interior edges of a 3 × 3 plane that do not touch the centre face: merging the ring of 8 faces.
    const m = editMeshFrom(planeData({ width: 3, height: 3, subdivisionsWidth: 3, subdivisionsHeight: 3 }));
    const centre = (() => {
      for (let f = 0; f < m.counts.faces; f++) {
        const c = faceCentroid(m, f);
        if (Math.abs(c[0]) < 1e-9 && Math.abs(c[2]) < 1e-9) return f;
      }
      return -1;
    })();
    const centreVerts = new Set(faceVerts(m, centre));
    const ring: number[] = [];
    for (let e = 0; e < m.counts.edges; e++) {
      if (m.edgeFaceCount(e) !== 2) continue;
      const touches = [0, 1].some((k) => centreVerts.has(m.edgeVert(e, k as 0 | 1)));
      const both = [0, 1].every((k) => centreVerts.has(m.edgeVert(e, k as 0 | 1)));
      if (!both && touches) ring.push(e);
    }
    expect(ring.length).toBe(8);
    runRefused(m, 'mesh.delete', sel(m, 'edge', ring), 'delete.hole');
  });
});

describe('mesh.fillHole details (§5.12)', () => {
  it('a side face of an open cylinder touches both border loops: both are filled', () => {
    const m = editMeshFrom(openCylinderData());
    const result = runOk(m, 'mesh.fillHole', sel(m, 'face', [0]));
    expect(counts(m)).toBe('16/24/10');
    expect(result.selection.faces.count()).toBe(2);
    expect(topologyStats(m).boundaryLoops).toBe(0);
    expect(windingProblems(m)).toEqual([]);
  });

  it('a border edge fills its loop; the new face takes the lowest-index adjacent face’s paint slot', () => {
    const m = editMeshFrom(openCylinderData());
    const paint = m.layer(BUILTIN_LAYERS.paint.name);
    m.begin('paint');
    for (let f = 0; f < m.counts.faces; f++) paint?.set(f, 0, f + 1);
    m.end();
    const top = borderEdges(m).filter((e) => position(m, m.edgeVert(e, 0))[1] > 0);
    const result = runOk(m, 'mesh.fillHole', sel(m, 'edge', [top[0] as number]));
    const [fill] = result.selection.faces.toArray();
    expect(m.faceLen(fill as number)).toBe(8);
    const adjacent = new Set<number>();
    for (const e of top)
      for (let f = 0; f < m.counts.faces; f++)
        if (f !== fill && faceVerts(m, f).includes(m.edgeVert(e, 0))) adjacent.add(f);
    expect(paint?.get(fill as number, 0)).toBe(Math.min(...adjacent) + 1);
  });

  it('refuses fillHole.no-border on a closed mesh', () => {
    const m = cube();
    runRefused(m, 'mesh.fillHole', sel(m, 'vertex', [0]), 'fillHole.no-border');
    expect(counts(m)).toBe('8/12/6');
  });
});

describe('mesh.bridge details (§5.12)', () => {
  const twoOpen = (sidesB = 8) => {
    const a = editMeshFrom(cylinderData());
    const b = editMeshFrom(cylinderData({ subdivisionsAxis: sidesB }));
    runOk(a, 'mesh.delete', sel(a, 'face', [faceToward(a, [0, 1, 0])]));
    runOk(b, 'mesh.delete', sel(b, 'face', [faceToward(b, [0, -1, 0])]));
    return editMeshFrom(combined(a.snapshot(), b.snapshot(), [0, 2, 0]));
  };

  it('unequal counts refuse with both counts; one loop refuses bridge.needs-two', () => {
    const m = twoOpen(6);
    const refusal = runRefused(m, 'mesh.bridge', sel(m, 'edge', borderEdges(m)), 'bridge.unequal-counts');
    expect(refusal.reason).toContain('8 vs 6');
    const one = editMeshFrom(openCylinderData());
    const top = borderEdges(one).filter((e) => position(one, one.edgeVert(e, 0))[1] > 0);
    runRefused(one, 'mesh.bridge', sel(one, 'edge', top), 'bridge.needs-two');
  });

  it('open chains: the facing border edges of two planes become one quad', () => {
    const m = editMeshFrom(combined(planeData(), planeData(), [2, 0, 0]));
    const facing = borderEdges(m).filter((e) =>
      [0, 1].every((k) => Math.abs(Math.abs(position(m, m.edgeVert(e, k as 0 | 1))[0] - 1) - 0.5) < 1e-9),
    );
    expect(facing.length).toBe(2);
    const result = runOk(m, 'mesh.bridge', sel(m, 'edge', facing), { divisions: 1 });
    // +2 ring vertices; +4 column edges and the ring edge; two quads.
    expect(counts(m)).toBe('10/13/4');
    expect(result.selection.faces.count()).toBe(2);
    expect(windingProblems(m)).toEqual([]);
  });

  it('two faces: deleted first, their boundaries bridged (a tunnel through a 3 × 3 × 3 box)', () => {
    const m = editMeshFrom(primitive('cube', { subdivisionsWidth: 3, subdivisionsHeight: 3, subdivisionsDepth: 3 }));
    expect(counts(m)).toBe('56/108/54');
    const centre = (dir: readonly [number, number, number]) => {
      for (let f = 0; f < m.counts.faces; f++) {
        const c = faceCentroid(m, f);
        if (Math.abs(c[0] - dir[0] / 2) + Math.abs(c[1] - dir[1] / 2) + Math.abs(c[2] - dir[2] / 2) < 1e-6) return f;
      }
      return -1;
    };
    const result = runOk(m, 'mesh.bridge', sel(m, 'face', [centre([0, 0, 1]), centre([0, 0, -1])]));
    expect(counts(m)).toBe('56/112/56');
    expect(result.selection.faces.count()).toBe(4);
    const stats = topologyStats(m);
    expect([stats.boundaryLoops, stats.nonManifoldEdges, stats.euler]).toEqual([0, 0, 0]);
    expect(windingProblems(m)).toEqual([]);
    const c = cube();
    runRefused(c, 'mesh.bridge', sel(c, 'face', [0]), 'bridge.needs-two');
  });

  it('twist and offset shift the pairing by whole steps; taper scales the intermediate ring', () => {
    const strips = (args: ParamValues) => {
      const m = twoOpen();
      runOk(m, 'mesh.bridge', sel(m, 'edge', borderEdges(m)), args);
      const pairs: string[] = [];
      for (let e = 0; e < m.counts.edges; e++) {
        const a = position(m, m.edgeVert(e, 0));
        const b = position(m, m.edgeVert(e, 1));
        if (Math.abs(Math.abs(a[1] - b[1]) - 1) < 1e-9)
          pairs.push(
            [a, b]
              .map((p) => p.map((x) => Math.round(x * 1e4)).join(','))
              .sort()
              .join('|'),
          );
      }
      return { m, pairs: pairs.sort() };
    };
    const plain = strips({});
    const twisted = strips({ twist: 1 });
    const offset = strips({ offset: 1 });
    expect(twisted.pairs).not.toEqual(plain.pairs);
    expect(offset.pairs).toEqual(twisted.pairs);
    expect(strips({ twist: 1, offset: -1 }).pairs).toEqual(plain.pairs);
    // Straight pairs: every strip edge is vertical without twist.
    for (const pair of plain.pairs) {
      const [p, q] = pair.split('|').map((s) => s.split(',').map(Number)) as [number[], number[]];
      expect([p[0], p[2]]).toEqual([q[0], q[2]]);
    }
    const tapered = twoOpen();
    const result = runOk(tapered, 'mesh.bridge', sel(tapered, 'edge', borderEdges(tapered)), {
      divisions: 1,
      taper: 2,
    });
    expect(result.selection.faces.count()).toBe(16);
    for (const v of newVerts(tapered, 32)) {
      const p = position(tapered, v);
      expect(p[1]).toBeCloseTo(1, 6);
      expect(Math.hypot(p[0], p[2])).toBeCloseTo(1, 6);
    }
  });

  it('the resolved loops follow pick order; strip edges follow H2', () => {
    const m = twoOpen();
    const border = borderEdges(m);
    const upper = border.filter((e) => position(m, m.edgeVert(e, 0))[1] > 1);
    const lower = border.filter((e) => position(m, m.edgeVert(e, 0))[1] < 1);
    const result = runOk(m, 'mesh.bridge', sel(m, 'edge', [...upper, ...lower]));
    expect(result.resolvedArgs['loops']).toEqual([upper, lower]);
    expect(allHard(m)).toBe(true);
    const smooth = twoOpen();
    // On a smooth mesh the straight strip continues the cylinder walls: the edges between strip quads stay soft.
    smooth.begin('soften');
    for (let e = 0; e < smooth.counts.edges; e++) smooth.setEdgeFlags(e, 0);
    smooth.end();
    runOk(smooth, 'mesh.bridge', sel(smooth, 'edge', borderEdges(smooth)), {}, ctxOf({ faceted: false }));
    expect(softEdges(smooth).length).toBeGreaterThan(0);
  });
});

describe('refusals and warnings of the remaining codes', () => {
  /** Three quads on one edge (0–1): a non-manifold fan. */
  const fan = () =>
    editMeshFrom(
      fromFaces(
        [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, -1, 0, 0, -1, 0, 1, 0, 1, 0, 0, 1],
        [
          [0, 1, 2, 3],
          [1, 0, 5, 4],
          [1, 0, 7, 6],
        ],
      ),
    );
  /** Two triangles that share only vertex 0 (a bow-tie). */
  const bowTie = () =>
    editMeshFrom(
      fromFaces(
        [0, 0, 0, 1, 0, 0, 1, 1, 0, -1, 0, 0, -1, -1, 0],
        [
          [0, 1, 2],
          [0, 3, 4],
        ],
      ),
    );

  it('extrude: vertex mode, an empty selection, faces around a non-manifold edge', () => {
    const m = fan();
    expect(runRefused(m, 'mesh.extrude', sel(m, 'vertex', [0]), 'extrude.vertex').reason).toContain('not available');
    runRefused(m, 'mesh.extrude', sel(m, 'face', []), 'extrude.no-selection');
    runRefused(m, 'mesh.extrude', sel(m, 'face', [0, 1]), 'extrude.non-manifold');
    expect(counts(m)).toBe('8/10/3');
    // A bow-tie region is extruded: its shared vertex is duplicated once per fan.
    const b = bowTie();
    runOk(b, 'mesh.extrude', sel(b, 'face', [0, 1]), { localTranslateZ: 0.2 });
    expect(counts(b)).toBe('11/18/8');
  });

  it('inset: an empty selection, a non-manifold edge, a vertex in two fans', () => {
    const m = fan();
    runRefused(m, 'mesh.inset', sel(m, 'face', []), 'inset.no-selection');
    runRefused(m, 'mesh.inset', sel(m, 'face', [0, 1]), 'inset.non-manifold');
    // Faces sharing only a vertex are two regions, each inset on its own.
    const b = bowTie();
    runOk(b, 'mesh.inset', sel(b, 'face', [0, 1]), { offset: 0.05 });
    expect(counts(b)).toBe('11/18/8');
    // One region that touches a vertex in two fans: the faces at (2, 2) of a 5 × 5 grid diagonal to each other,
    // joined round the far side.
    const grid = editMeshFrom(planeData({ width: 5, height: 5, subdivisionsWidth: 5, subdivisionsHeight: 5 }));
    const at = (i: number, j: number) => {
      for (let f = 0; f < grid.counts.faces; f++) {
        const c = faceCentroid(grid, f);
        if (Math.abs(c[0] - (i - 2)) < 1e-6 && Math.abs(c[2] - (j - 2)) < 1e-6) return f;
      }
      return -1;
    };
    const region = [at(1, 1), at(0, 1), at(0, 2), at(0, 3), at(1, 3), at(2, 3), at(2, 2)];
    expect(region.every((f) => f >= 0)).toBe(true);
    runRefused(grid, 'mesh.inset', sel(grid, 'face', region), 'inset.non-manifold');
    // Extrude duplicates that vertex once per fan instead.
    runOk(grid, 'mesh.extrude', sel(grid, 'face', region), { localTranslateZ: 0.2 });
    expect(windingProblems(grid)).toEqual([]);
  });

  it('offset loop: a loop turning inside a face warns offsetLoop.corner; a closed face boundary has no ring', () => {
    const m = editMeshFrom(planeData({ width: 3, height: 3, subdivisionsWidth: 3, subdivisionsHeight: 3 }));
    // An L through the interior vertex at (−0.5, −0.5): one edge along x, one along z.
    const v = vertexNear(m, [-0.5, 0, -0.5]);
    const along = (dx: number, dz: number) => m.findEdge(v, vertexNear(m, [-0.5 + dx, 0, -0.5 + dz]));
    const result = runOk(m, 'mesh.offsetLoop', sel(m, 'edge', [along(1, 0), along(0, 1)]), { offset: 0.25 });
    expect(result.warnings.find((w) => w.code === 'offsetLoop.corner')?.count).toBe(1);
    expect(windingProblems(m)).toEqual([]);
    const quad = editMeshFrom(planeData());
    runRefused(quad, 'mesh.offsetLoop', sel(quad, 'edge', [0, 1, 2, 3]), 'offsetLoop.no-ring');
    expect(counts(quad)).toBe('4/4/1');
  });

  it('delete: an empty selection, a 3-face edge, a winged vertex that would collapse its triangle', () => {
    const m = fan();
    runRefused(m, 'mesh.delete', sel(m, 'edge', []), 'delete.no-selection');
    runRefused(m, 'mesh.delete', sel(m, 'edge', [m.findEdge(0, 1)]), 'delete.non-manifold');
    const tri = editMeshFrom(fromFaces([0, 0, 0, 1, 0, 0, 0, 1, 0], [[0, 1, 2]]));
    runRefused(tri, 'mesh.delete', sel(tri, 'vertex', [0]), 'delete.degenerate');
    expect(counts(tri)).toBe('3/3/1');
  });
});
