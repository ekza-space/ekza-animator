// P10 for mesh.bevel (M6A-SPEC §5.14, §5.29): a symmetric mesh with a symmetric (or one-sided, expanded) edge or face
// selection yields a symmetric mesh — positions mirrored within 1e-6 m, a partner for every new vertex and face — and
// the unmatched-partner rule; on a mesh symmetric only within tolerance, a region that is its own mirror is
// symmetrized. Runs on the test stand-in map before B2 lands and on B2's real map behind READY.b2.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  buildSymmetryMap,
  type EditMesh,
  editMeshFrom,
  isRefusal,
  MESH_OPS,
  type MeshOp,
  primitive,
  selectionOf,
  type SymmetryMap,
} from '../../../src';
import { buildMeshData, diffStored } from '../../../src/testing';
import { at, ctxOf, edgeBetween, runChecked, runOk } from './harness';
import { READY } from './ready';
import { standInSymmetryMap } from './symmetry-map';

const bevel = MESH_OPS['mesh.bevel'] as MeshOp;
const IDENTITY = { t: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] } as const;

type MapBuilder = (m: EditMesh) => SymmetryMap;
const standIn: MapBuilder = (m) => standInSymmetryMap(m, 'x');
const real: MapBuilder = (m) =>
  buildSymmetryMap(m, { axis: 'x', space: 'object', placement: IDENTITY, tolerance: 1e-4 });

/** The largest distance between a vertex mirrored across x = 0 and its partner; Infinity when one has none. */
function mirrorError(m: EditMesh, map: SymmetryMap): number {
  let worst = 0;
  for (let v = 0; v < m.counts.points; v++) {
    const p = map.vertex[v] as number;
    if (p < 0) return Infinity;
    const a = at(m, v);
    const b = at(m, p);
    worst = Math.max(worst, Math.hypot(a[0] + b[0], a[1] - b[1], a[2] - b[2]));
  }
  return worst;
}

const unpairedFaces = (map: SymmetryMap): number => map.face.filter((f) => f < 0).length;

/** Symmetric primitives (their stand-in map pairs every vertex) with a few subdivision choices. */
const arbSymmetric = fc.oneof(
  fc.record({
    kind: fc.constant('cube' as const),
    params: fc.record({
      subdivisionsWidth: fc.integer({ min: 1, max: 3 }),
      subdivisionsHeight: fc.integer({ min: 1, max: 2 }),
      subdivisionsDepth: fc.integer({ min: 1, max: 2 }),
    }),
  }),
  fc.record({ kind: fc.constant('cylinder' as const), params: fc.constant({}) }),
  fc.record({ kind: fc.constant('sphere' as const), params: fc.constant({}) }),
  fc.record({ kind: fc.constant('torus' as const), params: fc.constant({}) }),
  fc.record({ kind: fc.constant('cone' as const), params: fc.constant({}) }),
);

function p10(build: MapBuilder, numRuns: number, seed: number): number {
  let ran = 0;
  fc.assert(
    fc.property(
      arbSymmetric,
      fc.array(fc.nat(), { minLength: 1, maxLength: 6 }),
      fc.boolean(),
      fc.record({
        fraction: fc.double({ min: 0.05, max: 1, noNaN: true }),
        segments: fc.integer({ min: 1, max: 3 }),
        chamfer: fc.boolean(),
      }),
      ({ kind, params }, seeds, faceMode, args) => {
        const m = editMeshFrom(primitive(kind, params));
        const map = build(m);
        expect(map.unmatched).toBe(0);
        const n = faceMode ? m.counts.faces : m.counts.edges;
        const sel = selectionOf(
          faceMode ? 'face' : 'edge',
          seeds.map((s) => s % n),
          m.counts,
        );
        const ctx = ctxOf(m, { symmetry: { map, preserveSeam: true } });
        const { result } = runChecked(bevel, m, sel, args, ctx);
        expect(isRefusal(result) ? result.code : 'ran').toBe('ran');
        if (isRefusal(result)) return;
        ran++;
        expect(result.warnings.map((w) => w.code)).not.toContain('symmetry.unmatched-partner');
        const after = build(m);
        expect(after.unmatched).toBe(0);
        expect(unpairedFaces(after)).toBe(0);
        expect(mirrorError(m, after)).toBeLessThanOrEqual(1e-6);
      },
    ),
    { numRuns, seed },
  );
  return ran;
}

describe('P10: symmetric bevel (stand-in partner map)', () => {
  it('symmetric primitives and selections give symmetric results with partners for every new vertex', () => {
    expect(p10(standIn, 120, 10)).toBe(120);
  });

  it('a one-sided selection runs on the expanded selection: the same mesh as selecting both sides', () => {
    for (const [args, faceMode] of [
      [{}, false],
      [{ segments: 2, chamfer: false }, false],
      [{ fraction: 0.8, segments: 3 }, true],
    ] as const) {
      const a = editMeshFrom(primitive('cube', { subdivisionsWidth: 2, subdivisionsHeight: 2 }));
      const b = editMeshFrom(primitive('cube', { subdivisionsWidth: 2, subdivisionsHeight: 2 }));
      const map = standIn(a);
      // Everything on the +X side (centroid x > 0) of the chosen kind, one element out of three.
      const kind = faceMode ? 'face' : 'edge';
      const count = faceMode ? a.counts.faces : a.counts.edges;
      const centroidX = (i: number): number => {
        if (!faceMode) return (at(a, a.edgeVert(i, 0))[0] + at(a, a.edgeVert(i, 1))[0]) / 2;
        let x = 0;
        const start = a.faceCorner(i);
        let c = start;
        do {
          x += at(a, a.cornerVert(c))[0] / a.faceLen(i);
          c = a.cornerNext(c);
        } while (c !== start);
        return x;
      };
      const oneSide = Array.from({ length: count }, (_, i) => i).filter((i) => centroidX(i) > 1e-6 && i % 3 === 0);
      expect(oneSide.length).toBeGreaterThan(0);
      const partners = map[kind === 'face' ? 'face' : 'edge'];
      const both = [...new Set([...oneSide, ...oneSide.map((i) => partners[i] as number)])];
      const withSymmetry = runOk(
        bevel,
        a,
        selectionOf(kind, oneSide, a.counts),
        args,
        ctxOf(a, { symmetry: { map, preserveSeam: true } }),
      );
      const plain = runOk(bevel, b, selectionOf(kind, both, b.counts), args);
      // The same mesh: every array bit-identical but the positions, which may differ by float noise (≤ 1e-12 m)
      // where a region that is its own mirror was symmetrized (§5.14: seam points land exactly on the plane).
      const sb = b.snapshot();
      let noise = 0;
      for (let i = 0; i < sb.position.length; i++) {
        noise = Math.max(noise, Math.abs((a.position[i] as number) - (sb.position[i] as number)));
      }
      expect(noise).toBeLessThanOrEqual(1e-12);
      expect(diffStored(a, { ...sb, position: Float32Array.from(a.position) })).toBeNull();
      expect(withSymmetry.selection.faces.toArray()).toEqual(plain.selection.faces.toArray());
      expect(mirrorError(a, standIn(a))).toBeLessThanOrEqual(1e-6);
    }
  });

  it('a centre-line edge and an edge crossing the plane bevel once, seam vertices stay on the plane', () => {
    const m = editMeshFrom(primitive('cube', { subdivisionsWidth: 2 }));
    const inSeam = edgeBetween(m, [0, 0.5, -0.5], [0, 0.5, 0.5]);
    const crossing = edgeBetween(m, [-0.5, -0.5, 0.5], [0, -0.5, 0.5]);
    expect(inSeam).not.toBe(-1);
    expect(crossing).not.toBe(-1);
    const map = standIn(m);
    const result = runOk(
      bevel,
      m,
      selectionOf('edge', [inSeam, crossing], m.counts),
      { segments: 2 },
      ctxOf(m, { symmetry: { map, preserveSeam: true } }),
    );
    expect(result.warnings).toEqual([]);
    const after = standIn(m);
    expect(after.unmatched).toBe(0);
    expect(mirrorError(m, after)).toBeLessThanOrEqual(1e-6);
    // Every vertex that is its own partner lies exactly on x = 0.
    const seam = Array.from({ length: m.counts.points }, (_, v) => v).filter((v) => after.vertex[v] === v);
    expect(seam.length).toBeGreaterThan(0);
    expect(Math.max(...seam.map((v) => Math.abs(at(m, v)[0])))).toBeLessThanOrEqual(1e-7);
  });

  it('on a mesh symmetric only within tolerance, a region that is its own mirror comes out exactly symmetric', () => {
    // A subdivided cube with every vertex moved by up to 2e-5 m: the stand-in map (1e-4) still pairs all of them.
    const data = primitive('cube', { subdivisionsWidth: 2 });
    const position = Float32Array.from(data.position, (x, i) => x + 2e-5 * Math.sin(12.9898 * (i + 1)));
    const original = Array.from({ length: data.counts.points }, (_, v) => [...position.subarray(3 * v, 3 * v + 3)]);
    /** Vertices the bevel made (not at an original position). */
    const created = (m: EditMesh): number[] =>
      Array.from({ length: m.counts.points }, (_, v) => v).filter(
        (v) => !original.some((q) => Math.hypot(...at(m, v).map((x, k) => x - (q[k] as number))) <= 1e-9),
      );
    /** The largest distance from a created vertex's mirror image to the nearest created vertex. */
    const asymmetry = (m: EditMesh): number => {
      const list = created(m);
      return Math.max(
        ...list.map((v) => {
          const [x, y, z] = at(m, v);
          return Math.min(...list.map((w) => Math.hypot(at(m, w)[0] + x, at(m, w)[1] - y, at(m, w)[2] - z)));
        }),
      );
    };
    const run = (pick: (m: EditMesh) => number[]): EditMesh => {
      const m = editMeshFrom({ ...data, position });
      const map = standIn(m);
      expect(map.unmatched).toBe(0);
      runOk(
        bevel,
        m,
        selectionOf('edge', pick(m), m.counts),
        { segments: 2 },
        ctxOf(m, { symmetry: { map, preserveSeam: true } }),
      );
      return m;
    };
    // The top-front edge, both halves: one region across the seam, its own mirror.
    const across = run((m) => [
      edgeBetween(m, [-0.5, 0.5, 0.5], [0, 0.5, 0.5], 1e-4),
      edgeBetween(m, [0, 0.5, 0.5], [0.5, 0.5, 0.5], 1e-4),
    ]);
    expect(created(across).length).toBeGreaterThan(0);
    expect(asymmetry(across)).toBeLessThanOrEqual(1e-7);
    const seam = created(across).filter((v) => Math.abs(at(across, v)[0]) <= 1e-4);
    expect(seam.length).toBeGreaterThan(0);
    for (const v of seam) expect(at(across, v)[0]).toBe(0);
    // The left and right top edges: two regions, each the other's mirror. Each is bevelled from its own geometry,
    // so the input's asymmetry stays (nothing is averaged across regions).
    const apart = run((m) => [
      edgeBetween(m, [-0.5, 0.5, 0.5], [-0.5, 0.5, -0.5], 1e-4),
      edgeBetween(m, [0.5, 0.5, 0.5], [0.5, 0.5, -0.5], 1e-4),
    ]);
    expect(asymmetry(apart)).toBeGreaterThan(1e-7);
    expect(asymmetry(apart)).toBeLessThanOrEqual(1e-4);
  });

  it('an edge without a partner is bevelled on its own side with symmetry.unmatched-partner', () => {
    // A cube whose +X top-front corner is pulled out: the edges at it have no mirror partner.
    const positions = [
      -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.6, 0.5, 0.5, -0.5, 0.5, 0.5, -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5,
      -0.5, 0.5, -0.5,
    ];
    const faces = [
      [0, 1, 2, 3],
      [3, 2, 6, 7],
      [7, 6, 5, 4],
      [4, 5, 1, 0],
      [1, 5, 6, 2],
      [4, 0, 3, 7],
    ];
    const m = editMeshFrom(buildMeshData({ positions, faces, edgeFlags: 1 }));
    const map = standIn(m);
    const lonely = m.findEdge(1, 2);
    const paired = m.findEdge(4, 7);
    expect(map.edge[lonely]).toBe(-1);
    expect(map.edge[paired]).not.toBe(-1);
    const sel = selectionOf('edge', [lonely, paired], m.counts);
    const result = runOk(bevel, m, sel, {}, ctxOf(m, { symmetry: { map, preserveSeam: true } }));
    const warning = result.warnings.find((w) => w.code === 'symmetry.unmatched-partner');
    expect(warning?.count).toBe(1);
    expect(Array.from(warning?.elements ?? [])).toEqual([lonely]);
    expect(warning?.message).toBe('No mirror partner: applied to one side');
    // The lonely edge alone plus the paired edge and its partner: three strips.
    expect(result.selection.faces.count()).toBe(3);
  });
});

describe.skipIf(!READY.b2)('P10: symmetric bevel (B2 partner maps)', () => {
  it('symmetric primitives and selections give symmetric results with partners for every new vertex', () => {
    expect(p10(real, 60, 12)).toBe(60);
  });

  it('the stand-in map agrees with B2’s on the symmetric primitives', () => {
    for (const kind of ['cube', 'cylinder', 'sphere', 'torus', 'cone'] as const) {
      const m = editMeshFrom(primitive(kind, kind === 'cube' ? { subdivisionsWidth: 2 } : {}));
      const a = standIn(m);
      const b = real(m);
      expect(Array.from(a.vertex), `${kind}`).toEqual(Array.from(b.vertex));
      expect(Array.from(a.edge), `${kind}`).toEqual(Array.from(b.edge));
      expect(Array.from(a.face), `${kind}`).toEqual(Array.from(b.face));
    }
  });
});
