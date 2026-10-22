// Mixamo-style clip parameters on a normalized humanoid clip (AUTORIG-SPEC §5.5.3; D5): speed, trim, mirror, in
// place and arm space, applied to the VRMA bytes before C12's import path (`deriveHumanoidVrma`), so the library
// preview and Use Clip compile the same curves from the same bytes. Pure and deterministic.
//
// - trim keeps the samples inside [start, end], adds a sample at each end (interpolated as the track interpolates:
//   STEP holds, LINEAR lerps positions and slerps rotations, CUBICSPLINE evaluates the Hermite segment and takes its
//   derivative as the new end tangents) and re-zeroes time;
// - speed divides sample times by the factor (CUBICSPLINE tangents, per second, are multiplied by it);
// - mirror swaps the left and right bones and reflects across the YZ plane: q → (x, −y, −z, w), hips x → −x;
// - arm space pre-multiplies the upper arms' normalized local rotations by an abduction about +Z (left +θ, right −θ:
//   the arms move away from the torso for θ > 0);
// - in place removes the hips' X/Z travel from the first to the last sample with the bake's own helper
//   (`travelBetween` / `travelAt`, `bake/bake.ts`), so the derived clip previews in place; idempotent.
//
// Identity parameters return the input unchanged (the same object; `deriveHumanoidVrma`: the same bytes).
import {
  EkzaError,
  mat4Compose,
  mat4Multiply,
  type Quat,
  quatFromAxisAngle,
  quatMultiply,
  quatNormalize,
  quatSlerp,
} from '@ekza-studio/anim-core';
import type { HumanBoneName } from '@ekza-studio/doc';
import { HUMAN_BONE_NAMES, type HumanoidClipData } from '@ekza-studio/rig';
import { travelAt, travelBetween } from '../bake/bake';
import { parseGlb } from '../glb/parse';
import { isIndex, isRecord, type JsonRecord, listField, nodesOf, numberTuple, rootExtensions } from '../gltf/schema';
import type { GlbContainer } from '../types';
import { readVrma, VRMA_EXTENSION } from '../vrma/read';
import { type HumanoidVrmaMeta, writeHumanoidVrma } from './vrma';

/**
 * Clip parameters (AUTORIG-SPEC §5.5.3; structurally `ClipParams` of editor-core, which io cannot import).
 * Identity = `{ speed: 1, trim: null, mirror: false, inPlace: false, armSpace: 0 }`.
 */
export interface HumanoidClipParams {
  /** 0.25 … 3: sample times are divided by it. */
  readonly speed: number;
  /** Seconds of the source clip; null = the whole clip. */
  readonly trim: { readonly start: number; readonly end: number } | null;
  readonly mirror: boolean;
  readonly inPlace: boolean;
  /** Degrees, −10 … +30: upper-arm abduction offset (mirror-signed). */
  readonly armSpace: number;
}

export const IDENTITY_HUMANOID_CLIP_PARAMS: HumanoidClipParams = Object.freeze({
  speed: 1,
  trim: null,
  mirror: false,
  inPlace: false,
  armSpace: 0,
});

export const CLIP_SPEED_RANGE = { min: 0.25, max: 3 } as const;
export const CLIP_ARM_SPACE_RANGE = { min: -10, max: 30 } as const;

/** Trim boundaries closer than this (seconds) to a key or to the clip's ends count as on it. */
const TIME_EPSILON = 1e-6;

type Interpolation = 'LINEAR' | 'STEP' | 'CUBICSPLINE';
interface Track {
  readonly times: Float32Array;
  readonly values: Float32Array;
}
type Interpolations = HumanoidClipData['interpolation'];

/** True when the trim covers the whole clip (or is null): the clip is not trimmed. */
export function isFullTrim(trim: HumanoidClipParams['trim'], duration: number): boolean {
  return trim === null || (trim.start <= TIME_EPSILON && trim.end >= duration - TIME_EPSILON);
}

/** True for the identity parameters (with any trim that covers the whole clip when `duration` is given). */
export function isIdentityClipParams(params: HumanoidClipParams, duration?: number): boolean {
  const untrimmed = params.trim === null || (duration !== undefined && isFullTrim(params.trim, duration));
  return params.speed === 1 && untrimmed && !params.mirror && !params.inPlace && params.armSpace === 0;
}

/** Why the parameters are not valid (for a clip of `duration` seconds when given), or null. */
export function clipParamsProblem(params: unknown, duration?: number): string | null {
  if (!isRecord(params)) return 'params must be { speed, trim, mirror, inPlace, armSpace }';
  const { speed, trim, mirror, inPlace, armSpace } = params;
  if (typeof speed !== 'number' || !(speed >= CLIP_SPEED_RANGE.min && speed <= CLIP_SPEED_RANGE.max)) {
    return `speed must be ${CLIP_SPEED_RANGE.min} … ${CLIP_SPEED_RANGE.max}`;
  }
  if (typeof mirror !== 'boolean' || typeof inPlace !== 'boolean') return 'mirror and inPlace must be booleans';
  if (typeof armSpace !== 'number' || !(armSpace >= CLIP_ARM_SPACE_RANGE.min && armSpace <= CLIP_ARM_SPACE_RANGE.max)) {
    return `armSpace must be ${CLIP_ARM_SPACE_RANGE.min} … ${CLIP_ARM_SPACE_RANGE.max} degrees`;
  }
  if (trim !== null) {
    if (!isRecord(trim) || typeof trim['start'] !== 'number' || typeof trim['end'] !== 'number') {
      return 'trim must be null or { start, end } in seconds';
    }
    const start = trim['start'];
    const end = trim['end'];
    if (!(start >= 0 && end > start)) return 'trim needs 0 ≤ start < end';
    if (duration !== undefined && end > duration + TIME_EPSILON) return `trim end is past the clip (${duration} s)`;
  }
  return null;
}

/**
 * The clip with the parameters applied (§5.5.3): trim → speed → mirror → arm space → in place. Identity parameters
 * return `data` itself. Throws EkzaError('invalid-input') for parameters out of range or a trim past the clip.
 */
export function applyClipParams(data: HumanoidClipData, params: HumanoidClipParams): HumanoidClipData {
  const problem = clipParamsProblem(params, data.duration);
  if (problem !== null) throw new EkzaError('invalid-input', `Clip parameters: ${problem}`);
  if (isIdentityClipParams(params, data.duration)) return data;
  let out = data;
  if (params.trim !== null && !isFullTrim(params.trim, data.duration)) out = trimClip(out, params.trim);
  if (params.speed !== 1) out = speedClip(out, params.speed);
  if (params.mirror) out = mirrorClip(out);
  if (params.armSpace !== 0) out = armSpaceClip(out, (params.armSpace * Math.PI) / 180);
  if (params.inPlace) out = removeTravel(out);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// tracks

const componentsOf = (path: 'rotation' | 'position'): number => (path === 'rotation' ? 4 : 3);

/** Every track of the clip with its key ('hipsPosition' for the hips translation), components and interpolation. */
function eachTrack(
  data: HumanoidClipData,
  visit: (
    key: HumanBoneName | 'hipsPosition',
    track: Track,
    components: number,
    mode: Interpolation,
  ) => Track | undefined,
): HumanoidClipData {
  const rotations: Partial<Record<HumanBoneName, Track>> = {};
  for (const bone of HUMAN_BONE_NAMES) {
    const track = data.rotations[bone];
    if (track === undefined) continue;
    rotations[bone] = visit(bone, track, 4, data.interpolation[bone] ?? 'LINEAR') ?? track;
  }
  const hips =
    data.hips === null
      ? null
      : (visit('hipsPosition', data.hips, 3, data.interpolation.hipsPosition ?? 'LINEAR') ?? data.hips);
  return { ...data, rotations, hips };
}

/** One key's value (the middle element of a CUBICSPLINE triple). */
function keyValue(track: Track, components: number, mode: Interpolation, key: number): number[] {
  const stride = mode === 'CUBICSPLINE' ? 3 * components : components;
  const offset = key * stride + (mode === 'CUBICSPLINE' ? components : 0);
  return Array.from(track.values.subarray(offset, offset + components));
}

/** One key's in (0) or out (2) tangent of a CUBICSPLINE track. */
function keyTangent(track: Track, components: number, key: number, which: 0 | 2): number[] {
  const offset = key * 3 * components + which * components;
  return Array.from(track.values.subarray(offset, offset + components));
}

/** The segment of `t` (index k with times[k] ≤ t < times[k + 1]); assumes times[0] < t < times[last]. */
function segmentOf(times: Float32Array, t: number): number {
  let lo = 0;
  let hi = times.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((times[mid] as number) <= t) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** The track's value at `t` and, for CUBICSPLINE, its time derivative there (null otherwise). */
function sampleTrack(
  track: Track,
  components: number,
  mode: Interpolation,
  t: number,
): { readonly value: number[]; readonly slope: number[] | null } {
  const { times } = track;
  const last = times.length - 1;
  const flat = (): number[] => new Array<number>(components).fill(0);
  if (t <= (times[0] as number)) {
    return { value: keyValue(track, components, mode, 0), slope: mode === 'CUBICSPLINE' ? flat() : null };
  }
  if (t >= (times[last] as number)) {
    return { value: keyValue(track, components, mode, last), slope: mode === 'CUBICSPLINE' ? flat() : null };
  }
  const k = segmentOf(times, t);
  const t0 = times[k] as number;
  const span = (times[k + 1] as number) - t0;
  const u = span > 0 ? (t - t0) / span : 0;
  const a = keyValue(track, components, mode, k);
  const b = keyValue(track, components, mode, k + 1);
  if (mode === 'STEP') return { value: a, slope: null };
  if (mode === 'LINEAR') {
    if (components === 4) {
      return { value: Array.from(quatSlerp(a as unknown as Quat, b as unknown as Quat, u)), slope: null };
    }
    return { value: a.map((v, i) => v + ((b[i] as number) - v) * u), slope: null };
  }
  // glTF CUBICSPLINE: p(u) = (2u³−3u²+1)v₀ + Δ(u³−2u²+u)b₀ + (−2u³+3u²)v₁ + Δ(u³−u²)a₁
  const out0 = keyTangent(track, components, k, 2);
  const in1 = keyTangent(track, components, k + 1, 0);
  const u2 = u * u;
  const u3 = u2 * u;
  const value = a.map(
    (v0, i) =>
      (2 * u3 - 3 * u2 + 1) * v0 +
      span * (u3 - 2 * u2 + u) * (out0[i] as number) +
      (-2 * u3 + 3 * u2) * (b[i] as number) +
      span * (u3 - u2) * (in1[i] as number),
  );
  // dp/dt = dp/du / Δ
  const slope = a.map(
    (v0, i) =>
      ((6 * u2 - 6 * u) * v0) / span +
      (3 * u2 - 4 * u + 1) * (out0[i] as number) +
      ((-6 * u2 + 6 * u) * (b[i] as number)) / span +
      (3 * u2 - 2 * u) * (in1[i] as number),
  );
  return { value: components === 4 ? Array.from(quatNormalize(value as unknown as Quat)) : value, slope };
}

/** A track cut to [start, end] with a sample at each end, time re-zeroed at `start`. */
function trimTrack(track: Track, components: number, mode: Interpolation, start: number, end: number): Track {
  const { times } = track;
  const cubic = mode === 'CUBICSPLINE';
  const stride = cubic ? 3 * components : components;
  const outTimes: number[] = [];
  const outValues: number[] = [];
  const pushKey = (
    t: number,
    value: readonly number[],
    inTangent: readonly number[],
    outTangent: readonly number[],
  ) => {
    outTimes.push(t - start);
    if (cubic) outValues.push(...inTangent);
    outValues.push(...value);
    if (cubic) outValues.push(...outTangent);
  };
  const boundary = (t: number): void => {
    // A key on the boundary is kept as it is (no interpolation noise).
    const on = times.findIndex((time) => Math.abs(time - t) <= TIME_EPSILON);
    if (on >= 0) {
      const value = keyValue(track, components, mode, on);
      pushKey(
        t,
        value,
        cubic ? keyTangent(track, components, on, 0) : [],
        cubic ? keyTangent(track, components, on, 2) : [],
      );
      return;
    }
    const { value, slope } = sampleTrack(track, components, mode, t);
    pushKey(t, value, slope ?? [], slope ?? []);
  };
  boundary(start);
  for (let i = 0; i < times.length; i++) {
    const t = times[i] as number;
    if (t <= start + TIME_EPSILON || t >= end - TIME_EPSILON) continue;
    outTimes.push(t - start);
    for (let c = 0; c < stride; c++) outValues.push(track.values[i * stride + c] as number);
  }
  boundary(end);
  return { times: Float32Array.from(outTimes), values: Float32Array.from(outValues) };
}

function trimClip(data: HumanoidClipData, trim: { readonly start: number; readonly end: number }): HumanoidClipData {
  const out = eachTrack(data, (_key, track, components, mode) =>
    track.times.length === 0 ? track : trimTrack(track, components, mode, trim.start, trim.end),
  );
  return { ...out, duration: trim.end - trim.start };
}

function speedClip(data: HumanoidClipData, speed: number): HumanoidClipData {
  const out = eachTrack(data, (_key, track, components, mode) => {
    const times = Float32Array.from(track.times, (t) => t / speed);
    if (mode !== 'CUBICSPLINE') return { times, values: track.values };
    const values = track.values.slice();
    for (let i = 0; i < values.length; i += 3 * components) {
      for (let c = 0; c < components; c++) {
        values[i + c] = (values[i + c] as number) * speed;
        values[i + 2 * components + c] = (values[i + 2 * components + c] as number) * speed;
      }
    }
    return { times, values };
  });
  return { ...out, duration: data.duration / speed };
}

// ---------------------------------------------------------------------------------------------------------------------
// mirror

/** The bone on the other side (`leftHand` ↔ `rightHand`); centre bones map to themselves. */
export function mirrorBone(bone: HumanBoneName): HumanBoneName {
  if (bone.startsWith('left')) return `right${bone.slice(4)}` as HumanBoneName;
  if (bone.startsWith('right')) return `left${bone.slice(5)}` as HumanBoneName;
  return bone;
}

/** Reflects every element of a rotation (q → (x, −y, −z, w)) or position (x → −x) track, tangents included. */
function reflect(values: Float32Array, components: number): Float32Array {
  const out = values.slice();
  for (let i = 0; i < out.length; i += components) {
    if (components === 4) {
      out[i + 1] = -(out[i + 1] as number);
      out[i + 2] = -(out[i + 2] as number);
    } else {
      out[i] = -(out[i] as number);
    }
  }
  return out;
}

function mirrorClip(data: HumanoidClipData): HumanoidClipData {
  const rotations: Partial<Record<HumanBoneName, Track>> = {};
  const interpolation: Partial<Record<HumanBoneName | 'hipsPosition', Interpolation>> = {};
  for (const bone of HUMAN_BONE_NAMES) {
    const from = mirrorBone(bone);
    const track = data.rotations[from];
    if (track !== undefined) rotations[bone] = { times: track.times, values: reflect(track.values, 4) };
    const mode = data.interpolation[from];
    if (mode !== undefined) interpolation[bone] = mode;
  }
  if (data.interpolation.hipsPosition !== undefined) interpolation.hipsPosition = data.interpolation.hipsPosition;
  const present = new Set(data.presentBones.map(mirrorBone));
  return {
    ...data,
    presentBones: HUMAN_BONE_NAMES.filter((bone) => present.has(bone)),
    rotations,
    hips: data.hips === null ? null : { times: data.hips.times, values: reflect(data.hips.values, 3) },
    restHipsPosition: [-data.restHipsPosition[0], data.restHipsPosition[1], data.restHipsPosition[2]],
    interpolation,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// arm space

function armSpaceClip(data: HumanoidClipData, angle: number): HumanoidClipData {
  const rotations: Partial<Record<HumanBoneName, Track>> = { ...data.rotations };
  const interpolation: Partial<Record<HumanBoneName | 'hipsPosition', Interpolation>> = { ...data.interpolation };
  const end = Math.max(data.duration, 0);
  for (const [bone, sign] of [
    ['leftUpperArm', 1],
    ['rightUpperArm', -1],
  ] as const) {
    if (!data.presentBones.includes(bone)) continue;
    const offset = quatFromAxisAngle([0, 0, 1], sign * angle);
    const track = data.rotations[bone];
    if (track === undefined || track.times.length === 0) {
      // A present bone without a track rests at identity: it gets the offset as a constant track.
      rotations[bone] = {
        times: end > 0 ? Float32Array.from([0, end]) : Float32Array.from([0]),
        values: Float32Array.from(end > 0 ? [...offset, ...offset] : offset),
      };
      interpolation[bone] = 'LINEAR';
      continue;
    }
    // Pre-multiplying is linear, so CUBICSPLINE tangents take the same product as the values.
    const values = track.values.slice();
    const q: Quat = [0, 0, 0, 1];
    for (let i = 0; i + 3 < values.length; i += 4) {
      q[0] = values[i] as number;
      q[1] = values[i + 1] as number;
      q[2] = values[i + 2] as number;
      q[3] = values[i + 3] as number;
      quatMultiply(offset, q, q);
      values.set(q, i);
    }
    rotations[bone] = { times: track.times, values };
  }
  return { ...data, rotations, interpolation };
}

// ---------------------------------------------------------------------------------------------------------------------
// in place

/**
 * The hips' X/Z travel from the first to the last sample removed linearly over time (the bake's root motion
 * 'in-place', `travelBetween` / `travelAt`); a clip that does not travel is returned as it is (idempotent).
 */
function removeTravel(data: HumanoidClipData): HumanoidClipData {
  const hips = data.hips;
  if (hips === null || hips.times.length < 2) return data;
  const mode = data.interpolation.hipsPosition ?? 'LINEAR';
  const last = hips.times.length - 1;
  const first = keyValue(hips, 3, mode, 0);
  const end = keyValue(hips, 3, mode, last);
  const t0 = hips.times[0] as number;
  const t1 = hips.times[last] as number;
  const travel = travelBetween(t0, t1, [first[0] as number, first[2] as number], [end[0] as number, end[2] as number]);
  if (travel === null || !(travel.span > 0)) return data;
  const values = hips.values.slice();
  const cubic = mode === 'CUBICSPLINE';
  const stride = cubic ? 9 : 3;
  const offset = cubic ? 3 : 0;
  for (let k = 0; k <= last; k++) {
    const t = hips.times[k] as number;
    const i = k * stride + offset;
    values[i] = (values[i] as number) - travelAt(travel, t, 0);
    values[i + 2] = (values[i + 2] as number) - travelAt(travel, t, 2);
    if (cubic) {
      // the removal's slope (travel per second) off both tangents
      for (const tangent of [k * stride, k * stride + 6]) {
        values[tangent] = (values[tangent] as number) - travel.x / travel.span;
        values[tangent + 2] = (values[tangent + 2] as number) - travel.z / travel.span;
      }
    }
  }
  return { ...data, hips: { times: hips.times, values } };
}

// ---------------------------------------------------------------------------------------------------------------------
// bytes

/**
 * VRMA bytes with the parameters applied (§5.5.3 step 1): `readVrma` → `applyClipParams` → `writeHumanoidVrma`,
 * carrying the source's `ekza_animation_v1` provenance (its first `derivedFrom` entry, the generator) and its rest
 * positions (mirrored with the clip). Identity parameters return `bytes` itself (no decode, no encode); otherwise the
 * output is byte-deterministic.
 */
export async function deriveHumanoidVrma(bytes: Uint8Array, params: HumanoidClipParams): Promise<Uint8Array> {
  const problem = clipParamsProblem(params);
  if (problem !== null) throw new EkzaError('invalid-input', `Clip parameters: ${problem}`);
  if (isIdentityClipParams(params)) return bytes;
  const container = await parseGlb(bytes);
  const data = readVrma(container);
  if (isIdentityClipParams(params, data.duration)) return bytes;
  const derived = applyClipParams(data, params);
  let rest = restWorldsOf(container);
  if (params.mirror) {
    const mirrored: Partial<Record<HumanBoneName, Vec3>> = {};
    for (const bone of HUMAN_BONE_NAMES) {
      const p = rest[mirrorBone(bone)];
      if (p !== undefined) mirrored[bone] = [-p[0], p[1], p[2]];
    }
    rest = mirrored;
  }
  return writeHumanoidVrma(derived, metaOf(container, data.name), rest);
}

type Vec3 = readonly [number, number, number];

/** Rest world positions of the VRMA's humanoid bones (from its node hierarchy; TRS or matrix locals). */
function restWorldsOf(container: GlbContainer): Partial<Record<HumanBoneName, Vec3>> {
  const json = container.json;
  const defs = nodesOf(json);
  const parentOf = new Map<number, number>();
  defs.forEach((def, i) => {
    for (const child of listField(def.children)) parentOf.set(child, i);
  });
  const worlds = new Map<number, Float64Array>();
  const world = (i: number, depth = 0): Float64Array => {
    const done = worlds.get(i);
    if (done !== undefined) return done;
    if (depth > defs.length) throw new EkzaError('malformed-gltf', 'The node hierarchy has a cycle');
    const def = defs[i];
    const m = numberTuple(def?.matrix, 16);
    let local: Float64Array;
    if (m !== null) local = Float64Array.from(m);
    else {
      const t = numberTuple(def?.translation, 3) ?? [0, 0, 0];
      const q = numberTuple(def?.rotation, 4) ?? [0, 0, 0, 1];
      const s = numberTuple(def?.scale, 3) ?? [1, 1, 1];
      local = mat4Compose({
        t: [t[0] as number, t[1] as number, t[2] as number],
        q: quatNormalize([q[0] as number, q[1] as number, q[2] as number, q[3] as number]),
        s: [s[0] as number, s[1] as number, s[2] as number],
      });
    }
    const parent = parentOf.get(i);
    const result = parent === undefined ? local : mat4Multiply(world(parent, depth + 1), local);
    worlds.set(i, result);
    return result;
  };
  const ext = rootExtensions(json)[VRMA_EXTENSION];
  const humanBones = isRecord(ext) && isRecord(ext['humanoid']) ? ext['humanoid']['humanBones'] : undefined;
  const out: Partial<Record<HumanBoneName, Vec3>> = {};
  const known = new Set<string>(HUMAN_BONE_NAMES);
  for (const [name, bone] of Object.entries(isRecord(humanBones) ? humanBones : {})) {
    const node = isRecord(bone) ? bone['node'] : undefined;
    if (!known.has(name) || !isIndex(node) || node >= defs.length) continue;
    const w = world(node);
    out[name as HumanBoneName] = [w[12] as number, w[13] as number, w[14] as number];
  }
  return out;
}

/** The writer's metadata from the source's `ekza_animation_v1` (first clip's first `derivedFrom`) and generator. */
function metaOf(container: GlbContainer, name: string): HumanoidVrmaMeta {
  const asset: JsonRecord = isRecord(container.json.asset) ? container.json.asset : {};
  const generator = typeof asset['generator'] === 'string' ? asset['generator'] : 'ekza-studio';
  const extras: JsonRecord = isRecord(asset['extras']) ? asset['extras'] : {};
  const meta: JsonRecord = isRecord(extras['ekza_animation_v1']) ? extras['ekza_animation_v1'] : {};
  const clips = Array.isArray(meta['clips']) ? (meta['clips'] as readonly unknown[]) : [];
  const clip: JsonRecord = isRecord(clips[0]) ? clips[0] : {};
  const derived = Array.isArray(clip['derivedFrom']) ? (clip['derivedFrom'] as readonly unknown[]) : [];
  const first: JsonRecord = isRecord(derived[0]) ? derived[0] : {};
  const text = (value: unknown, fallback: string): string =>
    typeof value === 'string' && value !== '' ? value : fallback;
  return {
    generator,
    source: text(first['title'], name === '' ? 'clip' : name),
    credit: text(first['author'], 'unknown'),
    license: text(first['license'], 'unknown'),
    sourceSha256: typeof first['sourceSha256'] === 'string' ? first['sourceSha256'] : null,
  };
}
