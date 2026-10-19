// M6A-SPEC §5.21 `meshToPrimitives` and §5.19 colour outputs (B8): the asset round trip of the fixtures (positions,
// normals, UVs, weights and morph deltas survive Make editable → export), derived morph NORMAL deltas, the tangent
// refusal, index widths, and the palette / vertex-colour / per-colour outputs.
import { readFixture } from '@ekza-animator/doc/testing';
import { BUILTIN_LAYERS, EDGE_HARD, type MeshData, morphLayer, setKernelDebug } from '@ekza-animator/mesh-core';
import { buildMeshData, cubeData } from '@ekza-animator/mesh-core/testing';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseGlb } from '../src/glb/parse';
import { GltfReader } from '../src/gltf/accessor';
import {
  type DetailedPrimitive,
  meshFromGltf,
  meshToPrimitives,
  meshToPrimitivesDetailed,
  type MeshToPrimitivesOptions,
  srgbEotf,
  writePaletteTexture,
} from '../src/mesh';
import type { GlbContainer, PrimitiveOut } from '../src/types';

beforeAll(() => setKernelDebug(true));

const ASSET: MeshToPrimitivesOptions = {
  colourOutput: 'asset',
  palette: null,
  paint: null,
  morphNormals: new Set(),
  hadTangents: false,
  dropTangents: false,
};

function primitivesOf(data: MeshData, opts: Partial<MeshToPrimitivesOptions> = {}): readonly DetailedPrimitive[] {
  const out = meshToPrimitivesDetailed(data, { ...ASSET, ...opts });
  if ('refused' in out) throw new Error(out.reason);
  return out.primitives;
}

/** The default palette "Ekza Default 16" (§5.19), slots 0–15. */
const DEFAULT_16: readonly (readonly [number, number, number])[] = [
  '#f4f4f4',
  '#c2c3c7',
  '#6e7179',
  '#2b2d33',
  '#e04646',
  '#f08a3c',
  '#f2c84b',
  '#8bc34a',
  '#3b9b5a',
  '#3fa7c9',
  '#3d6fd8',
  '#7b4fc9',
  '#e07bb5',
  '#c98b5b',
  '#8a5a3b',
  '#4a3426',
].map((hex) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as [number, number, number]);

/** A faceted unit cube with a paint layer: the top face (+Y) slot 4, the others slot 0. */
function paintedCube(): { readonly data: MeshData; readonly top: number } {
  const cube = cubeData();
  const top = 1; // [3, 2, 6, 7]: y = +0.5
  const paint = new Uint16Array(cube.counts.faces);
  paint[top] = 4;
  const layers = new Map(cube.layers);
  layers.set('paint', { def: BUILTIN_LAYERS.paint, data: paint });
  return { data: { ...cube, layers }, top };
}

function trianglesOf(p: PrimitiveOut): number {
  return p.indices.length / 3;
}

describe('meshToPrimitives: the asset round trip', () => {
  it('Polybot: every kept triangle keeps its corners (position, normal, UV, joints, weights, morph deltas)', async () => {
    const polybot = await parseGlb(readFixture('polybot.vrm'));
    const made = await meshFromGltf(polybot, 0);
    if ('refused' in made) throw new Error(made.reason);
    const out = primitivesOf(made.data, { morphNormals: new Set(made.report.morphNormals) });
    expect(out).toHaveLength(1);
    const p = out[0] as DetailedPrimitive;
    expect(trianglesOf(p)).toBe(made.report.triangles);
    expect(p.indices).toBeInstanceOf(Uint16Array);
    expect(p.targets).toHaveLength(16);
    expect(p.targets.every((t) => t.NORMAL !== undefined && t.NORMAL.length === 3 * p.vertexCount)).toBe(true);
    expect(p.targets.every((t) => t.NORMAL?.every(Number.isFinite) === true)).toBe(true);

    // The original triangles, minus the degenerate ones, in order.
    const reader = new GltfReader(polybot.json, polybot.bin);
    const prim = (
      polybot.json['meshes'] as {
        primitives: { attributes: Record<string, number>; indices: number; targets: Record<string, number>[] }[];
      }[]
    )[0]?.primitives[0];
    if (prim === undefined) throw new Error('no primitive');
    const pos = reader.readFloat(prim.attributes['POSITION'] as number);
    const nrm = reader.readFloat(prim.attributes['NORMAL'] as number);
    const uv = reader.readFloat(prim.attributes['TEXCOORD_0'] as number);
    const joints = reader.readUint(prim.attributes['JOINTS_0'] as number);
    const weights = reader.readFloat(prim.attributes['WEIGHTS_0'] as number);
    const delta0 = reader.readFloat((prim.targets[0] as Record<string, number>)['POSITION'] as number);
    const indices = reader.readUint(prim.indices);
    const same = (a: ArrayLike<number>, i: number, b: ArrayLike<number>, j: number, n: number) => {
      for (let k = 0; k < n; k++) if (a[n * i + k] !== b[n * j + k]) return false;
      return true;
    };
    let t = 0;
    let maxNormalError = 0;
    let maxWeightSumError = 0;
    for (let i = 0; i < indices.length; i += 3) {
      const g = [indices[i], indices[i + 1], indices[i + 2]] as number[];
      if (
        same(pos, g[0] as number, pos, g[1] as number, 3) ||
        same(pos, g[1] as number, pos, g[2] as number, 3) ||
        same(pos, g[0] as number, pos, g[2] as number, 3)
      )
        continue;
      for (let k = 0; k < 3; k++) {
        const o = g[k] as number;
        const v = p.indices[3 * t + k] as number;
        expect(same(pos, o, p.attributes['POSITION'] as Float32Array, v, 3)).toBe(true);
        expect(same(uv, o, p.attributes['TEXCOORD_0'] as Float32Array, v, 2)).toBe(true);
        expect(same(joints, o, p.attributes['JOINTS_0'] as Uint8Array, v, 4)).toBe(true);
        expect(same(delta0, o, (p.targets[0] as { POSITION: Float32Array }).POSITION, v, 3)).toBe(true);
        const n = p.attributes['NORMAL'] as Float32Array;
        const length = Math.hypot(nrm[3 * o] as number, nrm[3 * o + 1] as number, nrm[3 * o + 2] as number);
        for (let c = 0; c < 3; c++) {
          maxNormalError = Math.max(
            maxNormalError,
            Math.abs((n[3 * v + c] as number) - (nrm[3 * o + c] as number) / length),
          );
        }
        const w = p.attributes['WEIGHTS_0'] as Float32Array;
        const sum =
          (w[4 * v] as number) + (w[4 * v + 1] as number) + (w[4 * v + 2] as number) + (w[4 * v + 3] as number);
        maxWeightSumError = Math.max(maxWeightSumError, Math.abs(sum - 1));
        for (let c = 0; c < 4; c++)
          expect(Math.abs((w[4 * v + c] as number) - (weights[4 * o + c] as number))).toBeLessThan(1e-6);
      }
      t++;
    }
    expect(t).toBe(made.report.triangles);
    expect(maxNormalError).toBeLessThan(1e-6);
    expect(maxWeightSumError).toBeLessThan(1e-6);
  });

  it('Seed-san head: one primitive per material slot, every target keeps its POSITION, NORMAL only where it was', async () => {
    const seed: GlbContainer = await parseGlb(readFixture('seed-san.vrm'));
    const made = await meshFromGltf(seed, 2);
    if ('refused' in made) throw new Error(made.reason);
    const out = primitivesOf(made.data, { morphNormals: new Set(made.report.morphNormals) });
    expect(out.map((p) => p.material)).toEqual([0, 1, 2]);
    expect(out.map(trianglesOf).reduce((a, b) => a + b)).toBe(made.report.triangles);
    const names = out[0]?.targetNames ?? [];
    expect(names).toHaveLength(43);
    for (const p of out) {
      p.targets.forEach((target, i) => {
        expect(target.POSITION.length).toBe(3 * p.vertexCount);
        expect(target.NORMAL !== undefined).toBe(made.report.morphNormals.includes(names[i] as string));
      });
    }
  });

  it('is deterministic and uses uint16 indices below 65,536 vertices, uint32 from there', () => {
    const { data } = paintedCube();
    const a = primitivesOf(data);
    const b = primitivesOf(data);
    expect(a).toEqual(b);
    expect(a[0]?.indices).toBeInstanceOf(Uint16Array);
    // 130 × 130 faceted quads on a rough grid: every face has its own normal → 4 vertices per face (67,600).
    const n = 130;
    const positions: number[] = [];
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) positions.push(i, j, ((((i * 73_856_093) ^ (j * 19_349_663)) >>> 0) % 97) / 97);
    }
    const faces: number[][] = [];
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const v = j * (n + 1) + i;
        faces.push([v, v + 1, v + n + 2, v + n + 1]);
      }
    }
    const big = primitivesOf(buildMeshData({ positions, faces, edgeFlags: EDGE_HARD }));
    expect(big[0]?.vertexCount).toBeGreaterThanOrEqual(65_536);
    expect(big[0]?.indices).toBeInstanceOf(Uint32Array);
  });

  it('refuses a mesh that had tangents unless they are dropped', () => {
    const { data } = paintedCube();
    expect(meshToPrimitives(data, { ...ASSET, hadTangents: true })).toMatchObject({ refused: true, code: 'tangents' });
    const refusal = meshToPrimitives(data, { ...ASSET, hadTangents: true }) as { reason: string };
    expect(refusal.reason).toMatch(/M7/);
    expect('primitives' in meshToPrimitives(data, { ...ASSET, hadTangents: true, dropTangents: true })).toBe(true);
  });
});

describe('meshToPrimitives: derived morph NORMAL deltas', () => {
  const flatQuad = (lift: number): MeshData =>
    buildMeshData({
      positions: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0],
      faces: [
        [0, 1, 2],
        [0, 2, 3],
      ],
      layers: [
        { def: morphLayer('lift'), data: [0, 0, 0, 0, 0, 0, 0, 0, lift, 0, 0, 0] },
        { def: morphLayer('still'), data: Array.from({ length: 12 }, () => 0) },
      ],
    });

  it('writes NORMAL for the listed targets only: normals of base + delta minus base normals', () => {
    const out = primitivesOf(flatQuad(0.5), { morphNormals: new Set(['lift', 'still']) });
    const p = out[0] as DetailedPrimitive;
    expect(p.targetNames).toEqual(['lift', 'still']);
    const lift = p.targets[0]?.NORMAL as Float32Array;
    expect(lift.some((v) => Math.abs(v) > 1e-3)).toBe(true);
    expect(p.targets[1]?.NORMAL?.every((v) => v === 0)).toBe(true);
    // Base normal (0,0,1) + delta = the lifted shape's normal at that corner (unit length).
    const base = p.attributes['NORMAL'] as Float32Array;
    for (let v = 0; v < p.vertexCount; v++) {
      const x = (base[3 * v] as number) + (lift[3 * v] as number);
      const y = (base[3 * v + 1] as number) + (lift[3 * v + 1] as number);
      const z = (base[3 * v + 2] as number) + (lift[3 * v + 2] as number);
      expect(Math.hypot(x, y, z)).toBeCloseTo(1, 6);
    }
    const none = primitivesOf(flatQuad(0.5), { morphNormals: new Set(['morph:still']) })[0];
    expect(none?.targets[0]?.NORMAL).toBeUndefined();
    expect(none?.targets[1]?.NORMAL).toBeDefined();
  });
});

describe('meshToPrimitives: colour outputs (§5.19)', () => {
  const palette = writePaletteTexture(DEFAULT_16.map((srgb, slot) => ({ slot, srgb })));
  const paint = new Map(DEFAULT_16.map((srgb, slot) => [slot, srgb] as const));

  it('palette texture: every corner of a painted face samples its cell centre', () => {
    const { data, top } = paintedCube();
    const [p] = primitivesOf(data, { colourOutput: 'palette-texture', palette, paint });
    if (p === undefined) throw new Error('no primitive');
    const uv = p.attributes['TEXCOORD_0'] as Float32Array;
    const position = p.attributes['POSITION'] as Float32Array;
    const [u4, v4] = palette.uvOf(4);
    const [u0, v0] = palette.uvOf(0);
    expect([u4, v4]).toEqual([4.5 / 8, 0.5 / 8]);
    for (let i = 0; i < p.indices.length; i++) {
      const v = p.indices[i] as number;
      const face = Math.floor(i / 6); // two triangles per quad face, faces in order
      const expected = face === top ? [u4, v4] : [u0, v0];
      expect([uv[2 * v], uv[2 * v + 1]]).toEqual(expected.map(Math.fround));
      expect(face !== top || position[3 * v + 1] === 0.5).toBe(true);
    }
    expect(p.attributes['COLOR_0']).toBeUndefined();
  });

  it('vertex colour: COLOR_0 VEC3 is the swatch through the exact sRGB EOTF (1e-6), missing slots take slot 0', () => {
    const { data, top } = paintedCube();
    const layers = new Map(data.layers);
    const paintData = Uint16Array.from(layers.get('paint')?.data ?? []);
    paintData[0] = 99; // no live swatch: exported with slot 0's colour
    layers.set('paint', { def: BUILTIN_LAYERS.paint, data: paintData });
    const [p] = primitivesOf({ ...data, layers }, { colourOutput: 'vertex-colour', paint });
    if (p === undefined) throw new Error('no primitive');
    const colour = p.attributes['COLOR_0'] as Float32Array;
    expect(colour.length).toBe(3 * p.vertexCount);
    expect(p.attributes['TEXCOORD_0']).toBeUndefined();
    for (let i = 0; i < p.indices.length; i++) {
      const v = p.indices[i] as number;
      const face = Math.floor(i / 6);
      const srgb = DEFAULT_16[face === top ? 4 : 0] as readonly [number, number, number];
      for (let k = 0; k < 3; k++) {
        expect(Math.abs((colour[3 * v + k] as number) - srgbEotf((srgb[k] as number) / 255))).toBeLessThan(1e-6);
      }
    }
  });

  it('material per colour: one primitive per (slot, swatch) in ascending order', () => {
    const { data } = paintedCube();
    const out = primitivesOf(data, { colourOutput: 'material-per-colour', paint });
    expect(out.map((p) => [p.material, p.swatch, trianglesOf(p)])).toEqual([
      [0, 0, 10],
      [0, 4, 2],
    ]);
  });
});
