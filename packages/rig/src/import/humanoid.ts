import { EkzaError, type Frame } from '@ekza-animator/anim-core';
import type { HumanBoneName } from '@ekza-animator/doc';
import { HUMAN_BONE_NAMES, HUMAN_BONE_PARENT } from '../humanoid/bones';
import { HUMAN_BONE_INDEX, isHumanBoneName } from '../humanoid/map';
import { isHumanoidProgram } from '../inverse/solve';
import { internalsOf, type RigInternals } from '../kernel/internals';
import { allocXfArrays, type XfArrays, xfaCopy } from '../math/xfa';
import type { HumanoidClipData, ImportedClipKeys, ImportHumanoidOptions, RigProgram } from '../types';
import {
  buildImportedCurves,
  createFrameMapper,
  FrameTable,
  groupMode,
  makeSolvePlan,
  type SlotKeys,
  type SolvePlan,
  type SourceWorlds,
} from './core';
import { clipRange } from './raw';
import { type Interpolation, type SampledTrack, sampleTrack, trackKeyCount } from './sample';

const HUMAN_COUNT = HUMAN_BONE_NAMES.length;

interface HumanTracks {
  readonly rotation: readonly (SampledTrack | null)[];
  readonly hips: SampledTrack | null;
}

function track(
  data: { readonly times: Float32Array; readonly values: Float32Array } | null | undefined,
  interpolation: Interpolation | undefined,
  components: number,
): SampledTrack | null {
  if (data === null || data === undefined || data.times.length === 0) return null;
  const candidate: SampledTrack = { times: data.times, values: data.values, interpolation: interpolation ?? 'LINEAR' };
  for (let i = 0; i < data.times.length; i++) {
    const t = data.times[i] as number;
    if (!Number.isFinite(t) || (i > 0 && t <= (data.times[i - 1] as number))) return null;
  }
  if (trackKeyCount(candidate, components) < data.times.length) return null;
  for (let i = 0; i < data.values.length; i++) if (!Number.isFinite(data.values[i])) return null;
  return candidate;
}

/**
 * Normalized humanoid motion as desired target bone worlds (MVP-SPEC §4.11.7): world deltas are composed over the
 * source chain (D_b = D_parent(b) · N_b over the source's present bones); a target bone takes the delta of its own
 * bone, or of its nearest source-present ancestor when the source lacks it: q(W_b) = D'_b · q(W⁰_b). The hips sit at
 * the (scaled) source position, or at rest without a position track.
 */
class HumanoidSource implements SourceWorlds {
  readonly worlds: XfArrays;
  private readonly deltas = new Float64Array(HUMAN_COUNT * 4);
  private readonly sample: number[] = [0, 0, 0, 0];

  constructor(
    private readonly internals: RigInternals,
    private readonly tracks: HumanTracks,
    /** HUMAN_BONE_NAMES slot of each bone's nearest source-present ancestor (−1 none). */
    private readonly sourceParent: Int32Array,
    /** Per target bone slot: the source bone whose delta it takes (−1: identity). */
    private readonly sourceOf: Int32Array,
    private readonly hipsScale: number,
  ) {
    this.worlds = allocXfArrays(internals.nodeCount);
    for (let node = 0; node < internals.nodeCount; node++) xfaCopy(internals.restWorld, node, this.worlds, node);
  }

  prepare(seconds: number): void {
    const { deltas, sample, tracks, internals, worlds } = this;
    for (let h = 0; h < HUMAN_COUNT; h++) {
      const o = h * 4;
      const rotation = tracks.rotation[h];
      let nx = 0;
      let ny = 0;
      let nz = 0;
      let nw = 1;
      if (rotation !== null && rotation !== undefined) {
        sampleTrack(rotation, 4, seconds, sample);
        const len = Math.hypot(sample[0] as number, sample[1] as number, sample[2] as number, sample[3] as number);
        if (len > 0) {
          nx = (sample[0] as number) / len;
          ny = (sample[1] as number) / len;
          nz = (sample[2] as number) / len;
          nw = (sample[3] as number) / len;
        }
      }
      const parent = this.sourceParent[h] as number;
      if (parent === -1) {
        deltas[o] = nx;
        deltas[o + 1] = ny;
        deltas[o + 2] = nz;
        deltas[o + 3] = nw;
      } else {
        // D_b = D_parent · N_b
        const p = parent * 4;
        const px = deltas[p] as number;
        const py = deltas[p + 1] as number;
        const pz = deltas[p + 2] as number;
        const pw = deltas[p + 3] as number;
        deltas[o] = px * nw + pw * nx + py * nz - pz * ny;
        deltas[o + 1] = py * nw + pw * ny + pz * nx - px * nz;
        deltas[o + 2] = pz * nw + pw * nz + px * ny - py * nx;
        deltas[o + 3] = pw * nw - px * nx - py * ny - pz * nz;
      }
    }
    for (let h = 0; h < HUMAN_COUNT; h++) {
      const node = internals.humanNode[h] as number;
      if (node === -1) continue;
      const source = this.sourceOf[h] as number;
      // q(W_b) = D'_b · q(W⁰_b)
      let dx = 0;
      let dy = 0;
      let dz = 0;
      let dw = 1;
      if (source !== -1) {
        dx = deltas[source * 4] as number;
        dy = deltas[source * 4 + 1] as number;
        dz = deltas[source * 4 + 2] as number;
        dw = deltas[source * 4 + 3] as number;
      }
      const r = internals.restWorld.q;
      const rx = r[node * 4] as number;
      const ry = r[node * 4 + 1] as number;
      const rz = r[node * 4 + 2] as number;
      const rw = r[node * 4 + 3] as number;
      const qx = dx * rw + dw * rx + dy * rz - dz * ry;
      const qy = dy * rw + dw * ry + dz * rx - dx * rz;
      const qz = dz * rw + dw * rz + dx * ry - dy * rx;
      const qw = dw * rw - dx * rx - dy * ry - dz * rz;
      const inv = 1 / Math.hypot(qx, qy, qz, qw);
      worlds.q[node * 4] = qx * inv;
      worlds.q[node * 4 + 1] = qy * inv;
      worlds.q[node * 4 + 2] = qz * inv;
      worlds.q[node * 4 + 3] = qw * inv;
    }
    const hips = internals.hipsNode;
    if (hips !== -1 && tracks.hips !== null) {
      sampleTrack(tracks.hips, 3, seconds, sample);
      for (let c = 0; c < 3; c++) worlds.t[hips * 3 + c] = (sample[c] as number) * this.hipsScale;
    }
  }
}

/** Nearest ancestor (VRM parent map, starting at the bone itself when `self`) for which `has` holds, −1 if none. */
function nearestSlot(name: HumanBoneName, has: (slot: number) => boolean, self: boolean): number {
  let current: HumanBoneName | null = self ? name : HUMAN_BONE_PARENT[name];
  while (current !== null) {
    const slot = HUMAN_BONE_INDEX.get(current) as number;
    if (has(slot)) return slot;
    current = HUMAN_BONE_PARENT[current];
  }
  return -1;
}

/**
 * Imports normalized humanoid motion (VRMA) onto a humanoid rig (MVP-SPEC §4.11.7): missing and extra bones are
 * composed through world deltas, the hips position is scaled by `hipsScale` ('auto': target rest hips height over
 * the source's) and carried by `cog` (`fk.hips` stays at rest); times, key mode, interpolation mapping and reduction
 * as for raw clips. Throws EkzaError('unsupported') for a program that is not a humanoid rig.
 */
export function importHumanoidClip(
  data: HumanoidClipData,
  program: RigProgram,
  opts: ImportHumanoidOptions,
): ImportedClipKeys {
  if (!isHumanoidProgram(program)) {
    throw new EkzaError('unsupported', 'Humanoid clips (VRMA) import only onto humanoid rigs');
  }
  const internals = internalsOf(program);
  const warnings: string[] = [];

  const present = new Uint8Array(HUMAN_COUNT);
  for (const bone of data.presentBones) {
    if (isHumanBoneName(bone)) present[HUMAN_BONE_INDEX.get(bone) as number] = 1;
  }
  const rotation: (SampledTrack | null)[] = HUMAN_BONE_NAMES.map(() => null);
  for (const [bone, value] of Object.entries(data.rotations)) {
    if (!isHumanBoneName(bone)) {
      warnings.push(`Unknown humanoid bone "${bone}" in "${data.name}"; ignored`);
      continue;
    }
    const slot = HUMAN_BONE_INDEX.get(bone) as number;
    const parsed = track(value, data.interpolation[bone], 4);
    if (parsed === null) {
      warnings.push(`Malformed rotation track of "${bone}" in "${data.name}"; dropped`);
      continue;
    }
    rotation[slot] = parsed;
    present[slot] = 1;
  }
  const hipsTrack = track(data.hips, data.interpolation.hipsPosition, 3);
  if (data.hips !== null && hipsTrack === null) warnings.push(`Malformed hips position track in "${data.name}"; dropped`);

  const sourceParent = new Int32Array(HUMAN_COUNT).fill(-1);
  const sourceOf = new Int32Array(HUMAN_COUNT).fill(-1);
  HUMAN_BONE_NAMES.forEach((name, h) => {
    sourceParent[h] = nearestSlot(name, (slot) => present[slot] === 1, false);
    if (internals.humanNode[h] !== -1) sourceOf[h] = nearestSlot(name, (slot) => present[slot] === 1, true);
  });

  // Source bones whose motion reaches no target control.
  const carried = new Uint8Array(HUMAN_COUNT);
  for (let slot = 0; slot < internals.controlCount; slot++) {
    const node = internals.drivenNode[slot] as number;
    const h = node === -1 ? -1 : internals.humanNode.indexOf(node);
    if (h !== -1 && (sourceOf[h] as number) !== -1) carried[sourceOf[h] as number] = 1;
  }
  HUMAN_BONE_NAMES.forEach((name, h) => {
    if (rotation[h] !== null && carried[h] === 0 && !hasCarriedDescendant(h, carried, present)) {
      warnings.push(`Animation of humanoid bone "${name}" has no control on this character; dropped`);
    }
  });

  const plan = makeSolvePlan(internals, true);
  const targetRestHipsY = internals.hipsNode === -1 ? 0 : (internals.restWorld.t[internals.hipsNode * 3 + 1] as number);
  let hipsScale = 1;
  if (opts.hipsScale === 'auto') {
    const sourceY = data.restHipsPosition[1];
    hipsScale = Number.isFinite(sourceY) && Math.abs(sourceY) > 1e-6 ? targetRestHipsY / sourceY : 1;
  } else if (Number.isFinite(opts.hipsScale)) {
    hipsScale = opts.hipsScale;
  }

  let maxTime = 0;
  for (const t of [...rotation, hipsTrack]) if (t !== null && t !== undefined) maxTime = Math.max(maxTime, t.times[t.times.length - 1] as number);
  const range = clipRange(Math.max(maxTime, Number.isFinite(data.duration) ? data.duration : 0), opts.fps);
  const resample = opts.keyMode === 'resample';
  const mapper = createFrameMapper(opts.fps);
  const table = new FrameTable(mapper);
  if (!resample) for (const t of [...rotation, hipsTrack]) if (t !== null && t !== undefined) for (const s of t.times) table.add(s);

  const slots = keySlots(internals, plan, rotation, hipsTrack, sourceOf, present, table, range, opts.fps, resample);
  if (mapper.subFrame) {
    warnings.push(
      `Source times of "${data.name}" are not on whole frames at ${opts.fps.num}/${opts.fps.den} fps; sub-frame keys were created`,
    );
  }
  const source = new HumanoidSource(internals, { rotation, hips: hipsTrack }, sourceParent, sourceOf, hipsScale);
  const curves = buildImportedCurves(internals, plan, source, slots, opts);
  return { fps: opts.fps, range, curves, warnings };
}

function hasCarriedDescendant(h: number, carried: Uint8Array, present: Uint8Array): boolean {
  // A source bone's delta also reaches the targets of its descendants through composition.
  for (let other = 0; other < HUMAN_COUNT; other++) {
    if (carried[other] !== 1 || present[other] !== 1) continue;
    let parent = HUMAN_BONE_PARENT[HUMAN_BONE_NAMES[other] as HumanBoneName];
    while (parent !== null) {
      if (HUMAN_BONE_INDEX.get(parent) === h) return true;
      parent = HUMAN_BONE_PARENT[parent];
    }
  }
  return false;
}

/** Source bones (HUMAN_BONE_NAMES slots) whose N composes into the delta a target bone takes. */
function sourceChain(sourceOf: number, present: Uint8Array): Set<number> {
  const chain = new Set<number>();
  if (sourceOf === -1) return chain;
  let current: HumanBoneName | null = HUMAN_BONE_NAMES[sourceOf] as HumanBoneName;
  while (current !== null) {
    const slot = HUMAN_BONE_INDEX.get(current) as number;
    if (present[slot] === 1) chain.add(slot);
    current = HUMAN_BONE_PARENT[current];
  }
  return chain;
}

function keySlots(
  internals: RigInternals,
  plan: SolvePlan,
  rotation: readonly (SampledTrack | null)[],
  hips: SampledTrack | null,
  sourceOf: Int32Array,
  present: Uint8Array,
  table: FrameTable,
  range: { readonly start: Frame; readonly end: Frame },
  fps: ImportHumanoidOptions['fps'],
  resample: boolean,
): (SlotKeys | null)[] {
  const humanOfNode = new Map<number, number>();
  for (let h = 0; h < HUMAN_COUNT; h++) {
    const node = internals.humanNode[h] as number;
    if (node !== -1) humanOfNode.set(node, h);
  }
  const slots: (SlotKeys | null)[] = [];
  for (let slot = 0; slot < internals.controlCount; slot++) {
    const node = plan.target[slot] as number;
    const h = node === -1 ? undefined : humanOfNode.get(node);
    if (h === undefined) {
      slots.push(null);
      continue;
    }
    // The parent control's anchor bone: nearest control ancestor with a humanoid target.
    let parent = internals.controlParent[slot] as number;
    let anchor = -1;
    while (parent !== -1) {
      const target = plan.target[parent] as number;
      const ph = target === -1 ? undefined : humanOfNode.get(target);
      if (ph !== undefined) {
        anchor = ph;
        break;
      }
      parent = internals.controlParent[parent] as number;
    }
    const contributing = sourceChain(sourceOf[h] as number, present);
    if (anchor !== -1) for (const slotBone of sourceChain(sourceOf[anchor] as number, present)) contributing.delete(slotBone);
    const rotationInterps = new Set<string>();
    const seconds: number[] = [];
    for (const bone of contributing) {
      const t = rotation[bone];
      if (t === null || t === undefined) continue;
      rotationInterps.add(t.interpolation);
      for (const s of t.times) seconds.push(s);
    }
    const translationInterps = new Set<string>();
    if (node === internals.hipsNode && hips !== null) {
      translationInterps.add(hips.interpolation);
      for (const s of hips.times) seconds.push(s);
    }
    if (seconds.length === 0) {
      slots.push(null);
      continue;
    }
    let keys: { readonly seconds: number[]; readonly frames: Frame[] };
    if (resample) {
      const perSecond = fps.num / fps.den;
      const frames: Frame[] = [];
      for (let f = range.start; f <= range.end; f++) frames.push(f);
      keys = { frames, seconds: frames.map((f) => f / perSecond) };
    } else {
      keys = table.keys(seconds);
    }
    const all = new Set([...rotationInterps, ...translationInterps]);
    slots.push({
      ...keys,
      rotation: groupMode(rotationInterps.size > 0 ? rotationInterps : all, true, resample),
      translation: groupMode(translationInterps.size > 0 ? translationInterps : all, false, resample),
      scale: groupMode(all, false, resample),
    });
  }
  return slots;
}
