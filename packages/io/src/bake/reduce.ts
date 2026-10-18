// M2A-SPEC §5.16 export-side key reduction (FR-EXP-12, R02 §6.4): an error-bounded, interpolation-aware
// Douglas–Peucker variant on the sampled tracks of a baked clip, run after hemisphere continuity and root-motion
// handling and before writing. Nothing calls it while `ExportRequest.reduce` is absent or null (the M1 bytes).
//
// - Tolerances scale with the character height H: ε_pos = positionM·(H/1.7); per node j, θ_tol(j) = min(θ_cap,
//   ε_pos / max(L_j, L_min)) with L_j from `trackLeverArms`; translations ε_pos; scales `scaleRel` relative.
// - Keep set: the first and last samples (a closed loop's closure sample is the last), the clip's contact sample,
//   the per-track frames of `keep` (influence key times, A1), and both samples of every step discontinuity (a jump
//   above the tolerance between two holds). STEP tracks and tracks of two samples or fewer are copied unchanged.
// - Recursive split between kept neighbours i < j: every sample k ∈ (i, j) is reconstructed the way a player does
//   (slerp for rotations, lerp for translations and scales, at its time); the sample with the largest error (ties:
//   the smallest index) is kept while that error exceeds the tolerance. Deterministic: pure float64 arithmetic in a
//   fixed order on the float32 samples.
// - Bytes (acceptance fix round 1): a reduced track needs its own time accessor unless another track keeps the same
//   times. Reduced tracks are grouped by their times, and a group is kept only if it saves bytes counting that
//   accessor (TIME_ACCESSOR_BYTES + 4 B per time) against the full samples on the shared full time array; otherwise
//   its tracks keep every sample. So a reduced file is never larger than the unreduced one (smooth 30 fps clips keep
//   nearly every sample at R02's tolerances, and the extra time accessors made them larger).
import type { Frame } from '@ekza-animator/anim-core';
import { HUMAN_BONE_NAMES, type SkeletonDesc, type TrackKey } from '@ekza-animator/rig';
import { restWorlds } from '../skeleton/rest';
import type { BakedClip, BakedTrack, ExportReduceSpec, ReductionStats } from '../types';

/** The reference character height of R02 §6.4 (ε_pos is given for a 1.7 m character). */
export const REFERENCE_HEIGHT_M = 1.7;
/** R02 §6.4: L_j is the longest rest distance to a descendant joint plus 10 % for the skin. */
export const LEVER_SKIN_FACTOR = 1.1;
/** A scale component this close to 0 measures its error against this magnitude instead (no division by 0). */
const MIN_SCALE_MAGNITUDE = 1e-6;

export interface ReduceInput {
  readonly spec: ExportReduceSpec;
  /** Character height H in metres (`SkeletonDesc.height`); a non-positive or non-finite value reads 1.7. */
  readonly height: number;
  /** L_j per track node (`trackLeverArms`); a missing node reads 0 (so L_min applies). */
  readonly leverArm: ReadonlyMap<number, number>;
  /**
   * Frames each track must keep, counted from the clip's first sample (frame 0 = time 0): `bakeClip` converts the
   * clip frames of `BakeOptions.reduce.keep` (inside the bake range) before it calls this.
   */
  readonly keep: ReadonlyMap<TrackKey, readonly Frame[]>;
}

/** ε_pos of a character of height `height` (metres). */
export function positionTolerance(spec: ExportReduceSpec, height: number): number {
  const h = Number.isFinite(height) && height > 0 ? height : REFERENCE_HEIGHT_M;
  return spec.positionM * (h / REFERENCE_HEIGHT_M);
}

/** Tolerance of one track in its own error unit (radians, metres or relative scale). */
export function trackTolerance(
  track: Pick<BakedTrack, 'node' | 'path'>,
  spec: ExportReduceSpec,
  height: number,
  leverArm: ReadonlyMap<number, number>,
): number {
  const epsPos = positionTolerance(spec, height);
  if (track.path === 'translation') return epsPos;
  if (track.path === 'scale') return spec.scaleRel;
  const lever = leverArm.get(track.node) ?? 0;
  return Math.min(spec.rotationCapRad, epsPos / Math.max(Number.isFinite(lever) ? lever : 0, spec.minLeverM));
}

const COMPONENTS: Readonly<Record<BakedTrack['path'], number>> = { translation: 3, rotation: 4, scale: 3 };

/** Error of the sample `k` against its reconstruction from samples `i` and `j` (track units). */
function sampleError(track: BakedTrack, i: number, j: number, k: number): number {
  const times = track.times;
  const values = track.values;
  const t0 = times[i] as number;
  const t1 = times[j] as number;
  const alpha = t1 === t0 ? 0 : ((times[k] as number) - t0) / (t1 - t0);
  if (track.path === 'rotation') return rotationError(values, i * 4, j * 4, k * 4, alpha);
  const a = i * 3;
  const b = j * 3;
  const o = k * 3;
  if (track.path === 'translation') {
    const dx = (values[a] as number) + ((values[b] as number) - (values[a] as number)) * alpha - (values[o] as number);
    const dy =
      (values[a + 1] as number) +
      ((values[b + 1] as number) - (values[a + 1] as number)) * alpha -
      (values[o + 1] as number);
    const dz =
      (values[a + 2] as number) +
      ((values[b + 2] as number) - (values[a + 2] as number)) * alpha -
      (values[o + 2] as number);
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  let worst = 0;
  for (let c = 0; c < 3; c++) {
    const s = values[o + c] as number;
    const hat = (values[a + c] as number) + ((values[b + c] as number) - (values[a + c] as number)) * alpha;
    worst = Math.max(worst, Math.abs(hat - s) / Math.max(Math.abs(s), MIN_SCALE_MAGNITUDE));
  }
  return worst;
}

/**
 * `2·acos(min(1, |q̂·q|))` with q̂ = slerp(q_a, q_b, α) (shortest path, normalized), all in float64 from the stored
 * float32 samples.
 */
function rotationError(values: Float32Array, a: number, b: number, o: number, alpha: number): number {
  const ax = values[a] as number;
  const ay = values[a + 1] as number;
  const az = values[a + 2] as number;
  const aw = values[a + 3] as number;
  let bx = values[b] as number;
  let by = values[b + 1] as number;
  let bz = values[b + 2] as number;
  let bw = values[b + 3] as number;
  let cos = ax * bx + ay * by + az * bz + aw * bw;
  if (cos < 0) {
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
    cos = -cos;
  }
  let wa: number;
  let wb: number;
  const sinSq = 1 - cos * cos;
  if (sinSq <= Number.EPSILON) {
    wa = 1 - alpha;
    wb = alpha;
  } else {
    const sin = Math.sqrt(sinSq);
    const angle = Math.atan2(sin, cos);
    wa = Math.sin((1 - alpha) * angle) / sin;
    wb = Math.sin(alpha * angle) / sin;
  }
  let hx = wa * ax + wb * bx;
  let hy = wa * ay + wb * by;
  let hz = wa * az + wb * bz;
  let hw = wa * aw + wb * bw;
  const len = Math.sqrt(hx * hx + hy * hy + hz * hz + hw * hw);
  if (len > 0) {
    hx /= len;
    hy /= len;
    hz /= len;
    hw /= len;
  }
  const qx = values[o] as number;
  const qy = values[o + 1] as number;
  const qz = values[o + 2] as number;
  const qw = values[o + 3] as number;
  const qLen = Math.sqrt(qx * qx + qy * qy + qz * qz + qw * qw);
  const dot = qLen > 0 ? Math.abs(hx * qx + hy * qy + hz * qz + hw * qw) / qLen : 0;
  return 2 * Math.acos(Math.min(1, dot));
}

/** Error between two consecutive samples (the step-discontinuity test): the sample's change in track units. */
function stepChange(track: BakedTrack, k: number): number {
  return sampleError(track, k - 1, k - 1, k);
}

/** Sample index of a time (seconds) within half a frame, or −1. */
function sampleAt(times: Float32Array, seconds: number, halfFrame: number): number {
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((times[mid] as number) < seconds) lo = mid + 1;
    else hi = mid;
  }
  let best = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const index of [lo - 1, lo]) {
    if (index < 0 || index >= times.length) continue;
    const distance = Math.abs((times[index] as number) - seconds);
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  }
  return bestDistance <= halfFrame ? best : -1;
}

interface ReducedTrack {
  readonly track: BakedTrack;
  readonly before: number;
  readonly after: number;
  readonly maxError: number;
}

function reduceTrack(
  track: BakedTrack,
  tolerance: number,
  keepFrames: readonly Frame[] | undefined,
  contactSeconds: number | null,
  secondsPerFrame: number,
): ReducedTrack {
  const n = track.times.length;
  if (track.interpolation === 'STEP' || n <= 2 || !(tolerance >= 0)) {
    return { track, before: n, after: n, maxError: 0 };
  }
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const halfFrame = secondsPerFrame / 2;
  if (contactSeconds !== null && Number.isFinite(contactSeconds)) {
    const index = sampleAt(track.times, contactSeconds, halfFrame);
    if (index !== -1) keep[index] = 1;
  }
  for (const frame of keepFrames ?? []) {
    if (!Number.isFinite(frame)) continue;
    const index = sampleAt(track.times, frame * secondsPerFrame, halfFrame);
    if (index !== -1) keep[index] = 1;
  }
  // Step discontinuities: a change above the tolerance between two holds (or a track end) keeps both samples.
  for (let k = 1; k < n; k++) {
    if (!(stepChange(track, k) > tolerance)) continue;
    const holdBefore = k - 1 === 0 || !(stepChange(track, k - 1) > tolerance);
    const holdAfter = k === n - 1 || !(stepChange(track, k + 1) > tolerance);
    if (holdBefore && holdAfter) {
      keep[k - 1] = 1;
      keep[k] = 1;
    }
  }

  // Recursive split between kept neighbours (explicit stack: dense tracks can be long).
  const stack: number[] = [];
  let previous = 0;
  for (let k = 1; k < n; k++) {
    if (keep[k] !== 1) continue;
    if (k - previous > 1) stack.push(previous, k);
    previous = k;
  }
  while (stack.length > 0) {
    const j = stack.pop() as number;
    const i = stack.pop() as number;
    let worst = -1;
    let worstError = tolerance;
    for (let k = i + 1; k < j; k++) {
      const error = sampleError(track, i, j, k);
      if (error > worstError) {
        worst = k;
        worstError = error;
      }
    }
    if (worst === -1) continue;
    keep[worst] = 1;
    if (j - worst > 1) stack.push(worst, j);
    if (worst - i > 1) stack.push(i, worst);
  }

  let after = 0;
  for (let k = 0; k < n; k++) after += keep[k] as number;
  const width = COMPONENTS[track.path];
  const times = new Float32Array(after);
  const values = new Float32Array(after * width);
  let maxError = 0;
  let out = 0;
  let lastKept = 0;
  for (let k = 0; k < n; k++) {
    if (keep[k] !== 1) continue;
    times[out] = track.times[k] as number;
    values.set(track.values.subarray(k * width, k * width + width), out * width);
    out++;
    for (let m = lastKept + 1; m < k; m++) maxError = Math.max(maxError, sampleError(track, lastKept, k, m));
    lastKept = k;
  }
  return {
    track: { node: track.node, path: track.path, interpolation: track.interpolation, times, values },
    before: n,
    after,
    maxError,
  };
}

/**
 * Bytes one more time (input) accessor costs a written file besides its float32 times: the accessor's JSON with its
 * min/max and, in the surgeon, its own bufferView, plus alignment (measured 120–150 B; rounded up so that the
 * estimate errs towards keeping full tracks).
 */
export const TIME_ACCESSOR_BYTES = 192;

/** Key of a time array (float32 bit patterns). */
function timesKey(times: Float32Array): string {
  return Array.from(new Uint32Array(times.buffer, times.byteOffset, times.length)).join(',');
}

/**
 * Keeps the reduction of a group of tracks that share their reduced times only where it saves bytes (§5.16 bytes
 * rule): the group costs TIME_ACCESSOR_BYTES + 4·n for its times plus its samples, against the full samples of its
 * tracks on the full time array, which the file holds anyway while any track keeps it (charged once otherwise).
 */
function keepPayingReductions(original: readonly BakedTrack[], reduced: ReducedTrack[]): void {
  const sampleBytes = (track: BakedTrack, n: number): number => n * 4 * COMPONENTS[track.path];
  const groups = new Map<string, number[]>();
  let fullUsers = 0;
  reduced.forEach((r, i) => {
    if (r.after < r.before) {
      const key = timesKey(r.track.times);
      const group = groups.get(key);
      if (group === undefined) groups.set(key, [i]);
      else group.push(i);
    } else if (r.before > 2 && r.track.interpolation === 'LINEAR') fullUsers++;
  });
  const fullTimes = Math.max(0, ...original.map((track) => track.times.length));
  const reverted: number[] = [];
  let revertedSaving = 0;
  for (const members of groups.values()) {
    const first = reduced[members[0] as number] as ReducedTrack;
    let asReduced = TIME_ACCESSOR_BYTES + 4 * first.after;
    let asFull = 0;
    for (const i of members) {
      const r = reduced[i] as ReducedTrack;
      asReduced += sampleBytes(r.track, r.after);
      asFull += sampleBytes(r.track, r.before);
    }
    if (asReduced >= asFull) {
      reverted.push(...members);
      revertedSaving += asReduced - asFull;
    }
  }
  // With no other track on the full time array, reverting adds that array once: revert only if it still pays.
  if (reverted.length > 0 && fullUsers === 0 && revertedSaving <= TIME_ACCESSOR_BYTES + 4 * fullTimes) return;
  for (const i of reverted) {
    const track = original[i] as BakedTrack;
    reduced[i] = { track, before: track.times.length, after: track.times.length, maxError: 0 };
  }
}

/** §5.16: error-bounded reduction of a baked clip's sampled tracks. Pure and deterministic. */
export function reduceBakedClip(
  clip: BakedClip,
  opts: ReduceInput,
): { readonly clip: BakedClip; readonly stats: ReductionStats } {
  const secondsPerFrame = clip.fps.num > 0 ? clip.fps.den / clip.fps.num : 0;
  let samplesBefore = 0;
  let samplesAfter = 0;
  let maxRotationErrorRad = 0;
  let maxTranslationErrorM = 0;
  const reduced = clip.tracks.map((track) => {
    const key: TrackKey = `${track.node}/${track.path}`;
    const tolerance = trackTolerance(track, opts.spec, opts.height, opts.leverArm);
    return reduceTrack(track, tolerance, opts.keep.get(key), clip.meta.contactSeconds, secondsPerFrame);
  });
  keepPayingReductions(clip.tracks, reduced);
  const tracks = reduced.map((r, i) => {
    const path = (clip.tracks[i] as BakedTrack).path;
    samplesBefore += r.before;
    samplesAfter += r.after;
    if (path === 'rotation') maxRotationErrorRad = Math.max(maxRotationErrorRad, r.maxError);
    else if (path === 'translation') maxTranslationErrorM = Math.max(maxTranslationErrorM, r.maxError);
    return r.track;
  });
  const stats: ReductionStats = { samplesBefore, samplesAfter, maxRotationErrorRad, maxTranslationErrorM };
  return { clip: { ...clip, tracks, reduction: stats }, stats };
}

/**
 * L_j of R02 §6.4 per SkeletonDesc node (`'raw'`) or HUMAN_BONE_NAMES index (`'humanoid'`): the longest rest-pose
 * distance from the node to any descendant joint (`isJoint`), times 1.1 for the skin; 0 for a node without
 * descendant joints. Humanoid entries use the mapped node of each present bone.
 */
export function trackLeverArms(skeleton: SkeletonDesc, target: 'raw' | 'humanoid'): ReadonlyMap<number, number> {
  const worlds = restWorlds(skeleton);
  const nodes = skeleton.nodes;
  const longest = new Float64Array(nodes.length);
  // Every joint updates each of its ancestors (n·depth; skeletons are small).
  for (const node of nodes) {
    if (!node.isJoint) continue;
    const p = worlds[node.index]?.t;
    if (p === undefined) continue;
    for (let a = node.parent; a !== -1; a = nodes[a]?.parent ?? -1) {
      const q = worlds[a]?.t;
      if (q === undefined) break;
      const distance = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
      if (distance > (longest[a] as number)) longest[a] = distance;
    }
  }
  const out = new Map<number, number>();
  if (target === 'raw') {
    for (const node of nodes) out.set(node.index, (longest[node.index] as number) * LEVER_SKIN_FACTOR);
    return out;
  }
  const humanoid = skeleton.humanoid ?? {};
  HUMAN_BONE_NAMES.forEach((bone, index) => {
    const node = humanoid[bone];
    if (node !== undefined && node >= 0 && node < nodes.length)
      out.set(index, (longest[node] as number) * LEVER_SKIN_FACTOR);
  });
  return out;
}
