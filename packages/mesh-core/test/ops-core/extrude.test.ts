// `mesh.extrude`, `regionFrame` and `mesh.inset` behaviour (M6A-SPEC §5.8, §5.9, §5.3, §5.2): the cap transform's
// argument order, world space, together vs individual, border-edge extrusion, offset and thickness, H2 on walls,
// attribute propagation, the `adjust` fast path (bit-identical to a fresh run) and the region frame.
import type { ParamValues } from '@ekza-animator/anim-core';
import { describe, expect, it } from 'vitest';
import {
  BUILTIN_LAYERS,
  EDGE_HARD,
  type EditMesh,
  editMeshFrom,
  isRefusal,
  type OpContext,
  primitive,
  regionFrame,
} from '../../src';
import { cubeData, diffStored } from '../../src/testing';
import { edgesAlong, fromFaces, planeData, topOf } from './fixtures';
import {
  counts,
  ctxOf,
  cube,
  faceArea,
  faceCentroid,
  faceToward,
  faceVerts,
  op,
  position,
  runOk,
  sel,
  windingProblems,
} from './support';

const extents = (m: EditMesh, f: number) => {
  const ps = faceVerts(m, f).map((v) => position(m, v));
  const span = (k: 0 | 1 | 2) => Math.max(...ps.map((p) => p[k])) - Math.min(...ps.map((p) => p[k]));
  return [span(0), span(1), span(2)].map((x) => Math.round(x * 1e6) / 1e6);
};

/** Runs `id` with `args`, then adjusts it with `patch` in its own transaction; returns the mesh and the verdict. */
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
  if (isRefusal(result) || result.adjust === undefined) throw new Error('no adjust');
  m.begin(`${id} adjust`);
  const ok = result.adjust(patch);
  if (ok) m.end();
  else m.abort();
  const fresh = make();
  fresh.begin(id);
  const freshResult = op(id).run(fresh, selection(fresh), { ...args, ...patch }, ctx);
  fresh.end();
  return { ok, adjusted: m, fresh, result, freshResult };
}

/** What a result reports besides its selection (read through the getters that follow `adjust`). */
const reported = (r: ReturnType<ReturnType<typeof op>['run']>) =>
  isRefusal(r) ? r : { warnings: r.warnings, frame: r.frame, resolvedArgs: r.resolvedArgs };

describe('mesh.extrude: the cap transform (§5.8 step 5)', () => {
  it('applies scale, then rotate (Rz·Ry·Rx), then translate, in the region frame about its pivot', () => {
    const m = cube();
    const top = topOf(m);
    // The top face's frame: X = +Z, Y = +X, Z = +Y (§5.8 step 4).
    runOk(m, 'mesh.extrude', sel(m, 'face', [top]), {
      localScaleX: 0.5,
      localRotateZ: Math.PI / 2,
      localTranslateZ: 0.5,
    });
    // Scale halves the frame X (world Z); rotating 90° about the frame Z (+Y) turns it onto world X.
    expect(extents(m, top)).toEqual([0.5, 0, 1]);
    expect(faceCentroid(m, top).map((x) => Math.round(x * 1e9) / 1e9)).toEqual([0, 1, 0]);
  });

  it('world space moves along world axes through the placement', () => {
    const m = cube();
    const top = topOf(m);
    // A placement rotated 90° about +Z: world +X is mesh-local −Y.
    const s = Math.SQRT1_2;
    const ctx = ctxOf({ placement: { t: [3, 0, 0], q: [0, 0, s, s], s: [1, 1, 1] } });
    runOk(m, 'mesh.extrude', sel(m, 'face', [top]), { localTranslateX: 0.3, space: 'world' }, ctx);
    const c = faceCentroid(m, top);
    expect(c[0]).toBeCloseTo(0, 6);
    expect(c[1]).toBeCloseTo(0.5 - 0.3, 6);
    expect(c[2]).toBeCloseTo(0, 6);
  });

  it('together: one cap moves as a region; individually: each face along its own normal', () => {
    const together = cube();
    const top = topOf(together);
    const front = faceToward(together, [0, 0, 1]);
    runOk(together, 'mesh.extrude', sel(together, 'face', [top, front]), { thickness: 0.2 });
    expect(counts(together)).toBe('14/24/12');
    expect(windingProblems(together)).toEqual([]);
    const apart = cube();
    runOk(apart, 'mesh.extrude', sel(apart, 'face', [topOf(apart), faceToward(apart, [0, 0, 1])]), {
      localTranslateZ: 0.2,
      keepFacesTogether: false,
    });
    // float32 storage (§3 rule 8): 0.7 is stored as Math.fround(0.7).
    expect(faceCentroid(apart, topOf(apart)).map((x) => Math.round(x * 1e6) / 1e6)).toEqual([0, 0.7, 0]);
    expect(windingProblems(apart)).toEqual([]);
  });

  it('offset insets the cap inside the region surface and thickness pushes it along the normal', () => {
    const m = cube();
    const top = topOf(m);
    const result = runOk(m, 'mesh.extrude', sel(m, 'face', [top]), { offset: 0.1, thickness: 0.2 });
    expect(extents(m, top)).toEqual([0.8, 0, 0.8]);
    for (const v of faceVerts(m, top)) expect(position(m, v)[1]).toBeCloseTo(0.7, 6);
    expect(result.warnings).toEqual([]);
  });

  it('an offset past half the shortest region edge is clamped with extrude.offset-clamped', () => {
    const m = cube();
    const top = topOf(m);
    const result = runOk(m, 'mesh.extrude', sel(m, 'face', [top]), { offset: 0.8, localTranslateZ: 0.2 });
    expect(result.warnings.map((w) => [w.code, w.count])).toEqual([['extrude.offset-clamped', 4]]);
    expect(faceArea(m, top)).toBeGreaterThan(1e-6);
    expect(windingProblems(m)).toEqual([]);
  });

  it('a zero extrude stays in (the zero-drop is the session’s, §5.8)', () => {
    const m = cube();
    runOk(m, 'mesh.extrude', sel(m, 'face', [topOf(m)]), {});
    expect(counts(m)).toBe('12/20/10');
  });
});

describe('mesh.extrude: border edges (§5.8 step 7)', () => {
  it('extrudes a border edge into a quad with the outer edge selected, away from the face', () => {
    const m = editMeshFrom(planeData());
    expect(counts(m)).toBe('4/4/1');
    const e = edgesAlong(m, 0)[0] as number;
    const z0 = position(m, m.edgeVert(e, 0))[2];
    const result = runOk(m, 'mesh.extrude', sel(m, 'edge', [e]), { localTranslateY: 0.25 });
    expect(counts(m)).toBe('6/7/2');
    expect(result.selection.kind).toBe('edge');
    const [outer] = result.selection.edges.toArray();
    const p = position(m, m.edgeVert(outer as number, 0));
    expect(Math.abs(p[2])).toBeCloseTo(0.75, 6);
    expect(Math.sign(p[2])).toBe(Math.sign(z0));
    expect(windingProblems(m)).toEqual([]);
  });

  it('connected border edges share their new vertices; divisions add rings', () => {
    const m = editMeshFrom(planeData());
    const all = [0, 1, 2, 3];
    runOk(m, 'mesh.extrude', sel(m, 'edge', all), { localTranslateY: 0.2, divisions: 2 });
    expect(counts(m)).toBe('12/20/9');
    expect(windingProblems(m)).toEqual([]);
  });

  it('at a bow-tie vertex with two selected edges out, the chains keep separate new vertices (consistent winding)', () => {
    // A triangle (1, 2, 3) and a quad (2, 0, 3, 4) touching at vertices 2 and 3 only: vertex 2 has two selected
    // border edges leaving it (2 → 3 in the triangle, 2 → 0 in the quad). Joining them through one new vertex would
    // make two quads run the edge (2, 2′) the same way.
    const m = editMeshFrom(
      fromFaces(
        [1, 0, 0, -1, 0, 0, 0, 0, -1, 0, 0, 1, 0.5, 0, 0],
        [
          [1, 2, 3],
          [2, 0, 3, 4],
        ],
      ),
    );
    const edges = [
      [0, 3],
      [1, 2],
      [2, 0],
      [2, 3],
    ].map(([a, b]) => m.findEdge(a as number, b as number));
    expect(edges.every((e) => e >= 0)).toBe(true);
    runOk(m, 'mesh.extrude', sel(m, 'edge', edges), { localTranslateY: 0.2 });
    expect(windingProblems(m)).toEqual([]);
  });

  it('refuses an interior edge: it would make a fin', () => {
    const m = cube();
    const { result } = { result: op('mesh.extrude').run(m, sel(m, 'edge', [0]), {}, ctxOf()) };
    expect(isRefusal(result) && result.code).toBe('extrude.interior-edge');
  });
});

describe('mesh.extrude: hardness and attributes', () => {
  it('H2: faceted meshes get hard walls; smooth meshes keep coplanar wall joins soft (30°)', () => {
    const faceted = cube();
    runOk(faceted, 'mesh.extrude', sel(faceted, 'face', [topOf(faceted)]), { localTranslateZ: 0.5 });
    for (let e = 0; e < faceted.counts.edges; e++) expect(faceted.edgeFlags(e) & EDGE_HARD).toBe(EDGE_HARD);
    const smooth = editMeshFrom(cubeData({ hard: false }));
    const top = faceToward(smooth, [0, 1, 0]);
    const result = runOk(
      smooth,
      'mesh.extrude',
      sel(smooth, 'face', [top]),
      { localTranslateZ: 0.5 },
      ctxOf({ faceted: false }),
    );
    expect(result.resolvedArgs['smoothingAngle']).toBeCloseTo(Math.PI / 6, 12);
    // The old top edges now join a side to its wall (flat): soft; the cap rim and the vertical wall edges are 90°.
    const soft = [];
    for (let e = 0; e < smooth.counts.edges; e++) if ((smooth.edgeFlags(e) & EDGE_HARD) === 0) soft.push(e);
    expect(soft.length).toBe(4 + 8);
    expect(faceArea(smooth, top)).toBeCloseTo(1, 6);
  });

  it('side faces take the region face’s paint slot and its corner values (UVs stretched)', () => {
    const data = primitive('cube', {});
    const m = editMeshFrom(data);
    const top = topOf(m);
    m.begin('paint');
    m.layer(BUILTIN_LAYERS.paint.name)?.set(top, 0, 3);
    m.end();
    runOk(m, 'mesh.extrude', sel(m, 'face', [top]), { localTranslateZ: 0.5 });
    const paint = m.layer(BUILTIN_LAYERS.paint.name);
    for (let f = 6; f < m.counts.faces; f++) expect(paint?.get(f, 0)).toBe(3);
    // Every side corner's UV equals the cap corner's UV at its column.
    const uv = m.layer(BUILTIN_LAYERS.uv0.name);
    expect(uv).toBeDefined();
    const capUv = new Map<string, string>();
    for (const v of faceVerts(m, top)) {
      const p = position(m, v);
      const c = (() => {
        const start = m.faceCorner(top);
        let k = start;
        do {
          if (m.cornerVert(k) === v) return k;
          k = m.cornerNext(k);
        } while (k !== start);
        return -1;
      })();
      capUv.set(`${p[0]},${p[2]}`, `${uv?.get(c, 0)},${uv?.get(c, 1)}`);
    }
    for (let f = 6; f < m.counts.faces; f++) {
      const start = m.faceCorner(f);
      let k = start;
      do {
        const p = position(m, m.cornerVert(k));
        expect(`${uv?.get(k, 0)},${uv?.get(k, 1)}`).toBe(capUv.get(`${p[0]},${p[2]}`));
        k = m.cornerNext(k);
      } while (k !== start);
    }
  });
});

describe('mesh.extrude: adjust fast path (positions and wall hardness only)', () => {
  const top = (m: EditMesh) => sel(m, 'face', [topOf(m)]);

  it('value args re-place the cap bit-identically to a fresh run', () => {
    for (const patch of [
      { localTranslateZ: 0.8 },
      { localScaleX: 0.4, localScaleY: 1.3 },
      { localRotateX: 0.3, localTranslateY: -0.2 },
      { offset: 0.1, thickness: 0.05 },
      { space: 'world', localTranslateX: 0.2 },
    ] as ParamValues[]) {
      const {
        ok,
        adjusted: a,
        fresh,
      } = adjusted(cube, 'mesh.extrude', top, { localTranslateZ: 0.5, divisions: 2 }, patch);
      expect(ok).toBe(true);
      expect(diffStored(a, fresh)).toBeNull();
    }
  });

  it('re-applies H2 for a new smoothing angle; declines divisions and keepFacesTogether', () => {
    const smooth = () => editMeshFrom(cubeData({ hard: false }));
    const ctx = ctxOf({ faceted: false });
    const angle = adjusted(
      smooth,
      'mesh.extrude',
      (m) => sel(m, 'face', [faceToward(m, [0, 1, 0])]),
      { localTranslateZ: 0.5, localRotateX: 0.4 },
      { smoothingAngle: 1.2 },
      ctx,
    );
    expect(angle.ok).toBe(true);
    expect(diffStored(angle.adjusted, angle.fresh)).toBeNull();
    expect(adjusted(cube, 'mesh.extrude', top, { localTranslateZ: 0.5 }, { divisions: 3 }).ok).toBe(false);
    expect(adjusted(cube, 'mesh.extrude', top, { localTranslateZ: 0.5 }, { keepFacesTogether: false }).ok).toBe(false);
  });

  it('after adjust the result reports the warnings, frame and resolved args a fresh run reports', () => {
    // localTranslateZ 0.5 → 1.2 with a rotation: the frame pivot moves with the cap (fresh: [0, 1.7, 0]).
    const moved = adjusted(
      cube,
      'mesh.extrude',
      top,
      { localTranslateZ: 0.5 },
      { localTranslateZ: 1.2, localRotateX: 0.3 },
    );
    expect(moved.ok).toBe(true);
    expect(reported(moved.result)).toEqual(reported(moved.freshResult));
    expect(isRefusal(moved.result) ? null : moved.result.frame?.pivot.map((x) => Math.round(x * 1e9) / 1e9)).toEqual([
      0, 1.7, 0,
    ]);
    expect(isRefusal(moved.result) ? null : moved.result.resolvedArgs['localTranslateZ']).toBe(1.2);
    // An offset pushed past the clamp warns on the adjusted result, and the warning goes when it comes back.
    const clamped = adjusted(cube, 'mesh.extrude', top, { localTranslateZ: 0.5 }, { offset: 0.8 });
    expect(reported(clamped.result)).toEqual(reported(clamped.freshResult));
    const result = clamped.result;
    if (isRefusal(result) || result.adjust === undefined) throw new Error('no adjust');
    expect(result.warnings.map((w) => w.code)).toEqual(['extrude.offset-clamped']);
    clamped.adjusted.begin('back');
    expect(result.adjust({ offset: 0.1 })).toBe(true);
    clamped.adjusted.end();
    expect(result.warnings).toEqual([]);
    // A declined patch leaves the reported state as it was.
    expect(result.adjust({ divisions: 3 })).toBe(false);
    expect(result.resolvedArgs['offset']).toBe(0.1);
    // Edge extrude and inset follow their adjustments the same way.
    const edge = adjusted(
      () => editMeshFrom(planeData()),
      'mesh.extrude',
      (m) => sel(m, 'edge', [0, 1]),
      { localTranslateY: 0.2 },
      { localTranslateY: 0.6 },
    );
    expect(reported(edge.result)).toEqual(reported(edge.freshResult));
    const inset = adjusted(cube, 'mesh.inset', top, { offset: 0.1 }, { offset: 0.9, depth: 0.3 });
    expect(reported(inset.result)).toEqual(reported(inset.freshResult));
    expect(isRefusal(inset.result) ? [] : inset.result.warnings.map((w) => w.code)).toEqual(['inset.clamped']);
  });

  it('edge extrude adjusts the same way', () => {
    const plane = () => editMeshFrom(planeData());
    const {
      ok,
      adjusted: a,
      fresh,
    } = adjusted(
      plane,
      'mesh.extrude',
      (m) => sel(m, 'edge', [0, 1]),
      { localTranslateY: 0.2 },
      { localTranslateY: 0.6, localRotateX: 0.2 },
    );
    expect(ok).toBe(true);
    expect(diffStored(a, fresh)).toBeNull();
  });
});

describe('regionFrame and OpResult.frame', () => {
  it('the top face: pivot at its centroid, X = +Z, Y = +X, Z = +Y; the op frame sits on the moved cap', () => {
    const m = cube();
    const top = topOf(m);
    expect(regionFrame(m, [top])).toEqual({
      pivot: [0, 0.5, 0],
      axes: [
        [0, 0, 1],
        [1, 0, 0],
        [0, 1, 0],
      ],
    });
    const result = runOk(m, 'mesh.extrude', sel(m, 'face', [top]), { localTranslateZ: 0.5 });
    expect(result.frame).toEqual({
      pivot: [0, 1, 0],
      axes: [
        [0, 0, 1],
        [1, 0, 0],
        [0, 1, 0],
      ],
    });
  });

  it('a side face uses +Y as the up reference; out-of-range faces throw out-of-range', () => {
    const m = cube();
    const front = faceToward(m, [0, 0, 1]);
    const frame = regionFrame(m, [front]);
    expect(frame.axes[2]).toEqual([0, 0, 1]);
    expect(frame.axes[0]).toEqual([0, 1, 0]);
    expect(() => regionFrame(m, [99])).toThrow(/regionFrame/);
  });
});

describe('mesh.inset (§5.9)', () => {
  it('insets the region boundary by offset (even offset), keeps the inner face index, rim quads', () => {
    const m = cube();
    const top = topOf(m);
    const result = runOk(m, 'mesh.inset', sel(m, 'face', [top]), { offset: 0.1 });
    expect(counts(m)).toBe('12/20/10');
    expect(extents(m, top)).toEqual([0.8, 0, 0.8]);
    expect([...result.selection.faces.toArray()]).toEqual([top]);
    expect(result.frame?.pivot).toEqual([0, 0.5, 0]);
    expect(windingProblems(m)).toEqual([]);
  });

  it('evenOffset off moves corners by offset along the bisector; depth moves the inner faces', () => {
    const m = cube();
    const top = topOf(m);
    runOk(m, 'mesh.inset', sel(m, 'face', [top]), { offset: 0.1, evenOffset: false, depth: 0.2 });
    const span = 1 - 2 * 0.1 * Math.SQRT1_2;
    expect(extents(m, top).map((x) => Math.round(x * 1e5) / 1e5)).toEqual([
      Math.round(span * 1e5) / 1e5,
      0,
      Math.round(span * 1e5) / 1e5,
    ]);
    for (const v of faceVerts(m, top)) expect(position(m, v)[1]).toBeCloseTo(0.7, 6);
  });

  it('clamp limits each vertex to half its shortest region edge with inset.clamped', () => {
    const m = cube();
    const result = runOk(m, 'mesh.inset', sel(m, 'face', [topOf(m)]), { offset: 0.9 });
    expect(result.warnings.map((w) => [w.code, w.count])).toEqual([['inset.clamped', 4]]);
    expect(windingProblems(m)).toEqual([]);
  });

  it('individual insets each face; together insets the region boundary only', () => {
    const together = cube();
    runOk(together, 'mesh.inset', sel(together, 'face', [topOf(together), faceToward(together, [0, 0, 1])]), {
      offset: 0.1,
    });
    expect(counts(together)).toBe('14/24/12');
    const apart = cube();
    runOk(apart, 'mesh.inset', sel(apart, 'face', [topOf(apart), faceToward(apart, [0, 0, 1])]), {
      offset: 0.1,
      individual: true,
    });
    expect(counts(apart)).toBe('16/28/14');
  });

  it('adjust re-places the inner faces bit-identically', () => {
    const {
      ok,
      adjusted: a,
      fresh,
    } = adjusted(cube, 'mesh.inset', (m) => sel(m, 'face', [topOf(m)]), { offset: 0.1 }, { offset: 0.2, depth: -0.1 });
    expect(ok).toBe(true);
    expect(diffStored(a, fresh)).toBeNull();
  });
});
