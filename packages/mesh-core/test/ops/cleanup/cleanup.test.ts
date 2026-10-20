// mesh.cleanup (M6A-SPEC §5.25, §6.1): "select matching" (the default) and Select Matching Only change nothing; each
// fix is one undoable edit after which its codes are gone (V/E/F oracles on the Mesh Check corpus); hidden elements
// are left alone; P1 and P5 through the op harness, also on random polygon soups.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  BitSet,
  BUILTIN_LAYERS,
  checkMesh,
  EDGE_HARD,
  type EditMesh,
  editMeshFrom,
  isRefusal,
  MESH_OPS,
  type MeshData,
  type MeshOp,
  type OpResult,
  primitive,
  selectionOf,
  topologyStats,
} from '../../../src';
import { arbSoup, buildMeshData, diffStored, signedVolume, vef } from '../../../src/testing';
import { CHECK_CORPUS } from '../../check/corpus';
import { consistentlyWound, ctxOf, runChecked, runOk } from '../bevel/harness';

const cleanup = MESH_OPS['mesh.cleanup'] as MeshOp;
const FIXES = ['select', 'deleteLamina', 'collapse', 'conform', 'triangulate', 'dissolve', 'deleteLoose'] as const;

const codes = (m: EditMesh | MeshData): string[] => checkMesh(m).map((p) => p.code);
const ids = (bits: BitSet): number[] => Array.from(bits.toArray());
const fix = (m: EditMesh, name: (typeof FIXES)[number]): OpResult =>
  runOk(cleanup, m, null, { fix: name, selectOnly: false });
const warningOf = (result: OpResult) => result.warnings.map((w) => [w.code, w.count ?? null]);

describe('select matching', () => {
  it('the default selects every problem element and changes nothing', () => {
    const m = editMeshFrom(CHECK_CORPUS['loose-geometry']());
    const before = m.snapshot();
    const { result, delta } = runChecked(cleanup, m, null, {});
    expect(isRefusal(result)).toBe(false);
    const r = result as OpResult;
    expect(diffStored(m, before)).toBeNull();
    expect(delta?.dirty.topology).toBeFalsy();
    expect(r.selection.kind).toBe('vertex');
    expect(ids(r.selection.verts)).toEqual([2, 4]);
    expect(ids(r.selection.edges)).toEqual([3]);
    expect(ids(r.selection.faces)).toEqual([]);
    expect(warningOf(r)).toEqual([['cleanup.found', 3]]);
    expect(r.resolvedArgs).toEqual({ fix: 'select', selectOnly: true });
  });

  it('Select Matching Only (the default) with a fix selects only that fix’s codes', () => {
    const m = editMeshFrom(CHECK_CORPUS['loose-geometry']());
    const r = runOk(cleanup, m, null, { fix: 'deleteLoose' });
    expect(ids(r.selection.verts)).toEqual([4]);
    expect(ids(r.selection.edges)).toEqual([3]);
    expect(warningOf(r)).toEqual([['cleanup.found', 2]]);
    expect(vef(m)).toBe('5/4/1');
    const faces = runOk(cleanup, editMeshFrom(CHECK_CORPUS.lamina()), null, { fix: 'deleteLamina' });
    expect(faces.selection.kind).toBe('face');
    expect(ids(faces.selection.faces)).toEqual([1]);
  });

  it('a clean mesh: cleanup.clean and an empty selection for every fix', () => {
    for (const name of FIXES) {
      for (const selectOnly of [true, false]) {
        const m = editMeshFrom(primitive('cube', { subdivisionsWidth: 2 }));
        const before = m.snapshot();
        const r = runOk(cleanup, m, null, { fix: name, selectOnly });
        expect(warningOf(r), `${name}`).toEqual([['cleanup.clean', null]]);
        expect(r.selection.faces.count() + r.selection.edges.count() + r.selection.verts.count()).toBe(0);
        expect(diffStored(m, before)).toBeNull();
      }
    }
  });

  it('the descriptor: object-level, repeatable, not adjustable, poll always true', () => {
    expect(cleanup.kinds).toBe('object');
    expect(cleanup.flags).toMatchObject({ adjustable: false, repeatable: true, whole: true });
    const m = editMeshFrom(primitive('cube', {}));
    expect(cleanup.poll(m, null, ctxOf(m))).toBe(true);
    expect(cleanup.poll(m, selectionOf('face', [0], m.counts), ctxOf(m))).toBe(true);
  });
});

describe('fixes (§5.25 table)', () => {
  it('deleteLamina deletes the face with the larger index', () => {
    const m = editMeshFrom(CHECK_CORPUS.lamina());
    const r = fix(m, 'deleteLamina');
    expect(vef(m)).toBe('4/4/1');
    expect(codes(m)).toEqual([]);
    expect(warningOf(r)).toEqual([['cleanup.fixed', 1]]);
    // The survivor is the original face 0 (0 → 1 → 2 → 3).
    expect(m.cornerVert(m.faceCorner(0))).toBe(0);
    expect(m.cornerVert(m.cornerNext(m.faceCorner(0)))).toBe(1);
  });

  it('collapse merges a zero-length edge into its midpoint', () => {
    const m = editMeshFrom(CHECK_CORPUS['zero-length-edge']());
    const r = fix(m, 'collapse');
    expect(vef(m)).toBe('3/3/1');
    expect(codes(m)).toEqual([]);
    expect(r.selection.kind).toBe('vertex');
    expect(ids(r.selection.verts)).toEqual([0]);
    expect(warningOf(r)).toEqual([['cleanup.fixed', 1]]);
  });

  it('collapse joins a cap into the face across its longest edge (nothing moves)', () => {
    const data = CHECK_CORPUS['zero-area-face']();
    const m = editMeshFrom(data);
    const r = fix(m, 'collapse');
    // The sliver over the base edge 0–1 joins the base: the base becomes the quad 0 → 2 → 1 → 3.
    expect(vef(m)).toBe('4/5/3');
    expect(codes(m)).toEqual([]);
    expect(Array.from(m.position)).toEqual(Array.from(data.position));
    expect(topologyStats(m)).toMatchObject({ boundaryLoops: 0, nonManifoldEdges: 0, euler: 2 });
    expect(consistentlyWound(m)).toBe(true);
    expect(ids(r.selection.verts)).toEqual([3]);
    expect(warningOf(r)).toEqual([['cleanup.fixed', 1]]);
  });

  it('collapse removes a needle through its zero-length edge', () => {
    // A unit square fanned from vertex 0, vertex 3 a hair above vertex 1: the triangle 0–1–3 is a needle.
    const m = editMeshFrom(
      buildMeshData({
        positions: [0, 0, 0, 1, 0, 0, 1, 1, 0, 1, 1e-9, 0, 0, 1, 0],
        faces: [
          [0, 1, 3],
          [0, 3, 2],
          [0, 2, 4],
        ],
      }),
    );
    expect(codes(m)).toEqual(['zero-length-edge', 'zero-area-face']);
    fix(m, 'collapse');
    expect(vef(m)).toBe('4/5/2');
    expect(codes(m)).toEqual([]);
  });

  it('collapse leaves no loose geometry when every face of a component collapses (§5.1 orphan cleanup)', () => {
    // Vertices 0 and 2 coincide; the quad 0–1–2–3 has no area and no edge it can join across, the triangle 0–2–4 is a
    // needle: both faces go, then every edge and vertex they used.
    const m = editMeshFrom(
      buildMeshData({
        positions: [0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, -1, -1, 0],
        faces: [
          [0, 1, 2, 3],
          [0, 2, 4],
        ],
      }),
    );
    const r = fix(m, 'collapse');
    expect(vef(m)).toBe('0/0/0');
    expect(codes(m)).toEqual([]);
    expect(ids(r.selection.verts)).toEqual([]);
  });

  it('collapse keeps loose geometry it did not make (deleteLoose’s job)', () => {
    // The needle of the previous case beside a wire edge 5–6 and a lone vertex 7: those stay.
    const m = editMeshFrom(
      buildMeshData({
        positions: [0, 0, 0, 1, 0, 0, 1, 1, 0, 1, 1e-9, 0, 0, 1, 0, 5, 0, 0, 6, 0, 0, 7, 0, 0],
        faces: [
          [0, 1, 3],
          [0, 3, 2],
          [0, 2, 4],
        ],
      }),
    );
    m.begin('wire');
    m.makeEdge(5, 6);
    m.end();
    fix(m, 'collapse');
    expect(vef(m)).toBe('7/6/2');
    // Indices moved (the merged vertex 3 left a hole): name the loose elements by position.
    const x = (v: number): number => m.position[3 * v] as number;
    const loose = checkMesh(m).filter((p) => p.code === 'loose-geometry');
    expect(
      loose.map((p) => [
        p.domain,
        Array.from(p.elements ?? [], (i): number | number[] =>
          p.domain === 'point' ? x(i) : [x(m.edgeVert(i, 0)), x(m.edgeVert(i, 1))],
        ),
      ]),
    ).toEqual([
      ['point', [7]],
      ['edge', [[5, 6]]],
    ]);
  });

  it('collapse keeps the neighbour’s material, flags and face layers on a joined face', () => {
    const data = CHECK_CORPUS['zero-area-face']();
    const m = editMeshFrom({
      ...data,
      faceMaterial: Uint16Array.from([3, 1, 1, 1]),
      faceFlags: Uint8Array.from([0, 0, 0, 0]),
    });
    fix(m, 'collapse');
    const quad = Array.from({ length: m.counts.faces }, (_, f) => f).find((f) => m.faceLen(f) === 4) as number;
    expect(m.faceMaterial(quad)).toBe(3);
  });

  it('conform reverses the minority on an open strip and makes a closed mesh outward', () => {
    const strip = editMeshFrom(CHECK_CORPUS['inconsistent-winding']());
    const r = fix(strip, 'conform');
    expect(ids(r.selection.faces)).toEqual([1]);
    expect(codes(strip)).toEqual([]);
    expect(consistentlyWound(strip)).toBe(true);
    expect(warningOf(r)).toEqual([['cleanup.fixed', 1]]);
    // A cube with one face reversed, and a cube turned inside out.
    const faces = [
      [0, 1, 2, 3],
      [3, 2, 6, 7],
      [7, 6, 5, 4],
      [4, 5, 1, 0],
      [1, 5, 6, 2],
      [4, 0, 3, 7],
    ];
    const positions = [
      -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5, -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5,
      -0.5, 0.5, -0.5,
    ];
    const one = editMeshFrom(
      buildMeshData({ positions, faces: faces.map((f, i) => (i === 4 ? [...f].reverse() : f)) }),
    );
    expect(ids(fix(one, 'conform').selection.faces)).toEqual([4]);
    expect(signedVolume(one)).toBeCloseTo(1, 6);
    const inside = editMeshFrom(buildMeshData({ positions, faces: faces.map((f) => [...f].reverse()) }));
    expect(codes(inside)).toEqual([]); // consistently wound, only inward
    expect(runOk(cleanup, inside, null, { fix: 'conform', selectOnly: false }).warnings[0]?.code).toBe('cleanup.clean');
    // Two cubes in one mesh, the second reversed except one face: each component conforms on its own, and a closed
    // one turns outward even where that means reversing the majority.
    const shifted = positions.map((x, i) => (i % 3 === 0 ? x + 3 : x));
    const two = editMeshFrom(
      buildMeshData({
        positions: [...positions, ...shifted],
        faces: [...faces, ...faces.map((f, i) => (i === 0 ? f : [...f].reverse()).map((v) => v + 8))],
      }),
    );
    expect(ids(fix(two, 'conform').selection.faces)).toEqual([7, 8, 9, 10, 11]);
    expect(signedVolume(two)).toBeCloseTo(2, 6);
    expect(consistentlyWound(two)).toBe(true);
  });

  it('triangulate splits non-planar and concave n-gons along the one triangulation', () => {
    const lifted = editMeshFrom(CHECK_CORPUS['nonplanar-ngon']());
    const r = fix(lifted, 'triangulate');
    expect(vef(lifted)).toBe('5/7/3');
    expect(codes(lifted)).toEqual([]);
    expect(ids(r.selection.faces)).toEqual([0, 1, 2]);
    const ell = editMeshFrom(CHECK_CORPUS['concave-ngon']());
    fix(ell, 'triangulate');
    expect(vef(ell)).toBe('6/9/4');
    expect(codes(ell)).toEqual([]);
    expect(Math.abs(signedArea(ell))).toBeCloseTo(3, 6);
  });

  it('dissolve joins the two edges of a stray vertex', () => {
    const m = editMeshFrom(CHECK_CORPUS['stray-vertex']());
    const r = fix(m, 'dissolve');
    expect(vef(m)).toBe('3/3/1');
    expect(codes(m)).toEqual([]);
    expect(warningOf(r)).toEqual([['cleanup.fixed', 1]]);
  });

  it('deleteLoose deletes wire edges and the vertices they leave alone', () => {
    const m = editMeshFrom(CHECK_CORPUS['loose-geometry']());
    const r = fix(m, 'deleteLoose');
    expect(vef(m)).toBe('3/3/1');
    expect(codes(m)).toEqual([]);
    expect(warningOf(r)).toEqual([['cleanup.fixed', 3]]);
  });

  it('select-only codes have no fix: the select fix leaves them selected', () => {
    for (const code of ['non-manifold-edge', 'non-manifold-vertex', 'ngon-degenerate'] as const) {
      const m = editMeshFrom(CHECK_CORPUS[code]());
      const r = runOk(cleanup, m, null, { fix: 'select', selectOnly: false });
      expect(r.warnings[0]?.code, `${code}`).toBe('cleanup.found');
      expect(codes(m), `${code}`).toContain(code);
    }
  });
});

describe('visibility and properties', () => {
  it('hidden elements are neither reported nor fixed', () => {
    const m = editMeshFrom(CHECK_CORPUS.lamina());
    const hidden = { verts: new BitSet(4), edges: new BitSet(4), faces: new BitSet(2) };
    hidden.faces.add(1);
    const r = runOk(cleanup, m, null, { fix: 'deleteLamina', selectOnly: false }, ctxOf(m, { hidden }));
    expect(r.warnings[0]?.code).toBe('cleanup.clean');
    expect(vef(m)).toBe('4/4/2');
  });

  it('P7-hard: an all-hard mesh stays all-hard through every fix', () => {
    for (const code of Object.keys(CHECK_CORPUS) as (keyof typeof CHECK_CORPUS)[]) {
      const data = CHECK_CORPUS[code]();
      const hard = { ...data, edgeFlags: new Uint8Array(data.counts.edges).fill(EDGE_HARD) };
      for (const name of FIXES) {
        const m = editMeshFrom(hard);
        runOk(cleanup, m, null, { fix: name, selectOnly: false });
        const soft = Array.from({ length: m.counts.edges }, (_, e) => e).filter(
          (e) => (m.edgeFlags(e) & EDGE_HARD) === 0,
        );
        expect(soft, `${code} ${name}`).toEqual([]);
      }
    }
  });

  it('collapse averages point layers and keeps skin weights normalized', () => {
    const data = CHECK_CORPUS['zero-length-edge']();
    const joints = Uint16Array.from([0, 1, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0, 1, 2, 0, 0]);
    const weights = Float32Array.from([0.5, 0.5, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0.25, 0.75, 0, 0]);
    const layers = new Map(data.layers);
    layers.set('skin.joints', { def: BUILTIN_LAYERS.skinJoints, data: joints });
    layers.set('skin.weights', { def: BUILTIN_LAYERS.skinWeights, data: weights });
    const m = editMeshFrom({ ...data, layers });
    fix(m, 'collapse');
    // Vertices 0 and 3 merged into 0: joint 0 at (0.5 + 0) / 2, joint 1 at (0.5 + 0.25) / 2, joint 2 at 0.75 / 2.
    const w = new Float64Array(4);
    const j = new Float64Array(4);
    m.layer('skin.weights')?.read(0, w);
    m.layer('skin.joints')?.read(0, j);
    const byJoint = new Map<number, number>();
    for (let k = 0; k < 4; k++) if ((w[k] as number) > 0) byJoint.set(j[k] as number, w[k] as number);
    expect(byJoint.get(0)).toBeCloseTo(0.25, 6);
    expect(byJoint.get(1)).toBeCloseTo(0.375, 6);
    expect(byJoint.get(2)).toBeCloseTo(0.375, 6);
  });

  it('P1 + P5 on polygon soups: every fix gives a valid mesh with exact undo, and removes what it can', () => {
    fc.assert(
      fc.property(arbSoup(), fc.constantFrom(...FIXES), fc.boolean(), (soup, name, selectOnly) => {
        const m = editMeshFrom(soup);
        const loose = (): number =>
          checkMesh(m)
            .filter((p) => p.code === 'loose-geometry')
            .reduce((n, p) => n + (p.elements?.length ?? 0), 0);
        const looseBefore = loose();
        const { result } = runChecked(cleanup, m, null, { fix: name, selectOnly });
        expect(isRefusal(result)).toBe(false);
        const left = codes(m);
        // Deleting laminas and loose geometry never leaves one behind.
        expect(selectOnly || name !== 'deleteLamina' || !left.includes('lamina')).toBe(true);
        expect(selectOnly || name !== 'deleteLoose' || !left.includes('loose-geometry')).toBe(true);
        // A collapse removes what its merges leave unused (§5.1): it never adds loose geometry.
        expect(selectOnly || name !== 'collapse' || loose() <= looseBefore).toBe(true);
      }),
      { numRuns: 300, seed: 21 },
    );
  });
});

/** Twice the signed area of every face projected on z, halved (the L-hexagon lies in z = 0). */
function signedArea(m: EditMesh): number {
  let area = 0;
  for (let f = 0; f < m.counts.faces; f++) {
    const start = m.faceCorner(f);
    let c = start;
    do {
      const a = m.cornerVert(c);
      const b = m.cornerVert(m.cornerNext(c));
      area += (m.position[3 * a] as number) * (m.position[3 * b + 1] as number);
      area -= (m.position[3 * b] as number) * (m.position[3 * a + 1] as number);
      c = m.cornerNext(c);
    } while (c !== start);
  }
  return area / 2;
}
