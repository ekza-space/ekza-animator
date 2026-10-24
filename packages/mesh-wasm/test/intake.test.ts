// The Decimator and the intake chain on a dense, atlas-cut sphere (MODELING-PLAN §7.2 G-a, §7.3): exact triangle
// targets, crack-free UV seams, kept corner values, the palette bake's colours, normalize's frame, determinism.
import { topologyStats, validateMesh } from '@ekza-studio/mesh-core';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  type IntakeJob,
  loadSimplifier,
  normalizeMeshes,
  paletteBake,
  reduceMesh,
  type ReduceArgs,
  runIntakeJob,
  type Simplifier,
  splitBudget,
  triangleCount,
  WRAP_REPEAT,
} from '../src';
import { BANDS, bandTexture, chartedSphere, gridSphere, meshBytes, openEdges } from './support';

const REDUCE: ReduceArgs = {
  triangles: 3000,
  uvWeight: 1,
  normalWeight: 0.5,
  lockSeams: false,
  lockPalette: true,
  lockBorder: false,
  regularize: null,
  prune: false,
  hardAngle: (60 * Math.PI) / 180,
};
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

let simplifier: Simplifier;
beforeAll(async () => {
  simplifier = await loadSimplifier();
});

describe('reduce (meshoptimizer simplifyWithAttributes)', () => {
  const sphere = chartedSphere(100_000, 12);

  it('hits the exact triangle target and keeps the mesh closed along every UV seam', () => {
    const before = topologyStats(sphere);
    expect(before.boundaryLoops).toBe(0);
    for (const target of [3000, 2999, 500, 10_000]) {
      const outcome = reduceMesh(simplifier, sphere, target, REDUCE, false);
      expect(validateMesh(outcome.data)).toEqual([]);
      const tris = triangleCount(outcome.data);
      expect(tris).toBeLessThanOrEqual(target);
      // A closed mesh loses triangles in pairs: the exact target, or one under it for an odd target.
      expect(tris).toBeGreaterThanOrEqual(target - 1);
      expect(openEdges(outcome.data)).toEqual({ border: 0, nonManifold: 0 });
      expect(outcome.warnings).toEqual([]);
    }
  });

  it('keeps every kept corner on its source values (index-only: no new UVs)', () => {
    const outcome = reduceMesh(simplifier, sphere, 3000, REDUCE, false);
    const source = sphere.layers.get('uv0')?.data as Float32Array;
    const known = new Set<string>();
    for (let c = 0; c < sphere.counts.corners; c++) known.add(`${source[2 * c]},${source[2 * c + 1]}`);
    const uv = outcome.data.layers.get('uv0')?.data as Float32Array;
    for (let c = 0; c < outcome.data.counts.corners; c++) expect(known.has(`${uv[2 * c]},${uv[2 * c + 1]}`)).toBe(true);
    expect(outcome.data.layers.has('normal.custom')).toBe(false);
    expect(outcome.facts.seamPoints).toBeGreaterThan(100);
  });

  it('locks seams on request and reports a target it cannot reach', () => {
    const locked = reduceMesh(simplifier, sphere, 3000, { ...REDUCE, lockSeams: true }, false);
    expect(locked.facts.locked).toBeGreaterThan(0);
    const tris = triangleCount(locked.data);
    // Either the target is reached, or the report says it is not.
    expect(locked.warnings.map((w) => w.code)).toEqual(tris > 3000 ? ['reduce.target-unreached'] : []);
    expect(tris > 3000 || tris >= 2999).toBe(true);
    expect(openEdges(locked.data)).toEqual({ border: 0, nonManifold: 0 });
  });

  it('is deterministic: the same input and args give the same bytes', () => {
    const a = reduceMesh(simplifier, sphere, 3000, { ...REDUCE, regularize: true }, false);
    const b = reduceMesh(simplifier, chartedSphere(100_000, 12), 3000, { ...REDUCE, regularize: true }, false);
    expect(meshBytes(a.data)).toEqual(meshBytes(b.data));
    expect(a.facts.regularized).toBe(true);
  });

  it('repairs pinched edges where hundreds of UV charts meet in one point (lock the one-ring, search again)', () => {
    const fan = gridSphere(220, 220, true);
    const outcome = reduceMesh(simplifier, fan, 500, REDUCE, false);
    expect(outcome.facts.repairs).toBeGreaterThan(0);
    expect(openEdges(outcome.data)).toEqual({ border: 0, nonManifold: 0 });
    // The locked pole rings cost triangles: the target may stay out of reach, and the report says so.
    const codes = outcome.warnings.map((w) => w.code);
    expect(codes).not.toContain('reduce.non-manifold');
    expect(codes.includes('reduce.target-unreached')).toBe(triangleCount(outcome.data) > 500);
  });

  it('splits one budget over the parts of a model', () => {
    // Proportional to the triangle counts (the same reduction ratio everywhere), at least 4 triangles a part.
    expect(splitBudget([100_000, 50_000, 300], 3000)).toEqual([1997, 998, 5]);
    expect(splitBudget([10, 20], 3000)).toEqual([10, 20]);
    expect(splitBudget([1000, 1000, 1000], 1000).reduce((s, n) => s + n, 0)).toBeLessThanOrEqual(1000);
  });
});

describe('palette bake (k-means in OKLab)', () => {
  it('finds the texture bands and paints every face with one of at most 16 slots', async () => {
    const reduced = reduceMesh(simplifier, chartedSphere(40_000, 8), 3000, REDUCE, false).data;
    const image = bandTexture(256, 8);
    const outcome = paletteBake(
      [{ data: reduced, materials: [0] }],
      [{ factor: [1, 1, 1, 1], texture: { image, texCoord: 0, wrapS: WRAP_REPEAT, wrapT: WRAP_REPEAT } }],
      { colours: 16, samples: 6 },
    );
    expect(outcome.palette.length).toBeLessThanOrEqual(16);
    // Every band colour is within a few 8-bit steps of a swatch.
    for (const band of BANDS) {
      const best = Math.min(
        ...outcome.palette.map((swatch) => Math.max(...swatch.map((c, i) => Math.abs(c - (band[i] as number))))),
      );
      expect(best).toBeLessThanOrEqual(12);
    }
    const paint = outcome.meshes[0]?.layers.get('paint')?.data as Uint16Array;
    expect(paint.length).toBe(reduced.counts.faces);
    expect(Math.max(...paint)).toBeLessThan(outcome.palette.length);
    expect(validateMesh(outcome.meshes[0] as never)).toEqual([]);
    // Six colours in, six (or a few more noise splits) out: never more than asked.
    const few = paletteBake(
      [{ data: reduced, materials: [0] }],
      [{ factor: [1, 1, 1, 1], texture: { image, texCoord: 0, wrapS: WRAP_REPEAT, wrapT: WRAP_REPEAT } }],
      { colours: 6, samples: 6 },
    );
    expect(few.palette.length).toBeLessThanOrEqual(6);
  });

  it('bakes factor-only materials to their factor', () => {
    const data = chartedSphere(2000, 2);
    const outcome = paletteBake([{ data, materials: [0] }], [{ factor: [1, 0, 0, 1], texture: null }], {
      colours: 16,
      samples: 4,
    });
    expect(outcome.palette).toEqual([[255, 0, 0]]);
  });
});

describe('normalize', () => {
  it('turns a +X-facing model to +Z, scales it to the height and stands it on the origin', () => {
    // A box elongated along +X (its "nose"), 2 units tall, floating at y = 5.
    const sphere = chartedSphere(2000, 2);
    const nose = sphere.position.slice();
    for (let p = 0; p < sphere.counts.points; p++) {
      nose[3 * p] = (nose[3 * p] as number) * (nose[3 * p] > 0 ? 3 : 1);
      nose[3 * p + 1] = (nose[3 * p + 1] as number) * 4 + 5;
    }
    const data = { ...sphere, position: nose };
    const outcome = normalizeMeshes([data], [IDENTITY], {
      forward: '+x',
      up: '+y',
      unit: 1,
      height: 1.7,
      origin: 'bottom-center',
    });
    const out = outcome.meshes[0]?.position as Float32Array;
    let minY = Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let minX = Infinity;
    for (let p = 0; p < data.counts.points; p++) {
      minX = Math.min(minX, out[3 * p] as number);
      maxX = Math.max(maxX, out[3 * p] as number);
      minY = Math.min(minY, out[3 * p + 1] as number);
      maxY = Math.max(maxY, out[3 * p + 1] as number);
      minZ = Math.min(minZ, out[3 * p + 2] as number);
      maxZ = Math.max(maxZ, out[3 * p + 2] as number);
    }
    expect(minY).toBeCloseTo(0, 5);
    expect(maxY).toBeCloseTo(1.7, 5);
    expect((minX + maxX) / 2).toBeCloseTo(0, 5);
    expect((minZ + maxZ) / 2).toBeCloseTo(0, 5);
    // The nose (the point furthest along +X) now points to +Z.
    let nosePoint = 0;
    for (let p = 1; p < data.counts.points; p++)
      if ((nose[3 * p] as number) > (nose[3 * nosePoint] as number)) nosePoint = p;
    expect(out[3 * nosePoint + 2]).toBeCloseTo(maxZ, 5);
    expect(out[3 * nosePoint]).toBeCloseTo(0, 5);
    expect(validateMesh(outcome.meshes[0] as never)).toEqual([]);
  });

  it('refuses parallel axes', () => {
    expect(() =>
      normalizeMeshes([chartedSphere(200, 1)], [IDENTITY], {
        forward: '+y',
        up: '-y',
        unit: 1,
        height: null,
        origin: 'keep',
      }),
    ).toThrow(/different axes/);
  });
});

describe('the intake chain', () => {
  it('normalize → reduce → quadrangulate → palette bake, 100k → ≤ 3,000 triangles, ≤ 16 colours, deterministic', async () => {
    const job = (): IntakeJob => ({
      meshes: [{ key: 'm', data: chartedSphere(100_000, 12), world: IDENTITY, skinned: false, materials: [0] }],
      sources: [
        {
          factor: [1, 1, 1, 1],
          texture: { image: bandTexture(512, 12), texCoord: 0, wrapS: WRAP_REPEAT, wrapT: WRAP_REPEAT },
        },
      ],
      steps: [
        { kind: 'normalize', args: { forward: '+z', up: '+y', unit: 1, height: 1.7, origin: 'bottom-center' } },
        { kind: 'reduce', args: REDUCE },
        { kind: 'quadrangulate', args: { angle: (30 * Math.PI) / 180 } },
        { kind: 'paletteBake', args: { colours: 16, samples: 6 } },
      ],
    });
    const a = await runIntakeJob(job());
    const b = await runIntakeJob(job());
    const mesh = a.meshes[0]?.data;
    if (mesh === undefined) throw new Error('no mesh');
    expect(triangleCount(mesh)).toBeLessThanOrEqual(3000);
    expect(a.palette?.length).toBeLessThanOrEqual(16);
    expect(openEdges(mesh)).toEqual({ border: 0, nonManifold: 0 });
    expect(validateMesh(mesh)).toEqual([]);
    expect(meshBytes(mesh)).toEqual(meshBytes(b.meshes[0]?.data as never));
    expect(a.palette).toEqual(b.palette);
    expect(a.steps.map((s) => s.kind)).toEqual(['normalize', 'reduce', 'quadrangulate', 'paletteBake']);
    const quads = a.steps[2]?.facts['quads'] as number;
    expect(quads).toBeGreaterThan(0);
    process.stdout.write(
      `m7ga chain: ${a.steps.map((s) => `${s.kind} ${s.ms.toFixed(1)} ms ${s.trianglesBefore}→${s.trianglesAfter} ${JSON.stringify(s.facts)}`).join('\n  ')}\n  total ${a.ms.toFixed(1)} ms\n`,
    );
  });
});
