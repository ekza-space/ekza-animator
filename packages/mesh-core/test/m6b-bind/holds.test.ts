// C4 `applyHolds` (M6B-SPEC §5.10 on a masked §5.9 run): held joints never change under a masked Bind Skin — held
// entries bit-equal, the rest fitted into what the holds leave, ≤ 4 influences, Σ = 1 ± 1e-6; points outside the mask
// and points without held weight keep the solve's rows.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { applyHolds, type BindMethod, bindSkin, type SkinWeights, skinGeometryOf } from '../../src';
import { body, bodySkeletonRows, skeletonOf } from './fixtures';
import { DEFAULT_ARGS } from './goldens';

const METHODS: readonly BindMethod[] = ['auto-lowpoly', 'heat', 'rigid-islands', 'closest'];

function row(skin: SkinWeights, v: number): Map<string, number> {
  const out = new Map<string, number>();
  for (let k = 0; k < 4; k++) {
    const w = skin.weights[4 * v + k] as number;
    if (w > 0) out.set(skin.palette[skin.joints[4 * v + k] as number]?.key as string, w);
  }
  return out;
}

function rowProblems(skin: SkinWeights, v: number): string[] {
  const problems: string[] = [];
  let sum = 0;
  let last = Number.POSITIVE_INFINITY;
  let lastIndex = -1;
  let ended = false;
  for (let k = 0; k < 4; k++) {
    const w = skin.weights[4 * v + k] as number;
    const j = skin.joints[4 * v + k] as number;
    if (w === 0) {
      ended = true;
      if (j !== 0) problems.push(`${v}: unused slot names a joint`);
      continue;
    }
    if (ended || !(w > 0) || w > last || (w === last && j <= lastIndex)) problems.push(`${v}: slot order`);
    last = w;
    lastIndex = j;
    sum += w;
  }
  if (!(Math.abs(sum - 1) <= 1e-6)) problems.push(`${v}: sum ${sum}`);
  return problems;
}

describe('applyHolds (§5.10 on a masked bind)', () => {
  const mesh = body('smooth');
  const skeleton = skeletonOf(bodySkeletonRows());
  const geom = skinGeometryOf(mesh, skeleton.height);
  const before = bindSkin(geom, skeleton, { ...DEFAULT_ARGS, method: 'heat' }, null).skin;
  const keys = before.palette.map((entry) => entry.key);

  it('held weights stay bit-equal on every masked point; the rest are valid; unmasked rows are the solve’s', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 0, max: before.points - 1 }), { minLength: 1, maxLength: 80 }),
        fc.uniqueArray(fc.constantFrom(...keys), { minLength: 1, maxLength: 4 }),
        fc.constantFrom(...METHODS),
        (points, held, method) => {
          const solved = bindSkin(geom, skeleton, { ...DEFAULT_ARGS, method, points }, before).skin;
          const out = applyHolds(solved, before, points, held);
          const masked = new Set(points);
          const heldSet = new Set(held);
          const problems: string[] = [];
          for (let v = 0; v < out.points; v++) {
            if (!masked.has(v)) {
              for (let k = 0; k < 4; k++) {
                if (out.joints[4 * v + k] !== solved.joints[4 * v + k]) problems.push(`${v}: unmasked joint changed`);
                if (!Object.is(out.weights[4 * v + k], solved.weights[4 * v + k])) {
                  problems.push(`${v}: unmasked weight changed`);
                }
              }
              continue;
            }
            problems.push(...rowProblems(out, v));
            const was = row(before, v);
            const now = row(out, v);
            for (const key of heldSet) {
              if (!Object.is(now.get(key) ?? 0, was.get(key) ?? 0)) problems.push(`${v}: held ${key} changed`);
            }
          }
          expect(problems).toEqual([]);
        },
      ),
      { numRuns: 60 },
    );
  });

  it('no holds, or holds on joints with no weight anywhere in the mask, return the solve unchanged', () => {
    const points = [3, 4, 5];
    const solved = bindSkin(geom, skeleton, { ...DEFAULT_ARGS, method: 'closest', points }, before).skin;
    expect(applyHolds(solved, before, points, [])).toBe(solved);
    expect(applyHolds(solved, before, points, ['not-a-joint'])).toBe(solved);
  });

  it('a point whose held weights fill it keeps its previous row', () => {
    const v = 10;
    const was = row(before, v);
    const points = [v];
    const solved = bindSkin(geom, skeleton, { ...DEFAULT_ARGS, method: 'rigid-islands', points }, before).skin;
    const out = applyHolds(solved, before, points, [...was.keys()]);
    expect(row(out, v)).toEqual(was);
  });

  it('a held joint the point lacked stays at 0 even when the solve weights it', () => {
    // Re-solve a hand point with closest; hold the joint it gets most from the solve, which it lacked before.
    const target = [...Array(before.points).keys()].find((v) => {
      const solved = bindSkin(geom, skeleton, { ...DEFAULT_ARGS, method: 'closest', points: [v] }, before).skin;
      const now = row(solved, v);
      const was = row(before, v);
      return [...now.keys()].some((key) => !was.has(key)) && was.size > 0;
    });
    expect(target).toBeDefined();
    const v = target as number;
    const solved = bindSkin(geom, skeleton, { ...DEFAULT_ARGS, method: 'closest', points: [v] }, before).skin;
    const was = row(before, v);
    const fresh = [...row(solved, v).keys()].filter((key) => !was.has(key));
    const out = applyHolds(solved, before, [v], fresh);
    for (const key of fresh) expect(row(out, v).has(key)).toBe(false);
    expect(rowProblems(out, v)).toEqual([]);
  });
});
