// M6A-SPEC §5.14 World mode in the B4 ops (M6A-B4-3): a World X/Y/Z map reflects across the world axis plane through
// the world origin, mapped into mesh-local space through the placement (P⁻¹·S·P) — not across the local axis plane.
// - the mirror helpers: S is the world reflection seen in local space (an involution; the plane distance is the world
//   coordinate), for random placements with rotations, signed non-uniform scales and translations;
// - Average, Slide and Multi-Cut in World X on a mesh rotated 90° about Y (world X = local Z): the same result as the
//   run in Object Z and as the run without symmetry on symmetric input, symmetric in world space;
// - P10 in World mode on oblique placements (the local reflection is neither axis-aligned nor, with a non-uniform
//   scale, orthogonal): every B4 row of the §5.14 table keeps a world-symmetric mesh world-symmetric;
// - Symmetrize through a World map, and Mirror's vector layers (morph deltas, custom normals) in World position;
// - behind READY.b2: B2's World maps pair what the B4 test maps pair, and the ops keep B2-mapped meshes symmetric.
import { mat4Compose, type ReadonlyXf } from '@ekza-animator/anim-core';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  BUILTIN_LAYERS,
  buildSymmetryMap,
  type EditMesh,
  editMeshFrom,
  isRefusal,
  MESH_OPS,
  type MeshData,
  type MeshOp,
  mirrorEdgePoint,
  morphLayer,
  type OpContext,
  primitive,
  selectionOf,
  type SymmetryAxis,
  type SymmetryMap,
} from '../../src';
import { normalMatrix, transformNormal, transformPoint, transformVector } from '../../src/subset/matrix';
import {
  mirrorEdgePointOf,
  mirrorOf,
  mirrorPlane,
  planeDistance,
  projectOntoPlane,
  reflectPoint,
  reflectVector,
} from '../../src/subset/symmetry';
import { READY } from '../ready';
import { halfCube } from './determinism';
import { context, edgeAt, position, runOk, runOp } from './harness';
import { arbOpStep, type B4OpId, resolveOpStep } from './steps';
import { asymmetry, expand, testSymmetryMap } from './symmetry-fixture';

const AXES: readonly SymmetryAxis[] = ['x', 'y', 'z'];
const op = (id: string): MeshOp => MESH_OPS[id] as MeshOp;

function unitQuat(a: number, b: number, c: number, d: number): [number, number, number, number] {
  const len = Math.hypot(a, b, c, d);
  return len < 1e-3 ? [0, 0, 0, 1] : [a / len, b / len, c / len, d / len];
}

/** Evenly spread values in [min, max] (fc.double favours 0, ±1 and extremes: mostly axis-aligned rotations). */
const evenly = (min: number, max: number): fc.Arbitrary<number> =>
  fc.integer({ min: 0, max: 10_000 }).map((i) => min + ((max - min) * i) / 10_000);
const arbQuat = fc
  .tuple(evenly(-1, 1), evenly(-1, 1), evenly(-1, 1), evenly(-1, 1))
  .map(([a, b, c, d]) => unitQuat(a, b, c, d));
const arbScale = fc.tuple(evenly(0.4, 2), fc.boolean()).map(([s, negative]) => (negative ? -s : s));
const arbPlacement: fc.Arbitrary<ReadonlyXf> = fc.record({
  t: fc.tuple(evenly(-2, 2), evenly(-2, 2), evenly(-2, 2)),
  q: arbQuat,
  s: fc.tuple(arbScale, arbScale, arbScale),
});

describe('the mirror of a World map (P⁻¹·S·P)', () => {
  it('is the world reflection seen in mesh-local space: an involution whose plane distance is the world coordinate', () => {
    const local = new Float64Array(3);
    const back = new Float64Array(3);
    const world = new Float64Array(3);
    const image = new Float64Array(3);
    fc.assert(
      fc.property(
        arbPlacement,
        fc.constantFrom(...AXES),
        fc.tuple(evenly(-3, 3), evenly(-3, 3), evenly(-3, 3)),
        (placement, axis, [x, y, z]) => {
          const k = AXES.indexOf(axis);
          const P = mat4Compose(placement);
          const mirror = mirrorPlane({ axis, space: 'world', placement });
          transformPoint(P, x, y, z, world);
          // d(p) = the world coordinate on the axis (metres).
          expect(planeDistance(mirror, x, y, z)).toBeCloseTo(world[k] as number, 9);
          // P·S(p) = the world point reflected across the world axis plane.
          reflectPoint(mirror, x, y, z, local);
          transformPoint(P, local[0] as number, local[1] as number, local[2] as number, image);
          for (let c = 0; c < 3; c++) {
            expect(image[c]).toBeCloseTo(c === k ? -(world[c] as number) : (world[c] as number), 9);
          }
          // S(S(p)) = p; the projection lies on the plane; the linear part maps differences.
          reflectPoint(mirror, local[0] as number, local[1] as number, local[2] as number, back);
          for (let c = 0; c < 3; c++) expect(back[c]).toBeCloseTo([x, y, z][c] as number, 9);
          projectOntoPlane(mirror, x, y, z, back);
          expect(Math.abs(planeDistance(mirror, back[0] as number, back[1] as number, back[2] as number))).toBeLessThan(
            1e-9,
          );
          reflectVector(mirror, 0.3, -0.2, 0.7, back);
          reflectPoint(mirror, x + 0.3, y - 0.2, z + 0.7, image);
          for (let c = 0; c < 3; c++) expect(back[c]).toBeCloseTo((image[c] as number) - (local[c] as number), 9);
        },
      ),
      { numRuns: 300, seed: 61 },
    );
  });

  it('runs along a local axis when the rotation maps the world axis onto one (90° about Y: World X = local Z)', () => {
    const q90 = [0, Math.SQRT1_2, 0, Math.SQRT1_2] as const;
    const mirror = mirrorPlane({ axis: 'x', space: 'world', placement: { t: [0.6, 0.4, -0.3], q: q90, s: [1, 1, 2] } });
    expect(mirror.localAxis).toBe(2);
    // World x = 2·z_local + 0.6: the plane is z = −0.3; seam points land exactly on it.
    expect(mirror.offset).toBeCloseTo(-0.3, 12);
    const out = [0, 0, 0];
    reflectPoint(mirror, 0.25, 1, 0.5, out);
    expect(out[0]).toBe(0.25);
    expect(out[1]).toBe(1);
    expect(out[2]).toBeCloseTo(-1.1, 12);
    projectOntoPlane(mirror, 0.25, 1, 0.5, out);
    expect(out[2]).toBe(mirror.offset);
    // Object mode ignores the rotation: the local axis plane.
    const object = mirrorPlane({
      axis: 'x',
      space: 'object',
      placement: { t: [0.6, 0.4, -0.3], q: q90, s: [1, 1, 2] },
    });
    expect([object.localAxis, object.offset]).toEqual([0, 0]);
  });
});

// ---------- World X on a mesh rotated 90° about Y ----------

/** World X = local Z (scaled by 1.5); the translation keeps the world plane at local z = 0. */
const Q90: ReadonlyXf = { t: [0, 0.4, -0.3], q: [0, Math.SQRT1_2, 0, Math.SQRT1_2], s: [1.2, 0.9, 1.5] };

const cube = (subdivisionsDepth: number): MeshData =>
  primitive('cube', { width: 2, height: 3, depth: 2, subdivisionsWidth: 2, subdivisionsHeight: 3, subdivisionsDepth });

/** A 2 × 3 × 2 cube with bumps, symmetric in local z (x′, y′ even in z, z′ odd): symmetric in world X under Q90. */
function bumpy(subdivisionsDepth = 4): EditMesh {
  const m = editMeshFrom(cube(subdivisionsDepth));
  m.begin('bumps');
  for (let v = 0; v < m.counts.points; v++) {
    const [x, y, z] = position(m, v);
    m.setPosition(
      v,
      x + 0.1 * Math.sin(3 * y) + 0.05 * z * z,
      y + 0.1 * x * z * z,
      z * (1 + 0.2 * Math.sin(2 * y) + 0.1 * x),
    );
  }
  m.end();
  return m;
}

const worldX = (m: EditMesh, placement: ReadonlyXf = Q90): SymmetryMap =>
  testSymmetryMap(m, { axis: 'x', space: 'world', placement, tolerance: 1e-4 });
const objectZ = (m: EditMesh): SymmetryMap => testSymmetryMap(m, { axis: 'z', tolerance: 1e-4 });
const symmetric = (map: SymmetryMap, preserveSeam: boolean, placement: ReadonlyXf = Q90): OpContext =>
  context({ placement, symmetry: { map, preserveSeam } });

function maxDifference(a: EditMesh | MeshData, b: EditMesh | MeshData): number {
  expect(a.counts).toEqual(b.counts);
  let worst = 0;
  for (let i = 0; i < 3 * a.counts.points; i++) {
    worst = Math.max(worst, Math.abs((a.position[i] as number) - (b.position[i] as number)));
  }
  return worst;
}

describe('World X on a rotated mesh: Average, Slide, Multi-Cut (§5.14)', () => {
  it('the World X map pairs what the Object Z map pairs; the mesh is world-symmetric', () => {
    const m = bumpy();
    const map = worldX(m);
    expect(map.unmatched).toBe(0);
    expect(Array.from(map.vertex)).toEqual(Array.from(objectZ(m).vertex));
    expect(Array.from(map.face)).toEqual(Array.from(objectZ(m).face));
    expect(asymmetry(m, map, Q90)).toBeLessThan(1e-6);
    // Not symmetric in the local X plane: the old local-axis rule would pair almost nothing.
    expect(testSymmetryMap(m, { axis: 'x' }).unmatched).toBeGreaterThan(20);
  });

  it('Average Vertices: = the run without symmetry, = the Object Z run, world-symmetric (Preserve Seam off)', () => {
    const args = { iterations: 3, strength: 0.6 };
    const plain = bumpy();
    runOk(plain, op('mesh.averageVertices'), null, args, context({ placement: Q90 }));
    const viaZ = bumpy();
    runOk(viaZ, op('mesh.averageVertices'), null, args, symmetric(objectZ(viaZ), false));
    const m = bumpy();
    runOk(m, op('mesh.averageVertices'), null, args, symmetric(worldX(m), false));
    expect(maxDifference(m, plain)).toBeLessThan(1e-6);
    expect(maxDifference(m, viaZ)).toBeLessThan(1e-6);
    expect(asymmetry(m, worldX(m), Q90)).toBeLessThan(1e-6);
  });

  it('Average Vertices with Preserve Seam: seam vertices stay, the rest = the run without symmetry', () => {
    const m = bumpy();
    const map = worldX(m);
    const seam = [...map.vertex.keys()].filter((v) => map.vertex[v] === v);
    expect(seam.length).toBeGreaterThan(0);
    const off = [...map.vertex.keys()].filter((v) => map.vertex[v] !== v);
    const args = { iterations: 3, strength: 0.6 };
    const before = m.snapshot();
    runOk(m, op('mesh.averageVertices'), selectionOf('vertex', off, m.counts), args, symmetric(map, true));
    for (const v of seam) expect(position(m, v)).toEqual(position(before, v));
    const plain = bumpy();
    runOk(
      plain,
      op('mesh.averageVertices'),
      selectionOf('vertex', off, plain.counts),
      args,
      context({ placement: Q90 }),
    );
    expect(maxDifference(m, plain)).toBeLessThan(1e-6);
    expect(asymmetry(m, worldX(m), Q90)).toBeLessThan(1e-6);
    // Every seam vertex selected and Preserve Seam off: they move within the world plane (projected onto it).
    const n = bumpy();
    const all = [...map.vertex.keys()];
    runOk(n, op('mesh.averageVertices'), selectionOf('vertex', all, n.counts), args, symmetric(worldX(n), false));
    for (const v of seam) expect(Math.abs(position(n, v)[2])).toBeLessThan(1e-7);
  });

  it('Slide: a loop on the +X side and its mirror slide along mirrored rails; = Object Z; the source loop = no symmetry', () => {
    // The loop of edges at local z = 0.5 (world x = 0.75) on the undeformed cube; its rails run toward z = 1.
    const flat = editMeshFrom(cube(4));
    const loop: number[] = [];
    for (let e = 0; e < flat.counts.edges; e++) {
      if (position(flat, flat.edgeVert(e, 0))[2] === 0.5 && position(flat, flat.edgeVert(e, 1))[2] === 0.5)
        loop.push(e);
    }
    expect(loop).toHaveLength(10);
    const v = flat.edgeVert(loop[0] as number, 0);
    const [vx, vy] = position(flat, v);
    const rail = edgeAt(flat, [vx, vy, 0.5], [vx, vy, 1]);
    const args = { percent: 0.4, reference: { vertex: v, rail } };
    const ring = new Set(loop.flatMap((e) => [flat.edgeVert(e, 0), flat.edgeVert(e, 1)]));

    const m = bumpy();
    const map = worldX(m);
    const result = runOk(m, op('mesh.slide'), selectionOf('edge', loop, m.counts), args, symmetric(map, true));
    expect(result.warnings).toEqual([]);
    expect(asymmetry(m, worldX(m), Q90)).toBeLessThan(1e-6);
    const viaZ = bumpy();
    runOk(viaZ, op('mesh.slide'), selectionOf('edge', loop, viaZ.counts), args, symmetric(objectZ(viaZ), true));
    expect(maxDifference(m, viaZ)).toBeLessThan(1e-6);
    const plain = bumpy();
    runOk(plain, op('mesh.slide'), selectionOf('edge', loop, plain.counts), args, context({ placement: Q90 }));
    for (const w of ring) {
      expect(position(m, w)).toEqual(position(plain, w));
      // The mirrored loop moved by the mirrored amount (z ↦ −z), toward z = −1.
      const p = map.vertex[w] as number;
      expect(position(m, p)[2]).toBeCloseTo(-position(m, w)[2], 6);
    }
    // Vertex mode on one vertex: its partner slides along the mirrored rail.
    const g = bumpy();
    const gmap = worldX(g);
    runOk(g, op('mesh.slide'), selectionOf('vertex', [v], g.counts), args, symmetric(gmap, true));
    expect(asymmetry(g, worldX(g), Q90)).toBeLessThan(1e-6);
    expect(position(g, gmap.vertex[v] as number)).not.toEqual(position(bumpy(), gmap.vertex[v] as number));
  });

  it('Multi-Cut: a path on the +X side gets its mirrored second cut; a path through the seam is one symmetric cut', () => {
    const flat = editMeshFrom(cube(4));
    // On the top face (y = 1.5): a quad x ∈ [0, 1], z ∈ [0.5, 1]; cut across it from its z = 0.5 edge to its z = 1 edge.
    const a = edgeAt(flat, [0, 1.5, 0.5], [1, 1.5, 0.5]);
    const b = edgeAt(flat, [0, 1.5, 1], [1, 1.5, 1]);
    const points = [
      { kind: 'edge', edge: a, t: 0.3 },
      { kind: 'edge', edge: b, t: 0.6 },
    ];
    const m = bumpy();
    const { points: P } = m.counts;
    const result = runOk(m, op('mesh.cut'), null, { points }, symmetric(worldX(m), true));
    expect(result.warnings).toEqual([]);
    expect(m.counts.points).toBe(P + 4);
    expect(worldX(m).unmatched).toBe(0);
    expect(asymmetry(m, worldX(m), Q90)).toBeLessThan(1e-6);
    const viaZ = bumpy();
    runOk(viaZ, op('mesh.cut'), null, { points }, symmetric(objectZ(viaZ), true));
    expect(maxDifference(m, viaZ)).toBeLessThan(1e-6);
    // Through the seam: from the z = 0.5 edge to the in-seam edge at z = 0, then on to the −X side (clipped there).
    const seam = edgeAt(flat, [0, 1.5, 0], [1, 1.5, 0]);
    const across = edgeAt(flat, [0, 1.5, -0.5], [1, 1.5, -0.5]);
    const n = bumpy();
    const N = n.counts.points;
    runOk(
      n,
      op('mesh.cut'),
      null,
      {
        points: [
          { kind: 'edge', edge: a, t: 0.3 },
          { kind: 'edge', edge: seam, t: 0.45 },
          { kind: 'edge', edge: across, t: 0.9 },
        ],
      },
      symmetric(worldX(n), true),
    );
    // One symmetric cut: the kept half (2 points) and the mirror of its first point.
    expect(n.counts.points).toBe(N + 3);
    expect(worldX(n).unmatched).toBe(0);
    expect(asymmetry(n, worldX(n), Q90)).toBeLessThan(1e-6);
    // A chord crossing the world plane inside a face (local z ∈ [−1/3, 1/3]: both ends at local x > 0, so only the
    // world side sees the crossing): clipped and mirrored, one chord from the first point to its mirror image.
    const odd = editMeshFrom(cube(3));
    const near = edgeAt(odd, [0, 1.5, 1 / 3], [1, 1.5, 1 / 3]);
    const far = edgeAt(odd, [0, 1.5, -1 / 3], [1, 1.5, -1 / 3]);
    const c = bumpy(3);
    const C = c.counts.points;
    const crossing = runOk(
      c,
      op('mesh.cut'),
      null,
      {
        points: [
          { kind: 'edge', edge: near, t: 0.25 },
          { kind: 'edge', edge: far, t: 0.9 },
        ],
      },
      symmetric(worldX(c), true),
    );
    expect(c.counts.points).toBe(C + 2);
    expect(crossing.selection.edges.count()).toBe(1);
    expect(worldX(c).unmatched).toBe(0);
    expect(asymmetry(c, worldX(c), Q90)).toBeLessThan(1e-6);
  });
});

// ---------- P10 in World mode on oblique placements ----------

const SYMMETRIC_MESHES = [
  () => primitive('cube', { width: 2, subdivisionsWidth: 2, subdivisionsHeight: 2 }),
  () => primitive('cube', { width: 2, subdivisionsWidth: 4, subdivisionsDepth: 2 }),
  () => primitive('sphere', { subdivisionsAxis: 8, subdivisionsHeight: 6 }),
  () => primitive('cylinder', { subdivisionsAxis: 8, subdivisionsHeight: 3 }),
  () => primitive('torus', {}),
  () => primitive('plane', { width: 4, height: 2, subdivisionsWidth: 4, subdivisionsHeight: 3 }),
];

const P10_OPS: readonly B4OpId[] = [
  'mesh.harden',
  'mesh.soften',
  'mesh.setNormalAngle',
  'mesh.reverse',
  'mesh.triangulate',
  'mesh.quadrangulate',
  'mesh.spinEdge',
  'mesh.flipTriangleEdge',
  'mesh.averageVertices',
  'mesh.slide',
  'mesh.cut',
];

/** The primitive placed so that its world positions are the primitive's own (symmetric in world X): local = P⁻¹·p. */
function placed(data: MeshData, placement: ReadonlyXf): EditMesh {
  const m = editMeshFrom(data);
  const P = mat4Compose(placement);
  // P⁻¹ = diag(1/s)·Rᵀ·(w − t).
  const s = placement.s;
  const out = new Float64Array(3);
  m.begin('place');
  for (let v = 0; v < m.counts.points; v++) {
    const [x, y, z] = position(m, v);
    const w = [x - placement.t[0], y - placement.t[1], z - placement.t[2]];
    // Rᵀ·w through the columns of P (column j = R[:, j]·s_j).
    for (let j = 0; j < 3; j++) {
      const sj = s[j] as number;
      const col = [P[4 * j] as number, P[4 * j + 1] as number, P[4 * j + 2] as number].map((c) => c / sj);
      out[j] = (col[0]! * w[0]! + col[1]! * w[1]! + col[2]! * w[2]!) / sj;
    }
    m.setPosition(v, out[0] as number, out[1] as number, out[2] as number);
  }
  m.end();
  return m;
}

function worldP10(placements: fc.Arbitrary<ReadonlyXf>, ops: readonly B4OpId[], seed: number): number {
  let ran = 0;
  fc.assert(
    fc.property(
      placements,
      fc.integer({ min: 0, max: SYMMETRIC_MESHES.length - 1 }),
      arbOpStep(ops),
      (placement, meshIndex, base) => {
        const m = placed((SYMMETRIC_MESHES[meshIndex] as () => MeshData)(), placement);
        const map = worldX(m, placement);
        expect(map.unmatched).toBe(0);
        const resolved = resolveOpStep(m, { ...base, symmetric: false });
        // A symmetric selection: picks that are not their own mirror image, plus their partners (as in P10).
        let sel = resolved.sel;
        if (sel !== null) {
          const partners = sel.kind === 'vertex' ? map.vertex : sel.kind === 'edge' ? map.edge : map.face;
          const set = sel.kind === 'vertex' ? sel.verts : sel.kind === 'edge' ? sel.edges : sel.faces;
          const picks = Array.from(set.toArray()).filter((i) => (partners[i] as number) >= 0 && partners[i] !== i);
          sel = expand(selectionOf(sel.kind, picks, m.counts), map);
        }
        const ctx = context({
          epsilon: 1e-7,
          placement,
          symmetry: { map, preserveSeam: (base.values[7] ?? 0) % 2 === 0 },
        });
        const run = runOp(m, resolved.op, sel, resolved.args, ctx, { maySoften: true });
        if (isRefusal(run.result)) return;
        ran++;
        const after = worldX(m, placement);
        const worst = asymmetry(m, after, placement);
        expect([resolved.label, worst >= 0 && worst < 2e-6, after.unmatched]).toEqual([resolved.label, true, 0]);
        const unpaired: number[] = [];
        for (let e = 0; e < m.counts.edges; e++) {
          const p = after.edge[e] as number;
          if (p < 0 || (m.edgeFlags(p) & 1) !== (m.edgeFlags(e) & 1)) unpaired.push(e);
        }
        expect([resolved.label, unpaired]).toEqual([resolved.label, []]);
      },
    ),
    { numRuns: 400, seed },
  );
  return ran;
}

describe('P10 in World mode on oblique placements', () => {
  it('rotations, uniform scales and translations (the local mirror is an oblique orthogonal reflection)', () => {
    const similar = fc.record({
      t: arbPlacement.map((p) => p.t),
      q: arbQuat,
      s: evenly(0.5, 2).map((s) => [s, s, s] as const),
    });
    expect(worldP10(similar, P10_OPS, 71)).toBeGreaterThan(150);
  });

  it('signed non-uniform scales (the local mirror is not orthogonal) for the affine-equivariant rows', () => {
    // Set Normal Angle compares dihedral angles in mesh-local space, which a non-uniform scale does not preserve (with
    // or without symmetry); every other row only interpolates, pairs by partners or mirrors chosen diagonals.
    const ops = P10_OPS.filter((id) => id !== 'mesh.setNormalAngle');
    expect(worldP10(arbPlacement, ops, 73)).toBeGreaterThan(150);
  });
});

// ---------- Symmetrize and Mirror's vector layers ----------

describe('Symmetrize and Mirror in World mode', () => {
  it('Symmetrize through a World X map makes the mesh world-symmetric (oblique placement)', () => {
    const placement: ReadonlyXf = { t: [0.3, -0.2, 0.5], q: unitQuat(0.3, 0.5, -0.2, 0.8), s: [1.3, 0.7, -1.1] };
    const m = placed(primitive('sphere', {}), placement);
    const map = worldX(m, placement);
    expect(map.unmatched).toBe(0);
    // Pull two +X vertices off their mirror positions (within the map's tolerance) and a seam vertex off the plane.
    const plus = [...map.vertex.keys()].filter((v) => {
      const p = position(m, v);
      const d = planeDistance(mirrorOf(map, placement), p[0], p[1], p[2]);
      return d > 0.1;
    });
    const seam = [...map.vertex.keys()].find((v) => map.vertex[v] === v) as number;
    m.begin('skew');
    for (const v of [plus[0] as number, plus[1] as number, seam]) {
      const p = position(m, v);
      m.setPosition(v, p[0] + 3e-5, p[1] - 2e-5, p[2] + 4e-5);
    }
    m.end();
    expect(asymmetry(m, map, placement)).toBeGreaterThan(1e-5);
    runOk(
      m,
      op('mesh.symmetrize'),
      null,
      { tolerance: 1e-4 },
      context({ placement, symmetry: { map, preserveSeam: true } }),
    );
    expect(asymmetry(m, worldX(m, placement), placement)).toBeLessThan(1e-6);
    const p = position(m, seam);
    expect(Math.abs(planeDistance(mirrorOf(map, placement), p[0], p[1], p[2]))).toBeLessThan(1e-6);
  });

  it('Mirror in World position reflects morph deltas and custom normals through the world plane', () => {
    // Rotated and non-uniformly scaled: the local reflection is oblique and not orthogonal.
    const placement: ReadonlyXf = { t: [0.2, 0.1, -0.4], q: unitQuat(0.2, 0.6, 0.1, 0.75), s: [1.4, 0.8, 1.2] };
    const m = halfCube();
    m.begin('layers');
    const morph = m.addLayer(morphLayer('Pose'));
    const normals = m.addLayer(BUILTIN_LAYERS.normalCustom);
    for (let v = 0; v < m.counts.points; v++) {
      morph.set(v, 0, 0.1 + 0.01 * v);
      morph.set(v, 1, -0.2);
      morph.set(v, 2, 0.05 * v);
    }
    const n = 1 / Math.sqrt(3);
    for (let c = 0; c < m.counts.corners; c++) {
      normals.set(c, 0, n);
      normals.set(c, 1, n);
      normals.set(c, 2, -n);
    }
    m.end();
    const P0 = m.counts.points;
    const before = m.snapshot();
    runOk(m, op('mesh.mirror'), null, { position: 'world', cutMesh: false, mergeMode: 'none' }, context({ placement }));
    expect(m.counts.points).toBe(2 * P0);
    const P = mat4Compose(placement);
    const delta = new Float64Array(3);
    const source = new Float64Array(3);
    const world = new Float64Array(3);
    const reflected = new Float64Array(3);
    const copyOf = (v: number): number => {
      // The copy of v: the new vertex at its world mirror image (the match also checks the positions).
      transformPoint(
        P,
        before.position[3 * v] as number,
        before.position[3 * v + 1] as number,
        before.position[3 * v + 2] as number,
        world,
      );
      let best = -1;
      let bestD = Number.POSITIVE_INFINITY;
      for (let w = P0; w < m.counts.points; w++) {
        const q = position(m, w);
        transformPoint(P, q[0], q[1], q[2], reflected);
        const d = Math.hypot(reflected[0]! + world[0]!, reflected[1]! - world[1]!, reflected[2]! - world[2]!);
        if (d < bestD) [best, bestD] = [w, d];
      }
      expect(bestD).toBeLessThan(1e-6);
      return best;
    };
    for (let v = 0; v < P0; v++) {
      const w = copyOf(v);
      for (let c = 0; c < 3; c++) {
        source[c] = morph.get(v, c);
        delta[c] = m.layer('morph:Pose')?.get(w, c) as number;
      }
      // World delta of the copy = the source's world delta reflected (world x negated).
      transformVector(P, source[0] as number, source[1] as number, source[2] as number, world);
      transformVector(P, delta[0] as number, delta[1] as number, delta[2] as number, reflected);
      expect(reflected[0]).toBeCloseTo(-(world[0] as number), 6);
      expect(reflected[1]).toBeCloseTo(world[1] as number, 6);
      expect(reflected[2]).toBeCloseTo(world[2] as number, 6);
    }
    // Every copied corner's custom normal (unit length), in world space through the inverse transpose, is the
    // reflected world normal of its source.
    const N = m.layer('normal.custom');
    const toWorld = normalMatrix(P) as Float64Array;
    transformNormal(toWorld, n, n, -n, world);
    for (let c = before.counts.corners; c < m.counts.corners; c++) {
      const value = [N?.get(c, 0) as number, N?.get(c, 1) as number, N?.get(c, 2) as number];
      expect(Math.hypot(...value)).toBeCloseTo(1, 6);
      transformNormal(toWorld, value[0]!, value[1]!, value[2]!, reflected);
      expect(reflected[0]).toBeCloseTo(-(world[0] as number), 6);
      expect(reflected[1]).toBeCloseTo(world[1] as number, 6);
      expect(reflected[2]).toBeCloseTo(world[2] as number, 6);
    }
  });
});

// ---------- B2's World maps (READY.b2) ----------

describe.skipIf(!READY.b2)('World maps of B2 (READY.b2)', () => {
  const b2 = (m: EditMesh, placement: ReadonlyXf): SymmetryMap =>
    buildSymmetryMap(m, { axis: 'x', space: 'world', placement, tolerance: 1e-4 });
  const OBLIQUE: ReadonlyXf = { t: [0.3, -0.2, 0.5], q: unitQuat(0.3, 0.5, -0.2, 0.8), s: [1.3, 0.7, -1.1] };

  it('buildSymmetryMap pairs what the B4 World test map pairs (90° about Y; oblique, non-uniform, mirrored)', () => {
    const cases: [EditMesh, ReadonlyXf][] = [
      [bumpy(), Q90],
      [bumpy(3), Q90],
      [placed(primitive('sphere', {}), OBLIQUE), OBLIQUE],
      [placed(primitive('torus', {}), OBLIQUE), OBLIQUE],
    ];
    for (const [m, placement] of cases) {
      const theirs = b2(m, placement);
      const ours = worldX(m, placement);
      expect(theirs.unmatched).toBe(0);
      expect(Array.from(theirs.vertex)).toEqual(Array.from(ours.vertex));
      expect(Array.from(theirs.edge)).toEqual(Array.from(ours.edge));
      expect(Array.from(theirs.edgeSelf)).toEqual(Array.from(ours.edgeSelf));
      expect(Array.from(theirs.face)).toEqual(Array.from(ours.face));
    }
  });

  it('mirrorEdgePoint on a World map agrees with the B4 pointer rule (t* to rounding)', () => {
    for (const [m, placement] of [
      [bumpy(3), Q90],
      [placed(primitive('cube', { width: 2, subdivisionsWidth: 3 }), OBLIQUE), OBLIQUE],
    ] as [EditMesh, ReadonlyXf][]) {
      const map = b2(m, placement);
      const mirror = mirrorOf(map, placement);
      let crossing = 0;
      for (let e = 0; e < m.counts.edges; e++) {
        if (map.edgeSelf[e] === 1) crossing++;
        for (const t of [0.1, 0.5, 0.73, 0.50001]) {
          const theirs = mirrorEdgePoint(m, map, { edge: e, t });
          const ours = mirrorEdgePointOf(m, mirror, { edge: e, t });
          expect([theirs?.edge, theirs?.self]).toEqual([ours?.edge, ours?.self]);
          expect(Math.abs((theirs?.t ?? 0) - (ours?.t ?? 0))).toBeLessThan(1e-12);
        }
      }
      expect(crossing).toBeGreaterThan(0);
    }
  });

  it('Average, Slide and Multi-Cut on B2 World maps: the same results as on the B4 maps, world-symmetric', () => {
    const flat = editMeshFrom(cube(4));
    const loop: number[] = [];
    for (let e = 0; e < flat.counts.edges; e++) {
      if (position(flat, flat.edgeVert(e, 0))[2] === 0.5 && position(flat, flat.edgeVert(e, 1))[2] === 0.5)
        loop.push(e);
    }
    const v = flat.edgeVert(loop[0] as number, 0);
    const [vx, vy] = position(flat, v);
    const rail = edgeAt(flat, [vx, vy, 0.5], [vx, vy, 1]);
    const a = edgeAt(flat, [0, 1.5, 0.5], [1, 1.5, 0.5]);
    const b = edgeAt(flat, [0, 1.5, 1], [1, 1.5, 1]);
    const runs: [string, (m: EditMesh) => ReturnType<typeof selectionOf> | null, Record<string, unknown>][] = [
      ['mesh.averageVertices', () => null, { iterations: 3, strength: 0.6 }],
      ['mesh.slide', (m) => selectionOf('edge', loop, m.counts), { percent: 0.4, reference: { vertex: v, rail } }],
      [
        'mesh.cut',
        () => null,
        {
          points: [
            { kind: 'edge', edge: a, t: 0.3 },
            { kind: 'edge', edge: b, t: 0.6 },
          ],
        },
      ],
    ];
    for (const [id, sel, args] of runs) {
      for (const preserveSeam of [true, false]) {
        const m = bumpy();
        runOk(m, op(id), sel(m), args as never, symmetric(b2(m, Q90), preserveSeam));
        const ours = bumpy();
        runOk(ours, op(id), sel(ours), args as never, symmetric(worldX(ours), preserveSeam));
        expect([id, maxDifference(m, ours)]).toEqual([id, 0]);
        const after = b2(m, Q90);
        expect([id, after.unmatched]).toEqual([id, 0]);
        expect(asymmetry(m, after, Q90)).toBeLessThan(1e-6);
      }
    }
  });
});
