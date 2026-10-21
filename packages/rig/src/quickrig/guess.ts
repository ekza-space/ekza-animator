// Quick Rig v2 One-Click guess (M6B-SPEC §0.4.2 "Guess", §5.8 step 2's silhouette method; C2): the nine markers from
// the front silhouette (256 rows over the height, square columns, x = 0 a column), each marker's depth by the slab
// midpoint of the front ray through it, the elbow shifted back and the knee forward by the hinge bias (never tilting a
// T-posed segment past `GUESS.maxBiasTilt`, so the guess passes `skel.tpose`). Deterministic
// (float64, fixed scan orders, ties in index order). Thresholds are the §0.4.2 defaults as calibrated by C2's spike on
// the Cube Lad, the generated body and T-posed Polybot (`GUESS`; the record is docs/wp-notes/m6b-skeleton-kernel.md).
import type { TriangleBvh } from '@ekza-studio/mesh-core';
import type { QuickRigMarkers } from '../types';
import { firstSlabThickness, isInside, projectedCenterOf, type Raster, rasterize, rowRuns } from './raster';

export const GUESS = Object.freeze({
  rows: 256,
  /** pelvis = groin + 0.04 H. */
  pelvisAboveGroin: 0.04,
  /** ankle at 0.05 H (its depth the shin's 0.05 H above it); toe at 0.02 H, z at 0.65 of the foot length from the
   *  ankle toward the front extent. */
  ankle: 0.05,
  ankleDepthAbove: 0.05,
  /** knee: the leg's sharpest width step (≥ 3 columns between two rows) between 0.25 and 0.85 of the way from the
   *  ankle up to the groin (boxy and segmented legs); else 0.57 of the way (§5.8 "midway", calibrated on the smooth
   *  generated body). */
  kneeBand: [0.25, 0.85] as const,
  kneeStep: 3,
  kneeAlongLeg: 0.57,
  toe: 0.02,
  toeAlongFoot: 0.65,
  /** The torso edge: the median outer column of the rows from the groin up to 0.1 H above it. */
  torsoBand: 0.1,
  /** The arm band: the rows around the widest one that are wider than the torso by 0.05 H; its top is the shoulder
   *  row, the torso edge under it (the armpit) the arm root. */
  shoulderWiden: 0.05,
  /** A row holds an arm run when a run is separated from the torso, or the torso run reaches 0.05 H past the edge. */
  armBeyondTorso: 0.05,
  /** The chin is searched below 0.9 H. */
  chinBelow: 0.9,
  /** Hand length estimate 0.08 H; the wrist is pulled back from the arm's extreme point by 1.0 × it (spike). */
  handLength: 0.08,
  wristPullBack: 1,
  /** shoulder = elbow − 0.95·(wrist − elbow), clamped between the arm root and 0.02 H. */
  shoulderK: 0.95,
  shoulderMin: 0.02,
  maxArmAngle: (50 * Math.PI) / 180,
  aPoseAngle: (15 * Math.PI) / 180,
  hingeBias: 0.15,
  /** The hinge bias never tilts a T-posed segment (shin: knee → ankle; arm: shoulder → elbow → wrist) past this
   *  angle, inside `skel.tpose`'s 5° (M6B-C2-28: Polybot's thick knee biased forward by 0.15 of its slab tilted the
   *  shin 5.3°). */
  maxBiasTilt: (4 * Math.PI) / 180,
});

/**
 * `z` limited to within the depth offset from `refZ` that tilts a segment of length `along` on its axis and `perp`
 * across it (in the view plane) by at most `GUESS.maxBiasTilt`; an already steeper segment pins `z` to `refZ`.
 */
function limitTilt(z: number, refZ: number, along: number, perp: number): number {
  const reach = Math.tan(GUESS.maxBiasTilt) * Math.abs(along);
  const room = Math.sqrt(Math.max(0, reach * reach - perp * perp));
  return Math.min(refZ + room, Math.max(refZ - room, z));
}

interface Front {
  readonly raster: Raster;
  /** Column of x = 0. */
  readonly c0: number;
  readonly H: number;
  readonly ground: number;
  readonly zFront: number;
}

function frontRaster(bvh: TriangleBvh, bounds: readonly [readonly number[], readonly number[]]): Front | null {
  const lo = bounds[0];
  const hi = bounds[1];
  const ground = lo[1] as number;
  const H = (hi[1] as number) - ground;
  if (!(H > 0) || !Number.isFinite(H)) return null;
  const step = H / GUESS.rows;
  const reach = Math.max(Math.abs(lo[0] as number), Math.abs(hi[0] as number));
  const half = Math.ceil(reach / step) + 1;
  const raster = rasterize(bvh, 0, ground, -half * step, step, GUESS.rows, 2 * half + 1);
  return { raster, c0: half, H, ground, zFront: (hi[2] as number) + 1 };
}

const xOf = (f: Front, c: number): number => (c - f.c0) * f.raster.step;
const rowOfY = (f: Front, y: number): number =>
  Math.min(f.raster.rows - 1, Math.max(0, Math.floor((y - f.ground) / f.raster.step)));
const topOf = (f: Front, r: number): number => f.ground + (r + 1) * f.raster.step;

/** The run of a row containing column c, else null. */
function runAt(f: Front, r: number, c: number): [number, number] | null {
  if (!isInside(f.raster, r, c)) return null;
  let a = c;
  let b = c;
  while (isInside(f.raster, r, a - 1)) a--;
  while (isInside(f.raster, r, b + 1)) b++;
  return [a, b];
}

/** The right leg's run of a row: the innermost run entirely left of x = 0. */
function rightLegRun(f: Front, r: number): [number, number] | null {
  let leg: [number, number] | null = null;
  for (const run of rowRuns(f.raster, r)) if (run[1] < f.c0) leg = run;
  return leg;
}

function centreZ(bvh: TriangleBvh, f: Front, x: number, y: number, fallback = 0): number {
  const hit = projectedCenterOf(bvh, [x, y, f.zFront], [0, 0, -1], { mode: 'new', fallbackRadius: 0 });
  return hit === null ? fallback : hit[2];
}

function thickness(bvh: TriangleBvh, f: Front, x: number, y: number): number {
  return firstSlabThickness(bvh, [x, y, f.zFront], [0, 0, -1]);
}

/** The vertical centre of the inside run of column c around row r (the arm's axis under a slanted silhouette). */
function columnCentreY(f: Front, c: number, r: number): number | null {
  if (!isInside(f.raster, r, c)) {
    // Search the nearest inside row of the column (within a few rows) so a line just off the silhouette still lands.
    for (let k = 1; k <= 8; k++) {
      if (isInside(f.raster, r - k, c)) return columnCentreY(f, c, r - k);
      if (isInside(f.raster, r + k, c)) return columnCentreY(f, c, r + k);
    }
    return null;
  }
  let a = r;
  let b = r;
  while (isInside(f.raster, a - 1, c)) a--;
  while (isInside(f.raster, b + 1, c)) b++;
  return f.ground + ((a + b + 1) / 2) * f.raster.step;
}

/** The knee's height (see `GUESS.kneeBand`). */
function kneeHeight(f: Front, ankleY: number, groinY: number): number {
  const span = groinY - ankleY;
  const lo = rowOfY(f, ankleY + GUESS.kneeBand[0] * span);
  const hi = rowOfY(f, ankleY + GUESS.kneeBand[1] * span);
  const w = (r: number): number => {
    const run = rightLegRun(f, r);
    return run === null ? 0 : run[1] - run[0] + 1;
  };
  let best = -1;
  let bestStep = GUESS.kneeStep - 1;
  for (let r = lo; r < hi; r++) {
    const step = Math.abs(w(r + 1) - w(r));
    if (step > bestStep) {
      bestStep = step;
      best = r;
    }
  }
  return best >= 0 ? topOf(f, best) : ankleY + GUESS.kneeAlongLeg * span;
}

/** §0.4.2 guess; null when no leg split or arm run is found. `aPose` = armAngle > 15°. */
export function guessMarkers(
  bvh: TriangleBvh,
  bounds: readonly [readonly number[], readonly number[]],
): { readonly markers: Required<QuickRigMarkers>; readonly armAngle: number; readonly aPose: boolean } | null {
  const f = frontRaster(bvh, bounds);
  if (f === null) return null;
  const { raster, c0, H, ground } = f;
  const step = raster.step;
  const rows = raster.rows;

  // ---------- groin: the top of the leg split rising from the ground ----------
  // From the first row with x = 0 outside and both sides inside, up while x = 0 stays outside (rows with nothing inside
  // — the gaps between the shells of a segmented model — continue the split); the groin is the top of the last row
  // that held both legs.
  const split = (r: number): boolean => {
    if (isInside(raster, r, c0)) return false;
    let left = false;
    let right = false;
    for (let c = 0; c < raster.cols; c++) {
      if (!isInside(raster, r, c)) continue;
      if (c < c0) right = true;
      else if (c > c0) left = true;
    }
    return left && right;
  };
  let r = 0;
  while (r < rows && !split(r)) r++;
  if (r >= rows / 2) return null;
  let groinRow = r;
  while (r + 1 < rows && !isInside(raster, r + 1, c0)) {
    r++;
    if (split(r)) groinRow = r;
  }
  if (r + 1 >= rows) return null;
  const groinY = topOf(f, groinRow);

  // ---------- torso edge and width ----------
  const bandTop = rowOfY(f, groinY + GUESS.torsoBand * H);
  const edges: number[] = [];
  for (let k = groinRow + 1; k <= bandTop; k++) {
    const run = runAt(f, k, c0);
    if (run !== null) edges.push(Math.abs(xOf(f, run[0])));
  }
  if (edges.length === 0) return null;
  edges.sort((a, b) => a - b);
  const torsoEdge = edges[(edges.length - 1) >> 1] as number;
  const torsoWidth = 2 * torsoEdge;

  // ---------- arm band: the first run of rows above the groin wider than the torso by 0.05 H ----------
  // Its top is the shoulder row (§5.8: "the highest row whose width exceeds the torso width by 0.05 H", taken within
  // the arms' band so a head wider than the torso — Polybot's — is not mistaken for the shoulders).
  const width = (k: number): number => {
    const runs = rowRuns(raster, k);
    const first = runs[0];
    const last = runs[runs.length - 1];
    return first === undefined || last === undefined ? 0 : (last[1] - first[0]) * step;
  };
  const wide = (k: number): boolean => width(k) > torsoWidth + GUESS.shoulderWiden * H;
  // The band holding the widest row above the groin (the arms' span in a T-pose, arms and hands in an A-pose).
  let widest = -1;
  let widestW = -Infinity;
  for (let k = groinRow + 1; k < rows; k++) {
    const w = width(k);
    if (w > widestW) {
      widestW = w;
      widest = k;
    }
  }
  if (widest < 0 || !wide(widest)) return null;
  let bandBottom = widest;
  while (bandBottom - 1 > groinRow && wide(bandBottom - 1)) bandBottom--;
  let shoulderRow = widest;
  while (shoulderRow + 1 < rows && wide(shoulderRow + 1)) shoulderRow++;
  // The arm root: the torso's edge in the row under the band (the armpit), else the torso edge.
  const armpit = runAt(f, bandBottom - 1, c0);
  const armRoot = armpit === null ? torsoEdge : Math.max(Math.abs(xOf(f, armpit[0])), xOf(f, armpit[1]));

  // ---------- arm runs (right side) over the band ----------
  // Each sample: the outer end (most negative x) of the row's outermost run when it is separated from the torso, or of
  // the torso run when it reaches past the torso edge by 0.05 H.
  const ends: { s: number; y: number }[] = [];
  for (let k = shoulderRow; k >= bandBottom; k--) {
    const runs = rowRuns(raster, k).filter((run) => run[0] < c0);
    if (runs.length === 0) continue;
    const torso = runAt(f, k, c0);
    const outer = runs[0] as [number, number];
    const separated = torso === null || outer[1] < torso[0];
    const s = -xOf(f, outer[0]);
    if (!separated && s < torsoEdge + GUESS.armBeyondTorso * H) continue;
    ends.push({ s, y: f.ground + (k + 0.5) * step });
  }
  if (ends.length === 0) return null;

  // Arm angle: the least-squares line y = a + m·s through the outer ends (s = −x, outward).
  let sumS = 0;
  let sumY = 0;
  for (const e of ends) {
    sumS += e.s;
    sumY += e.y;
  }
  const meanS = sumS / ends.length;
  const meanY = sumY / ends.length;
  let sxx = 0;
  let sxy = 0;
  for (const e of ends) {
    sxx += (e.s - meanS) * (e.s - meanS);
    sxy += (e.s - meanS) * (e.y - meanY);
  }
  const slope = sxx > 1e-12 ? sxy / sxx : 0;
  const armAngle = Math.min(GUESS.maxArmAngle, Math.max(0, Math.atan(-slope)));
  // Line direction outward (in s, y) and its points.
  const us = Math.cos(armAngle);
  const uy = -Math.sin(armAngle);
  const yOnLine = (s: number): number => meanY - Math.tan(armAngle) * (s - meanS);
  // The extreme point along the line: the maximum projection of the outer ends.
  let extreme = -Infinity;
  for (const e of ends) extreme = Math.max(extreme, (e.s - meanS) * us + (e.y - meanY) * uy);
  const along = (t: number): [number, number] => [meanS + t * us, meanY + t * uy];
  const pull = GUESS.wristPullBack * GUESS.handLength * H;
  const [wristS, wristLineY] = along(extreme - pull);
  const rootS = armRoot;
  const rootY = yOnLine(rootS);
  const elbowS = (wristS + rootS) / 2;
  const elbowLineY = (wristLineY + rootY) / 2;
  const column = (s: number): number => Math.round(c0 - s / step);
  const wristY = columnCentreY(f, column(wristS), rowOfY(f, wristLineY)) ?? wristLineY;
  const elbowY = columnCentreY(f, column(elbowS), rowOfY(f, elbowLineY)) ?? elbowLineY;
  // Shoulder = elbow − 0.95·(wrist − elbow), clamped along the line into [0.02 H, torso edge].
  let shoulderS = elbowS - GUESS.shoulderK * (wristS - elbowS);
  let shoulderY = elbowY - GUESS.shoulderK * (wristY - elbowY);
  const clampS = Math.min(armRoot, Math.max(GUESS.shoulderMin * H, shoulderS));
  if (clampS !== shoulderS) {
    // Slide along the shoulder → elbow direction to the clamped s.
    const ds = elbowS - shoulderS;
    const t = ds !== 0 ? (clampS - shoulderS) / ds : 0;
    shoulderY += t * (elbowY - shoulderY);
    shoulderS = clampS;
  }

  // ---------- head, chin, pelvis ----------
  let topRow = -1;
  for (let k = rows - 1; k >= 0; k--) {
    if (isInside(raster, k, c0)) {
      topRow = k;
      break;
    }
  }
  if (topRow < 0) return null;
  const headZ = centreZ(bvh, f, 0, f.ground + (topRow + 0.5) * step);
  const above = (bounds[1][1] as number) + 1;
  const down = bvh.raycast([0, above, headZ], [0, -1, 0], 0, Number.POSITIVE_INFINITY);
  const headTopY = down !== null ? above - down.t : topOf(f, topRow);
  // Chin: the narrowest central run between the shoulder row and 0.9 H; ties within one column → the topmost.
  const chinTop = Math.min(topRow, rowOfY(f, ground + GUESS.chinBelow * H));
  let minCols = Infinity;
  const widths: { r: number; w: number }[] = [];
  for (let k = shoulderRow + 1; k < chinTop; k++) {
    const run = runAt(f, k, c0);
    if (run === null) continue;
    const w = run[1] - run[0] + 1;
    widths.push({ r: k, w });
    if (w < minCols) minCols = w;
  }
  let chinRow = shoulderRow + 1;
  for (const { r: k, w } of widths) if (w <= minCols + 1 && k > chinRow) chinRow = k;
  if (widths.length === 0) chinRow = Math.min(rows - 1, shoulderRow + 1);
  const chinY = topOf(f, chinRow);
  const pelvisY = groinY + GUESS.pelvisAboveGroin * H;

  // ---------- legs ----------
  const ankleY = ground + GUESS.ankle * H;
  const kneeY = kneeHeight(f, ankleY, groinY);
  const toeY = ground + GUESS.toe * H;
  // The leg run's centre at a height, from the nearest row holding one (gaps between segmented shells).
  const legX = (y: number): number | null => {
    const row = rowOfY(f, y);
    for (let k = 0; k <= 8; k++) {
      for (const rr of k === 0 ? [row] : [row - k, row + k]) {
        if (rr < 0 || rr >= rows) continue;
        const run = rightLegRun(f, rr);
        if (run !== null) return xOf(f, (run[0] + run[1]) / 2);
      }
    }
    return null;
  };
  const kneeX = legX(kneeY);
  const ankleX = legX(ankleY) ?? kneeX;
  const toeX = legX(toeY) ?? ankleX;
  if (kneeX === null || ankleX === null || toeX === null) return null;

  // ---------- depths ----------
  const wristX = -wristS;
  const elbowX = -elbowS;
  const shoulderX = -shoulderS;
  const aPose = armAngle > GUESS.aPoseAngle;
  const shoulderZ = centreZ(bvh, f, shoulderX, shoulderY);
  const wristZ = centreZ(bvh, f, wristX, wristY);
  let elbowZ = centreZ(bvh, f, elbowX, elbowY) - GUESS.hingeBias * thickness(bvh, f, elbowX, elbowY);
  if (!aPose) {
    // T-posed arms stay within the tilt bound of both segments (an A-posed arm is skel.tpose anyway).
    elbowZ = limitTilt(elbowZ, shoulderZ, elbowX - shoulderX, elbowY - shoulderY);
    elbowZ = limitTilt(elbowZ, wristZ, wristX - elbowX, wristY - elbowY);
  }
  // The ankle's depth is the shin's, 0.05 H above it: at the ankle's own height the front ray may run along the foot.
  const ankleZ = centreZ(bvh, f, ankleX, ankleY + GUESS.ankleDepthAbove * H);
  const kneeZ = limitTilt(
    centreZ(bvh, f, kneeX, kneeY) + GUESS.hingeBias * thickness(bvh, f, kneeX, kneeY),
    ankleZ,
    kneeY - ankleY,
    kneeX - ankleX,
  );
  // Toe: 0.65 of the foot's length from the ankle toward the front extent at the toe's x (rays below toe + 0.02 H).
  let frontZ = -Infinity;
  for (let k = 0; k < 6; k++) {
    const y = ground + ((k + 0.5) / 6) * (toeY + GUESS.toe * H - ground);
    const hit = bvh.raycast([toeX, y, f.zFront], [0, 0, -1], 0, Number.POSITIVE_INFINITY);
    if (hit !== null) frontZ = Math.max(frontZ, f.zFront - hit.t);
  }
  const toeZ = Number.isFinite(frontZ) ? ankleZ + GUESS.toeAlongFoot * (frontZ - ankleZ) : ankleZ;

  const markers: Required<QuickRigMarkers> = {
    headTop: [0, headTopY, headZ],
    chin: [0, chinY, centreZ(bvh, f, 0, chinY)],
    pelvis: [0, pelvisY, centreZ(bvh, f, 0, pelvisY)],
    shoulder: [shoulderX, shoulderY, shoulderZ],
    elbow: [elbowX, elbowY, elbowZ],
    wrist: [wristX, wristY, wristZ],
    knee: [kneeX, kneeY, kneeZ],
    ankle: [ankleX, ankleY, ankleZ],
    toe: [toeX, toeY, toeZ],
  };
  return { markers, armAngle, aPose };
}
