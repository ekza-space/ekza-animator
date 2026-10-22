// C6 (with the C5 MVP subset; M6B-SPEC §4.2, §5.21): the `skin.*` problems of one mesh's skin. Pure; the Validation
// service (C7) turns them into rows with their severities and fixes.
//
// - `skin.unweighted-vertex`: a point with Σ = 0;
// - `skin.influences`: more than 4 non-zero entries after duplicate palette indices are merged apart (imports);
// - `skin.weight-sum`: a weighted point with |Σ − 1| > 1e-6;
// - `skin.unreachable-island`: the points the last bind's heat solve could not reach (from the bind report);
// - `skin.review`: the review layer's points (§5.14);
// - `skin.cross-side`: a left point (x > 0.02 H) with more than 0.5 on a right joint, or the reverse — only when the
//   caller passes the positions (`geometry`, an optional extension of the contract's context);
// - `skin.dangling-joint`: a weighted palette key the skeleton does not have;
// - `skin.joint-without-weights`: a deforming joint of the skeleton with no weight on this mesh;
// - `skin.non-deforming-weighted`: points with weight on a helper joint, or on a prop joint when the mesh also carries
//   weight on deforming joints.
import { MAX_INFLUENCES, SUM_TOLERANCE, skeletonIndexOf, sumDesc } from '../normalize';
import type { SkinGeometry, SkinProblem, SkinReview, SkinWeights, WeightContext } from '../types';

export function checkSkin(
  skin: SkinWeights | null,
  ctx: Pick<WeightContext, 'skeleton'> & {
    readonly review: SkinReview | null;
    readonly unreachable: Uint32Array | null;
    /** Optional (not in the §4.2 context): the positions `skin.cross-side` needs. */
    readonly geometry?: Pick<SkinGeometry, 'positions'> | null;
  },
): readonly SkinProblem[] {
  if (skin === null) return [];
  const { skeleton } = ctx;
  const index = skeletonIndexOf(skeleton);
  const P = skin.points;
  const unweighted: number[] = [];
  const influences: number[] = [];
  const sum: number[] = [];
  const crossSide: number[] = [];
  const helper: number[] = [];
  const prop: number[] = [];
  const dangling = new Set<string>();
  const danglingPoints: number[] = [];
  const weighted = new Set<string>();
  let deformingWeight = false;
  const H = skeleton.height > 0 && Number.isFinite(skeleton.height) ? skeleton.height : 1;
  const positions = ctx.geometry?.positions ?? null;
  for (let v = 0; v < P; v++) {
    const values: number[] = [];
    const keys = new Set<string>();
    let onHelper = false;
    let onProp = false;
    let onDangling = false;
    let rightWeight = 0;
    let leftWeight = 0;
    for (let k = 0; k < MAX_INFLUENCES; k++) {
      const w = skin.weights[4 * v + k] as number;
      if (w === 0) continue;
      values.push(w);
      const entry = skin.palette[skin.joints[4 * v + k] as number];
      if (entry === undefined) {
        onDangling = true;
        continue;
      }
      keys.add(entry.key);
      if (!(w > 0)) continue;
      weighted.add(entry.key);
      const s = index.get(entry.key);
      if (s === undefined) {
        dangling.add(entry.key);
        onDangling = true;
        continue;
      }
      // SkinSkeleton has no roles: a non-deforming joint under a deforming one reads as a prop (sockets included),
      // one without a deforming ancestor (the root helper) as a helper.
      if (skeleton.deform[s] === 1) deformingWeight = true;
      else if (isProp(skeleton, s)) onProp = true;
      else onHelper = true;
      if (skeleton.side[s] === 2) rightWeight += w;
      else if (skeleton.side[s] === 1) leftWeight += w;
    }
    const total = sumDesc(values.filter((w) => w > 0));
    if (!(total > 0)) unweighted.push(v);
    else if (Math.abs(total - 1) > SUM_TOLERANCE || values.some((w) => !(w >= 0))) sum.push(v);
    if (keys.size > MAX_INFLUENCES) influences.push(v);
    if (onHelper) helper.push(v);
    if (onProp) prop.push(v);
    if (onDangling) danglingPoints.push(v);
    if (positions !== null) {
      const x = positions[3 * v] as number;
      if ((x > 0.02 * H && rightWeight > 0.5) || (x < -0.02 * H && leftWeight > 0.5)) crossSide.push(v);
    }
  }
  const problems: SkinProblem[] = [];
  const add = (code: SkinProblem['code'], points: readonly number[], joints: readonly string[] = []): void => {
    if (points.length === 0 && joints.length === 0) return;
    problems.push({ code, points: Uint32Array.from(points), joints });
  };
  add('skin.unweighted-vertex', unweighted);
  add('skin.influences', influences);
  add('skin.weight-sum', sum);
  if (ctx.unreachable !== null && ctx.unreachable.length > 0) {
    add(
      'skin.unreachable-island',
      Array.from(ctx.unreachable).filter((v) => v < P),
    );
  }
  if (ctx.review !== null)
    add(
      'skin.review',
      Array.from(ctx.review.points).filter((v) => v < P),
    );
  add('skin.cross-side', crossSide);
  if (dangling.size > 0) add('skin.dangling-joint', danglingPoints, [...dangling].sort());
  const unused: string[] = [];
  skeleton.keys.forEach((key, s) => {
    if (skeleton.deform[s] === 1 && !weighted.has(key)) unused.push(key);
  });
  add('skin.joint-without-weights', [], unused);
  const nonDeforming = [...helper, ...(deformingWeight ? prop : [])].sort((a, b) => a - b);
  add('skin.non-deforming-weighted', [...new Set(nonDeforming)]);
  return problems;
}

/** A non-deforming joint with a deforming ancestor. */
function isProp(skeleton: Pick<WeightContext['skeleton'], 'parent' | 'deform'>, s: number): boolean {
  let p = skeleton.parent[s] as number;
  for (let guard = 0; p >= 0 && guard < 1024; guard++) {
    if (skeleton.deform[p] === 1) return true;
    p = skeleton.parent[p] as number;
  }
  return false;
}
