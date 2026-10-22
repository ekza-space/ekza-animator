// The UAL → VRM retarget (M6B-SPEC §0.4.7, Q-MVP-9; C12): the world-space delta method of OMOBA's
// `scripts/retarget_animations.py`, written onto the VRM normalized T-pose (the VRMA frame, rest rotations identity).
//
//   reference W^ref = the `A_TPose` clip at its first key (world, every node above the bone included)
//   ΔW_b(t)  = W_b(t) · (W_b^ref)⁻¹                         rotation part, per mapped bone b
//   A        = identity, or 180° about +Y when the reference's left hand has x < 0 (faces +Z, left = +X)
//   N_b(t)   = A · ΔW_b(t) · A⁻¹                            normalized world rotation (rest = identity)
//   n_b(t)   = N_parent(b)(t)⁻¹ · N_b(t)                    local, along the VRM humanoid parent map (nearest mapped)
//   hips(t)  = A · p_hips(t)                                absolute, source metres; restHipsPosition = A · p_hips^ref
//
// Sampling: UAL's keys sit at 24 fps, the starter pack's clips are 30 fps (the manifest's `fps: 30`), so each clip is
// sampled at N + 1 uniform times, N = round(30 · d) for the source's last key time d: key k at k/30 s reads the source
// at k·d/N s (a clip whose length is not a whole number of 30 fps frames is time-scaled by less than half a frame, so
// its first and last keys stay the source's and a loop stays seamless). Quaternions normalized and hemisphere-
// continuous with a first key of w ≥ 0; a constant track keeps one key (the only reduction). Pure and deterministic:
// the same container and clip give the same arrays.
import {
  EkzaError,
  type Quat,
  quatInvert,
  quatMultiply,
  quatNormalize,
  quatRotateVec3,
  quatSlerp,
  type ReadonlyQuat,
  type Vec3,
} from '@ekza-studio/anim-core';
import type { HumanBoneName } from '@ekza-studio/doc';
import { HUMAN_BONE_NAMES, HUMAN_BONE_PARENT, type HumanoidClipData } from '@ekza-studio/rig';
import { GltfReader } from '../gltf/accessor';
import { animationsOf, type GltfNodeDef, isIndex, isRecord, listField, nodesOf, numberTuple } from '../gltf/schema';
import type { GlbContainer } from '../types';
import { UAL_BONE_MAP } from './boneMap';

/** The UAL reference clip (§0.4.7). */
export const UAL_REFERENCE_CLIP = 'A_TPose';
const IDENTITY: ReadonlyQuat = [0, 0, 0, 1];
const YAW_180: ReadonlyQuat = [0, 1, 0, 0];
/** Per-component tolerance under which every key of a track equals its first (a constant track). */
const CONSTANT_EPS = 1e-7;

type Interpolation = 'LINEAR' | 'STEP' | 'CUBICSPLINE';
interface Channel {
  readonly node: number;
  readonly path: 'translation' | 'rotation' | 'scale';
  readonly times: Float32Array;
  readonly values: Float32Array;
  readonly interpolation: Interpolation;
}
/** World transforms of every node (rotation, translation, per-axis scale), filled per sampled time. */
export interface UalWorld {
  readonly r: Float64Array; // 4 per node
  readonly t: Float64Array; // 3 per node
  readonly s: Float64Array; // 3 per node
}

/**
 * The UAL source rig: node hierarchy, rest locals and animation channels, with the forward kinematics the retarget
 * and its tests share. Built once per container (`ualSource`, cached).
 */
export class UalSource {
  readonly names: readonly string[];
  readonly nodeOf: ReadonlyMap<string, number>;
  /** Nodes, parents first (scene order, then children order); nodes outside every scene follow as roots. */
  readonly order: readonly number[];
  readonly parent: Int32Array;
  private readonly rest: { readonly t: Float64Array; readonly r: Float64Array; readonly s: Float64Array };
  private readonly clips: ReadonlyMap<string, readonly Channel[]>;
  /** World pose of the reference (A_TPose at its first key). */
  readonly reference: UalWorld;
  /** Yaw alignment A (§0.4.7). */
  readonly align: ReadonlyQuat;

  constructor(readonly container: GlbContainer) {
    const json = container.json;
    const defs = nodesOf(json);
    const count = defs.length;
    this.names = defs.map((def, i) => (typeof def.name === 'string' ? def.name : `#${i}`));
    this.nodeOf = new Map(this.names.map((name, i) => [name, i]));
    this.parent = new Int32Array(count).fill(-1);
    defs.forEach((def, i) => {
      for (const child of listField(def.children)) if (isIndex(child) && child < count) this.parent[child] = i;
    });
    this.order = topologicalOrder(defs, this.parent, json);
    this.rest = restLocals(defs);
    const reader = new GltfReader(json, container.bin);
    const clips = new Map<string, Channel[]>();
    for (const animation of animationsOf(json)) {
      const name = typeof animation.name === 'string' ? animation.name : '';
      const samplers = listField(animation.samplers);
      const channels: Channel[] = [];
      for (const def of listField(animation.channels)) {
        const target: Readonly<Record<string, unknown>> = isRecord(def.target) ? def.target : {};
        const node = target['node'];
        const path = target['path'];
        if (!isIndex(node) || node >= count) continue;
        if (path !== 'translation' && path !== 'rotation' && path !== 'scale') continue;
        const sampler = isIndex(def.sampler) ? samplers[def.sampler] : undefined;
        if (sampler === undefined || !isIndex(sampler.input) || !isIndex(sampler.output)) continue;
        const interpolation: Interpolation =
          sampler.interpolation === 'STEP' || sampler.interpolation === 'CUBICSPLINE'
            ? sampler.interpolation
            : 'LINEAR';
        channels.push({
          node,
          path,
          times: reader.readFloat(sampler.input),
          values: reader.readFloat(sampler.output),
          interpolation,
        });
      }
      if (name !== '' && !clips.has(name)) clips.set(name, channels);
    }
    this.clips = clips;
    const reference = this.channels(UAL_REFERENCE_CLIP);
    this.reference = this.worldAt(reference, firstTime(reference));
    const leftHand = this.node('DEF-hand.L');
    this.align = (this.reference.t[leftHand * 3] as number) < 0 ? YAW_180 : IDENTITY;
  }

  /** The node index of a UAL node name (throws for a name the file lacks). */
  node(name: string): number {
    const node = this.nodeOf.get(name);
    if (node === undefined) throw new EkzaError('unsupported', `The UAL file has no node '${name}'`);
    return node;
  }

  /** The channels of a clip (throws for a clip the file lacks). */
  channels(clip: string): readonly Channel[] {
    const channels = this.clips.get(clip);
    if (channels === undefined) throw new EkzaError('unsupported', `The UAL file has no clip '${clip}'`);
    return channels;
  }

  /** The source key times of a clip: the sorted union of its channels' inputs (float32 values). */
  keyTimes(clip: string): Float32Array {
    const times = new Set<number>();
    for (const channel of this.channels(clip)) for (const t of channel.times) times.add(t);
    return Float32Array.from([...times].sort((a, b) => a - b));
  }

  /** World transforms of every node at `time` (rest locals overridden by the clip's channels). */
  worldAt(channels: readonly Channel[], time: number): UalWorld {
    const count = this.names.length;
    const lt = Float64Array.from(this.rest.t);
    const lr = Float64Array.from(this.rest.r);
    const ls = Float64Array.from(this.rest.s);
    for (const channel of channels) {
      if (channel.times.length === 0) continue;
      if (channel.path === 'rotation') sampleInto(channel, time, 4, lr, channel.node * 4, true);
      else sampleInto(channel, time, 3, channel.path === 'translation' ? lt : ls, channel.node * 3, false);
    }
    const world: UalWorld = {
      r: new Float64Array(count * 4),
      t: new Float64Array(count * 3),
      s: new Float64Array(count * 3),
    };
    const q: Quat = [0, 0, 0, 1];
    const pq: Quat = [0, 0, 0, 1];
    const v: Vec3 = [0, 0, 0];
    for (const i of this.order) {
      const p = this.parent[i] as number;
      q[0] = lr[i * 4] as number;
      q[1] = lr[i * 4 + 1] as number;
      q[2] = lr[i * 4 + 2] as number;
      q[3] = lr[i * 4 + 3] as number;
      quatNormalize(q, q);
      if (p === -1) {
        world.r.set(q, i * 4);
        world.t.set(lt.subarray(i * 3, i * 3 + 3), i * 3);
        world.s.set(ls.subarray(i * 3, i * 3 + 3), i * 3);
        continue;
      }
      pq[0] = world.r[p * 4] as number;
      pq[1] = world.r[p * 4 + 1] as number;
      pq[2] = world.r[p * 4 + 2] as number;
      pq[3] = world.r[p * 4 + 3] as number;
      for (let k = 0; k < 3; k++) v[k] = (world.s[p * 3 + k] as number) * (lt[i * 3 + k] as number);
      quatRotateVec3(pq, v, v);
      for (let k = 0; k < 3; k++) {
        world.t[i * 3 + k] = (world.t[p * 3 + k] as number) + (v[k] as number);
        world.s[i * 3 + k] = (world.s[p * 3 + k] as number) * (ls[i * 3 + k] as number);
      }
      quatNormalize(quatMultiply(pq, q, q), q);
      world.r.set(q, i * 4);
    }
    return world;
  }
}

/** Frame rate of the starter pack's clips (§0.5 `StarterPackClip.fps`). */
export const UAL_OUTPUT_FPS = 30;

/** The sampling of one clip: source times read, and the output key times (k / 30 s). */
export function ualSampling(
  source: UalSource,
  clip: string,
): { readonly source: Float64Array; readonly output: Float32Array; readonly duration: number } {
  const keys = source.keyTimes(clip);
  if (keys.length === 0) throw new EkzaError('unsupported', `The UAL clip '${clip}' has no keys`);
  const first = keys[0] as number;
  const last = keys[keys.length - 1] as number;
  const frames = Math.max(1, Math.round((last - first) * UAL_OUTPUT_FPS));
  const sourceTimes = new Float64Array(frames + 1);
  const output = new Float32Array(frames + 1);
  for (let k = 0; k <= frames; k++) {
    sourceTimes[k] = k === frames ? last : first + (k * (last - first)) / frames;
    output[k] = k / UAL_OUTPUT_FPS;
  }
  return { source: sourceTimes, output, duration: frames / UAL_OUTPUT_FPS };
}

const sources = new WeakMap<GlbContainer, UalSource>();

/** The (cached) source rig of a UAL container. */
export function ualSource(ual: GlbContainer): UalSource {
  let source = sources.get(ual);
  if (source === undefined) {
    source = new UalSource(ual);
    sources.set(ual, source);
  }
  return source;
}

/** Mapped humanoid bones in `HUMAN_BONE_NAMES` order, with their UAL nodes. */
export function ualMappedBones(source: UalSource): readonly { readonly bone: HumanBoneName; readonly node: number }[] {
  const nodeOfBone = new Map<HumanBoneName, number>();
  for (const [name, bone] of Object.entries(UAL_BONE_MAP)) {
    const node = source.nodeOf.get(name);
    if (node !== undefined) nodeOfBone.set(bone, node);
  }
  return HUMAN_BONE_NAMES.filter((bone) => nodeOfBone.has(bone)).map((bone) => ({
    bone,
    node: nodeOfBone.get(bone) as number,
  }));
}

/**
 * The VRM normalized T-pose of the UAL rig: the reference's world positions of the mapped bones, turned by A (the
 * VRMA writer's node layout; the semantic tests' T-pose rig).
 */
export function ualRestWorld(ual: GlbContainer): Partial<Record<HumanBoneName, readonly [number, number, number]>> {
  const source = ualSource(ual);
  const out: Partial<Record<HumanBoneName, readonly [number, number, number]>> = {};
  for (const { bone, node } of ualMappedBones(source)) out[bone] = aligned(source, source.reference, node);
  return out;
}

/** §0.4.7 world-delta retarget of one UAL clip onto the VRM normalized T-pose. */
export function retargetUalClip(ual: GlbContainer, clip: string): HumanoidClipData {
  const source = ualSource(ual);
  const channels = source.channels(clip);
  const sampling = ualSampling(source, clip);
  const times = sampling.output;
  const mapped = ualMappedBones(source);
  const present = new Set(mapped.map((entry) => entry.bone));
  const parentOf = (bone: HumanBoneName): HumanBoneName | null => {
    let parent = HUMAN_BONE_PARENT[bone];
    while (parent !== null && !present.has(parent)) parent = HUMAN_BONE_PARENT[parent];
    return parent;
  };
  const hipsNode = source.node('DEF-hips');
  const align = source.align;
  const alignInv = quatInvert(align);
  const refInv = new Map<HumanBoneName, Quat>(
    mapped.map(({ bone, node }) => [bone, quatInvert(quatAt(source.reference.r, node))]),
  );
  const values = new Map<HumanBoneName, Float32Array>(
    mapped.map(({ bone }) => [bone, new Float32Array(times.length * 4)]),
  );
  const hips = new Float32Array(times.length * 3);
  const normalized = new Map<HumanBoneName, Quat>();
  const local: Quat = [0, 0, 0, 1];
  sampling.source.forEach((time, k) => {
    const world = source.worldAt(channels, time);
    for (const { bone, node } of mapped) {
      // N_b = A · W_b(t) · (W_b^ref)⁻¹ · A⁻¹
      const delta = quatMultiply(quatAt(world.r, node), refInv.get(bone) as Quat);
      normalized.set(bone, quatNormalize(quatMultiply(quatMultiply(align, delta), alignInv)));
    }
    for (const { bone } of mapped) {
      const parent = parentOf(bone);
      const n = normalized.get(bone) as Quat;
      if (parent === null) {
        local[0] = n[0];
        local[1] = n[1];
        local[2] = n[2];
        local[3] = n[3];
      } else quatNormalize(quatMultiply(quatInvert(normalized.get(parent) as Quat), n), local);
      (values.get(bone) as Float32Array).set(local, k * 4);
    }
    hips.set(aligned(source, world, hipsNode), k * 3);
  });

  const rotations: Partial<Record<HumanBoneName, { times: Float32Array; values: Float32Array }>> = {};
  const interpolation: Partial<Record<HumanBoneName | 'hipsPosition', 'LINEAR'>> = {};
  for (const { bone } of mapped) {
    const track = values.get(bone) as Float32Array;
    hemisphereContinuous(track);
    rotations[bone] = constantOrFull(times, track, 4);
    interpolation[bone] = 'LINEAR';
  }
  interpolation.hipsPosition = 'LINEAR';
  return {
    name: clip,
    duration: sampling.duration,
    presentBones: mapped.map((entry) => entry.bone),
    rotations,
    hips: constantOrFull(times, hips, 3),
    restHipsPosition: aligned(source, source.reference, hipsNode),
    interpolation,
  };
}

/** A · p, the world position of `node` turned by the yaw alignment. */
function aligned(source: UalSource, world: UalWorld, node: number): [number, number, number] {
  const p = quatRotateVec3(source.align, [
    world.t[node * 3] as number,
    world.t[node * 3 + 1] as number,
    world.t[node * 3 + 2] as number,
  ]);
  return [p[0], p[1], p[2]];
}

export function quatAt(values: Float64Array | Float32Array, index: number): Quat {
  return [
    values[index * 4] as number,
    values[index * 4 + 1] as number,
    values[index * 4 + 2] as number,
    values[index * 4 + 3] as number,
  ];
}

/** First key w ≥ 0, then every key in the hemisphere of the one before (float32 values, in place). */
function hemisphereContinuous(track: Float32Array): void {
  for (let i = 0; i < track.length; i += 4) {
    const flip =
      i === 0
        ? (track[3] as number) < 0
        : (track[i] as number) * (track[i - 4] as number) +
            (track[i + 1] as number) * (track[i - 3] as number) +
            (track[i + 2] as number) * (track[i - 2] as number) +
            (track[i + 3] as number) * (track[i - 1] as number) <
          0;
    if (flip) for (let c = 0; c < 4; c++) track[i + c] = 0 - (track[i + c] as number);
  }
}

/** The track, or its first key alone when every key equals it (the only reduction, §0.4.7). */
function constantOrFull(
  times: Float32Array,
  values: Float32Array,
  stride: number,
): { times: Float32Array; values: Float32Array } {
  for (let i = stride; i < values.length; i++) {
    if (Math.abs((values[i] as number) - (values[i % stride] as number)) > CONSTANT_EPS) return { times, values };
  }
  return { times: times.slice(0, 1), values: values.slice(0, stride) };
}

function firstTime(channels: readonly Channel[]): number {
  let first = Number.POSITIVE_INFINITY;
  for (const channel of channels) if (channel.times.length > 0) first = Math.min(first, channel.times[0] as number);
  return Number.isFinite(first) ? first : 0;
}

/** Samples one channel at `time` into `out[offset…]` (clamped at the ends; rotations by slerp and normalized). */
function sampleInto(
  channel: Channel,
  time: number,
  stride: number,
  out: Float64Array,
  offset: number,
  rotation: boolean,
): void {
  const { times, values, interpolation } = channel;
  const cubic = interpolation === 'CUBICSPLINE';
  const perKey = cubic ? stride * 3 : stride;
  const valueAt = (k: number, c: number): number => values[k * perKey + (cubic ? stride : 0) + c] as number;
  const last = times.length - 1;
  let k = 0;
  if (time >= (times[last] as number)) k = last;
  else if (time > (times[0] as number)) {
    let lo = 0;
    let hi = last;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if ((times[mid] as number) <= time) lo = mid;
      else hi = mid;
    }
    k = lo;
  }
  const t0 = times[k] as number;
  if (k === last || time <= t0 || interpolation === 'STEP') {
    for (let c = 0; c < stride; c++) out[offset + c] = valueAt(k, c);
    if (rotation) normalizeAt(out, offset);
    return;
  }
  const t1 = times[k + 1] as number;
  const dt = t1 - t0;
  const s = dt > 0 ? (time - t0) / dt : 0;
  if (cubic) {
    const s2 = s * s;
    const s3 = s2 * s;
    for (let c = 0; c < stride; c++) {
      const p0 = valueAt(k, c);
      const p1 = valueAt(k + 1, c);
      const m0 = (values[k * perKey + 2 * stride + c] as number) * dt; // out-tangent of k
      const m1 = (values[(k + 1) * perKey + c] as number) * dt; // in-tangent of k + 1
      out[offset + c] = (2 * s3 - 3 * s2 + 1) * p0 + (s3 - 2 * s2 + s) * m0 + (-2 * s3 + 3 * s2) * p1 + (s3 - s2) * m1;
    }
    if (rotation) normalizeAt(out, offset);
    return;
  }
  if (rotation) {
    const q = quatSlerp(
      quatNormalize([valueAt(k, 0), valueAt(k, 1), valueAt(k, 2), valueAt(k, 3)]),
      quatNormalize([valueAt(k + 1, 0), valueAt(k + 1, 1), valueAt(k + 1, 2), valueAt(k + 1, 3)]),
      s,
    );
    out.set(q, offset);
    return;
  }
  for (let c = 0; c < stride; c++) out[offset + c] = valueAt(k, c) + (valueAt(k + 1, c) - valueAt(k, c)) * s;
}

function normalizeAt(out: Float64Array, offset: number): void {
  const q = quatNormalize([
    out[offset] as number,
    out[offset + 1] as number,
    out[offset + 2] as number,
    out[offset + 3] as number,
  ]);
  out.set(q, offset);
}

function restLocals(defs: readonly GltfNodeDef[]): {
  readonly t: Float64Array;
  readonly r: Float64Array;
  readonly s: Float64Array;
} {
  const t = new Float64Array(defs.length * 3);
  const r = new Float64Array(defs.length * 4);
  const s = new Float64Array(defs.length * 3);
  defs.forEach((def, i) => {
    if (numberTuple(def.matrix, 16) !== null) {
      throw new EkzaError('unsupported', `UAL node ${i} uses a matrix; the retarget reads TRS nodes only`);
    }
    t.set(numberTuple(def.translation, 3) ?? [0, 0, 0], i * 3);
    r.set(quatNormalize((numberTuple(def.rotation, 4) ?? [0, 0, 0, 1]) as unknown as Quat), i * 4);
    s.set(numberTuple(def.scale, 3) ?? [1, 1, 1], i * 3);
  });
  return { t, r, s };
}

function topologicalOrder(defs: readonly GltfNodeDef[], parent: Int32Array, json: GlbContainer['json']): number[] {
  const order: number[] = [];
  const seen = new Set<number>();
  const visit = (root: number): void => {
    const stack = [root];
    while (stack.length > 0) {
      const i = stack.pop() as number;
      if (seen.has(i)) continue;
      seen.add(i);
      order.push(i);
      const children = listField(defs[i]?.children).filter((child) => isIndex(child) && child < defs.length);
      for (let c = children.length - 1; c >= 0; c--) stack.push(children[c] as number);
    }
  };
  const scenes = Array.isArray(json['scenes']) ? (json['scenes'] as readonly unknown[]) : [];
  for (const scene of scenes) {
    const nodes = isRecord(scene) && Array.isArray(scene['nodes']) ? (scene['nodes'] as readonly unknown[]) : [];
    for (const node of nodes) if (isIndex(node) && node < defs.length && parent[node] === -1) visit(node);
  }
  for (let i = 0; i < defs.length; i++) if (parent[i] === -1) visit(i);
  return order;
}
