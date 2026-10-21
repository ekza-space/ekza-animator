// Quick Rig start checks and re-run seeding (M6B-SPEC §0.4.2 "Start checks", "Re-run"; CR-AR-3; C2).
import type { HumanBoneName } from '@ekza-studio/doc';
import type { TriangleBvh } from '@ekza-studio/mesh-core';
import type { QuickRigMarker } from '../types';
import { rasterize } from './raster';

type Vec3 = readonly [number, number, number];

export interface QuickRigStartChecks {
  /** |centre x| ≤ 0.01 H (the bounds' x centre). */
  readonly centred: boolean;
  /** |min y| ≤ 0.01 H. */
  readonly grounded: boolean;
  /** The toes' front extent lies in front of the ankles: the mean z of the side-view inside samples of the lowest
   *  0.05 H band is greater than the slab midpoint (the z extent's midpoint) of the band's top row. A model turned
   *  sideways (its z extent larger than its x extent, M6B-C2-22) never faces +Z. */
  readonly facing: boolean;
}

export const START_CHECKS = Object.freeze({ tolerance: 0.01, band: 0.05, rows: 256 });

/**
 * CR-AR-3: the start checks of `skel.quickRig.start` as a pure function of the meshes' world bounds and their
 * triangles (`bvh` over the same world positions). A flat or empty model fails every check.
 */
export function quickRigStartChecks(
  bounds: readonly [readonly number[], readonly number[]],
  bvh: TriangleBvh,
): QuickRigStartChecks {
  const lo = bounds[0];
  const hi = bounds[1];
  const H = (hi[1] as number) - (lo[1] as number);
  if (!(H > 0) || !Number.isFinite(H)) return { centred: false, grounded: false, facing: false };
  const tol = START_CHECKS.tolerance * H;
  const centred = Math.abs(((lo[0] as number) + (hi[0] as number)) / 2) <= tol;
  const grounded = Math.abs(lo[1] as number) <= tol;
  return { centred, grounded, facing: !sideways(lo, hi) && toesToward(bvh, lo, hi, H, 2) === 1 };
}

/** A humanoid's front silhouette (arms, shoulders) is wider than its depth: a larger z extent means it faces ±X. */
const sideways = (lo: readonly number[], hi: readonly number[]): boolean =>
  (hi[2] as number) - (lo[2] as number) > (hi[0] as number) - (lo[0] as number);

/**
 * The turn about Y (radians) that makes the model face +Z, for `skel.quickRig.faceForward`: 0 when it faces +Z, π
 * when it faces −Z, −π/2 when its toes point +X and π/2 when they point −X (M6B-C2-22: a sideways model could not be
 * fixed by the 180° turn alone). 0 for a flat or empty model.
 */
export function quickRigFacingTurn(bounds: readonly [readonly number[], readonly number[]], bvh: TriangleBvh): number {
  const lo = bounds[0];
  const hi = bounds[1];
  const H = (hi[1] as number) - (lo[1] as number);
  if (!(H > 0) || !Number.isFinite(H)) return 0;
  if (sideways(lo, hi)) {
    const toward = toesToward(bvh, lo, hi, H, 0);
    return toward === 1 ? -Math.PI / 2 : toward === -1 ? Math.PI / 2 : 0;
  }
  return toesToward(bvh, lo, hi, H, 2) === -1 ? Math.PI : 0;
}

/**
 * Which way the toes point along `axis` (0: x, 2: z): +1 when the mean coordinate of the inside samples of the lowest
 * 0.05 H band (the view along the other horizontal axis) lies past the midpoint of the band's top row (the ankles),
 * −1 when it lies before it, 0 without samples.
 */
function toesToward(bvh: TriangleBvh, lo: readonly number[], hi: readonly number[], H: number, axis: 0 | 2): number {
  const step = H / START_CHECKS.rows;
  const rows = Math.max(1, Math.round(START_CHECKS.band * START_CHECKS.rows));
  const u0 = (lo[axis] as number) - step;
  const cols = Math.ceil(((hi[axis] as number) - u0) / step) + 2;
  const view = rasterize(bvh, axis, lo[1] as number, u0, step, rows, cols);
  let sum = 0;
  let count = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (view.inside[r * cols + c] !== 1) continue;
      sum += u0 + c * step;
      count++;
    }
  }
  // The band's top row: the midpoint of its extent.
  let first = -1;
  let last = -1;
  const top = rows - 1;
  for (let c = 0; c < cols; c++) {
    if (view.inside[top * cols + c] !== 1) continue;
    if (first < 0) first = c;
    last = c;
  }
  if (count === 0 || first < 0) return 0;
  const mid = u0 + ((first + last) / 2) * step;
  const mean = sum / count;
  return mean > mid ? 1 : mean < mid ? -1 : 0;
}

/** A joint's rest position and tail, looked up by human bone. */
export type JointLookup = (bone: HumanBoneName) => { readonly position: Vec3; readonly tail: Vec3 | null } | undefined;

/**
 * §0.4.2 Re-run: the markers of an existing template skeleton — `headTop` = the head tail, `chin` = (0, neck.y +
 * 0.01 H, neck.z), `pelvis` = hips and the side markers = the right joints of their meaning, as they are (flexion is
 * not undone). H = headTop.y − ground. Missing joints leave their marker out.
 */
export function markersFromJoints(joint: JointLookup, ground: number): Partial<Record<QuickRigMarker, Vec3>> {
  const out: Partial<Record<QuickRigMarker, Vec3>> = {};
  const head = joint('head');
  const neck = joint('neck');
  const headTop: Vec3 | null = head?.tail ?? null;
  if (headTop !== null) out.headTop = [0, headTop[1], headTop[2]];
  const H = headTop === null ? null : headTop[1] - ground;
  if (neck !== undefined && H !== null) out.chin = [0, neck.position[1] + 0.01 * H, neck.position[2]];
  const hips = joint('hips');
  if (hips !== undefined) out.pelvis = hips.position;
  const side: readonly (readonly [QuickRigMarker, HumanBoneName])[] = [
    ['shoulder', 'rightUpperArm'],
    ['elbow', 'rightLowerArm'],
    ['wrist', 'rightHand'],
    ['knee', 'rightLowerLeg'],
    ['ankle', 'rightFoot'],
    ['toe', 'rightToes'],
  ];
  for (const [marker, bone] of side) {
    const j = joint(bone);
    if (j !== undefined) out[marker] = j.position;
  }
  if (out.toe === undefined) {
    const foot = joint('rightFoot');
    if (foot?.tail !== null && foot?.tail !== undefined) out.toe = foot.tail;
  }
  return out;
}
