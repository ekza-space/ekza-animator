// mesh.uv.planar / mesh.uv.box / mesh.uv.cylindrical (M6A-SPEC §5.28, §6.1): goldens (test/goldens/b5-uv.json,
// `UPDATE_GOLDENS=1` rewrites it; the Chromium run compares the same file), seams on chart borders and at the wrap and
// none inside a continuous chart, the fit in 0–1, selections and object mode, hidden faces, refusals, the pane
// camera, symmetry, and P1/P5 through the op harness. Positions and topology never change.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  BitSet,
  EDGE_SEAM,
  type EditMesh,
  editMeshFrom,
  isRefusal,
  MESH_OPS,
  type MeshData,
  type MeshOp,
  type OpResult,
  primitive,
  selectionOf,
} from '../../../src';
import { boxPlane } from '../../../src/uv/project';
import { buildMeshData, goldenRunner } from '../../../src/testing';
import { ctxOf, runChecked, runOk } from '../bevel/harness';
import { standInSymmetryMap } from '../bevel/symmetry-map';
import { uvCase, uvGoldenValues } from './goldens';

const planar = MESH_OPS['mesh.uv.planar'] as MeshOp;
const box = MESH_OPS['mesh.uv.box'] as MeshOp;
const cylindrical = MESH_OPS['mesh.uv.cylindrical'] as MeshOp;
const OPS = [planar, box, cylindrical] as const;

const allFaces = (m: EditMesh): number[] => Array.from({ length: m.counts.faces }, (_, f) => f);
const seams = (m: EditMesh): number[] =>
  Array.from({ length: m.counts.edges }, (_, e) => e).filter((e) => (m.edgeFlags(e) & EDGE_SEAM) !== 0);
const uvOf = (m: EditMesh, c: number): [number, number] => {
  const layer = m.layer('uv0');
  return [layer?.get(c, 0) as number, layer?.get(c, 1) as number];
};

/** The corners of each two-face edge at its two vertices, as [corner in face 1, corner in face 2] pairs. */
function cornerPairs(m: EditMesh, e: number): [number, number][] {
  const c = m.edgeCorner(e);
  const d = m.cornerRadialNext(c);
  const at = (r: number, v: number): number => (m.cornerVert(r) === v ? r : m.cornerNext(r));
  return [m.edgeVert(e, 0), m.edgeVert(e, 1)].map((v) => [at(c, v), at(d, v)] as [number, number]);
}

const continuousAcross = (m: EditMesh, e: number): boolean =>
  cornerPairs(m, e).every(([a, b]) => {
    const [ua, va] = uvOf(m, a);
    const [ub, vb] = uvOf(m, b);
    return ua === ub && va === vb;
  });

/** Everything but uv0 and the edge flags, for "positions and topology untouched". */
function geometry(m: EditMesh | MeshData): unknown {
  const d = 'snapshot' in m ? m.snapshot() : m;
  return {
    counts: d.counts,
    position: Array.from(d.position),
    cornerVert: Array.from(d.cornerVert),
    cornerNext: Array.from(d.cornerNext),
    edgeVerts: Array.from(d.edgeVerts),
    hard: Array.from(d.edgeFlags, (f) => f & ~EDGE_SEAM),
    layers: [...d.layers].filter(([name]) => name !== 'uv0').map(([name, l]) => [name, Array.from(l.data)]),
  };
}

describe('goldens (P6)', () => {
  const file = join(dirname(fileURLToPath(import.meta.url)), '../../goldens/b5-uv.json');
  const computed = uvGoldenValues();
  const goldens = goldenRunner(
    file,
    computed,
    { existsSync, readFileSync, writeFileSync },
    process.env['UPDATE_GOLDENS'] === '1',
  );

  it('match test/goldens/b5-uv.json', () => {
    expect(JSON.parse(JSON.stringify(computed))).toEqual(goldens);
  });

  it('are stable within one runtime', () => {
    expect(uvGoldenValues()).toEqual(computed);
  });

  it('box mapping of a cube: six charts, every cube edge a seam, every value in 0–1', () => {
    const golden = computed['box/cube-raw'];
    const m = editMeshFrom(primitive('cube', {}));
    expect(golden?.seams).toEqual(Array.from({ length: m.counts.edges }, (_, e) => e));
    const fitted = computed['box/cube']?.uv ?? [];
    expect(Math.min(...fitted)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...fitted)).toBeLessThanOrEqual(1);
  });

  it('planar mapping of a whole cube: one continuous chart, no seams', () => {
    expect(computed['planar-y/cube']?.seams).toEqual([]);
    expect(computed['planar-camera/cube']?.seams).toEqual([]);
  });

  it('planar mapping of one face: its four edges are the chart border', () => {
    expect(computed['planar-x/cube-top-face']?.seams).toHaveLength(4);
  });
});

describe('seams (§5.28)', () => {
  it('a seam on every edge between charts, outside the run or across a value jump; none elsewhere', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('cube', 'sphere', 'cylinder', 'cone', 'torus', 'plane'),
        fc.integer({ min: 0, max: 2 }),
        fc.option(fc.array(fc.nat(), { minLength: 1, maxLength: 12 }), { nil: null }),
        fc.boolean(),
        (kind, which, seeds, fit) => {
          const m = editMeshFrom(primitive(kind, {}));
          const op = OPS[which] as MeshOp;
          const picked = seeds === null ? null : [...new Set(seeds.map((s) => s % m.counts.faces))];
          const sel = picked === null ? null : selectionOf('face', picked, m.counts);
          runOk(op, m, sel, { fit });
          const run = new Set(picked ?? allFaces(m));
          for (let e = 0; e < m.counts.edges; e++) {
            const n = m.edgeFaceCount(e);
            if (n !== 2) continue;
            const c = m.edgeCorner(e);
            const f = m.cornerFace(c);
            const g = m.cornerFace(m.cornerRadialNext(c));
            const touched = run.has(f) || run.has(g);
            if (!touched) continue;
            const seam = (m.edgeFlags(e) & EDGE_SEAM) !== 0;
            const border = !(run.has(f) && run.has(g));
            const chartBorder = op === box && boxPlane(faceNormal(m, f)) !== boxPlane(faceNormal(m, g));
            // A seam exactly where the chart ends or the values jump; uv0 continuous across every other edge.
            expect(seam, `${kind} ${op.id} edge ${e}`).toBe(border || chartBorder || !continuousAcross(m, e));
          }
        },
      ),
      { numRuns: 120, seed: 8 },
    );
  });

  it('seams inside a continuous chart are cleared; border edges keep their flags', () => {
    const m = editMeshFrom(primitive('cube', {}));
    runOk(box, m, null, {});
    expect(seams(m)).toHaveLength(12);
    runOk(planar, m, null, { axis: 'y' });
    expect(seams(m)).toEqual([]);
    const plane = editMeshFrom(primitive('plane', { subdivisionsWidth: 2 }));
    plane.begin('mark');
    plane.setEdgeFlags(0, plane.edgeFlags(0) | EDGE_SEAM);
    plane.end();
    expect(plane.edgeFaceCount(0)).toBe(1);
    runOk(planar, plane, null, {});
    expect(seams(plane)).toEqual([0]);
  });

  it('cylindrical: the side edge on the wrap (−Z) is a seam with u = 0 on one side and the full width on the other', () => {
    const m = editMeshFrom(primitive('cylinder', { subdivisionsCaps: 0 }));
    const side = allFaces(m).filter((f) => m.faceLen(f) === 4);
    runOk(cylindrical, m, selectionOf('face', side, m.counts), {});
    const wrap = Array.from({ length: m.counts.edges }, (_, e) => e).filter((e) => {
      const a = m.edgeVert(e, 0);
      const b = m.edgeVert(e, 1);
      const p = m.position;
      const onWrap = (v: number) => Math.abs(p[3 * v] as number) < 1e-6 && (p[3 * v + 2] as number) < 0;
      return onWrap(a) && onWrap(b);
    });
    expect(wrap).toHaveLength(1);
    const e = wrap[0] as number;
    expect(seams(m)).toContain(e);
    const us = cornerPairs(m, e)
      .flat()
      .map((c) => uvOf(m, c)[0])
      .sort((a, b) => a - b);
    expect(us[0]).toBeCloseTo(0, 9);
    expect(us[1]).toBeCloseTo(0, 9);
    expect(us[2]).toBeCloseTo(1, 9);
    expect(us[3]).toBeCloseTo(1, 9);
  });
});

describe('runs', () => {
  it('positions, topology, hardness and other layers never change; the flags are topology: false', () => {
    for (const op of OPS) {
      expect(op.flags).toMatchObject({ adjustable: true, repeatable: true, topology: false });
      const m = editMeshFrom(primitive('torus', {}));
      const before = geometry(m);
      const { delta } = runChecked(op, m, null, {});
      expect(geometry(m)).toEqual(before);
      expect(delta?.dirty.topology).toBe(false);
      expect(delta?.dirty.layers).toContain('uv0');
    }
  });

  it('object mode maps every visible face; a face selection only its faces (the others keep their uv0)', () => {
    const m = editMeshFrom(primitive('cube', {}));
    const before = Array.from({ length: m.counts.corners }, (_, c) => uvOf(m, c));
    const r = runOk(planar, m, selectionOf('face', [0, 2], m.counts), { axis: 'z' });
    expect(Array.from(r.selection.faces.toArray())).toEqual([0, 2]);
    const others = Array.from({ length: m.counts.corners }, (_, c) => c).filter(
      (c) => ![0, 2].includes(m.cornerFace(c)),
    );
    expect(others.map((c) => uvOf(m, c))).toEqual(others.map((c) => before[c]));
    const hidden = { verts: new BitSet(8), edges: new BitSet(12), faces: new BitSet(6) };
    hidden.faces.add(5);
    const all = editMeshFrom(primitive('cube', {}));
    const kept = Array.from({ length: all.counts.corners }, (_, c) => uvOf(all, c));
    const whole = runOk(box, all, null, { fit: false }, ctxOf(all, { hidden }));
    expect(whole.selection.faces.count()).toBe(0);
    for (let c = 0; c < all.counts.corners; c++) {
      const f = all.cornerFace(c);
      // Raw box values are the primitive's less ½ on visible faces; the hidden face is untouched.
      const [u, v] = kept[c] as [number, number];
      expect(uvOf(all, c)).toEqual(f === 5 ? [u, v] : [Math.fround(u - 0.5), Math.fround(v - 0.5)]);
    }
  });

  it('adds uv0 to a mesh without it', () => {
    const m = editMeshFrom(buildMeshData({ positions: [0, 0, 0, 2, 0, 0, 2, 0, -1, 0, 0, -1], faces: [[0, 1, 2, 3]] }));
    expect(m.layer('uv0')).toBeUndefined();
    runOk(planar, m, null, {});
    expect(Array.from({ length: 4 }, (_, c) => uvOf(m, c))).toEqual([
      [0, 0],
      [1, 0],
      [1, 0.5],
      [0, 0.5],
    ]);
  });

  it('refusals: no faces to map, a camera projection without a camera', () => {
    const m = editMeshFrom(primitive('cube', {}));
    const ctx = ctxOf(m);
    for (const op of OPS) {
      for (const sel of [
        selectionOf('vertex', [0], m.counts),
        selectionOf('edge', [0], m.counts),
        selectionOf('face', [], m.counts),
      ]) {
        expect(op.poll(m, sel, ctx)).toMatchObject({ code: 'uv.no-faces' });
        expect(op.run(m, sel, {}, ctx)).toMatchObject({ code: 'uv.no-faces' });
      }
      const hidden = { verts: new BitSet(8), edges: new BitSet(12), faces: new BitSet(6) };
      for (let f = 0; f < 6; f++) hidden.faces.add(f);
      expect(op.poll(m, null, ctxOf(m, { hidden }))).toMatchObject({ code: 'uv.no-faces' });
    }
    for (const camera of [null, { direction: [0, 1, 0], up: [0, 1, 0] }, { direction: [0, 0, -1] }, 'front']) {
      const { result } = runChecked(planar, m, null, { axis: 'camera', camera });
      expect(isRefusal(result) && result.code).toBe('uv.no-camera');
    }
  });

  it('the pane camera: the front view equals planar Z; the camera is recorded in the resolved args', () => {
    const camera = { direction: [0, 0, -1], up: [0, 1, 0] };
    const a = uvCase('mesh.uv.planar', 'sphere', {}, { axis: 'camera', camera });
    const b = uvCase('mesh.uv.planar', 'sphere', {}, { axis: 'z' });
    expect(a).toEqual(b);
    const m = editMeshFrom(primitive('cube', {}));
    const r = runOk(planar, m, null, { axis: 'camera', camera });
    expect(r.resolvedArgs).toEqual({ axis: 'camera', fit: true, camera });
    // A mesh turned 90° about +Y seen from the front: its local +Z side faces the camera's right.
    const s = Math.SQRT1_2;
    const turned = editMeshFrom(primitive('plane', { width: 2 }));
    const placed = runOk(
      planar,
      turned,
      null,
      { axis: 'camera', camera: { direction: [0, -1, 0], up: [0, 0, -1] }, fit: false },
      ctxOf(turned, { placement: { t: [5, 0, 0], q: [0, s, 0, s], s: [1, 1, 1] } }),
    );
    expect(isRefusal(placed)).toBe(false);
    // Looking down with −Z up: right = +X world = local +Z (after the turn), so u spans the plane's depth (1 m)
    // and v its width (2 m).
    const us = Array.from({ length: turned.counts.corners }, (_, c) => uvOf(turned, c)[0]);
    const vs = Array.from({ length: turned.counts.corners }, (_, c) => uvOf(turned, c)[1]);
    expect(Math.max(...us) - Math.min(...us)).toBeCloseTo(1, 6);
    expect(Math.max(...vs) - Math.min(...vs)).toBeCloseTo(2, 6);
  });

  it('symmetry: a one-sided face selection maps the mirrored faces too; faces without a partner warn', () => {
    const m = editMeshFrom(primitive('cube', { subdivisionsWidth: 2 }));
    const map = standInSymmetryMap(m, 'x');
    const plusX = allFaces(m).filter((f) => faceCentroid(m, f)[0] > 0.1 && faceNormal(m, f)[1] > 0.5);
    expect(plusX).toHaveLength(1);
    const r = runOk(
      box,
      m,
      selectionOf('face', plusX, m.counts),
      {},
      ctxOf(m, { symmetry: { map, preserveSeam: true } }),
    );
    expect(Array.from(r.selection.faces.toArray())).toEqual(
      [...plusX, map.face[plusX[0] as number] as number].sort((a, b) => a - b),
    );
    expect(r.warnings).toEqual([]);
    const lonely = { ...map, face: map.face.map((p, f) => (f === plusX[0] ? -1 : p)) };
    const again = editMeshFrom(primitive('cube', { subdivisionsWidth: 2 }));
    const w = runOk(
      box,
      again,
      selectionOf('face', plusX, again.counts),
      {},
      ctxOf(again, { symmetry: { map: lonely, preserveSeam: true } }),
    );
    expect(w.warnings.map((x) => [x.code, x.count])).toEqual([['symmetry.unmatched-partner', 1]]);
    expect(w.selection.faces.count()).toBe(1);
  });

  it('P1 + P5: random primitives, ops, selections and args through the op harness', () => {
    let ran = 0;
    fc.assert(
      fc.property(
        fc.constantFrom('cube', 'sphere', 'cylinder', 'cone', 'torus', 'plane'),
        fc.integer({ min: 0, max: 2 }),
        fc.option(fc.array(fc.nat(), { minLength: 1, maxLength: 20 }), { nil: null }),
        fc.record({ fit: fc.boolean(), axis: fc.constantFrom('x', 'y', 'z') }),
        (kind, which, seeds, args) => {
          const m = editMeshFrom(primitive(kind, { subdivisionsWidth: 2 }));
          const sel =
            seeds === null
              ? null
              : selectionOf(
                  'face',
                  seeds.map((s) => s % m.counts.faces),
                  m.counts,
                );
          const { result } = runChecked(OPS[which] as MeshOp, m, sel, args);
          expect(isRefusal(result)).toBe(false);
          ran++;
          const r = result as OpResult;
          const layer = m.layer('uv0');
          for (const f of sel === null ? allFaces(m) : r.selection.faces.toArray()) {
            const start = m.faceCorner(f);
            let c = start;
            do {
              const u = layer?.get(c, 0) as number;
              const v = layer?.get(c, 1) as number;
              expect(Number.isFinite(u) && Number.isFinite(v)).toBe(true);
              expect(!args.fit || (u >= 0 && u <= 1 && v >= 0 && v <= 1)).toBe(true);
              c = m.cornerNext(c);
            } while (c !== start);
          }
        },
      ),
      { numRuns: 150, seed: 9 },
    );
    expect(ran).toBe(150);
  });
});

function faceNormal(m: EditMesh, f: number): [number, number, number] {
  const p = m.position;
  let x = 0;
  let y = 0;
  let z = 0;
  const start = m.faceCorner(f);
  let c = start;
  do {
    const a = 3 * m.cornerVert(c);
    const b = 3 * m.cornerVert(m.cornerNext(c));
    x += ((p[a + 1] as number) - (p[b + 1] as number)) * ((p[a + 2] as number) + (p[b + 2] as number));
    y += ((p[a + 2] as number) - (p[b + 2] as number)) * ((p[a] as number) + (p[b] as number));
    z += ((p[a] as number) - (p[b] as number)) * ((p[a + 1] as number) + (p[b + 1] as number));
    c = m.cornerNext(c);
  } while (c !== start);
  return [x, y, z];
}

function faceCentroid(m: EditMesh, f: number): [number, number, number] {
  const out: [number, number, number] = [0, 0, 0];
  const n = m.faceLen(f);
  const start = m.faceCorner(f);
  let c = start;
  do {
    const v = m.cornerVert(c);
    for (let k = 0; k < 3; k++) out[k] = (out[k] as number) + (m.position[3 * v + k] as number) / n;
    c = m.cornerNext(c);
  } while (c !== start);
  return out;
}
