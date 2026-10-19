// The kernel gates of M6A-SPEC §5.29 on every B4 op (Node run; properties.browser.test.ts repeats the core ones in
// Chromium):
// - P1 validity, P5 exact undo/redo (also on rebuilt runtimes), P8 incremental revisions and P7-hard — through the B4
//   harness on random op sequences over random primitives and polygon soups (model-based: each step resolves against
//   the current mesh);
// - P2 Euler characteristic unchanged by the topology ops that preserve it;
// - P3 closed 2-manifold in → closed 2-manifold out and P4 orientation (opposite traversal, positive volume) for the
//   manifold-preserving ops;
// - P7 propagation: edges cut inside a face are never attribute seams;
// - P10 symmetric tools: a symmetric mesh, selection and args give a symmetric mesh with a partner for every vertex.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  type EditMesh,
  editMeshFrom,
  isRefusal,
  MESH_OPS,
  type MeshOp,
  primitive,
  selectionOf,
  topologyStats,
  triangulate,
} from '../../src';
import { arbPrimitive, arbSoup } from '../../src/testing';
import { context, runOp } from './harness';
import { arbOpStep, type B4OpId, resolveOpStep } from './steps';
import { asymmetry, expand, testSymmetryMap } from './symmetry-fixture';

const SOFTENING = new Set(['mesh.soften', 'mesh.setNormalAngle']);

function runSequence(
  m: EditMesh,
  steps: readonly Parameters<typeof resolveOpStep>[1][],
): { ran: number; refused: number } {
  let ran = 0;
  let refused = 0;
  for (const step of steps) {
    const { op, sel, args, ctx } = resolveOpStep(m, step);
    const run = runOp(m, op, sel, args, ctx, { maySoften: SOFTENING.has(op.id) });
    if (isRefusal(run.result)) refused++;
    else ran++;
  }
  return { ran, refused };
}

describe('P1 + P5 + P8 + P7-hard: random B4 op sequences', () => {
  it('on primitives with random divisions', () => {
    let ran = 0;
    fc.assert(
      fc.property(
        arbPrimitive(),
        fc.array(arbOpStep(), { minLength: 20, maxLength: 60 }),
        ({ kind, params }, steps) => {
          ran += runSequence(editMeshFrom(primitive(kind, params)), steps).ran;
        },
      ),
      { numRuns: 40, seed: 4 },
    );
    expect(ran).toBeGreaterThan(400);
  });

  it('on polygon soups (non-manifold edges, bow-ties, flipped and duplicate faces, loose vertices)', () => {
    let ran = 0;
    fc.assert(
      fc.property(arbSoup(), fc.array(arbOpStep(), { minLength: 20, maxLength: 60 }), (soup, steps) => {
        ran += runSequence(editMeshFrom(soup), steps).ran;
      }),
      { numRuns: 60, seed: 5 },
    );
    expect(ran).toBeGreaterThan(400);
  });
});

const EULER_KEEPING: readonly B4OpId[] = [
  'mesh.harden',
  'mesh.soften',
  'mesh.setNormalAngle',
  'mesh.reverse',
  'mesh.conform',
  'mesh.triangulate',
  'mesh.quadrangulate',
  'mesh.spinEdge',
  'mesh.flipTriangleEdge',
  'mesh.applyTransform',
  'mesh.averageVertices',
  'mesh.slide',
  'mesh.cut',
  'mesh.symmetrize',
];

describe('P2: χ = V − E + F unchanged', () => {
  it('by every B4 op except Mirror (which builds a second half)', () => {
    fc.assert(
      fc.property(arbPrimitive(), arbOpStep(EULER_KEEPING), ({ kind, params }, step) => {
        const m = editMeshFrom(primitive(kind, params));
        const before = topologyStats(m).euler;
        const { op, sel, args, ctx } = resolveOpStep(m, step);
        runOp(m, op, sel, args, ctx, { maySoften: true });
        expect(topologyStats(m).euler).toBe(before);
      }),
      { numRuns: 300, seed: 6 },
    );
  });
});

const CLOSED = fc.oneof(
  ...['cube', 'sphere', 'cylinder', 'cone', 'torus'].map((kind) => arbPrimitive().filter((p) => p.kind === kind)),
);

const MANIFOLD_OPS: readonly B4OpId[] = [
  'mesh.conform',
  'mesh.triangulate',
  'mesh.quadrangulate',
  'mesh.spinEdge',
  'mesh.flipTriangleEdge',
  'mesh.cut',
  'mesh.mirror',
];

/** Signed volume of the shared triangulation (what the viewport and export show; a fan over a non-planar quad's other
 *  diagonal would measure another solid). */
function renderedVolume(m: EditMesh): number {
  const t = triangulate(m);
  const p = m.position;
  let volume = 0;
  for (let i = 0; i < t.triFace.length; i++) {
    const [a, b, c] = [0, 1, 2].map((k) => 3 * m.cornerVert(t.tris[3 * i + k] as number)) as [number, number, number];
    const ax = p[a] as number;
    const ay = p[a + 1] as number;
    const az = p[a + 2] as number;
    const bx = p[b] as number;
    const by = p[b + 1] as number;
    const bz = p[b + 2] as number;
    const cx = p[c] as number;
    const cy = p[c + 1] as number;
    const cz = p[c + 2] as number;
    volume += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  return volume;
}

/** Every edge has two faces running it in opposite directions. */
function consistent(m: EditMesh): boolean {
  for (let e = 0; e < m.counts.edges; e++) {
    const c = m.edgeCorner(e);
    const d = m.cornerRadialNext(c);
    if (c === -1 || m.cornerRadialNext(d) !== c || m.cornerVert(c) === m.cornerVert(d)) return false;
  }
  return true;
}

describe('P3 + P4: closed 2-manifolds stay closed, consistent and outward', () => {
  it('through the manifold-preserving ops', () => {
    let ran = 0;
    fc.assert(
      fc.property(CLOSED, arbOpStep(MANIFOLD_OPS), ({ kind, params }, base) => {
        const m = editMeshFrom(primitive(kind, params));
        const id = MANIFOLD_OPS.find((x) => MESH_OPS[x] === resolveOpStep(m, base).op) as B4OpId;
        // Mirror's P3 class is "with merge"; the cut of a mesh is checked with merge on.
        const step =
          id === 'mesh.mirror' ? { ...base, values: base.values.map((v, i) => (i === 3 ? 1 : i === 2 ? 1 : v)) } : base;
        const { op, sel, args, ctx } = resolveOpStep(m, step);
        const run = runOp(m, op, sel, args, ctx);
        if (isRefusal(run.result)) return;
        ran++;
        const stats = topologyStats(m);
        // Spin changes the surface (on a coarse torus it can fold a face inward); every other op keeps the shape.
        const outward = op.id === 'mesh.spinEdge' || renderedVolume(m) > 0;
        expect([
          op.id,
          stats.boundaryLoops,
          stats.nonManifoldEdges,
          stats.nonManifoldVerts,
          consistent(m),
          outward,
        ]).toEqual([op.id, 0, 0, 0, true, true]);
      }),
      { numRuns: 300, seed: 8 },
    );
    expect(ran).toBeGreaterThan(100);
  });
});

describe('P7: cuts inside a face are never attribute seams', () => {
  /** Corner values on both sides of edge e are equal at both ends. */
  function continuous(m: EditMesh, e: number): boolean {
    const c = m.edgeCorner(e);
    const d = m.cornerRadialNext(c);
    if (d === c) return true;
    const pairs = [
      [c, m.cornerNext(d)],
      [m.cornerNext(c), d],
    ] as const;
    for (const layer of m.layers()) {
      if (layer.def.domain !== 'corner') continue;
      for (const [x, y] of pairs) {
        for (let k = 0; k < layer.def.comps; k++) if (!Object.is(layer.get(x, k), layer.get(y, k))) return false;
      }
    }
    return true;
  }

  it('Multi-Cut chords and Triangulate diagonals carry equal values on both sides', () => {
    fc.assert(
      fc.property(arbPrimitive(), arbOpStep(['mesh.cut', 'mesh.triangulate']), ({ kind, params }, base) => {
        const m = editMeshFrom(primitive(kind, params));
        const step = { ...base, symmetric: false };
        const { op, sel, args, ctx } = resolveOpStep(m, step);
        const E = m.counts.edges;
        const run = runOp(m, op, sel, args, ctx);
        if (isRefusal(run.result)) return;
        const created = op.id === 'mesh.cut' ? Array.from(run.result.selection.edges.toArray()) : [];
        if (op.id === 'mesh.triangulate') for (let e = E; e < m.counts.edges; e++) created.push(e);
        for (const e of created) expect(continuous(m, e)).toBe(true);
      }),
      { numRuns: 200, seed: 9 },
    );
  });
});

// ---------- P10 ----------

// Meshes whose faces do not straddle the plane (a quad crossing it has no symmetric triangulation or spin; the
// straddling cases of Multi-Cut have their own tests).
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

describe('P10: symmetric input, selection and args → symmetric output', () => {
  it('every B4 row of the §5.14 table, with the test symmetry map', () => {
    let ran = 0;
    fc.assert(
      fc.property(fc.integer({ min: 0, max: SYMMETRIC_MESHES.length - 1 }), arbOpStep(P10_OPS), (meshIndex, base) => {
        const m = editMeshFrom((SYMMETRIC_MESHES[meshIndex] as () => ReturnType<typeof primitive>)());
        const step = { ...base, symmetric: true };
        const resolved = resolveOpStep(m, step);
        const map = (resolved.ctx.symmetry as NonNullable<typeof resolved.ctx.symmetry>).map;
        expect(map.unmatched).toBe(0);
        // A symmetric selection: the picks that are not their own mirror image (those have no symmetric result for
        // spin and flip) plus their partners; the pointer ops expand it again.
        let sel = resolved.sel;
        if (sel !== null) {
          const partners = sel.kind === 'vertex' ? map.vertex : sel.kind === 'edge' ? map.edge : map.face;
          const set = sel.kind === 'vertex' ? sel.verts : sel.kind === 'edge' ? sel.edges : sel.faces;
          const picks = Array.from(set.toArray()).filter((i) => (partners[i] as number) >= 0 && partners[i] !== i);
          sel = expand(selectionOf(sel.kind, picks, m.counts), map);
        }
        const run = runOp(m, resolved.op, sel, resolved.args, resolved.ctx, { maySoften: true });
        if (isRefusal(run.result)) return;
        ran++;
        const after = testSymmetryMap(m, { tolerance: 1e-4 });
        const worst = asymmetry(m, after);
        expect([resolved.label, worst >= 0 && worst < 1e-6, after.unmatched]).toEqual([resolved.label, true, 0]);
        // Every edge has a partner and agrees with it on hardness.
        const unpaired: number[] = [];
        for (let e = 0; e < m.counts.edges; e++) {
          const p = after.edge[e] as number;
          if (p < 0 || (m.edgeFlags(p) & 1) !== (m.edgeFlags(e) & 1)) unpaired.push(e);
        }
        expect([resolved.label, unpaired]).toEqual([resolved.label, []]);
      }),
      { numRuns: 400, seed: 10 },
    );
    expect(ran).toBeGreaterThan(150);
  });

  it('Mirror and Symmetrize make any mesh symmetric', () => {
    for (const make of SYMMETRIC_MESHES) {
      const m = editMeshFrom(make());
      // Break the symmetry, then mirror back.
      m.begin('skew');
      for (let v = 0; v < m.counts.points; v++) {
        const x = m.position[3 * v] as number;
        if (x > 0.01) m.setPosition(v, x * 1.2, m.position[3 * v + 1] as number, m.position[3 * v + 2] as number);
      }
      m.end();
      const run = runOp(m, MESH_OPS['mesh.mirror'] as MeshOp, null, {}, context());
      expect(isRefusal(run.result)).toBe(false);
      expect(asymmetry(m)).toBeLessThan(1e-6);
      expect(testSymmetryMap(m).unmatched).toBe(0);
    }
    const s = editMeshFrom(primitive('sphere', {}));
    s.begin('skew');
    s.setPosition(1, (s.position[3] as number) + 0.0004, s.position[4] as number, s.position[5] as number);
    s.end();
    runOp(s, MESH_OPS['mesh.symmetrize'] as MeshOp, null, { tolerance: 0.001 });
    expect(asymmetry(s, testSymmetryMap(s, { tolerance: 0.001 }))).toBeLessThan(1e-6);
  });
});
