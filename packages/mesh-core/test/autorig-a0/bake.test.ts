// AUTORIG-SPEC §10 A0 (mesh-core): the Apply Pose as Rest skin bake — `bakeSkinnedPoints` equals an independent LBS
// evaluation Σ wₖ·Mₖ·v within 1e-6 m, points at rest (all-identity influences, unweighted points) bit-equal;
// `bakeSkinnedMesh` writes float32 positions, turns custom normals (renormalized) and morph deltas by the blended
// linear part, shares every other array (the skin layers: weights bit-equal) and returns the same revision when nothing
// moves; and P-S7 on A-posed Polybot unchanged by A0 (74.2 % exact, ≥ 98 % within one joint, M6B §0.11 I-6).
import { describe, expect, it } from 'vitest';
import {
  bakeSkinnedMesh,
  bakeSkinnedPoints,
  bindSkin,
  type MeshData,
  morphLayer,
  readSkin,
  type SkinWeights,
  skinGeometryOf,
  withSkin,
} from '../../src';
import { BUILTIN_LAYERS } from '../../src/layers/builtin';
import { DEFAULT_ARGS } from '../m6b-bind/goldens';
import { polybot } from '../m6b-bind/polybot';

/** Rotation about Z by `a` through the pivot (px, py), column-major. */
function turnZ(a: number, px: number, py: number): Float64Array {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return new Float64Array([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, px - (c * px - s * py), py - (s * px + c * py), 0, 1]);
}

/** The textbook LBS of one point: Σ wₖ·Mₖ·v (identity for null entries), weights normalized by their sum. */
function lbs(v: readonly number[], skin: SkinWeights, deltas: readonly (Float64Array | null)[], p: number): number[] {
  let sum = 0;
  for (let k = 0; k < 4; k++) sum += skin.weights[4 * p + k] as number;
  if (sum === 0) return [...v];
  const out = [0, 0, 0];
  for (let k = 0; k < 4; k++) {
    const w = (skin.weights[4 * p + k] as number) / sum;
    if (w === 0) continue;
    const m = deltas[skin.joints[4 * p + k] as number] ?? null;
    for (let r = 0; r < 3; r++) {
      const moved =
        m === null
          ? (v[r] as number)
          : (m[r] as number) * (v[0] as number) +
            (m[4 + r] as number) * (v[1] as number) +
            (m[8 + r] as number) * (v[2] as number) +
            (m[12 + r] as number);
      out[r] = (out[r] as number) + w * moved;
    }
  }
  return out;
}

/** A-posed Polybot bound with `auto-lowpoly` on its own skeleton (P-S7's setup), as a skinned MeshData. */
function boundPolybot() {
  const pb = polybot('apose');
  const geom = skinGeometryOf(pb.mesh, pb.skeleton.height);
  const { skin } = bindSkin(geom, pb.skeleton, { ...DEFAULT_ARGS, symmetrize: false }, null);
  return { pb, skin, data: withSkin(pb.mesh, skin) };
}

/** Deltas turning the right arm chain (every palette entry whose key names the right arm or hand) 40° about Z. */
function armDeltas(skin: SkinWeights, pivot: readonly [number, number]): (Float64Array | null)[] {
  const turn = turnZ((40 * Math.PI) / 180, pivot[0], pivot[1]);
  return skin.palette.map((entry) =>
    /right(Upper|Lower)Arm|rightHand|Right(Hand|Arm|ForeArm)/.test(entry.key) ? turn : null,
  );
}

describe('bakeSkinnedPoints', () => {
  it('equals an independent LBS within 1e-6 m; points at rest stay bit-equal', () => {
    const { pb, skin, data } = boundPolybot();
    const deltas = armDeltas(skin, [-0.134, 0.623]);
    expect(deltas.filter((d) => d !== null).length).toBeGreaterThanOrEqual(3);
    const baked = bakeSkinnedPoints(data.position, skin, deltas);
    let maxError = 0;
    let atRest = 0;
    let movedPoints = 0;
    const restMismatch: number[] = [];
    for (let p = 0; p < skin.points; p++) {
      const v = [data.position[3 * p], data.position[3 * p + 1], data.position[3 * p + 2]] as number[];
      const expected = lbs(v, skin, deltas, p);
      maxError = Math.max(maxError, Math.hypot(...expected.map((e, c) => e - (baked[3 * p + c] as number))));
      let moves = false;
      for (let k = 0; k < 4; k++) {
        if ((skin.weights[4 * p + k] as number) > 0 && deltas[skin.joints[4 * p + k] as number] !== null) moves = true;
      }
      if (moves) movedPoints++;
      else {
        atRest++;
        if (v.some((value, c) => !Object.is(value, baked[3 * p + c]))) restMismatch.push(p);
      }
    }
    expect(maxError).toBeLessThan(1e-6);
    expect(movedPoints).toBeGreaterThan(50);
    expect(atRest).toBeGreaterThan(skin.points / 2);
    expect(restMismatch).toEqual([]);
    expect(pb.mesh.counts.points).toBe(skin.points);
  });

  it('unweighted points and all-null deltas leave every coordinate bit-equal', () => {
    const skin: SkinWeights = {
      points: 2,
      palette: [{ key: 'a', parent: null, mirror: null }],
      joints: new Uint16Array(8),
      weights: new Float32Array([0, 0, 0, 0, 1, 0, 0, 0]),
    };
    const positions = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5, 0.6]);
    expect(Array.from(bakeSkinnedPoints(positions, skin, [null]))).toEqual(Array.from(positions));
    const moved = bakeSkinnedPoints(positions, skin, [turnZ(Math.PI / 2, 0, 0)]);
    expect([moved[0], moved[1], moved[2]]).toEqual([positions[0], positions[1], positions[2]]);
    expect(moved[3]).toBeCloseTo(-0.5, 7);
    expect(moved[4]).toBeCloseTo(0.4, 7);
  });
});

describe('bakeSkinnedMesh', () => {
  it('float32 positions; the skin layers and the topology shared (weights bit-equal); same revision at rest', () => {
    const { skin, data } = boundPolybot();
    expect(
      bakeSkinnedMesh(
        data,
        skin,
        skin.palette.map(() => null),
      ),
    ).toBe(data);
    const baked = bakeSkinnedMesh(data, skin, armDeltas(skin, [-0.134, 0.623]));
    expect(baked).not.toBe(data);
    expect(baked.position).toBeInstanceOf(Float32Array);
    expect(baked.cornerVert).toBe(data.cornerVert);
    expect(baked.faceFlags).toBe(data.faceFlags);
    expect(baked.edgeFlags).toBe(data.edgeFlags);
    expect(baked.layers.get('skin.weights')).toBe(data.layers.get('skin.weights'));
    expect(baked.layers.get('skin.joints')).toBe(data.layers.get('skin.joints'));
    const after = readSkin(baked) as SkinWeights;
    expect(Array.from(after.weights)).toEqual(Array.from(skin.weights));
    expect(Array.from(after.joints)).toEqual(Array.from(skin.joints));
  });

  it('turns custom normals (unit) and morph deltas by the blended linear part', () => {
    const { skin, data } = boundPolybot();
    const C = data.cornerVert.length;
    const P = data.counts.points;
    const normals = new Float32Array(3 * C);
    for (let c = 0; c < C; c++) normals[3 * c + 1] = 1;
    const morph = new Float32Array(3 * P);
    for (let p = 0; p < P; p++) morph[3 * p + 1] = 0.01;
    const layers = new Map(data.layers);
    layers.set('normal.custom', { def: BUILTIN_LAYERS.normalCustom, data: normals });
    layers.set('morph:test', { def: morphLayer('test'), data: morph });
    const withExtras: MeshData = { ...data, layers };
    const deltas = skin.palette.map(() => turnZ(Math.PI / 2, 0, 0));
    const baked = bakeSkinnedMesh(withExtras, skin, deltas);
    const n = baked.layers.get('normal.custom')?.data as Float32Array;
    const d = baked.layers.get('morph:test')?.data as Float32Array;
    // Every point turned 90° about Z: +Y normals become −X, +Y deltas become −X·0.01.
    for (const c of [0, Math.floor(C / 2), C - 1]) {
      expect(n[3 * c]).toBeCloseTo(-1, 6);
      expect(n[3 * c + 1]).toBeCloseTo(0, 6);
    }
    for (const p of [0, Math.floor(P / 2), P - 1]) {
      expect(d[3 * p]).toBeCloseTo(-0.01, 7);
      expect(d[3 * p + 1]).toBeCloseTo(0, 7);
    }
  });
});

describe('P-S7 on A-posed Polybot (unchanged by A0)', () => {
  it('74.2 % exact, ≥ 98 % within one joint of the artist', () => {
    const { pb, skin } = boundPolybot();
    const keyOf = (p: number): string => {
      let best = 0;
      for (let k = 1; k < 4; k++)
        if ((skin.weights[4 * p + k] as number) > (skin.weights[4 * p + best] as number)) best = k;
      return skin.palette[skin.joints[4 * p + best] as number]?.key as string;
    };
    let exact = 0;
    let within = 0;
    const parent = pb.skeleton.parent;
    for (let p = 0; p < skin.points; p++) {
      const ours = pb.skeleton.keys.indexOf(keyOf(p));
      const artist = pb.dominant[p] as number;
      if (ours === artist) exact++;
      if (ours === artist || parent[ours] === artist || parent[artist] === ours) within++;
    }
    expect(Math.round((1000 * exact) / skin.points) / 10).toBe(74.2);
    expect(within / skin.points).toBeGreaterThanOrEqual(0.98);
  });
});
