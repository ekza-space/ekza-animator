// Read-back check (MVP-SPEC §4.11.10 step 5): re-parses an export, finds every baked clip and track in it and
// compares the stored samples with the baked ones (1e-4 rad for rotations, 1e-5 for translation and scale).
import { quatAngle, quatSlerp, type Quat } from '@ekza-studio/anim-core';
import { HUMAN_BONE_NAMES, type SkeletonDesc } from '@ekza-studio/rig';
import { parseGlbSync } from '../glb/parse';
import { GltfReader } from '../gltf/accessor';
import {
  animationsOf,
  type GltfAnimationDef,
  isIndex,
  isRecord,
  listField,
  nodesOf,
  rootExtensions,
} from '../gltf/schema';
import type { BakedClip, BakedTrack, ExportKind, GltfJson, ReadBackReport } from '../types';
import { clipNameKey } from '../writers/names';

export const READBACK_ROTATION_TOLERANCE = 1e-4;
export const READBACK_TRANSLATION_TOLERANCE = 1e-5;

const FAILED: ReadBackReport = {
  ok: false,
  animations: 0,
  channels: 0,
  maxRotationErrorRad: Infinity,
  maxTranslationErrorM: Infinity,
};

export async function readBackCheck(
  kind: ExportKind,
  bytes: Uint8Array,
  expected: readonly BakedClip[],
  skeleton: SkeletonDesc,
): Promise<ReadBackReport> {
  return readBackCheckSync(kind, bytes, expected, skeleton);
}

export function readBackCheckSync(
  kind: ExportKind,
  bytes: Uint8Array,
  expected: readonly BakedClip[],
  skeleton: SkeletonDesc,
): ReadBackReport {
  let json: GltfJson;
  let reader: GltfReader;
  try {
    const parsed = parseGlbSync(bytes);
    json = parsed.json;
    reader = new GltfReader(parsed.json, parsed.bin);
  } catch {
    return FAILED;
  }
  const nodeOf = nodeMapping(kind, json, expected, skeleton);
  if (nodeOf === null) return FAILED;
  const animations = animationsOf(json);
  let ok = true;
  let matched = 0;
  let channels = 0;
  let maxRot = 0;
  let maxLin = 0;
  for (const clip of expected) {
    const animation =
      kind === 'vrma'
        ? animations[0]
        : animations.find((a) => clipNameKey(String(a.name ?? '')) === clipNameKey(clip.name));
    if (animation === undefined) {
      ok = false;
      continue;
    }
    matched++;
    const defs = listField(animation.channels);
    channels += defs.length;
    if (defs.length !== clip.tracks.length) ok = false;
    for (const track of clip.tracks) {
      const node = nodeOf(track);
      const error = node === null ? null : compareTrack(reader, animation, node, track);
      if (error === null) {
        ok = false;
        continue;
      }
      if (track.path === 'rotation') maxRot = Math.max(maxRot, error);
      else maxLin = Math.max(maxLin, error);
    }
  }
  ok &&= maxRot <= READBACK_ROTATION_TOLERANCE && maxLin <= READBACK_TRANSLATION_TOLERANCE;
  return { ok, animations: matched, channels, maxRotationErrorRad: maxRot, maxTranslationErrorM: maxLin };
}

/** Maps a baked track to the glTF node index it must target in the output file (null: no such node). */
function nodeMapping(
  kind: ExportKind,
  json: GltfJson,
  expected: readonly BakedClip[],
  skeleton: SkeletonDesc,
): ((track: BakedTrack) => number | null) | null {
  if (kind === 'vrma') {
    const ext = rootExtensions(json)['VRMC_vrm_animation'];
    const humanoid = isRecord(ext) ? ext['humanoid'] : undefined;
    const bones = isRecord(humanoid) ? humanoid['humanBones'] : undefined;
    if (!isRecord(bones)) return null;
    return (track) => {
      const bone = bones[HUMAN_BONE_NAMES[track.node] ?? ''];
      return isRecord(bone) && isIndex(bone['node']) ? bone['node'] : null;
    };
  }
  if (kind === 'animation-glb') {
    // The writer keeps the animated nodes and their ancestors, in SkeletonDesc order; names must survive.
    const keep = new Set<number>();
    for (const clip of expected) {
      for (const track of clip.tracks) {
        for (let n = track.node; n !== -1 && !keep.has(n); n = skeleton.nodes[n]?.parent ?? -1) {
          if (skeleton.nodes[n] === undefined) break;
          keep.add(n);
        }
      }
    }
    const kept = skeleton.nodes.filter((node) => keep.has(node.index));
    const outputNodes = nodesOf(json);
    if (outputNodes.length !== kept.length) return null;
    const index = new Map(kept.map((node, i) => [node.index, i]));
    if (kept.some((node, i) => (outputNodes[i]?.name ?? '') !== node.name)) return null;
    return (track) => index.get(track.node) ?? null;
  }
  return (track) => skeleton.nodes[track.node]?.gltfIndex ?? null;
}

/** Largest error of a track against the stored channel, or null when the channel is missing or unreadable. */
function compareTrack(reader: GltfReader, animation: GltfAnimationDef, node: number, track: BakedTrack): number | null {
  const channel = listField(animation.channels).find(
    (ch) => isRecord(ch.target) && ch.target.node === node && ch.target.path === track.path,
  );
  const sampler = channel !== undefined && isIndex(channel.sampler) ? animation.samplers[channel.sampler] : undefined;
  if (sampler === undefined || !isIndex(sampler.input) || !isIndex(sampler.output)) return null;
  let times: Float32Array;
  let values: Float32Array;
  try {
    times = reader.readFloat(sampler.input);
    values = reader.readFloat(sampler.output);
  } catch {
    return null;
  }
  const n = track.path === 'rotation' ? 4 : 3;
  const interpolation =
    sampler.interpolation === 'STEP' ? 'STEP' : sampler.interpolation === 'CUBICSPLINE' ? null : 'LINEAR';
  if (interpolation === null || values.length !== times.length * n || times.length === 0) return null;
  const sample = new Float64Array(n);
  let max = 0;
  for (let k = 0; k < track.times.length; k++) {
    sampleAt(times, values, n, interpolation, track.times[k] as number, sample);
    const expected = track.values.subarray(k * n, k * n + n);
    if (n === 4) {
      max = Math.max(max, quatAngle(expected as unknown as Quat, sample as unknown as Quat));
    } else {
      for (let c = 0; c < n; c++) max = Math.max(max, Math.abs((sample[c] as number) - (expected[c] as number)));
    }
  }
  return max;
}

/** glTF LINEAR (slerp for quaternions) / STEP sampling with clamped ends. */
export function sampleAt(
  times: Float32Array,
  values: Float32Array,
  n: number,
  interpolation: 'LINEAR' | 'STEP',
  t: number,
  out: Float64Array,
): void {
  const last = times.length - 1;
  // First index whose time is ≥ t (binary search).
  let lo0 = 0;
  let hi0 = times.length;
  while (lo0 < hi0) {
    const mid = (lo0 + hi0) >> 1;
    if ((times[mid] as number) < t) lo0 = mid + 1;
    else hi0 = mid;
  }
  const hi = lo0;
  if (hi === 0 || (hi <= last && times[hi] === t)) {
    const k = Math.min(hi, last);
    for (let c = 0; c < n; c++) out[c] = values[k * n + c] as number;
    return;
  }
  if (hi > last) {
    for (let c = 0; c < n; c++) out[c] = values[last * n + c] as number;
    return;
  }
  const lo = hi - 1;
  if (interpolation === 'STEP') {
    for (let c = 0; c < n; c++) out[c] = values[lo * n + c] as number;
    return;
  }
  const u = (t - (times[lo] as number)) / ((times[hi] as number) - (times[lo] as number));
  if (n === 4) {
    const a: Quat = [
      values[lo * 4] as number,
      values[lo * 4 + 1] as number,
      values[lo * 4 + 2] as number,
      values[lo * 4 + 3] as number,
    ];
    const b: Quat = [
      values[hi * 4] as number,
      values[hi * 4 + 1] as number,
      values[hi * 4 + 2] as number,
      values[hi * 4 + 3] as number,
    ];
    out.set(quatSlerp(a, b, u));
    return;
  }
  for (let c = 0; c < n; c++) {
    out[c] = (values[lo * n + c] as number) * (1 - u) + (values[hi * n + c] as number) * u;
  }
}
