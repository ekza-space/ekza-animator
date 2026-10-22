// Fixtures of the C6 weight-kernel tests (M6B-SPEC §5.10–§5.13, §5.26 P-S1/P-S2/P-S3/P-S6): the symmetric generated
// body bound with the default auto-lowpoly bind (symmetrized), its geometry and skeleton, and helpers that read
// points as (joint key, weight) maps and compare skins.
import {
  bindSkin,
  type SkinGeometry,
  type SkinSkeleton,
  type SkinWeights,
  skinGeometryOf,
  type WeightContext,
} from '../../src';
import { body, bodySkeletonRows, skeletonOf } from '../m6b-bind/fixtures';
import { DEFAULT_ARGS } from '../m6b-bind/goldens';

export interface Bound {
  readonly geometry: SkinGeometry;
  readonly skeleton: SkinSkeleton;
  readonly skin: SkinWeights;
}

let cached: Bound | null = null;

/** The smooth generated body (1.6 m) bound with the defaults (symmetrize on): w(v) = M(w(p(v))) exactly (P-S4). */
export function boundBody(): Bound {
  if (cached !== null) return cached;
  const skeleton = skeletonOf(bodySkeletonRows());
  const geometry = skinGeometryOf(body('smooth'), skeleton.height);
  const { skin } = bindSkin(geometry, skeleton, DEFAULT_ARGS, null);
  cached = { geometry, skeleton, skin };
  return cached;
}

export function context(bound: Bound, holds: readonly string[] = []): WeightContext {
  return { skeleton: bound.skeleton, geometry: bound.geometry, holds: new Set(holds) };
}

/** A point as joint key → weight (non-zero only). */
export function vectorOf(skin: SkinWeights, v: number): Map<string, number> {
  const out = new Map<string, number>();
  for (let k = 0; k < 4; k++) {
    const w = skin.weights[4 * v + k] as number;
    if (w === 0) continue;
    const key = skin.palette[skin.joints[4 * v + k] as number]?.key ?? `#${skin.joints[4 * v + k]}`;
    out.set(key, (out.get(key) ?? 0) + w);
  }
  return out;
}

/** The mirror key of a joint by the L/R name swap of the fixtures. */
export function mirrorKey(key: string): string {
  if (key.startsWith('left')) return `right${key.slice(4)}`;
  if (key.startsWith('right')) return `left${key.slice(5)}`;
  return key;
}

/** The points whose vector is not the exact mirror image of their partner's (`w(v) = M(w(p(v)))`). */
export function asymmetric(bound: Pick<Bound, 'geometry'>, skin: SkinWeights): number[] {
  const out: number[] = [];
  for (let v = 0; v < skin.points; v++) {
    const p = bound.geometry.partner[v] as number;
    if (p < 0) continue;
    const own = vectorOf(skin, v);
    const other = vectorOf(skin, p);
    const image = new Map([...other].map(([key, w]) => [mirrorKey(key), w]));
    if (own.size !== image.size || [...own].some(([key, w]) => image.get(key) !== w)) out.push(v);
  }
  return out;
}

/** The invariants of §5.10 on every point (P-S1): non-negative, ≤ 4, Σ = 1 ± 1e-6 or unweighted. */
export function invalidPoints(skin: SkinWeights): number[] {
  const out: number[] = [];
  for (let v = 0; v < skin.points; v++) {
    let sum = 0;
    let count = 0;
    let bad = false;
    for (let k = 0; k < 4; k++) {
      const w = skin.weights[4 * v + k] as number;
      if (w < 0 || !Number.isFinite(w)) bad = true;
      if (w > 0) {
        count++;
        sum += w;
        if ((skin.joints[4 * v + k] as number) >= skin.palette.length) bad = true;
      }
    }
    if (bad || count > 4 || (count > 0 && Math.abs(sum - 1) > 1e-6)) out.push(v);
  }
  return out;
}

/** The left points (x > 0.05) of the body whose partner is on the right. */
export function leftPoints(bound: Bound): number[] {
  const out: number[] = [];
  for (let v = 0; v < bound.skin.points; v++) {
    const x = bound.geometry.positions[3 * v] as number;
    const p = bound.geometry.partner[v] as number;
    if (x > 0.05 && p >= 0 && p !== v) out.push(v);
  }
  return out;
}

/** Points of the body near a position (within `r`), ascending. */
export function pointsNear(bound: Bound, at: readonly [number, number, number], r: number): number[] {
  const out: number[] = [];
  for (let v = 0; v < bound.skin.points; v++) {
    const dx = (bound.geometry.positions[3 * v] as number) - at[0];
    const dy = (bound.geometry.positions[3 * v + 1] as number) - at[1];
    const dz = (bound.geometry.positions[3 * v + 2] as number) - at[2];
    if (dx * dx + dy * dy + dz * dz <= r * r) out.push(v);
  }
  return out;
}
