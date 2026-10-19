// `mesh.transformComponents` (M6A-SPEC §6.1, §5.14 first row, §5.15): World/Object/Component spaces under placements,
// pivot and orientation resolution, hidden components, exact undo (P5) and determinism, symmetry (mirrored deltas,
// seam vertices, Preserve Seam, unmatched partners), soft weights (the E2E-MOD-10 plane), the adjust fast path, and
// P10 for transforms and soft selection as properties.
import { curveEngine, type ParamValues, type ReadonlyXf } from '@ekza-animator/anim-core';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  buildSymmetryMap,
  type ComponentKind,
  type ComponentSelection,
  type EditMesh,
  editMeshFrom,
  expandSelection,
  isRefusal,
  MESH_OPS,
  type MeshDelta,
  type OpContext,
  type OpResult,
  primitive,
  type SymmetryMap,
  validateMesh,
  writeRevision,
} from '../../src';
import { softWeights } from '../../src/soft/weights';
import { mirrorSpaceOf, planeDistance, reflectPoint, worldDistance } from '../../src/symmetry/space';
import { arbPrimitive, buildMeshData, cubeData, diffStored } from '../../src/testing';
import {
  faceCentroid,
  faceVerts,
  hiddenSet,
  hideFaces,
  IDENTITY,
  mesh,
  position,
  sel,
  vertexAt,
} from '../select/fixtures';

const op = MESH_OPS['mesh.transformComponents'] as (typeof MESH_OPS)[string];

function context(over: Partial<OpContext> = {}): OpContext {
  return {
    symmetry: null,
    hidden: null,
    placement: IDENTITY,
    faceted: true,
    soft: null,
    curves: curveEngine,
    epsilon: 1e-9,
    ...over,
  };
}

/** Runs the op in its own transaction; a refusal aborts. */
function run(
  m: EditMesh,
  s: ComponentSelection | null,
  args: ParamValues,
  ctx: OpContext = context(),
): { readonly result: OpResult; readonly delta: MeshDelta } {
  m.begin(op.id);
  const result = op.run(m, s, args, ctx);
  if (isRefusal(result)) {
    m.abort();
    throw new Error(`refused: ${result.code}`);
  }
  const delta = m.end();
  return { result, delta };
}

/** World position of a local point. */
function toWorld(p: readonly number[], xf: ReadonlyXf): [number, number, number] {
  const [qx, qy, qz, qw] = xf.q;
  const [x, y, z] = [(p[0] ?? 0) * xf.s[0], (p[1] ?? 0) * xf.s[1], (p[2] ?? 0) * xf.s[2]];
  // q · v · q*
  const ix = qw * x + qy * z - qz * y;
  const iy = qw * y + qz * x - qx * z;
  const iz = qw * z + qx * y - qy * x;
  const iw = -qx * x - qy * y - qz * z;
  return [
    ix * qw + iw * -qx + iy * -qz - iz * -qy + xf.t[0],
    iy * qw + iw * -qy + iz * -qx - ix * -qz + xf.t[1],
    iz * qw + iw * -qz + ix * -qy - iy * -qx + xf.t[2],
  ];
}

const close = (a: readonly number[], b: readonly number[], digits = 6): void => {
  for (let i = 0; i < 3; i++) expect(a[i] as number).toBeCloseTo(b[i] as number, digits);
};

const topFace = (m: EditMesh): number =>
  [...Array(m.counts.faces).keys()].find((f) => faceCentroid(m, f)[1] > 0.49) as number;

describe('poll and refusals', () => {
  it('needs visible components of the selection kind', () => {
    const m = mesh('cube');
    expect(op.poll(m, null, context())).toMatchObject({ code: 'transform.no-selection' });
    expect(op.poll(m, sel(m, 'face', []), context())).toMatchObject({ code: 'transform.no-selection' });
    const hidden = hiddenSet(m, { faces: [0] });
    expect(op.poll(m, sel(m, 'face', [0]), context({ hidden }))).toMatchObject({ code: 'transform.no-selection' });
    expect(op.poll(m, sel(m, 'face', [0, 1]), context({ hidden }))).toBe(true);
    m.begin('x');
    expect(op.run(m, null, {}, context())).toMatchObject({ refused: true, code: 'transform.no-selection' });
    m.abort();
    expect(op.flags.topology).toBe(false);
    expect(op.symmetry).toBe('expand');
  });
});

describe('spaces, pivot and orientation', () => {
  it('World: translate a vertex; resolved pivot = the picks’ bounding-box centre; others stay', () => {
    const m = mesh('cube');
    const v = vertexAt(m, 0.5, 0.5, 0.5);
    const before = m.snapshot();
    const { result } = run(m, sel(m, 'vertex', [v]), { translateX: 0.1, translateY: 0.2, translateZ: -0.3 });
    close(position(m, v), [0.6, 0.7, 0.2]);
    for (let u = 0; u < 8; u++)
      if (u !== v) expect(position(m, u)).toEqual(Array.from(before.position.slice(3 * u, 3 * u + 3)));
    expect(result.resolvedArgs['pivot']).toEqual([0.5, 0.5, 0.5]);
    expect(result.resolvedArgs['space']).toBe('world');
    expect(result.selection.verts.has(v)).toBe(true);
    expect(result.warnings).toEqual([]);
    close(result.frame?.pivot ?? [], [0.6, 0.7, 0.2]);
    expect(validateMesh(m)).toEqual([]);
  });

  it('World under a rotated, scaled, moved placement: the world delta is exactly the args', () => {
    const m = mesh('cube');
    const s = Math.SQRT1_2;
    const placement: ReadonlyXf = { t: [3, -1, 2], q: [0, s, 0, s], s: [2, 1, 0.5] };
    const v = vertexAt(m, 0.5, 0.5, 0.5);
    const w0 = toWorld(position(m, v), placement);
    run(m, sel(m, 'vertex', [v]), { translateX: 1, translateY: 0.25 }, context({ placement }));
    close(toWorld(position(m, v), placement), [w0[0] + 1, w0[1] + 0.25, w0[2]], 5);
  });

  it('Object: translation along the placement’s rotated axes, in world metres', () => {
    const m = mesh('cube');
    const s = Math.SQRT1_2;
    const placement: ReadonlyXf = { t: [0, 0, 0], q: [0, s, 0, s], s: [2, 2, 2] }; // 90° about Y: local X → world −Z
    const v = vertexAt(m, 0.5, 0.5, 0.5);
    const w0 = toWorld(position(m, v), placement);
    run(m, sel(m, 'vertex', [v]), { translateX: 1, space: 'object' }, context({ placement }));
    close(toWorld(position(m, v), placement), [w0[0], w0[1], w0[2] - 1], 5);
  });

  it('Component: the frame of the top face is Z = +Y, X = +Z, Y = +X (region-frame rule)', () => {
    const m = mesh('cube');
    const f = topFace(m);
    const { result } = run(m, sel(m, 'face', [f]), { translateZ: 0.5, translateX: 0.2, space: 'component' });
    for (const v of faceVerts(m, f)) {
      const p = position(m, v);
      expect(p[1]).toBeCloseTo(1, 6);
      expect(Math.abs(p[2])).toBeCloseTo(p[2] > 0 ? 0.7 : 0.3, 6);
    }
    const q = result.resolvedArgs['orientation'] as number[];
    expect(q.length).toBe(4);
    expect(Math.hypot(...q)).toBeCloseTo(1, 12);
    // Recorded and resolved in every space: a World run records the same Component frame.
    const m2 = mesh('cube');
    const { result: r2 } = run(m2, sel(m2, 'face', [topFace(m2)]), { translateY: 0.1 });
    expect(r2.resolvedArgs['orientation']).toEqual(q);
    // Vertex picks average the normals of the faces around them.
    const m3 = mesh('cube');
    const top = faceVerts(m3, topFace(m3));
    const { result: r3 } = run(m3, sel(m3, 'vertex', top), { translateZ: 0.25, space: 'component' });
    for (const v of top) expect(position(m3, v)[1]).toBeCloseTo(0.75, 6);
    expect(r3.resolvedArgs['orientation']).toEqual(q);
  });

  it('rotate and scale about the pivot (resolved or explicit); rotate order xyz', () => {
    const m = mesh('cube');
    const f = topFace(m);
    run(m, sel(m, 'face', [f]), { rotateY: Math.PI / 2 });
    for (const v of faceVerts(m, f)) {
      const p = position(m, v);
      expect(Math.abs(p[0])).toBeCloseTo(0.5, 6);
      expect(Math.abs(p[2])).toBeCloseTo(0.5, 6);
    }
    const m2 = mesh('cube');
    run(m2, sel(m2, 'face', [topFace(m2)]), { scaleX: 2, scaleZ: 3 });
    for (const v of faceVerts(m2, topFace(m2))) {
      const p = position(m2, v);
      expect(Math.abs(p[0])).toBeCloseTo(1, 6);
      expect(Math.abs(p[2])).toBeCloseTo(1.5, 6);
    }
    const m3 = mesh('cube');
    const v = vertexAt(m3, 0.5, 0.5, 0.5);
    run(m3, sel(m3, 'vertex', [v]), { scaleX: 2, scaleY: 2, scaleZ: 2, pivot: [0, 0, 0] });
    close(position(m3, v), [1, 1, 1]);
    // xyz order: R = Rz·Ry·Rx — a point on +Z rotated 90° about X then 90° about Z.
    const m4 = editMeshFrom(buildMeshData({ positions: [0, 0, 1, 1, 1, 1, 2, 2, 2], faces: [[0, 1, 2]] }));
    run(m4, sel(m4, 'vertex', [0]), { rotateX: Math.PI / 2, rotateZ: Math.PI / 2, pivot: [0, 0, 0] });
    close(position(m4, 0), [1, 0, 0]);
  });

  it('edges move their endpoints; faces sharing a vertex with hidden faces still move it; hidden picks stay', () => {
    const m = mesh('cube');
    const e = m.findEdge(vertexAt(m, 0.5, 0.5, 0.5), vertexAt(m, -0.5, 0.5, 0.5));
    run(m, sel(m, 'edge', [e]), { translateY: 1 });
    expect(position(m, vertexAt(m, 0.5, 1.5, 0.5))).toEqual([0.5, 1.5, 0.5]);
    expect(vertexAt(m, -0.5, 1.5, 0.5)).toBeGreaterThanOrEqual(0);
    const m2 = mesh('cube');
    const f = topFace(m2);
    const side = [...Array(6).keys()].find((g) => g !== f && faceCentroid(m2, g)[0] > 0.49) as number;
    const hidden = hideFaces(m2, [side]);
    run(m2, sel(m2, 'face', [f, side]), { translateY: 1 }, context({ hidden }));
    for (const v of faceVerts(m2, f)) expect(position(m2, v)[1]).toBeCloseTo(1.5, 6);
    const bottomOfSide = faceVerts(m2, side).filter((v) => position(m2, v)[1] < 0);
    for (const v of bottomOfSide) expect(position(m2, v)[1]).toBeCloseTo(-0.5, 6);
    const m3 = mesh('cube');
    const p0 = position(m3, 0);
    const p1 = position(m3, 1);
    const h3 = hiddenSet(m3, { verts: [0] });
    run(m3, sel(m3, 'vertex', [0, 1]), { translateY: 1 }, context({ hidden: h3 }));
    expect(position(m3, 0)).toEqual(p0);
    expect(position(m3, 1)).toEqual([p1[0], p1[1] + 1, p1[2]]);
  });
});

describe('exact undo and determinism', () => {
  it('P5: backward restores the stored arrays bit-identically, forward re-yields the result', () => {
    const m = mesh('torus');
    const before = m.snapshot();
    const s = sel(m, 'face', [0, 1, 2, 30]);
    const ctx = context({ soft: { radius: 0.4, falloff: 'surface', curve: 'smooth' } });
    const { delta } = run(m, s, { translateX: 0.3, rotateZ: 0.4, scaleY: 1.5 }, ctx);
    const after = m.snapshot();
    expect(delta.dirty.topology).toBe(false);
    m.apply(delta, 'backward');
    expect(diffStored(m, before)).toBeNull();
    m.apply(delta, 'forward');
    expect(diffStored(m, after)).toBeNull();
  });

  it('P6: the same input and args give the same manifest; untouched vertices are not dirtied', () => {
    const go = (): string => {
      const m = mesh('sphere');
      run(
        m,
        sel(m, 'vertex', [3, 4, 17]),
        { translateY: 0.123, rotateX: 0.2, space: 'component' },
        context({ soft: { radius: 0.3, falloff: 'volume', curve: 'sharp' } }),
      );
      return writeRevision(m).manifestId;
    };
    expect(go()).toBe(go());
    const m = mesh('cube');
    const { delta } = run(m, sel(m, 'vertex', [2]), { translateY: 1 });
    expect(Array.from(delta.dirty.points as Uint32Array)).toEqual([2]);
  });
});

describe('symmetry', () => {
  const X = (m: EditMesh, tolerance = 0.001): SymmetryMap =>
    buildSymmetryMap(m, { axis: 'x', space: 'object', placement: IDENTITY, tolerance });

  it('the partner gets the mirrored delta, from either side', () => {
    for (const side of [1, -1]) {
      const m = mesh('cube');
      const map = X(m);
      const v = vertexAt(m, 0.5 * side, 0.5, 0.5);
      const p = map.vertex[v] as number;
      const { result } = run(
        m,
        sel(m, 'vertex', [v]),
        { translateX: 0.1, translateY: 0.2 },
        context({ symmetry: { map, preserveSeam: true } }),
      );
      close(position(m, v), [0.5 * side + 0.1, 0.7, 0.5]);
      close(position(m, p), [-0.5 * side - 0.1, 0.7, 0.5]);
      expect(result.warnings).toEqual([]);
    }
  });

  it('rotations and scales mirror about S·pivot with S·R·S', () => {
    const m = mesh('cube', { subdivisionsWidth: 2 });
    const map = X(m);
    const right = [...Array(m.counts.faces).keys()].filter((f) => faceCentroid(m, f)[0] > 0.4);
    run(
      m,
      sel(m, 'face', right),
      { rotateY: 0.5, rotateZ: 0.3, scaleX: 1.4 },
      context({ symmetry: { map, preserveSeam: true } }),
    );
    const space = mirrorSpaceOf(map);
    const q = new Float64Array(3);
    for (let v = 0; v < m.counts.points; v++) {
      const p = map.vertex[v] as number;
      const [x, y, z] = position(m, v);
      reflectPoint(space, x, y, z, q);
      close(Array.from(q), position(m, p));
    }
  });

  it('seam vertices take the in-plane part; Preserve Seam projects them onto the plane', () => {
    for (const preserve of [true, false]) {
      const data = primitive('cube', { subdivisionsWidth: 2 });
      const m = editMeshFrom(data);
      const c = vertexAt(m, 0, 0.5, 0.5);
      m.begin('nudge');
      m.setPosition(c, 0.0004, 0.5, 0.5); // within the tolerance: still on the seam
      m.end();
      const map = X(m);
      expect(map.vertex[c]).toBe(c);
      run(
        m,
        sel(m, 'vertex', [c]),
        { translateX: 0.3, translateY: 0.2 },
        context({ symmetry: { map, preserveSeam: preserve } }),
      );
      close(position(m, c), [preserve ? 0 : 0.0004, 0.7, 0.5]);
    }
  });

  it('picks without a partner move on their own side only and warn symmetry.unmatched-partner', () => {
    const base = cubeData();
    const positions = Array.from(base.position);
    positions[5] = (positions[5] as number) + 0.01; // vertex 1 (x = +0.5) 1 cm off its mirror
    const faces: number[][] = [];
    for (let f = 0; f < 6; f++) faces.push([0, 1, 2, 3].map((k) => base.cornerVert[4 * f + k] as number));
    const m = editMeshFrom(buildMeshData({ positions, faces }));
    const map = X(m);
    const { result } = run(
      m,
      sel(m, 'vertex', [1, 2]),
      { translateX: 0.1 },
      context({ symmetry: { map, preserveSeam: true } }),
    );
    expect(position(m, 1)[0]).toBeCloseTo(0.6, 6);
    expect(position(m, 0)[0]).toBeCloseTo(-0.5, 6); // its would-be partner stays
    expect(position(m, 3)[0]).toBeCloseTo(-0.6, 6); // vertex 2's partner mirrors
    expect(result.warnings).toEqual([
      {
        code: 'symmetry.unmatched-partner',
        message: 'No mirror partner: applied to one side',
        count: 1,
        elements: Uint32Array.of(1),
      },
    ]);
  });

  it('two-sided picks: the side of the pivot moves by M (positive when the pivot is on the plane)', () => {
    const m = mesh('cube');
    const map = X(m);
    const a = vertexAt(m, 0.5, 0.5, 0.5);
    const b = map.vertex[a] as number;
    run(m, sel(m, 'vertex', [b, a]), { translateX: 0.1 }, context({ symmetry: { map, preserveSeam: true } }));
    close(position(m, a), [0.6, 0.5, 0.5]);
    close(position(m, b), [-0.6, 0.5, 0.5]);
  });

  it('a stale map (other vertex count) is a caller error', () => {
    const m = mesh('cube');
    const map = X(mesh('cube', { subdivisionsWidth: 2 }));
    m.begin('x');
    expect(() => op.run(m, sel(m, 'vertex', [0]), {}, context({ symmetry: { map, preserveSeam: true } }))).toThrow(
      expect.objectContaining({ code: 'symmetry-stale' }),
    );
    m.abort();
  });
});

describe('soft selection', () => {
  it('E2E-MOD-10 in the kernel: every vertex within 1.8 m moves by w(d/r)·Δy, the rest stays', () => {
    const m = mesh('plane', { width: 10, height: 10, subdivisionsWidth: 99, subdivisionsHeight: 99 });
    let centre = 0;
    let best = Infinity;
    for (let v = 0; v < m.counts.points; v++) {
      const [x, , z] = position(m, v);
      if (Math.hypot(x, z) < best) {
        best = Math.hypot(x, z);
        centre = v;
      }
    }
    const before = m.snapshot().position;
    const soft = { radius: 1.8, falloff: 'volume' as const, curve: 'smooth' as const };
    run(m, sel(m, 'vertex', [centre]), { translateY: 0.5 }, context({ soft }));
    const [cx, , cz] = [before[3 * centre] as number, 0, before[3 * centre + 2] as number];
    let moved = 0;
    for (let v = 0; v < m.counts.points; v++) {
      const d = Math.hypot((before[3 * v] as number) - cx, (before[3 * v + 2] as number) - cz);
      const x = Math.min(1, d / 1.8);
      const w = d > 1.8 ? 0 : 1 - (3 * x * x - 2 * x * x * x);
      expect(Math.abs((m.position[3 * v + 1] as number) - 0.5 * w)).toBeLessThan(1e-6);
      if (w > 0) moved++;
    }
    expect(moved).toBeGreaterThan(900);
  });

  it('weights come from the expanded selection; seam vertices in the falloff move in the plane only', () => {
    const m = mesh('plane', { width: 4, height: 4, subdivisionsWidth: 8, subdivisionsHeight: 8 });
    const map = buildSymmetryMap(m, { axis: 'x', space: 'object', placement: IDENTITY, tolerance: 0.001 });
    const v = vertexAt(m, 0.5, 0, 0);
    const soft = { radius: 1, falloff: 'volume' as const, curve: 'linear' as const };
    const before = m.snapshot().position;
    run(
      m,
      sel(m, 'vertex', [v]),
      { translateX: 0.2, translateY: 0.3 },
      context({ soft, symmetry: { map, preserveSeam: true } }),
    );
    const seeds = expandSelection(sel(m, 'vertex', [v]), map).verts;
    const w = softWeights(editMeshFrom({ ...m.snapshot(), position: before }), seeds, { ...soft, placement: IDENTITY });
    for (let u = 0; u < m.counts.points; u++) {
      const x0 = before[3 * u] as number;
      const dx = (m.position[3 * u] as number) - x0;
      const dy = m.position[3 * u + 1] as number;
      expect(dy).toBeCloseTo(0.3 * (w[u] as number), 6);
      if (Math.abs(x0) < 1e-9) expect(dx).toBe(0);
      else expect(dx).toBeCloseTo(Math.sign(x0) * 0.2 * (w[u] as number), 6);
    }
  });
});

describe('adjust (live preview fast path)', () => {
  it('re-applies new values from the pre-op positions inside the open transaction', () => {
    const a = mesh('cylinder');
    const b = mesh('cylinder');
    const before = a.snapshot();
    const s = sel(a, 'face', [0, 1]);
    const soft = { radius: 0.6, falloff: 'surface' as const, curve: 'smooth' as const };
    a.begin(op.id);
    const result = op.run(a, s, { translateY: 0.1 }, context({ soft })) as OpResult;
    expect(result.adjust?.({ translateY: 0.3, rotateY: 0.2 })).toBe(true);
    expect(result.adjust?.({ translateY: 0.35 })).toBe(true);
    const delta = a.end();
    run(b, sel(b, 'face', [0, 1]), { translateY: 0.35, rotateY: 0.2 }, context({ soft }));
    expect(diffStored(a, b)).toBeNull();
    a.apply(delta, 'backward');
    expect(diffStored(a, before)).toBeNull();
    expect(result.adjust?.({ translateY: 1 })).toBe(false);
  });
});

// ---------- P10 ----------

const arbArgs = fc.record({
  translateX: fc.double({ min: -1, max: 1, noNaN: true }),
  translateY: fc.double({ min: -1, max: 1, noNaN: true }),
  translateZ: fc.double({ min: -1, max: 1, noNaN: true }),
  rotateX: fc.double({ min: -Math.PI, max: Math.PI, noNaN: true }),
  rotateY: fc.double({ min: -Math.PI, max: Math.PI, noNaN: true }),
  rotateZ: fc.double({ min: -Math.PI, max: Math.PI, noNaN: true }),
  scaleX: fc.double({ min: 0.25, max: 2, noNaN: true }),
  scaleY: fc.double({ min: 0.25, max: 2, noNaN: true }),
  scaleZ: fc.double({ min: 0.25, max: 2, noNaN: true }),
  space: fc.constantFrom('world', 'object', 'component'),
});

/** A placement whose world X plane is the mesh's local X plane (rotation about X, translation in Y/Z). */
const arbPlacementX = fc.record({
  t: fc.tuple(fc.constant(0), fc.double({ min: -2, max: 2, noNaN: true }), fc.double({ min: -2, max: 2, noNaN: true })),
  angle: fc.double({ min: -Math.PI, max: Math.PI, noNaN: true }),
  s: fc.tuple(
    fc.double({ min: 0.3, max: 2, noNaN: true }),
    fc.double({ min: 0.3, max: 2, noNaN: true }),
    fc.double({ min: 0.3, max: 2, noNaN: true }),
  ),
});

const arbSoft = fc.option(
  fc.record({
    radius: fc.double({ min: 0.05, max: 2, noNaN: true }),
    falloff: fc.constantFrom('volume' as const, 'surface' as const),
    curve: fc.constantFrom(
      'smooth' as const,
      'linear' as const,
      'sharp' as const,
      'root' as const,
      'sphere' as const,
      'constant' as const,
    ),
  }),
  { nil: null },
);

/** Positions mirror each other across the map's plane (1e-6 m); seam vertices do not leave the tolerance band. */
function checkSymmetric(m: EditMesh, map: SymmetryMap, before: Float32Array, preserve: boolean): void {
  const space = mirrorSpaceOf(map);
  const q = new Float64Array(3);
  for (let v = 0; v < m.counts.points; v++) {
    const p = map.vertex[v] as number;
    const [x, y, z] = position(m, v);
    if (p === v) {
      const d0 = planeDistance(
        space,
        before[3 * v] as number,
        before[3 * v + 1] as number,
        before[3 * v + 2] as number,
      );
      const d1 = planeDistance(space, x, y, z);
      if (preserve) expect(Math.abs(d1)).toBeLessThanOrEqual(1e-6);
      else expect(Math.abs(d1)).toBeLessThanOrEqual(Math.abs(d0) + 1e-6);
      continue;
    }
    if (p < 0) continue;
    reflectPoint(space, x, y, z, q);
    const [px, py, pz] = position(m, p);
    expect(worldDistance(space, q[0] as number, q[1] as number, q[2] as number, px, py, pz)).toBeLessThanOrEqual(1e-6);
  }
}

describe('P10: symmetric input + symmetric args → symmetric output', () => {
  const kinds: readonly ComponentKind[] = ['vertex', 'edge', 'face'];

  it('transforms and soft selection, Object X, any placement', () => {
    fc.assert(
      fc.property(
        arbPrimitive(),
        fc.constantFrom(...kinds),
        fc.array(fc.nat(), { minLength: 1, maxLength: 6 }),
        arbArgs,
        arbSoft,
        fc.boolean(),
        arbPlacementX,
        ({ kind, params }, ck, raw, args, soft, preserve, xf) => {
          const m = editMeshFrom(primitive(kind, params));
          const map = buildSymmetryMap(m, { axis: 'x', space: 'object', placement: IDENTITY, tolerance: 1e-4 });
          if (map.unmatched > 0) return; // cones and odd spheres are symmetric about X too, but stay safe
          const count = ck === 'vertex' ? m.counts.points : ck === 'edge' ? m.counts.edges : m.counts.faces;
          const picks = [...new Set(raw.map((i) => i % count))];
          const before = m.snapshot().position;
          const placement: ReadonlyXf = { t: xf.t, q: [Math.sin(xf.angle / 2), 0, 0, Math.cos(xf.angle / 2)], s: xf.s };
          run(m, sel(m, ck, picks), args, context({ placement, soft, symmetry: { map, preserveSeam: preserve } }));
          expect(validateMesh(m)).toEqual([]);
          checkSymmetric(m, map, before, preserve);
          if (soft === null) {
            // Partners are found again for every vertex (no vertex was created; the pairs survive).
            const again = buildSymmetryMap(m, { axis: 'x', space: 'object', placement: IDENTITY, tolerance: 1e-4 });
            expect(again.unmatched).toBe(0);
          }
        },
      ),
      { numRuns: 150 },
    );
  });

  it('World X with a placement that keeps the world plane on the mesh plane', () => {
    fc.assert(
      fc.property(
        arbPrimitive(),
        fc.array(fc.nat(), { minLength: 1, maxLength: 4 }),
        arbArgs,
        arbSoft,
        arbPlacementX,
        ({ kind, params }, raw, args, soft, xf) => {
          const m = editMeshFrom(primitive(kind, params));
          const placement: ReadonlyXf = { t: xf.t, q: [Math.sin(xf.angle / 2), 0, 0, Math.cos(xf.angle / 2)], s: xf.s };
          const map = buildSymmetryMap(m, { axis: 'x', space: 'world', placement, tolerance: 1e-4 });
          if (map.unmatched > 0) return;
          const picks = [...new Set(raw.map((i) => i % m.counts.faces))];
          const before = m.snapshot().position;
          run(m, sel(m, 'face', picks), args, context({ placement, soft, symmetry: { map, preserveSeam: true } }));
          checkSymmetric(m, map, before, true);
        },
      ),
      { numRuns: 100 },
    );
  });
});
