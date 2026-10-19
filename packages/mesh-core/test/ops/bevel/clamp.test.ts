// The bevel's clamp property beyond boxes (M6A-SPEC §9 B5 "no inverted faces and no coincident points for any fraction
// in 0…1"; fix round 2): at acute and triangle corners the miter points of a face pass each other while its Newell
// normal survives (the shrunk face comes out rotated by 180°, every strip along it a bow-tie), and a clamp that stops
// exactly at the boundary leaves a zero-area face. The oracle (twist.ts) compares each result with a reference run at
// a tiny width: no face flips, no quad twists, no n-gon starts crossing itself, no edge reverses, and Mesh Check
// reports no zero-area face or zero-length edge. Every run goes through the op harness (P1, P5, P8).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  checkMesh,
  editMeshFrom,
  isRefusal,
  type MeshData,
  MESH_OPS,
  type MeshOp,
  type OpResult,
  primitive,
  selectionOf,
} from '../../../src';
import { arbPrimitive, buildMeshData } from '../../../src/testing';
import { at, ctxOf, faceVerts, minVertexGap, runChecked } from './harness';
import { referenceRun, twistProblems } from './twist';

const bevel = MESH_OPS['mesh.bevel'] as MeshOp;

/** A prism (z = 0 … h) over the triangle (0, 0), (a, 0), (b·cos t, b·sin t): bottom cap, top cap, then the sides. */
function triPrism(a: number, t: number, b: number, h: number): MeshData {
  const pts: [number, number][] = [
    [0, 0],
    [a, 0],
    [b * Math.cos(t), b * Math.sin(t)],
  ];
  return buildMeshData({
    positions: [...pts.flatMap(([x, y]) => [x, y, 0]), ...pts.flatMap(([x, y]) => [x, y, h])],
    faces: [
      [2, 1, 0],
      [3, 4, 5],
      [0, 1, 4, 3],
      [1, 2, 5, 4],
      [2, 0, 3, 5],
    ],
  });
}

const equilateral = (): MeshData => triPrism(1, Math.PI / 3, 1, 1);
/** The octahedron: a sphere with four axis and two height subdivisions. */
const octahedron = (): MeshData => primitive('sphere', { subdivisionsAxis: 4, subdivisionsHeight: 2 });

type Args = Record<string, number | boolean>;

/** Bevels `ids` of a fresh copy of `data` through the harness: the result, its warnings and its twist problems. */
function bevelled(data: MeshData, kind: 'edge' | 'face', ids: readonly number[], args: Args) {
  const m = editMeshFrom(data);
  const sel = selectionOf(kind, ids, m.counts);
  const { result } = runChecked(bevel, m, sel, args);
  if (isRefusal(result)) throw new Error(`refused: ${result.code} ${result.reason}`);
  const ref = referenceRun(bevel, data, sel, args);
  if (ref === null) throw new Error('every reference width refused');
  return { m, warnings: (result as OpResult).warnings.map((w) => w.code), problems: twistProblems(m, ref) };
}

describe('clamp: acute and triangle corners (fix round 2 repros)', () => {
  it('equilateral prism, the top cap in face mode at fraction 0.8: clamped, the shrunk cap not rotated', () => {
    const { m, warnings, problems } = bevelled(equilateral(), 'face', [1], { fraction: 0.8 });
    expect(warnings).toContain('bevel.clamped');
    expect(problems).toEqual([]);
    // Each corner of the shrunk cap points from the cap's centre towards an original corner (a cap rotated by 180°
    // points at the edge midpoints, 60° off).
    const cap = faceVerts(m, 1).map((v) => at(m, v));
    expect(cap).toHaveLength(3);
    const centre = [0.5, Math.sqrt(3) / 6];
    const corners = [
      [0, 0],
      [1, 0],
      [0.5, Math.sqrt(3) / 2],
    ];
    for (const p of cap) {
      const dx = p[0] - (centre[0] as number);
      const dy = p[1] - (centre[1] as number);
      const best = Math.max(
        ...corners.map(([x, y]) => {
          const ex = (x as number) - (centre[0] as number);
          const ey = (y as number) - (centre[1] as number);
          return (dx * ex + dy * ey) / (Math.hypot(dx, dy) * Math.hypot(ex, ey));
        }),
      );
      expect(best).toBeGreaterThan(Math.cos((5 * Math.PI) / 180));
      expect(p[2]).toBeCloseTo(1, 6);
    }
  });

  it.each([
    ['the triangle at a sphere pole (7 × 4, face mode, fraction 0.8)', 'face', [23], { fraction: 0.8 }],
    ['four octahedron edges at fraction 0.7', 'edge', [4, 3, 2, 5], { fraction: 0.7 }],
    [
      'four octahedron edges, a two-segment flat profile at fraction 0.774',
      'edge',
      [4, 3, 2, 5],
      { fraction: 0.774, segments: 2, chamfer: false, roundness: 0 },
    ],
    ['two faces of a three-sided cone, two segments at fraction 0.84', 'face', [3, 0], { fraction: 0.84, segments: 2 }],
  ] as const)('%s: no twisted, flipped or zero-area face', (name, kind, ids, args) => {
    const data = name.includes('sphere')
      ? primitive('sphere', { subdivisionsAxis: 7, subdivisionsHeight: 4 })
      : name.includes('cone')
        ? primitive('cone', { subdivisionsAxis: 3, subdivisionsHeight: 2 })
        : octahedron();
    const { m, problems } = bevelled(data, kind, ids, args);
    expect(problems).toEqual([]);
    expect(checkMesh(m).filter((p) => p.code === 'zero-area-face' || p.code === 'zero-length-edge')).toEqual([]);
  });

  it('a sliver corner (1.3°) refuses a width too thin to resolve and bevels a wider one cleanly', () => {
    const data = triPrism(0.2, 2.9, 1.856881072635707, 0.1);
    const all = (n: number): number[] => Array.from({ length: n }, (_, e) => e);
    const thin = editMeshFrom(data);
    const { result } = runChecked(bevel, thin, selectionOf('edge', all(thin.counts.edges), thin.counts), {
      fraction: 0.01,
      segments: 3,
    });
    // At 0.01 the corner fan's triangles are under ε thick: no width fits, the op says so instead of leaving them.
    expect(isRefusal(result) ? result.code : 'ran').toBe('bevel.zero-width');
    const { m, problems } = bevelled(data, 'edge', all(thin.counts.edges), { fraction: 1, segments: 3 });
    expect(problems).toEqual([]);
    expect(minVertexGap(m)).toBeGreaterThan(ctxOf(m).epsilon);
  });
});

describe('clamp property on every primitive and on triangular prisms', () => {
  it('no flipped, twisted, crossing or zero-area face and no coincident points for any fraction in (0, 1]', () => {
    let ran = 0;
    const arbMesh = fc.oneof(
      arbPrimitive().map(({ kind, params }) => primitive(kind, params)),
      fc
        .record({
          a: fc.double({ min: 0.2, max: 2, noNaN: true }),
          t: fc.double({ min: 0.15, max: 2.9, noNaN: true }),
          b: fc.double({ min: 0.2, max: 2, noNaN: true }),
          h: fc.double({ min: 0.1, max: 2, noNaN: true }),
        })
        .map(({ a, t, b, h }) => triPrism(a, t, b, h)),
      fc.constant(octahedron()),
    );
    fc.assert(
      fc.property(
        arbMesh,
        fc.array(fc.nat(), { minLength: 1, maxLength: 12 }),
        fc.record({
          fraction: fc.double({ min: 0.01, max: 1, noNaN: true }),
          segments: fc.integer({ min: 1, max: 3 }),
          chamfer: fc.boolean(),
          roundness: fc.double({ min: 0, max: 1, noNaN: true }),
        }),
        fc.boolean(),
        (data, seeds, args, faceMode) => {
          const m = editMeshFrom(data);
          const n = faceMode ? m.counts.faces : m.counts.edges;
          const sel = selectionOf(
            faceMode ? 'face' : 'edge',
            seeds.map((s) => s % n),
            m.counts,
          );
          const ctx = ctxOf(m);
          const { result } = runChecked(bevel, m, sel, args, ctx);
          if (isRefusal(result)) {
            // Open primitives (plane, capless cylinder and cone) have border edges; a width no corner has room for
            // refuses.
            expect(result.code).toMatch(/^bevel\.(border-edge|zero-width)$/);
            return;
          }
          ran++;
          expect(minVertexGap(m)).toBeGreaterThan(ctx.epsilon);
          // When every smaller width refuses (slivers), the result is its own reference: the absolute checks remain.
          const ref = referenceRun(bevel, data, sel, args) ?? m;
          // Roundness above 0.5 puts the profile beyond the corner, where strips meeting there cross (M6A-B5-15).
          const strict = args.chamfer || args.segments === 1 || args.roundness <= 0.5;
          expect(twistProblems(m, ref, strict)).toEqual([]);
        },
      ),
      { numRuns: 600, seed: 17 },
    );
    expect(ran).toBeGreaterThan(400);
  });
});
