// M6A-SPEC §5.13 Mirror and Symmetrize (B4): the half-cube oracle 8/12/5 → 12/20/10 (closed, manifold, outward), the
// cut of a whole cube, `keep`, `cutMesh` off, `mergeMode: 'none'`, the merge threshold snap, layers by their mirror
// rules (U flip, morph axis, `_L`/`_R` swap), the world plane, mirrored quad diagonals; Symmetrize from either side,
// seam vertices onto the plane, unmatched vertices reported.
import { describe, expect, it } from 'vitest';
import {
  BUILTIN_LAYERS,
  type EditMesh,
  editMeshFrom,
  MESH_OPS,
  morphLayer,
  primitive,
  selectionOf,
  topologyStats,
  triangulate,
  validateMesh,
} from '../../../src';
import { buildMeshData, signedVolume, vef } from '../../../src/testing';
import { removeFaces } from '../../../src/subset/setops';
import { halfCube as sharedHalfCube } from '../determinism';
import { context, faceVertList, facesWhere, position, refusedCode, runOk, vertexAt } from '../harness';
import { asymmetry, testSymmetryMap } from '../symmetry-fixture';

const mirror = MESH_OPS['mesh.mirror'] as NonNullable<(typeof MESH_OPS)[string]>;
const symmetrize = MESH_OPS['mesh.symmetrize'] as NonNullable<(typeof MESH_OPS)[string]>;

/** The +X half of a unit cube (8/12/5): a centre loop by Multi-Cut, −X faces removed (E2E-MOD-09). */
function halfCube(): EditMesh {
  const m = sharedHalfCube();
  expect(vef(m)).toBe('8/12/5');
  return m;
}

describe('mesh.mirror', () => {
  it('half cube → 12/20/10: closed, manifold, outward; whole mesh selected', () => {
    const m = halfCube();
    const result = runOk(m, mirror, null);
    expect(vef(m)).toBe('12/20/10');
    const stats = topologyStats(m);
    expect([stats.boundaryLoops, stats.nonManifoldEdges, stats.nonManifoldVerts]).toEqual([0, 0, 0]);
    expect(signedVolume(m)).toBeCloseTo(1, 6);
    expect(result.selection.kind).toBe('face');
    expect(result.selection.faces.count()).toBe(10);
    expect(asymmetry(m)).toBe(0);
    expect(validateMesh(m)).toEqual([]);
  });

  it('cutMesh clips a whole cube at the plane, then mirrors: 12/20/10; keep negative mirrors the other half', () => {
    for (const keep of ['positive', 'negative'] as const) {
      const m = editMeshFrom(primitive('cube', { width: 2 }));
      // Shift so the halves differ: the +X half is longer.
      m.begin('shift');
      for (let v = 0; v < m.counts.points; v++) {
        const p = position(m, v);
        m.setPosition(v, p[0] + 0.5, p[1], p[2]);
      }
      m.end();
      runOk(m, mirror, null, { keep });
      expect(vef(m)).toBe('12/20/10');
      expect(topologyStats(m).boundaryLoops).toBe(0);
      expect(signedVolume(m)).toBeGreaterThan(0);
      const xs = [...Array(m.counts.points).keys()].map((v) => position(m, v)[0]);
      expect(Math.max(...xs)).toBeCloseTo(keep === 'positive' ? 1.5 : 0.5, 6);
      expect(Math.min(...xs)).toBeCloseTo(keep === 'positive' ? -1.5 : -0.5, 6);
    }
  });

  it('mergeMode none keeps the halves apart (16/24/10); cutMesh off mirrors everything', () => {
    const m = halfCube();
    runOk(m, mirror, null, { mergeMode: 'none' });
    expect(vef(m)).toBe('16/24/10');
    expect(topologyStats(m).shells).toBe(2);
    const whole = editMeshFrom(primitive('cube', {}));
    // A unit cube moved to x ∈ [1, 2]: nothing on the plane, the copy lands at x ∈ [−2, −1].
    whole.begin('move');
    for (let v = 0; v < whole.counts.points; v++) {
      const p = position(whole, v);
      whole.setPosition(v, p[0] + 1.5, p[1], p[2]);
    }
    whole.end();
    runOk(whole, mirror, null, { cutMesh: false });
    expect(vef(whole)).toBe('16/24/12');
    expect(signedVolume(whole)).toBeCloseTo(2, 6);
  });

  it('vertices within mergeThreshold snap onto the plane and weld', () => {
    const m = halfCube();
    m.begin('nudge');
    for (let v = 0; v < m.counts.points; v++) {
      const p = position(m, v);
      if (p[0] === 0) m.setPosition(v, 0.0004, p[1], p[2]);
    }
    m.end();
    runOk(m, mirror, null);
    expect(vef(m)).toBe('12/20/10');
    for (let v = 0; v < m.counts.points; v++) expect(Math.abs(position(m, v)[0])).not.toBeCloseTo(0.0004, 6);
  });

  it('layers follow their mirror rules: U flips with flipUVs, morph deltas negate the axis and swap _L/_R', () => {
    const m = halfCube();
    m.begin('layers');
    const left = m.addLayer(morphLayer('Blink_L'));
    m.addLayer(morphLayer('Blink_R'));
    const tip = vertexAt(m, [0.5, 0.5, 0.5]);
    left.set(tip, 0, 0.1);
    left.set(tip, 1, 0.2);
    m.end();
    runOk(m, mirror, null, { flipUVs: true });
    const copy = vertexAt(m, [-0.5, 0.5, 0.5]);
    const right = m.layer('morph:Blink_R');
    expect([right?.get(copy, 0), right?.get(copy, 1), right?.get(copy, 2)]).toEqual([
      Math.fround(-0.1),
      Math.fround(0.2),
      0,
    ]);
    expect(m.layer('morph:Blink_L')?.get(copy, 0)).toBe(0);
    // A mirrored face's corners carry 1 − u of their source corners.
    const uv = m.layer('uv0');
    const source = facesWhere(m, (c) => c[0] === 0.5)[0] as number;
    const mirrored = facesWhere(m, (c) => c[0] === -0.5)[0] as number;
    const us = (f: number) => {
      const out: number[] = [];
      let c = m.faceCorner(f);
      const s = c;
      do {
        out.push(uv?.get(c, 0) as number);
        c = m.cornerNext(c);
      } while (c !== s);
      return out.sort((a, b) => a - b);
    };
    expect(us(mirrored)).toEqual(
      us(source)
        .map((u) => Math.fround(1 - u))
        .sort((a, b) => a - b),
    );
  });

  it('position world: the plane through the world origin, mapped through the placement', () => {
    const m = editMeshFrom(primitive('cube', {}));
    runOk(
      m,
      mirror,
      null,
      { position: 'world', cutMesh: true },
      context({ placement: { t: [1, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] } }),
    );
    // World x ∈ [0.5, 1.5] → the copy at world x ∈ [−1.5, −0.5], local x ∈ [−2.5, −1.5].
    expect(vef(m)).toBe('16/24/12');
    const xs = [...Array(m.counts.points).keys()].map((v) => position(m, v)[0]);
    expect(Math.min(...xs)).toBeCloseTo(-2.5, 6);
  });

  it('mirrored quads show the mirror image of their source’s diagonal', () => {
    // A strip of quads at x ≥ 0 whose tie-break diagonals would not mirror by index alone.
    const m = editMeshFrom(primitive('plane', { width: 2, subdivisionsWidth: 2 }));
    m.begin('half');
    removeFaces(
      m,
      facesWhere(m, (c) => c[0] < 0),
    );
    m.end();
    runOk(m, mirror, null);
    const map = testSymmetryMap(m);
    const t = triangulate(m);
    const shown = (f: number) => {
      const from = t.faceTriStart[f] as number;
      const tri = [0, 1, 2].map((k) => m.cornerVert(t.tris[3 * from + k] as number));
      const verts = faceVertList(m, f);
      const pair =
        tri.includes(verts[0] as number) && tri.includes(verts[2] as number)
          ? [verts[0], verts[2]]
          : [verts[1], verts[3]];
      return (pair as number[]).sort((a, b) => a - b);
    };
    for (let f = 0; f < m.counts.faces; f++) {
      const pf = map.face[f] as number;
      const [a, b] = shown(f) as [number, number];
      expect(shown(pf)).toEqual([map.vertex[a] as number, map.vertex[b] as number].sort((x, y) => x - y));
    }
  });

  it('refuses when nothing lies on the kept side', () => {
    const m = editMeshFrom(buildMeshData({ positions: [-1, 0, 0, -2, 0, 0, -1, 1, 0], faces: [[0, 1, 2]] }));
    expect(refusedCode(m, mirror, null)).toBe('mirror.empty');
  });
});

describe('mesh.symmetrize', () => {
  function perturbed(): EditMesh {
    const m = editMeshFrom(primitive('cube', { width: 2, subdivisionsWidth: 2 }));
    m.begin('perturb');
    const v = vertexAt(m, [1, 0.5, 0.5]);
    m.setPosition(v, 1.0003, 0.5002, 0.5);
    const seam = vertexAt(m, [0, 0.5, 0.5]);
    m.setPosition(seam, 0.0002, 0.5, 0.5);
    m.end();
    return m;
  }

  it('keep positive copies the +X side onto its partners; seam vertices go onto the plane', () => {
    const m = perturbed();
    runOk(m, symmetrize, null, { tolerance: 0.001 });
    expect(position(m, vertexAt(m, [-1.0003, 0.5002, 0.5]))).toEqual([Math.fround(-1.0003), Math.fround(0.5002), 0.5]);
    expect(position(m, vertexAt(m, [0, 0.5, 0.5]))[0]).toBe(0);
    expect(asymmetry(m)).toBe(0);
  });

  it('keep negative copies the −X side', () => {
    const m = perturbed();
    runOk(m, symmetrize, null, { keep: 'negative', tolerance: 0.001 });
    expect(position(m, vertexAt(m, [1, 0.5, 0.5]))).toEqual([1, 0.5, 0.5]);
  });

  it('vertex mode acts on the touched pairs; unmatched vertices are reported', () => {
    const m = perturbed();
    const v = vertexAt(m, [1.0003, 0.5002, 0.5]);
    m.begin('stray');
    const stray = m.makeVert(0.7, 0.1, 0.1);
    m.end();
    const result = runOk(m, symmetrize, selectionOf('vertex', [v, stray], m.counts), { tolerance: 0.001 });
    expect(result.warnings.map((w) => [w.code, w.count])).toEqual([['symmetrize.unmatched', 1]]);
    expect(position(m, vertexAt(m, [-1.0003, 0.5002, 0.5]))[0]).toBe(Math.fround(-1.0003));
    // The seam vertex was not selected: it stays off the plane.
    expect(position(m, vertexAt(m, [0.0002, 0.5, 0.5]))[0]).toBe(Math.fround(0.0002));
  });

  it('uses the symmetry map of the context when it is on the same axis', () => {
    const m = perturbed();
    const map = testSymmetryMap(m, { tolerance: 0.001 });
    runOk(m, symmetrize, null, {}, context({ symmetry: { map, preserveSeam: true } }));
    expect(asymmetry(m)).toBe(0);
    expect(refusedCode(m, symmetrize, selectionOf('vertex', [], m.counts))).toBe('symmetrize.no-vertices');
  });
});

void BUILTIN_LAYERS;
