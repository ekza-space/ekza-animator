// M6A-SPEC §5.14 for B3's ops (P10 and the goldens of §9 B3): expanded selections, mirror-consistent extrude frames,
// self-mirrored regions and groups, Insert Edge Loop decided by the mapped seed point, the Target Weld seam table,
// Bridge's mirrored pair, unmatched partners processed on one side with `symmetry.unmatched-partner`. Maps come from
// the §5.14 definition (`referenceSymmetryMap`); `READY.b2` cross-checks B3's helpers against B2's functions.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { type EditMesh, editMeshFrom, expandSelection, isRefusal, mirrorEdgePoint, primitive } from '../../src';
import { expandIndices, Mirror, mirrorPoint } from '../../src/ops/extrude/shared/symmetry';
import { combined, cylinderData, edgesAlong, planeData, topOf, vertexNear } from './fixtures';
import { READY } from './ready';
import {
  counts,
  ctxOf,
  cube,
  faceCentroid,
  faceToward,
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

  it('every exp/ptr op on symmetric meshes (positions within 1e-6, every vertex partnered)', () => {
    let ran = 0;
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
          const { result } = runChecked(m, op(step.id), sel(m, step.kind, picks), step.args, symCtx(m));
          if (isRefusal(result)) return;
          ran++;
          expect(symmetryProblems(m), `${step.id} ${JSON.stringify(step.args)} on ${picks.join(',')}`).toEqual([]);
          expect(result.warnings.filter((w) => w.code === 'symmetry.unmatched-partner')).toEqual([]);
        },
      ),
      { numRuns: 300 * SCALE },
    );
    expect(ran).toBeGreaterThan(100);
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
