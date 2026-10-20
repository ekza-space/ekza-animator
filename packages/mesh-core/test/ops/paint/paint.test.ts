// `ops/paint` (M6A-SPEC §5.19, §6.1; B13): Assign Colour / Paint Colour strokes, Fill Shell and the internal remap
// behind Replace Swatch, with the harness's P1/P5/P8 checks on every run.
import fc from 'fast-check';
import { editMeshFrom, type EditMesh, isRefusal, MESH_OPS, primitive, selectionOf, topologyStats } from '../../../src';
import { faceShell, paint, paintFillShell, paintRemap, UNMATCHED_PARTNER } from '../../../src/ops/paint';
import { buildMeshData, cubeData } from '../../../src/testing';
import { centroid, ctxOf, hiddenFaces, mirrorMapX, ok, runChecked, slots } from './harness';

/** A 2-wide cube (12/20/10): faces 0–1 front, 2–3 top, 4–5 back, 6–7 bottom, 8 right, 9 left. */
const wideCube = (): EditMesh => editMeshFrom(primitive('cube', { subdivisionsWidth: 2 }));

/** Two unit cubes 3 m apart in X (two shells, mirror images of each other). */
function twoCubes(): EditMesh {
  const one = cubeData();
  const positions: number[] = [];
  for (const dx of [-1.5, 1.5]) {
    for (let i = 0; i < one.counts.points; i++) {
      positions.push(
        (one.position[3 * i] as number) + dx,
        one.position[3 * i + 1] as number,
        one.position[3 * i + 2] as number,
      );
    }
  }
  const faces: number[][] = [];
  for (const offset of [0, 8]) {
    for (let f = 0; f < one.counts.faces; f++) {
      const corners: number[] = [];
      let c = one.faceCorner[f] as number;
      const first = c;
      do {
        corners.push((one.cornerVert[c] as number) + offset);
        c = one.cornerNext[c] as number;
      } while (c !== first);
      faces.push(corners);
    }
  }
  return editMeshFrom(buildMeshData({ positions, faces }));
}

describe('mesh.paint', () => {
  it('is the registered kernel op', () => {
    expect(MESH_OPS['mesh.paint']).toBe(paint);
    expect(MESH_OPS['mesh.paint.fillShell']).toBe(paintFillShell);
    expect(MESH_OPS['mesh.paint.remap']).toBe(paintRemap);
  });

  it('paints the selected faces and keeps the selection', () => {
    const m = wideCube();
    const sel = selectionOf('face', [2, 3], m.counts);
    const result = ok(runChecked(paint, m, sel, { slot: 4 }));
    expect(slots(m)).toEqual([0, 0, 4, 4, 0, 0, 0, 0, 0, 0]);
    expect(result.selection).toBe(sel);
    expect(result.warnings).toEqual([]);
    expect(result.resolvedArgs).toEqual({ slot: 4, faces: null });
    expect(topologyStats(m).shells).toBe(1);
  });

  it('adds the paint layer to a mesh without one (slot 0 elsewhere)', () => {
    const m = editMeshFrom(cubeData());
    expect(m.layer('paint')).toBeUndefined();
    ok(runChecked(paint, m, selectionOf('face', [1], m.counts), { slot: 9 }));
    expect(m.layer('paint')).toBeDefined();
    expect(slots(m)).toEqual([0, 9, 0, 0, 0, 0]);
  });

  it('paints explicit faces (a tool stroke) whatever the selection, and records them sorted', () => {
    const m = wideCube();
    const result = ok(runChecked(paint, m, selectionOf('face', [0], m.counts), { slot: 3, faces: [9, 4] }));
    expect(slots(m)).toEqual([0, 0, 0, 0, 3, 0, 0, 0, 0, 3]);
    expect(result.resolvedArgs).toEqual({ slot: 3, faces: [4, 9] });
  });

  it('mirrors explicit faces under symmetry and reports faces without a partner', () => {
    const m = wideCube();
    const map = mirrorMapX(m);
    // front-left (x < 0) ↔ front-right; right ↔ left
    const front = [0, 1].map((f) => centroid(m, f)[0]);
    expect(Math.sign(front[0] as number)).toBe(-Math.sign(front[1] as number));
    const ctx = ctxOf({ symmetry: { map, preserveSeam: true } });
    const result = ok(runChecked(paint, m, null, { slot: 5, faces: [0, 8] }, ctx));
    expect(slots(m)).toEqual([5, 5, 0, 0, 0, 0, 0, 0, 5, 5]);
    expect(result.warnings).toEqual([]);

    const lonely = mirrorMapX(m, 1e-6, [2]);
    const second = ok(
      runChecked(paint, m, null, { slot: 7, faces: [2] }, ctxOf({ symmetry: { map: lonely, preserveSeam: true } })),
    );
    expect(slots(m)).toEqual([5, 5, 7, 0, 0, 0, 0, 0, 5, 5]);
    expect(second.warnings).toHaveLength(1);
    expect(second.warnings[0]).toMatchObject({ code: UNMATCHED_PARTNER, count: 1 });
    expect([...(second.warnings[0]?.elements ?? [])]).toEqual([2]);
  });

  it('expands a selection under symmetry (idempotent with the runtime’s own expansion)', () => {
    const m = wideCube();
    const ctx = ctxOf({ symmetry: { map: mirrorMapX(m), preserveSeam: true } });
    ok(runChecked(paint, m, selectionOf('face', [0], m.counts), { slot: 2 }, ctx));
    expect(slots(m).slice(0, 2)).toEqual([2, 2]);
    ok(runChecked(paint, m, selectionOf('face', [2, 3], m.counts), { slot: 6 }, ctx));
    expect(slots(m).slice(2, 4)).toEqual([6, 6]);
  });

  it('never paints hidden faces; all hidden or none selected refuses and leaves the mesh untouched', () => {
    const m = wideCube();
    const hidden = hiddenFaces(m, [3]);
    ok(runChecked(paint, m, selectionOf('face', [2, 3], m.counts), { slot: 4 }, ctxOf({ hidden })));
    expect(slots(m)).toEqual([0, 0, 4, 0, 0, 0, 0, 0, 0, 0]);
    const all = runChecked(paint, m, selectionOf('face', [3], m.counts), { slot: 8 }, ctxOf({ hidden }));
    expect(isRefusal(all.result) && all.result.code).toBe('paint.no-faces');
    const none = runChecked(paint, m, selectionOf('face', [], m.counts), { slot: 8 });
    expect(isRefusal(none.result) && none.result.code).toBe('paint.no-faces');
    const edges = runChecked(paint, m, selectionOf('edge', [0], m.counts), { slot: 8 });
    expect(isRefusal(edges.result) && edges.result.code).toBe('paint.no-faces');
    expect(slots(m)).toEqual([0, 0, 4, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('refuses faces out of range', () => {
    const m = wideCube();
    const ran = runChecked(paint, m, null, { slot: 1, faces: [0, 10] });
    expect(isRefusal(ran.result) && ran.result.code).toBe('paint.out-of-range');
  });

  it('clamps the slot like every op argument (u16, 0…65534)', () => {
    const m = wideCube();
    const result = ok(runChecked(paint, m, null, { slot: 70_000, faces: [0] }));
    expect(result.resolvedArgs['slot']).toBe(65_534);
    expect(slots(m)[0]).toBe(65_534);
  });

  it('a repaint with the same slot writes nothing (empty dirty set)', () => {
    const m = wideCube();
    ok(runChecked(paint, m, null, { slot: 4, faces: [0] }));
    const again = runChecked(paint, m, null, { slot: 4, faces: [0] });
    expect(again.delta?.dirty.faces).toEqual(new Uint32Array(0));
  });

  it('P5 and P8 hold for random strokes (property)', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            faces: fc.uniqueArray(fc.integer({ min: 0, max: 9 }), { minLength: 1, maxLength: 10 }),
            slot: fc.integer({ min: 0, max: 15 }),
          }),
          { minLength: 1, maxLength: 6 },
        ),
        (strokes) => {
          const m = wideCube();
          const expected = Array.from({ length: 10 }, () => 0);
          for (const stroke of strokes) {
            ok(runChecked(paint, m, null, stroke));
            for (const f of stroke.faces) expected[f] = stroke.slot;
          }
          expect(slots(m)).toEqual(expected);
        },
      ),
      { numRuns: 60 },
    );
  });
});

describe('mesh.paint.fillShell', () => {
  it('fills the shell of the clicked face only', () => {
    const m = twoCubes();
    const right = [...Array(12).keys()].find((f) => centroid(m, f)[0] > 0) as number;
    const result = ok(runChecked(paintFillShell, m, null, { slot: 3, face: right }));
    const painted = slots(m);
    for (let f = 0; f < 12; f++) expect(painted[f]).toBe(centroid(m, f)[0] > 0 ? 3 : 0);
    expect(result.resolvedArgs).toEqual({ slot: 3, face: right });
  });

  it('fills the mirrored shell too under symmetry', () => {
    const m = twoCubes();
    const ctx = ctxOf({ symmetry: { map: mirrorMapX(m), preserveSeam: true } });
    ok(runChecked(paintFillShell, m, null, { slot: 6, face: 0 }, ctx));
    expect(slots(m)).toEqual(Array.from({ length: 12 }, () => 6));
    const lonely = ctxOf({ symmetry: { map: mirrorMapX(m, 1e-6, [0]), preserveSeam: true } });
    const result = ok(runChecked(paintFillShell, m, null, { slot: 2, face: 0 }, lonely));
    expect(slots(m).filter((s) => s === 2)).toHaveLength(6);
    expect(result.warnings[0]).toMatchObject({ code: UNMATCHED_PARTNER, count: 1 });
  });

  it('skips hidden faces and refuses a hidden or missing face', () => {
    const m = wideCube();
    const hidden = hiddenFaces(m, [2]);
    ok(runChecked(paintFillShell, m, null, { slot: 1, face: 0 }, ctxOf({ hidden })));
    expect(slots(m)).toEqual([1, 1, 0, 1, 1, 1, 1, 1, 1, 1]);
    const onHidden = runChecked(paintFillShell, m, null, { slot: 1, face: 2 }, ctxOf({ hidden }));
    expect(isRefusal(onHidden.result) && onHidden.result.code).toBe('paint.no-face');
    const missing = runChecked(paintFillShell, m, null, { slot: 1 });
    expect(isRefusal(missing.result) && missing.result.code).toBe('paint.no-face');
    const outside = runChecked(paintFillShell, m, null, { slot: 1, face: 99 });
    expect(isRefusal(outside.result) && outside.result.code).toBe('paint.out-of-range');
  });

  it('faceShell walks shared vertices (a corner-touching face is in the shell)', () => {
    // Two quads sharing only vertex 2.
    const m = editMeshFrom(
      buildMeshData({
        positions: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 2, 1, 0, 2, 2, 0, 1, 2, 0],
        faces: [
          [0, 1, 2, 3],
          [2, 4, 5, 6],
        ],
      }),
    );
    expect(faceShell(m, 0)).toEqual([0, 1]);
    expect(faceShell(m, 1, (f) => f === 0)).toEqual([1]);
  });
});

describe('mesh.paint.remap', () => {
  it('repaints every face of one slot, hidden or not, and nothing else', () => {
    const m = wideCube();
    ok(runChecked(paint, m, null, { slot: 4, faces: [0, 3, 9] }));
    ok(runChecked(paint, m, null, { slot: 2, faces: [1] }));
    const hidden = hiddenFaces(m, [3]);
    const result = ok(runChecked(paintRemap, m, null, { from: 4, to: 11 }, ctxOf({ hidden })));
    expect(slots(m)).toEqual([11, 2, 0, 11, 0, 0, 0, 0, 0, 11]);
    expect(result.resolvedArgs).toEqual({ from: 4, to: 11 });
    // slot 0 is the layer default: remapping it repaints the unpainted faces
    ok(runChecked(paintRemap, m, null, { from: 0, to: 1 }));
    expect(slots(m)).toEqual([11, 2, 1, 11, 1, 1, 1, 1, 1, 11]);
  });

  it('from = to writes nothing', () => {
    const m = wideCube();
    const ran = runChecked(paintRemap, m, null, { from: 3, to: 3 });
    expect(ran.delta?.dirty.faces).toEqual(new Uint32Array(0));
    expect(m.layer('paint')).toBeDefined();
  });
});
