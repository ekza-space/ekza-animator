// Soft-selection weights (M6A-SPEC §5.15): the six presets at sample distances (1e-9 against the float32 rounding of
// the preset), Volume (world Euclidean) vs Surface (geodesic along visible edges, cut at r), world-space radii under a
// scaled placement, hidden vertices and edges, custom AnimCurve falloffs and caller errors.
import { type AnimCurve, makeKeyData } from '@ekza-studio/anim-core';
import { describe, expect, it } from 'vitest';
import { BitSet, editMeshFrom, softWeights } from '../../src';
import { FALLOFF_PRESETS, presetFalloff } from '../../src/soft/falloff';
import { buildMeshData } from '../../src/testing';
import { hiddenSet, IDENTITY, mesh, position, vertexAt } from '../select/fixtures';

/** A strip of quads along +X: vertices at x = k · step (k = 0…n), z = 0 and z = 1. */
function strip(n: number, step: number): ReturnType<typeof editMeshFrom> {
  const positions: number[] = [];
  for (let k = 0; k <= n; k++) positions.push(k * step, 0, 0);
  for (let k = 0; k <= n; k++) positions.push(k * step, 0, 1);
  const faces: number[][] = [];
  for (let k = 0; k < n; k++) faces.push([k, k + 1, n + 2 + k, n + 1 + k]);
  return editMeshFrom(buildMeshData({ positions, faces }));
}

const seedsOf = (m: ReturnType<typeof mesh>, vs: readonly number[]): BitSet => {
  const s = new BitSet(m.counts.points);
  for (const v of vs) s.add(v);
  return s;
};

describe('presets', () => {
  it('match the §5.15 formulas', () => {
    const f = (x: number) => ({
      smooth: 1 - (3 * x * x - 2 * x * x * x),
      linear: 1 - x,
      sharp: (1 - x) ** 2,
      root: Math.sqrt(1 - x),
      sphere: Math.sqrt(1 - x * x),
      constant: 1,
    });
    for (const x of [0, 0.125, 0.25, 0.5, 0.75, 0.875, 1]) {
      for (const curve of FALLOFF_PRESETS) expect(presetFalloff(curve, x)).toBeCloseTo(f(x)[curve], 12);
    }
    expect(presetFalloff('linear', -1)).toBe(1);
    expect(presetFalloff('linear', 2)).toBe(0);
  });

  it('Volume weights equal the preset at sample distances (1e-9), 0 beyond the radius', () => {
    // Dyadic positions: distances are exact, so weights are exactly the float32 rounding of the preset.
    const m = strip(16, 0.125);
    const seeds = seedsOf(m, [0]);
    for (const curve of FALLOFF_PRESETS) {
      const w = softWeights(m, seeds, { radius: 1, falloff: 'volume', curve, placement: IDENTITY });
      for (let k = 0; k <= 16; k++) {
        const d = k * 0.125;
        const expected = k === 0 ? 1 : d > 1 ? 0 : presetFalloff(curve, d);
        expect(Math.abs((w[k] as number) - Math.fround(expected))).toBeLessThanOrEqual(1e-9);
      }
      // The far row (z = 1): d = √(x² + 1) ≥ 1, so only the vertex right above the seed is at the radius.
      expect(w[17]).toBe(Math.fround(presetFalloff(curve, 1)));
      for (let k = 18; k <= 33; k++) expect(w[k]).toBe(0);
    }
  });

  it('radius 0: the seeds weigh 1, nothing else', () => {
    const m = strip(4, 0.25);
    const w = softWeights(m, seedsOf(m, [2]), { radius: 0, falloff: 'volume', curve: 'smooth', placement: IDENTITY });
    expect(Array.from(w)).toEqual([0, 0, 1, 0, 0, 0, 0, 0, 0, 0]);
  });
});

describe('Volume vs Surface', () => {
  /** A U-shaped strip: two arms 1 m apart joined at the far end (geodesic ≫ Euclidean across the gap). */
  function uShape(): ReturnType<typeof editMeshFrom> {
    // Arm A along x at z = 0…0.25, arm B at z = 1…1.25, joined by a bridge at x = 2…2.25.
    const positions: number[] = [];
    const quads: number[][] = [];
    const vertex = new Map<string, number>();
    const at = (x: number, z: number): number => {
      const key = `${x},${z}`;
      if (!vertex.has(key)) {
        vertex.set(key, positions.length / 3);
        positions.push(x, 0, z);
      }
      return vertex.get(key) as number;
    };
    const quad = (x0: number, z0: number, x1: number, z1: number): void => {
      quads.push([at(x0, z0), at(x1, z0), at(x1, z1), at(x0, z1)]);
    };
    for (let k = 0; k < 9; k++) quad(k * 0.25, 0, (k + 1) * 0.25, 0.25);
    for (let k = 0; k < 9; k++) quad(k * 0.25, 1, (k + 1) * 0.25, 1.25);
    for (let j = 1; j < 4; j++) quad(2, j * 0.25, 2.25, (j + 1) * 0.25);
    return editMeshFrom(buildMeshData({ positions, faces: quads }));
  }

  it('Surface follows the edges: across a 0.75 m gap Volume reaches, Surface does not', () => {
    const m = uShape();
    const seed = vertexAt(m, 0, 0, 0.25);
    const across = vertexAt(m, 0, 0, 1);
    const seeds = seedsOf(m, [seed]);
    const volume = softWeights(m, seeds, { radius: 1, falloff: 'volume', curve: 'linear', placement: IDENTITY });
    const surface = softWeights(m, seeds, { radius: 1, falloff: 'surface', curve: 'linear', placement: IDENTITY });
    expect(volume[across]).toBeCloseTo(0.25, 6);
    expect(surface[across]).toBe(0);
    // Along the arm both agree (the geodesic is the straight edge path).
    const along = vertexAt(m, 0.5, 0, 0.25);
    expect(surface[along]).toBeCloseTo(0.5, 6);
    expect(volume[along]).toBeCloseTo(0.5, 6);
    // Geodesic along edges: two edges of 0.25 m (x then z) give 0.5 m where the straight line is 0.354 m.
    const diagonal = vertexAt(m, 0.25, 0, 0);
    expect(surface[diagonal]).toBeCloseTo(1 - 0.5, 6);
    expect(volume[diagonal]).toBeCloseTo(1 - Math.hypot(0.25, 0.25), 6);
  });

  it('Surface on the E2E-MOD-10 plane matches Volume on a flat grid along the grid lines', () => {
    const m = mesh('plane', { width: 10, height: 10, subdivisionsWidth: 99, subdivisionsHeight: 99 });
    expect(m.counts.points).toBe(10_000);
    let centre = -1;
    let best = Infinity;
    for (let v = 0; v < m.counts.points; v++) {
      const [x, , z] = position(m, v);
      const d = Math.hypot(x, z);
      if (d < best) {
        best = d;
        centre = v;
      }
    }
    const seeds = seedsOf(m, [centre]);
    const ctx = { radius: 1.8, curve: 'smooth' as const, placement: IDENTITY };
    const volume = softWeights(m, seeds, { ...ctx, falloff: 'volume' });
    const surface = softWeights(m, seeds, { ...ctx, falloff: 'surface' });
    const [cx, , cz] = position(m, centre);
    let inside = 0;
    let volumeError = 0;
    let rowError = 0;
    let outside = 0;
    for (let v = 0; v < m.counts.points; v++) {
      const [x, , z] = position(m, v);
      const d = Math.hypot(x - cx, z - cz);
      const expected = d > 1.8 ? 0 : presetFalloff('smooth', d / 1.8);
      volumeError = Math.max(volumeError, Math.abs((volume[v] as number) - expected));
      if (d <= 1.8) inside++;
      // Along the seed's grid row the geodesic is the straight distance.
      if (Math.abs(z - cz) < 1e-6) rowError = Math.max(rowError, Math.abs((surface[v] as number) - expected));
      if (d > 1.8) outside = Math.max(outside, surface[v] as number);
    }
    expect(volumeError).toBeLessThan(1e-6);
    expect(rowError).toBeLessThan(1e-5);
    expect(outside).toBe(0);
    expect(inside).toBeGreaterThan(900);
  });
});

describe('world space, hidden, custom curves', () => {
  it('the radius is in world metres: a placement scale of 2 halves the reach in mesh-local units', () => {
    const m = strip(8, 0.125);
    const placement = { t: [5, 1, -2] as const, q: [0, 0.3826834, 0, 0.9238795] as const, s: [2, 2, 2] as const };
    const w = softWeights(m, seedsOf(m, [0]), { radius: 1, falloff: 'volume', curve: 'linear', placement });
    for (let k = 0; k <= 8; k++) expect(w[k]).toBeCloseTo(Math.max(0, 1 - 2 * k * 0.125), 6);
  });

  it('hidden vertices weigh 0 and seed nothing; hidden edges block Surface paths', () => {
    const m = strip(8, 0.125);
    const hidden = hiddenSet(m, { verts: [3] });
    const w = softWeights(m, seedsOf(m, [0]), {
      radius: 1,
      falloff: 'volume',
      curve: 'linear',
      placement: IDENTITY,
      hidden,
    });
    expect(w[3]).toBe(0);
    expect(w[4]).toBeCloseTo(0.5, 6);
    const asSeed = softWeights(m, seedsOf(m, [3]), {
      radius: 1,
      falloff: 'volume',
      curve: 'linear',
      placement: IDENTITY,
      hidden,
    });
    expect(Array.from(asSeed).every((x) => x === 0)).toBe(true);
    // Surface: cut the bottom row at edge 3–4 and the rung… the path goes round through the top row.
    const blocked = hiddenSet(m, { edges: [m.findEdge(3, 4)] });
    const s = softWeights(m, seedsOf(m, [0]), {
      radius: 2,
      falloff: 'surface',
      curve: 'linear',
      placement: IDENTITY,
      hidden: blocked,
    });
    // 0 → 3 along the bottom (0.375), up (1), 3 → 4 on top (0.125), down (1): 2.5 m > 2 → only via the far rungs.
    expect(s[4]).toBe(0);
    expect(s[2]).toBeCloseTo(1 - 0.25 / 2, 6);
  });

  it('a custom AnimCurve falloff evaluates at x = d / r (clamped to [0, 1])', () => {
    const m = strip(8, 0.125);
    const linear = { in: 'linear', out: 'linear' } as const;
    const curve: AnimCurve = {
      keys: [makeKeyData(0, 1, linear), makeKeyData(1, 0, linear)],
      weighted: false,
      pre: 'constant',
      post: 'constant',
    };
    const w = softWeights(m, seedsOf(m, [0]), { radius: 1, falloff: 'volume', curve, placement: IDENTITY });
    for (let k = 0; k <= 8; k++) expect(w[k]).toBeCloseTo(1 - k * 0.125, 5);
  });

  it('reuses `out` when it is long enough; rejects bad radii, falloffs and curves', () => {
    const m = strip(4, 0.25);
    const out = new Float32Array(20).fill(7);
    const w = softWeights(
      m,
      seedsOf(m, [0]),
      { radius: 1, falloff: 'volume', curve: 'linear', placement: IDENTITY },
      out,
    );
    expect(w).toBe(out);
    expect(out[0]).toBe(1);
    expect(out[19]).toBe(7);
    const bad = (ctx: object) => () =>
      softWeights(m, seedsOf(m, [0]), { radius: 1, falloff: 'volume', curve: 'linear', placement: IDENTITY, ...ctx });
    expect(bad({ radius: -1 })).toThrow(expect.objectContaining({ code: 'invalid-argument' }));
    expect(bad({ radius: Number.NaN })).toThrow(expect.objectContaining({ code: 'invalid-argument' }));
    expect(bad({ falloff: 'global' })).toThrow(expect.objectContaining({ code: 'invalid-argument' }));
    expect(bad({ curve: 'bumpy' })).toThrow(expect.objectContaining({ code: 'invalid-argument' }));
  });
});
