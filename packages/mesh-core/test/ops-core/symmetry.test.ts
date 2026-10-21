// M6A-SPEC §5.14 for B3's ops (P10 and the goldens of §9 B3): expanded selections, mirror-consistent extrude frames,
// self-mirrored regions and groups, scalar args applying to both halves (on the source side an expand-class op equals
// the plain run of the expanded selection; Connect's weight), Insert Edge Loop decided by the mapped seed point, the
// Target Weld seam table, Bridge's mirrored pair, unmatched partners processed on one side with
// `symmetry.unmatched-partner`. Maps come from the §5.14 definition (`referenceSymmetryMap`); `READY.b2` cross-checks
// B3's helpers against B2's functions.
import type { ParamValues } from '@ekza-studio/anim-core';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  buildSymmetryMap,
  type ComponentKind,
  type EditMesh,
  editMeshFrom,
  expandSelection,
  isRefusal,
  mirrorEdgePoint,
  primitive,
  type SymmetryMap,
  topologyStats,
} from '../../src';
import { expandIndices, Mirror, mirrorPoint } from '../../src/ops/extrude/shared/symmetry';
import { READY } from '../ready';
import {
  combined,
  cylinderData,
  edgeNear,
  edgesAlong,
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
  IDENTITY_XF,
  op,
  position,
  referenceSymmetryMap,
  runChecked,
  runOk,
  runRefused,
  sel,
  symmetryProblems,
  windingProblems,
} from './support';

/** Heavier local runs: B3_PROPERTY_SCALE multiplies the P10 run count (CI runs scale 1). */
const SCALE = Math.max(1, Number(process.env['B3_PROPERTY_SCALE'] ?? '1') || 1);

const symCtx = (m: EditMesh, preserveSeam = true) => ctxOf({ symmetry: referenceSymmetryMap(m, 'x'), preserveSeam });

describe('P10: symmetric input + symmetric args → symmetric output', () => {
  const steps = fc.oneof(
    fc.record({
      id: fc.constant('mesh.extrude'),
      kind: fc.constant('face' as const),
      args: fc.record({
        localTranslateX: fc.double({ min: -0.3, max: 0.3, noNaN: true }),
        localTranslateZ: fc.double({ min: 0.05, max: 0.6, noNaN: true }),
        localRotateY: fc.double({ min: -0.6, max: 0.6, noNaN: true }),
        localScaleX: fc.double({ min: 0.3, max: 1.5, noNaN: true }),
        offset: fc.double({ min: 0, max: 0.1, noNaN: true }),
        thickness: fc.double({ min: 0, max: 0.1, noNaN: true }),
        divisions: fc.integer({ min: 1, max: 2 }),
        keepFacesTogether: fc.boolean(),
        space: fc.constantFrom('local', 'world'),
      }),
    }),
    fc.record({
      id: fc.constant('mesh.inset'),
      kind: fc.constant('face' as const),
      args: fc.record({
        offset: fc.double({ min: 0.02, max: 0.2, noNaN: true }),
        depth: fc.double({ min: -0.1, max: 0.1, noNaN: true }),
        individual: fc.boolean(),
      }),
    }),
    fc.record({
      id: fc.constantFrom('mesh.offsetLoop', 'mesh.collapse', 'mesh.delete', 'mesh.fillHole'),
      kind: fc.constant('edge' as const),
      args: fc.record({ offset: fc.double({ min: 0.05, max: 0.45, noNaN: true }) }),
    }),
    fc.record({
      id: fc.constantFrom('mesh.connect', 'mesh.merge', 'mesh.mergeToCenter', 'mesh.deleteEdgeVertex'),
      kind: fc.constantFrom('vertex' as const, 'edge' as const),
      args: fc.record({
        weight: fc.double({ min: 0.1, max: 0.9, noNaN: true }),
        distance: fc.double({ min: 0, max: 0.4, noNaN: true }),
      }),
    }),
    fc.record({
      id: fc.constant('mesh.insertLoop'),
      kind: fc.constant('edge' as const),
      // 'equal' clamps at short ring edges into coincident points, which the reference map cannot pair: it gets a
      // fixed case below.
      args: fc.record({
        mode: fc.constantFrom('relative', 'multiple'),
        weight: fc.double({ min: 0.05, max: 0.95, noNaN: true }),
        divisions: fc.integer({ min: 1, max: 3 }),
      }),
    }),
  );
  const meshes = fc.oneof(
    fc.constant(() => primitive('cube', { subdivisionsWidth: 2, subdivisionsHeight: 2 })),
    fc.constant(() => primitive('cube', { subdivisionsWidth: 3 })),
    fc.constant(() => primitive('plane', { subdivisionsWidth: 4, subdivisionsHeight: 3 })),
    fc.constant(() => primitive('cylinder', { subdivisionsAxis: 8, subdivisionsHeight: 2 })),
    fc.constant(() => primitive('sphere', { subdivisionsAxis: 8, subdivisionsHeight: 4 })),
  );

  it('every exp/ptr op on symmetric meshes (positions within 1e-6, every vertex partnered); exp ops keep the plain run on the source side', () => {
    let ran = 0;
    let compared = 0;
    fc.assert(
      fc.property(
        meshes,
        steps,
        fc.array(fc.nat({ max: 1_000_000 }), { minLength: 1, maxLength: 3 }),
        (make, step, seeds) => {
          const m = editMeshFrom(make());
          expect(symmetryProblems(m)).toEqual([]);
          const count =
            step.kind === 'vertex' ? m.counts.points : step.kind === 'edge' ? m.counts.edges : m.counts.faces;
          const picks = seeds.map((s) => s % count);
          const ctx = symCtx(m);
          const { result } = runChecked(m, op(step.id), sel(m, step.kind, picks), step.args, ctx);
          if (isRefusal(result)) return;
          ran++;
          const label = `${step.id} ${JSON.stringify(step.args)} on ${picks.join(',')}`;
          expect(symmetryProblems(m), `P10: ${label}`).toEqual([]);
          expect(result.warnings.filter((w) => w.code === 'symmetry.unmatched-partner')).toEqual([]);
          // World-space extrude args move a region that is its own mirror asymmetrically (a world X move, a turn about
          // world Y): its symmetrized result is not the plain run's, so those runs check P10 only.
          if (!SOURCE_SIDE_OPS.has(step.id) || (step.args as { space?: string }).space === 'world') return;
          compared++;
          const map = ctx.symmetry?.map as SymmetryMap;
          const gap = sourceSideGap(editMeshFrom(make()), map, step.id, step.kind, picks, step.args, m);
          expect(gap, `source side: ${label}`).toBeLessThan(SOURCE_SIDE_TOLERANCE);
        },
      ),
      { numRuns: 300 * SCALE },
    );
    expect(ran).toBeGreaterThan(100);
    expect(compared).toBeGreaterThan(50);
  });
});

/**
 * The expand-class ops whose symmetric run is, on the source side, the plain run of the expanded selection (§5.14:
 * "scalar args apply to both halves"). Merge and Merge to Center merge the picks and their partners as separate groups
 * (M6A-B3-22), so a plain run of the expanded set (one group) is not their reference; Insert Edge Loop is pointer-class
 * (its goldens are below).
 */
const SOURCE_SIDE_OPS = new Set([
  'mesh.extrude',
  'mesh.inset',
  'mesh.offsetLoop',
  'mesh.collapse',
  'mesh.delete',
  'mesh.fillHole',
  'mesh.connect',
  'mesh.deleteEdgeVertex',
]);

/** As P10's: positions within 1e-6 (a lost weight or frame moves points by centimetres). */
const SOURCE_SIDE_TOLERANCE = 1e-6;

/**
 * The largest distance between the symmetric result `after` and a plain run (no symmetry) of the expanded selection
 * on `fresh`, a copy of the input, over the vertices of `after` on the positive side of the plane (the §5.14 source
 * side; points snapped onto the plane are left out). Infinity when the plain run refuses or makes other counts.
 */
function sourceSideGap(
  fresh: EditMesh,
  map: SymmetryMap,
  id: string,
  kind: ComponentKind,
  picks: readonly number[],
  args: ParamValues,
  after: EditMesh,
): number {
  const expanded = expandIndices(new Mirror({ map, preserveSeam: true }, IDENTITY_XF), kind, picks).indices;
  const { result } = runChecked(fresh, op(id), sel(fresh, kind, expanded), args, ctxOf());
  if (isRefusal(result) || counts(fresh) !== counts(after)) return Number.POSITIVE_INFINITY;
  let gap = 0;
  for (let v = 0; v < after.counts.points; v++) {
    const p = position(after, v);
    if (p[0] <= 1e-6) continue;
    const q = position(fresh, v);
    gap = Math.max(gap, Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]));
  }
  return gap;
}

describe('Connect under symmetry (§5.14: the weight applies to both halves)', () => {
  /** A cube with a centre loop at x = 0: 12/20/10. */
  const centreLoopCube = () => editMeshFrom(primitive('cube', { subdivisionsWidth: 2 }));
  /** The two vertical edges of a cube's face at `x`. */
  const verticals = (m: EditMesh, x: number): number[] =>
    [0.5, -0.5].map((z) => edgeNear(m, [x, -0.5, z], [x, 0.5, z]));
  const fresh = (m: EditMesh, from: number): [number, number, number][] => {
    const out: [number, number, number][] = [];
    for (let v = from; v < m.counts.points; v++) out.push(position(m, v));
    return out.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  };

  it.each([0.2, 0.8])(
    'weight %s on one side face: the plain run on that side and its mirror on the other, not a loop at 0.5',
    (weight) => {
      const plain = centreLoopCube();
      expect(counts(plain)).toBe('12/20/10');
      runOk(plain, 'mesh.connect', sel(plain, 'edge', verticals(plain, 0.5)), { weight });
      const right = fresh(plain, 12);
      expect(right.map((p) => Math.abs(p[1]))).toEqual([expect.closeTo(0.3, 6), expect.closeTo(0.3, 6)]);
      const left = right
        .map(([x, y, z]): [number, number, number] => [-x, y, z])
        .sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
      for (const x of [0.5, -0.5]) {
        // Picking either side gives the same mesh: the +X group is the source (§5.14 source side).
        const m = centreLoopCube();
        const result = runOk(m, 'mesh.connect', sel(m, 'edge', verticals(m, x)), { weight }, symCtx(m));
        expect(counts(m)).toBe('16/26/12');
        expect(result.resolvedArgs['weight']).toBe(weight);
        expect(result.selection.edges.count()).toBe(2);
        expect(fresh(m, 12)).toEqual([...left, ...right]);
        expect(symmetryProblems(m)).toEqual([]);
      }
    },
  );

  it('one picked edge whose partner shares a face connects: poll and run count the expanded selection', () => {
    const m = cube();
    const edge = edgeNear(m, [0.5, -0.5, 0.5], [0.5, 0.5, 0.5]);
    expect(op('mesh.connect').poll(m, sel(m, 'edge', [edge]), ctxOf())).not.toBe(true);
    runRefused(m, 'mesh.connect', sel(m, 'edge', [edge]), 'connect.no-selection');
    expect(op('mesh.connect').poll(m, sel(m, 'edge', [edge]), symCtx(m))).toBe(true);
    const result = runOk(m, 'mesh.connect', sel(m, 'edge', [edge]), { weight: 0.3 }, symCtx(m));
    // The +Z face holds the edge and its partner: one chord across it, both points at the same height.
    expect(counts(m)).toBe('10/15/7');
    expect(result.selection.edges.count()).toBe(1);
    const [a, b] = fresh(m, 8) as [[number, number, number], [number, number, number]];
    expect(Math.abs(a[1])).toBeCloseTo(0.2, 6);
    expect(b[1]).toBe(a[1]);
    expect(symmetryProblems(m)).toEqual([]);
  });

  it('one picked vertex whose partner shares a face (an 8-sided cap) is joined to it by a chord', () => {
    const m = editMeshFrom(cylinderData());
    const map = referenceSymmetryMap(m, 'x');
    const top = faceToward(m, [0, 1, 0]);
    const v = faceVerts(m, top).find((u) => {
      const p = map.vertex[u] as number;
      return p !== u && p !== -1 && m.findEdge(u, p) === -1;
    }) as number;
    runRefused(m, 'mesh.connect', sel(m, 'vertex', [v]), 'connect.no-selection');
    const before = counts(m);
    runOk(m, 'mesh.connect', sel(m, 'vertex', [v]), {}, symCtx(m));
    expect(before).toBe('16/24/10');
    expect(counts(m)).toBe('16/25/11');
    expect(symmetryProblems(m)).toEqual([]);
  });

  it('property: edges picked in pairs of faces give a symmetric mesh that keeps the plain run on the source side', () => {
    const meshes = fc.oneof(
      fc.constant(() => primitive('cube', { subdivisionsWidth: 2, subdivisionsHeight: 2 })),
      // Crossing edges (the middle column straddles the plane): their points land on the plane.
      fc.constant(() => primitive('cube', { subdivisionsWidth: 3, subdivisionsHeight: 2 })),
      fc.constant(() => primitive('plane', { subdivisionsWidth: 4, subdivisionsHeight: 3 })),
      fc.constant(() => primitive('cylinder', { subdivisionsAxis: 8, subdivisionsHeight: 2 })),
      fc.constant(() => primitive('sphere', { subdivisionsAxis: 8, subdivisionsHeight: 4 })),
    );
    // Each pick: two edges of one face (opposite or neighbours), so most picks link through a face.
    const picks = fc.array(fc.record({ face: fc.nat(1_000_000), corner: fc.nat(7), opposite: fc.boolean() }), {
      minLength: 1,
      maxLength: 3,
    });
    let ran = 0;
    fc.assert(
      fc.property(meshes, picks, fc.double({ min: 0.05, max: 0.95, noNaN: true }), (make, chosen, weight) => {
        const m = editMeshFrom(make());
        const edges = chosen.flatMap(({ face, corner, opposite }) => {
          const vs = faceVerts(m, face % m.counts.faces);
          const n = vs.length;
          const i = corner % n;
          const j = (i + (opposite ? Math.floor(n / 2) : 1)) % n;
          return [i, j].map((k) => m.findEdge(vs[k] as number, vs[(k + 1) % n] as number));
        });
        const ctx = symCtx(m);
        const { result } = runChecked(m, op('mesh.connect'), sel(m, 'edge', edges), { weight }, ctx);
        if (isRefusal(result)) return;
        ran++;
        const label = `weight ${weight} on ${edges.join(',')}`;
        expect(symmetryProblems(m), `P10: ${label}`).toEqual([]);
        const map = ctx.symmetry?.map as SymmetryMap;
        const gap = sourceSideGap(editMeshFrom(make()), map, 'mesh.connect', 'edge', edges, { weight }, m);
        expect(gap, `source side: ${label}`).toBeLessThan(SOURCE_SIDE_TOLERANCE);
      }),
      { numRuns: 200 * SCALE },
    );
    expect(ran).toBeGreaterThan(100);
  });
});

/** Open cylinders: a bottom one without its top cap and a top one (2 m up) without its bottom cap (a neck at x = 0). */
function neckPair(): ReturnType<EditMesh['snapshot']> {
  const a = editMeshFrom(cylinderData());
  const b = editMeshFrom(cylinderData());
  runOk(a, 'mesh.delete', sel(a, 'face', [faceToward(a, [0, 1, 0])]));
  runOk(b, 'mesh.delete', sel(b, 'face', [faceToward(b, [0, -1, 0])]));
  return combined(a.snapshot(), b.snapshot(), [0, 2, 0]);
}

/** The border loops of `m` (border edges joined through shared vertices), each sorted. */
function borderLoops(m: EditMesh): number[][] {
  const border: number[] = [];
  for (let e = 0; e < m.counts.edges; e++) if (m.edgeFaceCount(e) === 1) border.push(e);
  const parent = new Map<number, number>();
  const find = (v: number): number => {
    let r = v;
    while ((parent.get(r) ?? r) !== r) r = parent.get(r) as number;
    return r;
  };
  for (const e of border) {
    const a = find(m.edgeVert(e, 0));
    const b = find(m.edgeVert(e, 1));
    if (a !== b) parent.set(Math.max(a, b), Math.min(a, b));
  }
  const loops = new Map<number, number[]>();
  for (const e of border) {
    const r = find(m.edgeVert(e, 0));
    loops.set(r, [...(loops.get(r) ?? []), e]);
  }
  return [...loops.values()].sort((x, y) => (x[0] as number) - (y[0] as number));
}

describe('P10 for the pointer and border rows: edge extrude, Target Weld, Bridge', () => {
  const meshes = fc.oneof(
    fc.constant(() => primitive('plane', { subdivisionsWidth: 4, subdivisionsHeight: 3 })),
    fc.constant(() => primitive('cube', { subdivisionsWidth: 3, subdivisionsHeight: 2, subdivisionsDepth: 2 })),
    fc.constant(() => openCylinderData()),
    fc.constant(() => neckPair()),
    fc.constant(() => combined(shifted(neckPair(), -2), shifted(neckPair(), 2))),
  );
  const steps = fc.oneof(
    fc.record({
      id: fc.constant('mesh.extrude'),
      kind: fc.constant('edge' as const),
      args: fc.record({
        localTranslateY: fc.double({ min: -0.3, max: 0.5, noNaN: true }),
        localTranslateZ: fc.double({ min: -0.3, max: 0.3, noNaN: true }),
        localScaleX: fc.double({ min: 0.5, max: 1.5, noNaN: true }),
        divisions: fc.integer({ min: 1, max: 2 }),
      }),
    }),
    fc.record({
      id: fc.constant('mesh.targetWeld'),
      kind: fc.constantFrom('vertex' as const, 'edge' as const),
      args: fc.record({ mode: fc.constantFrom('target', 'center') }),
    }),
    fc.record({
      id: fc.constant('mesh.bridge'),
      kind: fc.constantFrom('edge' as const, 'face' as const),
      args: fc.record({
        divisions: fc.integer({ min: 0, max: 2 }),
        twist: fc.integer({ min: -1, max: 1 }),
        taper: fc.double({ min: 0.5, max: 1.5, noNaN: true }),
      }),
    }),
  );

  it('symmetric picks on symmetric meshes give symmetric meshes (positions within 1e-6, every vertex partnered)', () => {
    const ran: Record<string, number> = {};
    fc.assert(
      fc.property(
        meshes,
        steps,
        fc.array(fc.nat({ max: 1_000_000 }), { minLength: 2, maxLength: 4 }),
        (make, step, seeds) => {
          const m = editMeshFrom(make());
          expect(symmetryProblems(m)).toEqual([]);
          // Preserve Seam on (the default): without it a seam source welded off the seam is one weld, one-sided by
          // the seam table (the fixed seam-table case below).
          const ctx = symCtx(m);
          let selection = sel(m, step.kind, []);
          let args: Record<string, unknown> = { ...step.args };
          if (step.id === 'mesh.extrude') {
            // Border edges only (interior edges refuse `extrude.interior-edge`).
            const border = borderLoops(m).flat();
            if (border.length === 0) return;
            selection = sel(
              m,
              'edge',
              seeds.map((x) => border[x % border.length] as number),
            );
          } else if (step.id === 'mesh.targetWeld') {
            const count = step.kind === 'vertex' ? m.counts.points : m.counts.edges;
            const a = (seeds[0] as number) % count;
            const b = (seeds[1] as number) % count;
            if (a === b) return;
            args = { ...args, pairs: [[a, b]] };
          } else if (step.kind === 'edge') {
            // Two whole border loops; a pair that is its own mirror (a neck, or a loop and its mirror image) is one
            // bridge, so a twist would make it chiral: symmetric args there are twist 0.
            const loops = borderLoops(m);
            if (loops.length < 2) return;
            const i = (seeds[0] as number) % loops.length;
            const j = (i + 1 + ((seeds[1] as number) % (loops.length - 1))) % loops.length;
            const pick = [...(loops[i] as number[]), ...(loops[j] as number[])];
            const map = ctx.symmetry?.map;
            const mirrored = pick.map((e) => (map === undefined ? -1 : (map.edge[e] as number)));
            if (mirrored.every((e) => pick.includes(e))) args = { ...args, twist: 0 };
            selection = sel(m, 'edge', pick);
          } else {
            // Two interior faces of one size that touch neither each other nor each other's mirror images.
            const map = ctx.symmetry?.map;
            const partner = (f: number): number => (map === undefined ? -1 : (map.face[f] as number));
            const vertsOf = (f: number): number[] => (f === -1 ? [] : faceVerts(m, f));
            const interior = (f: number): boolean =>
              vertsOf(f).every((v, i, vs) => m.edgeFaceCount(m.findEdge(v, vs[(i + 1) % vs.length] as number)) === 2);
            const a = (seeds[0] as number) % m.counts.faces;
            const near = new Set([...vertsOf(a), ...vertsOf(partner(a))]);
            const candidates: number[] = [];
            for (let f = 0; f < m.counts.faces; f++) {
              if (f === a || vertsOf(f).length !== vertsOf(a).length || !interior(f)) continue;
              if ([...vertsOf(f), ...vertsOf(partner(f))].some((v) => near.has(v))) continue;
              candidates.push(f);
            }
            if (candidates.length === 0 || !interior(a)) return;
            const b = candidates[(seeds[1] as number) % candidates.length] as number;
            selection = sel(m, 'face', [a, b]);
            // A face pair that is its own mirror is one bridge: twist 0, as above.
            if ([a, b].every((f) => [a, b].includes(partner(f)))) args = { ...args, twist: 0 };
          }
          const { result } = runChecked(m, op(step.id), selection, args as never, ctx);
          if (isRefusal(result)) return;
          ran[`${step.id}:${step.kind}`] = (ran[`${step.id}:${step.kind}`] ?? 0) + 1;
          expect(symmetryProblems(m), `${step.id} ${step.kind} ${JSON.stringify(args)}`).toEqual([]);
          expect(result.warnings.filter((w) => w.code === 'symmetry.unmatched-partner')).toEqual([]);
        },
      ),
      // 600 runs (was 300): at 300 the face-pair Bridge ran ≤ 5 times in about one full run in three (found at INT,
      // M6A-INT-16), failing the coverage check below, not the property.
      { numRuns: 600 * SCALE },
    );
    const keys = [
      'mesh.extrude:edge',
      'mesh.targetWeld:vertex',
      'mesh.targetWeld:edge',
      'mesh.bridge:edge',
      'mesh.bridge:face',
    ];
    expect(Object.fromEntries(keys.map((key) => [key, (ran[key] ?? 0) > 5]))).toEqual(
      Object.fromEntries(keys.map((key) => [key, true])),
    );
  });
});

describe('extrude under symmetry (§5.14 extrude row)', () => {
  it('mirrored faces extrude with reflected frames: identical numbers, mirror-image caps', () => {
    const m = cube();
    const right = faceToward(m, [1, 0, 0]);
    const left = faceToward(m, [-1, 0, 0]);
    const result = runOk(
      m,
      'mesh.extrude',
      sel(m, 'face', [right]),
      { localTranslateZ: 0.5, localTranslateY: 0.2, localRotateX: 0.3 },
      symCtx(m),
    );
    expect(counts(m)).toBe('16/28/14');
    const a = faceCentroid(m, right);
    const b = faceCentroid(m, left);
    expect(Math.abs(a[0] + b[0])).toBeLessThan(1e-6);
    expect(Math.abs(a[1] - b[1])).toBeLessThan(1e-6);
    expect(Math.abs(a[2] - b[2])).toBeLessThan(1e-6);
    expect(a[0]).toBeCloseTo(1, 6);
    expect([...result.selection.faces.toArray()]).toEqual([right, left].sort((x, y) => x - y));
    expect(symmetryProblems(m)).toEqual([]);
  });

  it('a self-mirrored region is extruded once with its own frame and symmetrized', () => {
    const m = cube();
    const top = topOf(m);
    runOk(m, 'mesh.extrude', sel(m, 'face', [top]), { localTranslateZ: 0.4, localTranslateY: 0.3 }, symCtx(m));
    expect(counts(m)).toBe('12/20/10');
    // The frame's Y of a top face is +X (§5.8 step 4): the asymmetric part is averaged away.
    expect(faceCentroid(m, top)[0]).toBeCloseTo(0, 9);
    expect(symmetryProblems(m)).toEqual([]);
  });

  it('a face without a partner extrudes on its own side with symmetry.unmatched-partner', () => {
    const m = cube();
    // Break the right side: move one vertex of the +X face off its mirror.
    const v = vertexNear(m, [0.5, 0.5, 0.5]);
    m.begin('nudge');
    const p = position(m, v);
    m.setPosition(v, p[0] + 0.05, p[1], p[2]);
    m.end();
    const right = faceToward(m, [1, 0, 0]);
    const result = runOk(m, 'mesh.extrude', sel(m, 'face', [right]), { localTranslateZ: 0.3 }, symCtx(m));
    expect(counts(m)).toBe('12/20/10');
    expect(result.warnings).toEqual([
      { code: 'symmetry.unmatched-partner', message: 'No mirror partner: applied to one side', count: 1 },
    ]);
  });
});

// M6A-INT-16 (§5.14 merge rows): the runtime expands an 'expand' op's input before the run, so Merge to Center gets the
// picks with their partners. Groups come from the plane, not from which vertices were picked: two end caps (both
// arms) merge into two mirrored poles whether the run gets the pick or the expanded pair; a group that holds its own
// mirror merges once onto the plane.
/** How far the nearest vertex of `m` lies from `p`. */
function distanceToVertex(m: EditMesh, p: readonly [number, number, number]): number {
  const q = position(m, vertexNear(m, p));
  return Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
}

describe('Merge to Center under symmetry with the runtime’s expanded input (M6A-INT-16)', () => {
  function arms(): { readonly m: EditMesh; readonly right: number; readonly left: number } {
    const m = cube();
    runOk(m, 'mesh.extrude', sel(m, 'face', [faceToward(m, [1, 0, 0])]), { localTranslateZ: 0.5 }, symCtx(m));
    return { m, right: faceToward(m, [1, 0, 0]), left: faceToward(m, [-1, 0, 0]) };
  }

  it('the picked cap and the expanded pair both give two mirrored poles', () => {
    for (const picks of [
      (f: { right: number; left: number }) => [f.right],
      (f: { right: number; left: number }) => [f.right, f.left],
    ]) {
      const { m, right, left } = arms();
      expect(counts(m)).toBe('16/28/14');
      const before = [faceCentroid(m, right), faceCentroid(m, left)];
      runOk(m, 'mesh.mergeToCenter', sel(m, 'face', picks({ right, left })), {}, symCtx(m));
      // Each cap's four corners become one vertex: 16 − 6 points.
      expect(counts(m)).toBe('10/20/12');
      const stats = topologyStats(m);
      expect([stats.boundaryLoops, stats.nonManifoldEdges, stats.nonManifoldVerts]).toEqual([0, 0, 0]);
      for (const centre of before) expect(distanceToVertex(m, centre)).toBeLessThan(1e-6);
      expect(symmetryProblems(m)).toEqual([]);
    }
  });

  it('picks that hold their own mirror (a cross-seam pair joined by an edge) merge once, onto the plane', () => {
    const m = cube();
    const v = vertexNear(m, [0.5, 0.5, 0.5]);
    const p = vertexNear(m, [-0.5, 0.5, 0.5]);
    runOk(m, 'mesh.mergeToCenter', sel(m, 'vertex', [v, p]), {}, symCtx(m));
    expect(counts(m)).toBe('7/11/6');
    expect(distanceToVertex(m, [0, 0.5, 0.5])).toBeLessThan(1e-6);
    expect(symmetryProblems(m)).toEqual([]);
  });
});

// M6A-INT-49 (§5.14 merge rows): each side merges separately. The runtime hands Merge the expanded selection, so one
// picked vertex arrives with its mirror; that pair is never "two vertices" for Always Merge for Two. A coincident pair
// (a V-snap on both sides) gets partners from B2's map and merges together with its mirror.
describe('Merge under symmetry: per side, coincident pairs partnered (M6A-INT-49)', () => {
  const b2Ctx = (m: EditMesh) =>
    ctxOf({
      symmetry: buildSymmetryMap(m, { axis: 'x', space: 'object', placement: IDENTITY_XF, tolerance: 0.001 }),
      preserveSeam: true,
    });

  /** A cube with two height spans whose (±0.5, 0, 0.5) vertices are snapped onto (±0.5, 0.5, 0.5). */
  function snapped(): { readonly m: EditMesh; readonly a: number; readonly b: number } {
    const m = editMeshFrom(primitive('cube', { subdivisionsHeight: 2 }));
    m.begin('snap');
    for (const x of [0.5, -0.5]) m.setPosition(vertexNear(m, [x, 0, 0.5]), x, 0.5, 0.5);
    m.end();
    const a = vertexNear(m, [0.5, 0.5, 0.5]);
    const b = [...Array(m.counts.points).keys()].find((v) => {
      const p = position(m, v);
      return v !== a && Math.hypot(p[0] - 0.5, p[1] - 0.5, p[2] - 0.5) < 1e-9;
    }) as number;
    return { m, a, b };
  }

  it.skipIf(!READY.b2)('B2 pairs both coincident vertices of each side (no unmatched)', () => {
    const { m, a, b } = snapped();
    const map = buildSymmetryMap(m, { axis: 'x', space: 'object', placement: IDENTITY_XF, tolerance: 0.001 });
    expect(map.unmatched).toBe(0);
    for (const v of [a, b]) expect(position(m, map.vertex[v] as number)).toEqual([-0.5, 0.5, 0.5]);
    expect(map.vertex[a]).not.toBe(map.vertex[b]);
    // The swap rule keeps the topology: every edge has its mirror.
    expect([...map.edge].filter((e) => e === -1)).toEqual([]);
  });

  it.skipIf(!READY.b2)('one picked vertex (with the runtime’s mirror) is not a merge pair: refused', () => {
    const m = editMeshFrom(primitive('cube', { subdivisionsHeight: 2 }));
    const v = vertexNear(m, [0.5, 0.5, 0.5]);
    const p = vertexNear(m, [-0.5, 0.5, 0.5]);
    runRefused(m, 'mesh.merge', sel(m, 'vertex', [v, p]), 'merge.nothing', { alwaysMergeTwo: true }, b2Ctx(m));
    runRefused(m, 'mesh.merge', sel(m, 'vertex', [v]), 'merge.nothing', { alwaysMergeTwo: true }, b2Ctx(m));
    expect(m.counts.points).toBe(12);
  });

  it.skipIf(!READY.b2)('a coincident pair merges on both sides, picked or expanded', () => {
    for (const expanded of [false, true]) {
      const { m, a, b } = snapped();
      const before = m.counts.points;
      const ctx = b2Ctx(m);
      const map = ctx.symmetry?.map as SymmetryMap;
      const picks = expanded ? [a, b, map.vertex[a] as number, map.vertex[b] as number] : [a, b];
      const result = runOk(m, 'mesh.merge', sel(m, 'vertex', picks), { alwaysMergeTwo: true }, ctx);
      expect(m.counts.points).toBe(before - 2);
      expect(result.warnings.filter((w) => w.code === 'symmetry.unmatched-partner')).toEqual([]);
      const stats = topologyStats(m);
      expect([stats.nonManifoldEdges, stats.nonManifoldVerts]).toEqual([0, 0]);
      expect(symmetryProblems(m)).toEqual([]);
    }
  });
});

describe('Insert Edge Loop under symmetry (§5.14 goldens)', () => {
  it('a symmetric arm pair: two loops, every new vertex partnered', () => {
    // Arms: the ±X faces of a cube extruded 1 m with symmetry.
    const m = cube();
    runOk(m, 'mesh.extrude', sel(m, 'face', [faceToward(m, [1, 0, 0])]), { localTranslateZ: 1 }, symCtx(m));
    expect(counts(m)).toBe('16/28/14');
    // A ring edge of the right arm: an X-direction edge at x > 0.5.
    const seed = edgesAlong(m, 0).find((e) => position(m, m.edgeVert(e, 0))[0] > 0.6) as number;
    runOk(m, 'mesh.insertLoop', sel(m, 'edge', [seed]), { weight: 0.3 }, symCtx(m));
    expect(counts(m)).toBe('24/44/22');
    expect(referenceSymmetryMap(m, 'x').unmatched).toBe(0);
    expect(symmetryProblems(m)).toEqual([]);
  });

  it('a waist ring: one loop, partners for all', () => {
    const m = cube();
    const seed = edgesAlong(m, 1)[0] as number;
    runOk(m, 'mesh.insertLoop', sel(m, 'edge', [seed]), { weight: 0.3 }, symCtx(m));
    expect(counts(m)).toBe('12/20/10');
    expect(referenceSymmetryMap(m, 'x').unmatched).toBe(0);
    expect(symmetryProblems(m)).toEqual([]);
  });

  it('multiple on an X-ring: the mirrored set coincides and is inserted once', () => {
    const m = cube();
    const seed = edgesAlong(m, 0)[0] as number;
    runOk(m, 'mesh.insertLoop', sel(m, 'edge', [seed]), { mode: 'multiple', divisions: 3 }, symCtx(m));
    expect(counts(m)).toBe('20/36/18');
    expect(symmetryProblems(m)).toEqual([]);
  });

  it('equal distance on a waist ring and an X-ring stays symmetric', () => {
    const waist = cube();
    runOk(
      waist,
      'mesh.insertLoop',
      sel(waist, 'edge', [edgesAlong(waist, 1)[0] as number]),
      { mode: 'equal', weight: 0.2 },
      symCtx(waist),
    );
    expect(counts(waist)).toBe('12/20/10');
    expect(symmetryProblems(waist)).toEqual([]);
    const ring = cube();
    runOk(
      ring,
      'mesh.insertLoop',
      sel(ring, 'edge', [edgesAlong(ring, 0)[0] as number]),
      { mode: 'equal', weight: 0.2 },
      symCtx(ring),
    );
    expect(counts(ring)).toBe('16/28/14');
    expect(symmetryProblems(ring)).toEqual([]);
  });

  it('a seed without a partner inserts one loop with the warning', () => {
    const m = cube();
    const v = vertexNear(m, [0.5, 0.5, 0.5]);
    m.begin('nudge');
    m.setPosition(v, 0.55, 0.5, 0.5);
    m.end();
    const seed = edgesAlong(m, 1).find((e) => m.edgeVert(e, 0) === v || m.edgeVert(e, 1) === v) as number;
    const result = runOk(m, 'mesh.insertLoop', sel(m, 'edge', [seed]), { weight: 0.5 }, symCtx(m));
    expect(counts(m)).toBe('12/20/10');
    expect(result.warnings.map((w) => w.code)).toEqual(['symmetry.unmatched-partner']);
  });
});

describe('Target Weld seam table (§5.14)', () => {
  // A 2 × 2 plane in XZ: x ∈ {−0.5, 0, 0.5}; the x = 0 column is the seam.
  const grid = () => editMeshFrom(planeData({ subdivisionsWidth: 2, subdivisionsHeight: 2 }));

  it('s → g off the seam also welds p(s) → p(g)', () => {
    const m = grid();
    const s = vertexNear(m, [0.5, 0, -0.5]);
    const g = vertexNear(m, [0.5, 0, 0]);
    const result = runOk(m, 'mesh.targetWeld', sel(m, 'vertex', []), { pairs: [[s, g]] }, symCtx(m));
    // Each weld collapses one border edge; the two corner quads become triangles.
    expect(counts(m)).toBe('7/10/4');
    expect(result.selection.verts.count()).toBe(2);
    expect(symmetryProblems(m)).toEqual([]);
  });

  it('g on the seam: s and p(s) both weld onto g, which keeps x = 0', () => {
    const m = grid();
    const s = vertexNear(m, [0.5, 0, 0]);
    const g = vertexNear(m, [0, 0, 0]);
    runOk(m, 'mesh.targetWeld', sel(m, 'vertex', []), { pairs: [[s, g]] }, symCtx(m));
    expect(counts(m)).toBe('7/10/4');
    expect(position(m, vertexNear(m, [0, 0, 0]))[0]).toBe(0);
    expect(symmetryProblems(m)).toEqual([]);
  });

  it('g = p(s): both merge to their centre on the plane', () => {
    const m = grid();
    const s = vertexNear(m, [0.5, 0, 0]);
    const g = vertexNear(m, [-0.5, 0, 0]);
    const result = runOk(m, 'mesh.targetWeld', sel(m, 'vertex', []), { pairs: [[s, g]] }, symCtx(m));
    expect(counts(m).split('/')[0]).toBe('8');
    const kept = result.selection.verts.toArray()[0] as number;
    expect(position(m, kept)[0]).toBe(0);
    expect(symmetryProblems(m)).toEqual([]);
  });

  it('s on the seam and g off it: refused with Preserve Seam, one weld without', () => {
    const m = grid();
    const s = vertexNear(m, [0, 0, 0]);
    const g = vertexNear(m, [0.5, 0, 0]);
    runRefused(m, 'mesh.targetWeld', sel(m, 'vertex', []), 'symmetry.seam', { pairs: [[s, g]] }, symCtx(m));
    expect(counts(m)).toBe('9/12/4');
    runOk(m, 'mesh.targetWeld', sel(m, 'vertex', []), { pairs: [[s, g]] }, symCtx(m, false));
    expect(counts(m)).toBe('8/11/4');
  });

  it('an edge weld onto a crossing edge: the chain and the centre pair weld into one point on the plane', () => {
    // Cube 3 × 2 × 2, top centre row x ∈ {±0.5, ±1/6} at z = 0: the edge (0.5 → 1/6) welded onto the crossing edge
    // (1/6 → −1/6) pairs 0.5 → 1/6 (mirrored −0.5 → −1/6) and 1/6 → −1/6 (a mirror pair: its centre). The four
    // vertices share welds, so they become one vertex at (0, 0.5, 0).
    const m = editMeshFrom(primitive('cube', { subdivisionsWidth: 3, subdivisionsHeight: 2, subdivisionsDepth: 2 }));
    const third = 1 / 6;
    const source = edgeNear(m, [0.5, 0.5, 0], [third, 0.5, 0]);
    const target = edgeNear(m, [third, 0.5, 0], [-third, 0.5, 0]);
    const before = m.counts.points;
    const result = runOk(m, 'mesh.targetWeld', sel(m, 'edge', []), { pairs: [[source, target]] }, symCtx(m));
    expect(m.counts.points).toBe(before - 3);
    expect(symmetryProblems(m)).toEqual([]);
    const kept = result.selection.verts.toArray();
    expect(kept.length).toBe(1);
    expect(position(m, kept[0] as number).map((x) => Math.round(x * 1e9) / 1e9)).toEqual([0, 0.5, 0]);
  });

  it('an unpaired weld welds once with symmetry.unmatched-partner (count 1)', () => {
    const m = grid();
    const s = vertexNear(m, [0.5, 0, -0.5]);
    m.begin('nudge');
    m.setPosition(s, 0.5, 0, -0.45);
    m.end();
    const g = vertexNear(m, [0.5, 0, 0]);
    const result = runOk(m, 'mesh.targetWeld', sel(m, 'vertex', []), { pairs: [[s, g]] }, symCtx(m));
    expect(counts(m)).toBe('8/11/4');
    expect(result.warnings).toEqual([
      { code: 'symmetry.unmatched-partner', message: 'No mirror partner: applied to one side', count: 1 },
    ]);
  });
});

describe('Bridge under symmetry (§5.14 bridge row)', () => {
  /** Open cylinders: a bottom one without its top cap and a top one (2 m up) without its bottom cap. */
  const pair = () => {
    const a = editMeshFrom(cylinderData());
    const b = editMeshFrom(cylinderData());
    runOk(a, 'mesh.delete', sel(a, 'face', [faceToward(a, [0, 1, 0])]));
    runOk(b, 'mesh.delete', sel(b, 'face', [faceToward(b, [0, -1, 0])]));
    return combined(a.snapshot(), b.snapshot(), [0, 2, 0]);
  };

  it('the picked pair and its mirrored pair are bridged (mirror-exact rings)', () => {
    const left = pair();
    // The pair at x = −2 and its mirror at x = +2.
    const m = editMeshFrom(combined(shifted(left, -2), shifted(left, 2)));
    expect(counts(m)).toBe('64/96/36');
    const border: number[] = [];
    for (let e = 0; e < m.counts.edges; e++) {
      if (m.edgeFaceCount(e) === 1 && position(m, m.edgeVert(e, 0))[0] < 0) border.push(e);
    }
    expect(border.length).toBe(16);
    const result = runOk(m, 'mesh.bridge', sel(m, 'edge', border), { divisions: 1, twist: 1 }, symCtx(m));
    expect(counts(m)).toBe('80/144/68');
    expect(result.selection.faces.count()).toBe(32);
    expect(symmetryProblems(m)).toEqual([]);
    expect(windingProblems(m)).toEqual([]);
  });

  it('a pair that is its own mirror (a neck at x = 0) bridges once', () => {
    const m = editMeshFrom(pair());
    const border: number[] = [];
    for (let e = 0; e < m.counts.edges; e++) if (m.edgeFaceCount(e) === 1) border.push(e);
    runOk(m, 'mesh.bridge', sel(m, 'edge', border), { divisions: 2 }, symCtx(m));
    expect(counts(m)).toBe('48/88/42');
    expect(symmetryProblems(m)).toEqual([]);
  });
});

/** `data` moved by dx in X. */
function shifted(data: ReturnType<EditMesh['snapshot']>, dx: number): ReturnType<EditMesh['snapshot']> {
  const m = editMeshFrom(data);
  m.begin('shift');
  for (let v = 0; v < m.counts.points; v++) {
    const p = position(m, v);
    m.setPosition(v, p[0] + dx, p[1], p[2]);
  }
  m.end();
  return m.snapshot();
}

describe.skipIf(!READY.b2)('B3 helpers agree with B2 (READY.b2)', () => {
  it('the reference maps of these tests equal buildSymmetryMap (Object X, 1 mm) on symmetric and broken meshes', () => {
    const extruded = () => {
      const m = cube();
      runOk(m, 'mesh.extrude', sel(m, 'face', [faceToward(m, [1, 0, 0])]), { localTranslateZ: 0.6 }, symCtx(m));
      runOk(m, 'mesh.insertLoop', sel(m, 'edge', [edgesAlong(m, 0)[0] as number]), { weight: 0.3 }, symCtx(m));
      return m;
    };
    const makers = [
      () => cube(),
      () => editMeshFrom(primitive('cube', { subdivisionsWidth: 2, subdivisionsHeight: 2 })),
      () => editMeshFrom(primitive('cylinder', { subdivisionsAxis: 8, subdivisionsHeight: 2 })),
      () => editMeshFrom(primitive('sphere', { subdivisionsAxis: 8, subdivisionsHeight: 4 })),
      () => editMeshFrom(planeData({ subdivisionsWidth: 3, subdivisionsHeight: 2 })),
      extruded,
      () => {
        // One vertex nudged off its mirror: unmatched vertices, edges and faces.
        const m = cube();
        const v = vertexNear(m, [0.5, 0.5, 0.5]);
        const p = position(m, v);
        m.begin('nudge');
        m.setPosition(v, p[0] + 0.05, p[1], p[2]);
        m.end();
        return m;
      },
    ];
    for (const make of makers) {
      const m = make();
      const ours = referenceSymmetryMap(m, 'x');
      const theirs = buildSymmetryMap(m, { axis: 'x', space: 'object', placement: IDENTITY_XF, tolerance: 0.001 });
      expect({
        vertex: [...theirs.vertex],
        edge: [...theirs.edge],
        edgeReversed: [...theirs.edgeReversed],
        edgeSelf: [...theirs.edgeSelf],
        face: [...theirs.face],
        unmatched: theirs.unmatched,
      }).toEqual({
        vertex: [...ours.vertex],
        edge: [...ours.edge],
        edgeReversed: [...ours.edgeReversed],
        edgeSelf: [...ours.edgeSelf],
        face: [...ours.face],
        unmatched: ours.unmatched,
      });
    }
  });

  it('expandIndices and mirrorPoint follow expandSelection and mirrorEdgePoint', () => {
    for (const make of [() => cube(), () => editMeshFrom(planeData({ subdivisionsWidth: 3, subdivisionsHeight: 2 }))]) {
      const m = make();
      const map = referenceSymmetryMap(m, 'x');
      const mirror = new Mirror({ map, preserveSeam: true }, IDENTITY_XF);
      for (let e = 0; e < m.counts.edges; e++) {
        const ours = expandIndices(mirror, 'edge', [e]).indices;
        const theirs = [...expandSelection(sel(m, 'edge', [e]), map).edges.toArray()];
        expect(ours).toEqual(theirs);
        for (const t of [0, 0.3, 0.5, 0.9])
          expect(mirrorPoint(m, mirror, { edge: e, t })).toEqual(mirrorEdgePoint(m, map, { edge: e, t }));
      }
    }
  });
});
