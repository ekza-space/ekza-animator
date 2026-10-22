// The skin bake of Apply Pose as Rest (M6B-SPEC §5.7; AUTORIG-SPEC §10 A0): every bound point moved by the linear
// blend skinning of the posed skeleton, v′ = Σ wₖ·(Wₖ(P)·IBMₖ)·v. The caller passes, per palette entry, the pose delta
// Mₖ = Wₖ(P)·IBMₖ (a column-major 4×4 in the mesh's space, which is character space for skinned meshes) or null for
// an entry the pose leaves at rest (identity).
//
// Exactness: the bake is written as v′ = v + Σ (wₖ/S)·(Mₖ·v − v) with S = Σ wₖ (the stored weights sum to 1 ± 1e-6),
// so a point whose influences are all at rest, and every unweighted point, keeps its coordinates bit-equal; the result
// equals the textbook Σ wₖ·Mₖ·v within (1 − S)·|v|. `bakeSkinnedMesh` rounds the positions to the stored float32,
// carries the derived data along (custom corner normals and morph-target deltas turned by the blended linear part,
// normals renormalized) and shares every other array (topology, flags, UVs, colours, the skin layers: weights are
// never touched).
import { EkzaError } from '@ekza-studio/anim-core';
import type { MeshData } from '../../types';
import type { SkinWeights } from '../types';

/** Per palette entry: the pose delta Mₖ (column-major mat4) or null = identity (the entry stays at rest). */
export type PaletteDeltas = readonly (ArrayLike<number> | null)[];

const NORMAL_CUSTOM = 'normal.custom';
const MORPH_PREFIX = 'morph:';

/** The palette slots of point `p` that move, with their normalized weights; null when the point stays at rest. */
function movingInfluences(
  skin: SkinWeights,
  deltas: PaletteDeltas,
  p: number,
  out: { slots: number[]; weights: number[] },
): boolean {
  out.slots.length = 0;
  out.weights.length = 0;
  let sum = 0;
  for (let k = 0; k < 4; k++) sum += skin.weights[4 * p + k] as number;
  if (!(sum > 0)) return false;
  for (let k = 0; k < 4; k++) {
    const w = skin.weights[4 * p + k] as number;
    if (w === 0) continue;
    const delta = deltas[skin.joints[4 * p + k] as number] ?? null;
    if (delta === null) continue;
    out.slots.push(skin.joints[4 * p + k] as number);
    out.weights.push(w / sum);
  }
  return out.slots.length > 0;
}

/**
 * Linear blend skinning of `positions` (3P) by `deltas` (per palette entry of `skin`): a new Float64Array, points at
 * rest bit-equal (see the module comment). Throws on a size mismatch.
 */
export function bakeSkinnedPoints(
  positions: ArrayLike<number>,
  skin: SkinWeights,
  deltas: PaletteDeltas,
): Float64Array {
  const P = skin.points;
  if (positions.length < 3 * P)
    throw new EkzaError('invalid-input', `bakeSkinnedPoints: ${positions.length / 3} positions, ${P} points`);
  const out = Float64Array.from({ length: 3 * P }, (_, i) => positions[i] as number);
  const scratch = { slots: [] as number[], weights: [] as number[] };
  for (let p = 0; p < P; p++) {
    if (!movingInfluences(skin, deltas, p, scratch)) continue;
    const x = out[3 * p] as number;
    const y = out[3 * p + 1] as number;
    const z = out[3 * p + 2] as number;
    let dx = 0;
    let dy = 0;
    let dz = 0;
    for (let i = 0; i < scratch.slots.length; i++) {
      const m = deltas[scratch.slots[i] as number] as ArrayLike<number>;
      const w = scratch.weights[i] as number;
      dx += w * ((m[0] as number) * x + (m[4] as number) * y + (m[8] as number) * z + (m[12] as number) - x);
      dy += w * ((m[1] as number) * x + (m[5] as number) * y + (m[9] as number) * z + (m[13] as number) - y);
      dz += w * ((m[2] as number) * x + (m[6] as number) * y + (m[10] as number) * z + (m[14] as number) - z);
    }
    out[3 * p] = x + dx;
    out[3 * p + 1] = y + dy;
    out[3 * p + 2] = z + dz;
  }
  return out;
}

/** The blended linear part L = Σ (wₖ/S)·Rₖ (+ the rest share as identity) of a point, row-major 3×3; null at rest. */
function blendedLinear(
  skin: SkinWeights,
  deltas: PaletteDeltas,
  p: number,
  scratch: { slots: number[]; weights: number[] },
): Float64Array | null {
  if (!movingInfluences(skin, deltas, p, scratch)) return null;
  const L = new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  for (let i = 0; i < scratch.slots.length; i++) {
    const m = deltas[scratch.slots[i] as number] as ArrayLike<number>;
    const w = scratch.weights[i] as number;
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        L[3 * r + c] = (L[3 * r + c] as number) + w * ((m[4 * c + r] as number) - (r === c ? 1 : 0));
      }
    }
  }
  return L;
}

function turn(L: Float64Array, x: number, y: number, z: number): [number, number, number] {
  return [
    (L[0] as number) * x + (L[1] as number) * y + (L[2] as number) * z,
    (L[3] as number) * x + (L[4] as number) * y + (L[5] as number) * z,
    (L[6] as number) * x + (L[7] as number) * y + (L[8] as number) * z,
  ];
}

/**
 * A new revision of `data` baked by `deltas` (see the module comment): positions (float32), custom corner normals and
 * morph deltas; every other array shared. Returns `data` itself when no point moves.
 */
export function bakeSkinnedMesh(data: MeshData, skin: SkinWeights, deltas: PaletteDeltas): MeshData {
  const P = data.counts.points;
  if (skin.points !== P)
    throw new EkzaError('invalid-input', `bakeSkinnedMesh: the skin has ${skin.points} points, the mesh ${P}`);
  const scratch = { slots: [] as number[], weights: [] as number[] };
  const linear: (Float64Array | null)[] = [];
  let moved = false;
  for (let p = 0; p < P; p++) {
    const L = blendedLinear(skin, deltas, p, scratch);
    linear.push(L);
    if (L !== null) moved = true;
  }
  if (!moved) return data;
  const baked = bakeSkinnedPoints(data.position, skin, deltas);
  const position = Float32Array.from(baked);
  const layers = new Map(data.layers);
  for (const [name, layer] of data.layers) {
    if (layer.def.type !== 'f32' || layer.def.comps !== 3) continue;
    const corner = name === NORMAL_CUSTOM && layer.def.domain === 'corner';
    const morph = name.startsWith(MORPH_PREFIX) && layer.def.domain === 'point';
    if (!corner && !morph) continue;
    const values = Float32Array.from(layer.data as Float32Array);
    const count = values.length / 3;
    for (let i = 0; i < count; i++) {
      const p = corner ? (data.cornerVert[i] as number) : i;
      const L = linear[p] ?? null;
      if (L === null) continue;
      const x = values[3 * i] as number;
      const y = values[3 * i + 1] as number;
      const z = values[3 * i + 2] as number;
      if (x === 0 && y === 0 && z === 0) continue;
      let v = turn(L, x, y, z);
      if (corner) {
        const l = Math.hypot(v[0], v[1], v[2]);
        if (l > 0) v = [v[0] / l, v[1] / l, v[2] / l];
      }
      values[3 * i] = v[0];
      values[3 * i + 1] = v[1];
      values[3 * i + 2] = v[2];
    }
    layers.set(name, { def: layer.def, data: values });
  }
  return { ...data, position, layers };
}
