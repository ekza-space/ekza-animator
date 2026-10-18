import {
  eulerFilter,
  eulerNear,
  eulerToQuat,
  type Fps,
  type Frame,
  type KeyData,
  quatToEuler,
  reduceKeys,
  type TangentType,
  type Vec3,
} from '@ekza-animator/anim-core';
import type { ControlRecord, TrsChannel } from '@ekza-animator/doc';
import { BIND_ROTATE } from '../kernel/constants';
import type { RigInternals } from '../kernel/internals';
import { allocXfArrays, type XfArrays, xfaIdentity, xfaInvMul, xfaMul, xfaMulInv } from '../math/xfa';
import { SLOT_CHANNELS, slotDefault } from '../sampler/channels';
import type { ImportedClipKeys, ImportedCurve, ReduceSpec } from '../types';

// Shared clip-import machinery (MVP-SPEC §4.11.6–7, research 07 §15.4): desired bone worlds from a source clip are
// solved onto controls top-down at every key time, rotations converted with eulerNear against the previous key, then
// Euler-filtered, mapped to tangent types per source interpolation, stripped of default-valued curves and reduced.

/** How a control follows its import target. */
export const SOLVE_NONE = 0;
/** Rotate binding: only the target bone's world rotation is reproduced. */
export const SOLVE_ROTATE = 1;
/** Full or translateRotate binding: W_c = W_b · K⁻¹. */
export const SOLVE_TRANSFORM = 2;
/** A pure space control carrying a bone through a held (rest) child control: W_c = W_b · K⁻¹ · O_via⁻¹ (cog ← hips). */
export const SOLVE_REDIRECT = 3;

export interface SolvePlan {
  readonly target: Int32Array;
  readonly mode: Uint8Array;
  readonly via: Int32Array;
}

/**
 * Import targets per control: its driven bone, except in humanoid rigs where `cog` carries the hips motion and
 * `fk.hips` and `root` stay at rest (MVP-SPEC §4.11.6 step 6).
 */
export function makeSolvePlan(internals: RigInternals, humanoid: boolean): SolvePlan {
  const n = internals.controlCount;
  const target = new Int32Array(n).fill(-1);
  const mode = new Uint8Array(n);
  const via = new Int32Array(n).fill(-1);
  for (let slot = 0; slot < n; slot++) {
    const node = internals.drivenNode[slot] as number;
    if (node === -1) continue;
    target[slot] = node;
    mode[slot] = internals.bindMode[node] === BIND_ROTATE ? SOLVE_ROTATE : SOLVE_TRANSFORM;
  }
  if (humanoid) {
    const slotOfKey = new Map(internals.controls.map((control, slot) => [control.key, slot]));
    const cog = slotOfKey.get('cog');
    const hips = slotOfKey.get('fk.hips');
    if (
      cog !== undefined &&
      hips !== undefined &&
      internals.controlParent[hips] === cog &&
      internals.drivenNode[cog] === -1 &&
      internals.drivenNode[hips] === internals.hipsNode &&
      internals.hipsNode !== -1
    ) {
      target[cog] = internals.hipsNode;
      mode[cog] = SOLVE_REDIRECT;
      via[cog] = hips;
      target[hips] = -1;
      mode[hips] = SOLVE_NONE;
    }
  }
  return { target, mode, via };
}

/** Desired (source) bone worlds in canonical character space at a given time. */
export interface SourceWorlds {
  prepare(seconds: number): void;
  /** Per node; only the nodes that are import targets are read. */
  readonly worlds: XfArrays;
}

/** Top-down solve of every control for the source pose (representable channels only). */
export class ControlSolver {
  /** Per slot: representable local transform (channels) after `solve`. */
  readonly local: XfArrays;
  private readonly world: XfArrays;
  private readonly scratch: XfArrays = allocXfArrays(3);
  private readonly euler: Vec3 = [0, 0, 0];
  private readonly q: [number, number, number, number] = [0, 0, 0, 1];

  constructor(
    private readonly internals: RigInternals,
    private readonly plan: SolvePlan,
  ) {
    this.local = allocXfArrays(internals.controlCount);
    this.world = allocXfArrays(internals.controlCount);
  }

  solve(source: SourceWorlds): void {
    const { internals, plan, local, world, scratch } = this;
    const src = source.worlds;
    const P = 0;
    const D = 1;
    for (let slot = 0; slot < internals.controlCount; slot++) {
      const parent = internals.controlParent[slot] as number;
      if (parent === -1) {
        xfaIdentity(scratch, 2);
        xfaMul(scratch, 2, internals.offsets, slot, scratch, P);
      } else {
        xfaMul(world, parent, internals.offsets, slot, scratch, P);
      }
      const mode = plan.mode[slot] as number;
      const node = plan.target[slot] as number;
      if (mode === SOLVE_NONE || node === -1) {
        xfaIdentity(local, slot);
      } else {
        xfaMulInv(src, node, internals.bind, node, scratch, D);
        if (mode === SOLVE_REDIRECT) xfaMulInv(scratch, D, internals.offsets, plan.via[slot] as number, scratch, D);
        if (mode === SOLVE_ROTATE) {
          // Only the rotation is prescribed; the control stays where its parent puts it.
          for (let k = 0; k < 3; k++) {
            scratch.t[D * 3 + k] = scratch.t[P * 3 + k] as number;
            scratch.s[D * 3 + k] = scratch.s[P * 3 + k] as number;
          }
        }
        xfaInvMul(scratch, P, scratch, D, local, slot);
        this.restrictToKeyable(slot);
      }
      xfaMul(scratch, P, local, slot, world, slot);
    }
  }

  /** Non-keyable channels keep their defaults so the solved worlds are what the rig can evaluate. */
  private restrictToKeyable(slot: number): void {
    const keyable = this.internals.keyable;
    const local = this.local;
    const base = slot * 9;
    for (let k = 0; k < 3; k++) {
      if (keyable[base + k] !== 1) local.t[slot * 3 + k] = 0;
      if (keyable[base + 6 + k] !== 1) local.s[slot * 3 + k] = 1;
    }
    const r0 = keyable[base + 3] === 1;
    const r1 = keyable[base + 4] === 1;
    const r2 = keyable[base + 5] === 1;
    if (r0 && r1 && r2) return;
    const order = this.internals.rotateOrders[slot] ?? 'xyz';
    const q = this.q;
    for (let k = 0; k < 4; k++) q[k] = local.q[slot * 4 + k] as number;
    const e = quatToEuler(q, order, this.euler);
    if (!r0) e[0] = 0;
    if (!r1) e[1] = 0;
    if (!r2) e[2] = 0;
    eulerToQuat(e, order, q);
    for (let k = 0; k < 4; k++) local.q[slot * 4 + k] = q[k] as number;
  }
}

export type GroupMode = 'linear' | 'step' | 'auto' | 'hermite';

/** The keys of one control: solve times (seconds), key frames and tangent mode per channel group. */
export interface SlotKeys {
  readonly seconds: readonly number[];
  readonly frames: readonly Frame[];
  readonly rotation: GroupMode;
  readonly translation: GroupMode;
  readonly scale: GroupMode;
}

/** Interpolations seen on a control's source tracks → tangent mode (MVP-SPEC §4.11.6 table). */
export function groupMode(interpolations: ReadonlySet<string>, rotation: boolean, resample: boolean): GroupMode {
  if (resample) return 'auto';
  if (interpolations.size > 0 && [...interpolations].every((i) => i === 'STEP')) return 'step';
  if (interpolations.has('CUBICSPLINE')) return rotation ? 'auto' : 'hermite';
  return 'linear';
}

export interface FrameMapper {
  /** Clip frame of a source time: whole frames within 1e-4 s snap (sub-frame otherwise, flagged). */
  frameOf(seconds: number): Frame;
  readonly subFrame: boolean;
}

export function createFrameMapper(fps: Fps): FrameMapper {
  const perSecond = fps.num / fps.den;
  let subFrame = false;
  return {
    frameOf(seconds: number): Frame {
      const frame = seconds * perSecond;
      const whole = Math.round(frame);
      if (Math.abs(frame - whole) / perSecond <= 1e-4) return whole;
      subFrame = true;
      return frame;
    },
    get subFrame() {
      return subFrame;
    },
  };
}

/**
 * Source times → clip frames for a whole clip: every frame keeps the earliest source time that maps to it, so all
 * controls keyed at a frame are solved at the same instant.
 */
export class FrameTable {
  private readonly secondsByFrame = new Map<Frame, number>();

  constructor(private readonly mapper: FrameMapper) {}

  add(seconds: number): Frame {
    const frame = this.mapper.frameOf(seconds);
    const current = this.secondsByFrame.get(frame);
    if (current === undefined || seconds < current) this.secondsByFrame.set(frame, seconds);
    return frame;
  }

  /** Sorted unique frames of the given source times with their solve times. */
  keys(seconds: Iterable<number>): { readonly seconds: number[]; readonly frames: Frame[] } {
    const frames = [...new Set([...seconds].map((s) => this.mapper.frameOf(s)))].sort((a, b) => a - b);
    return { frames, seconds: frames.map((frame) => this.secondsByFrame.get(frame) ?? frame) };
  }
}

export interface BuildOptions {
  readonly fps: Fps;
  readonly eulerFilter: boolean;
  readonly reduce: ReduceSpec | null;
}

/** Numeric derivative step for Hermite handles of CUBICSPLINE translations/scales (seconds). */
const DERIVATIVE_STEP = 1e-5;

/**
 * Solves every control at its key times and builds the imported curves. `slots[slot]` null = no keys for that
 * control (it keeps its defaults).
 */
export function buildImportedCurves(
  internals: RigInternals,
  plan: SolvePlan,
  source: SourceWorlds,
  slots: readonly (SlotKeys | null)[],
  opts: BuildOptions,
): ImportedCurve[] {
  const solver = new ControlSolver(internals, plan);
  const count = internals.controlCount;
  // values[slot][key * 9 + channel]
  const values: (Float64Array | null)[] = slots.map((keys) =>
    keys === null || keys.frames.length === 0 ? null : new Float64Array(keys.frames.length * 9),
  );
  const cursor = new Int32Array(count);
  const last: Vec3[] = slots.map((): Vec3 => [0, 0, 0]);
  const times = new Set<number>();
  for (const keys of slots) if (keys !== null) for (const s of keys.seconds) times.add(s);
  const solveTimes = [...times].sort((a, b) => a - b);
  const q: [number, number, number, number] = [0, 0, 0, 1];
  const euler: Vec3 = [0, 0, 0];
  for (const seconds of solveTimes) {
    source.prepare(seconds);
    solver.solve(source);
    for (let slot = 0; slot < count; slot++) {
      const keys = slots[slot];
      const out = values[slot];
      if (keys === null || keys === undefined || out === null || out === undefined) continue;
      const k = cursor[slot] as number;
      if (k >= keys.seconds.length || keys.seconds[k] !== seconds) continue;
      cursor[slot] = k + 1;
      const o = k * 9;
      const local = solver.local;
      out[o] = local.t[slot * 3] as number;
      out[o + 1] = local.t[slot * 3 + 1] as number;
      out[o + 2] = local.t[slot * 3 + 2] as number;
      for (let c = 0; c < 4; c++) q[c] = local.q[slot * 4 + c] as number;
      const e = eulerNear(q, internals.rotateOrders[slot] ?? 'xyz', last[slot] as Vec3, euler);
      (last[slot] as Vec3)[0] = e[0];
      (last[slot] as Vec3)[1] = e[1];
      (last[slot] as Vec3)[2] = e[2];
      out[o + 3] = e[0];
      out[o + 4] = e[1];
      out[o + 5] = e[2];
      out[o + 6] = local.s[slot * 3] as number;
      out[o + 7] = local.s[slot * 3 + 1] as number;
      out[o + 8] = local.s[slot * 3 + 2] as number;
    }
  }

  if (opts.eulerFilter) {
    values.forEach((out, slot) => {
      if (out === null) return;
      const n = out.length / 9;
      const triples: Vec3[] = [];
      for (let k = 0; k < n; k++)
        triples.push([out[k * 9 + 3] as number, out[k * 9 + 4] as number, out[k * 9 + 5] as number]);
      eulerFilter(triples, internals.rotateOrders[slot] ?? 'xyz');
      triples.forEach((triple, k) => {
        out[k * 9 + 3] = triple[0];
        out[k * 9 + 4] = triple[1];
        out[k * 9 + 5] = triple[2];
      });
    });
  }

  const slopes = hermiteSlopes(internals, source, slots, solver);

  const curves: ImportedCurve[] = [];
  for (let slot = 0; slot < count; slot++) {
    const keys = slots[slot];
    const out = values[slot];
    if (keys === null || keys === undefined || out === null || out === undefined) continue;
    const control = internals.controls[slot] as ControlRecord;
    for (let channel = 0; channel < 9; channel++) {
      if (internals.keyable[slot * 9 + channel] !== 1) continue;
      const group = channel < 3 ? 'translation' : channel < 6 ? 'rotation' : 'scale';
      const tolerance = channelTolerance(channel, opts.reduce);
      const n = keys.frames.length;
      const def = slotDefault(channel);
      let constantDefault = true;
      for (let k = 0; k < n; k++) {
        if (Math.abs((out[k * 9 + channel] as number) - def) > tolerance) {
          constantDefault = false;
          break;
        }
      }
      if (constantDefault) continue;
      const mode = keys[group];
      const keyData = makeKeys(keys.frames, out, channel, mode, slopes.get(slot), opts.fps);
      let finalKeys: readonly KeyData[] = keyData;
      let maxReduceError = 0;
      if (opts.reduce !== null && keyData.length > 2) {
        const reduced = reduceKeys(
          { keys: keyData, weighted: false, pre: 'constant', post: 'constant' },
          { tolerance },
        );
        finalKeys = reduced.keys;
        maxReduceError = reduced.maxError;
      }
      curves.push({
        control: control.id,
        channel: SLOT_CHANNELS[channel] as TrsChannel,
        keys: finalKeys,
        stats: { sourceKeys: keyData.length, maxReduceError },
      });
    }
  }
  return curves;
}

/**
 * Tolerance per channel kind: the reduction spec, else 1e-6 (rad, m, unitless) — above the float32 noise of source
 * data (constant scale tracks often differ from the rest scale by ~1e-7) and far below the import accuracy gates.
 */
function channelTolerance(channel: number, reduce: ReduceSpec | null): number {
  if (reduce === null) return 1e-6;
  return channel < 3 ? reduce.translationM : channel < 6 ? reduce.rotationRad : reduce.scale;
}

const ZERO_HANDLE = { dt: 0, dv: 0 } as const;

function makeKeys(
  frames: readonly Frame[],
  values: Float64Array,
  channel: number,
  mode: GroupMode,
  slopes: Float64Array | undefined,
  fps: Fps,
): KeyData[] {
  const n = frames.length;
  const keys: KeyData[] = [];
  const types: Record<Exclude<GroupMode, 'hermite'>, { in: TangentType; out: TangentType }> = {
    linear: { in: 'linear', out: 'linear' },
    step: { in: 'flat', out: 'step' },
    auto: { in: 'auto', out: 'auto' },
  };
  for (let k = 0; k < n; k++) {
    const t = frames[k] as Frame;
    const v = values[k * 9 + channel] as number;
    if (mode !== 'hermite' || slopes === undefined) {
      const tangent = types[mode === 'hermite' ? 'auto' : mode];
      keys.push({
        t,
        v,
        inType: tangent.in,
        outType: tangent.out,
        inHandle: ZERO_HANDLE,
        outHandle: ZERO_HANDLE,
        broken: false,
        weightLocked: true,
      });
      continue;
    }
    // Fixed Hermite handles: slope per frame from the source tangents, |dt| = span / 3 (MVP-SPEC §4.11.6).
    const prev = k > 0 ? (frames[k - 1] as Frame) : undefined;
    const next = k < n - 1 ? (frames[k + 1] as Frame) : undefined;
    const inSpan = prev !== undefined ? t - prev : next !== undefined ? next - t : 1;
    const outSpan = next !== undefined ? next - t : inSpan;
    const perFrame = fps.den / fps.num;
    let inSlope = (slopes[(k * 9 + channel) * 2] as number) * perFrame;
    let outSlope = (slopes[(k * 9 + channel) * 2 + 1] as number) * perFrame;
    if (prev === undefined) inSlope = outSlope;
    if (next === undefined) outSlope = inSlope;
    const inDt = -inSpan / 3;
    const outDt = outSpan / 3;
    keys.push({
      t,
      v,
      inType: 'fixed',
      outType: 'fixed',
      inHandle: { dt: inDt, dv: inSlope * inDt },
      outHandle: { dt: outDt, dv: outSlope * outDt },
      broken: Math.abs(inSlope - outSlope) > 1e-9 * (1 + Math.abs(inSlope) + Math.abs(outSlope)),
      weightLocked: true,
    });
  }
  return keys;
}

/**
 * One-sided derivatives (value per second) of the translation/scale channels of controls in 'hermite' mode at their
 * key times: [(key · 9 + channel) · 2] = left, [+ 1] = right. Second-order one-sided differences.
 */
function hermiteSlopes(
  internals: RigInternals,
  source: SourceWorlds,
  slots: readonly (SlotKeys | null)[],
  solver: ControlSolver,
): Map<number, Float64Array> {
  const wanted: number[] = [];
  slots.forEach((keys, slot) => {
    if (keys !== null && (keys.translation === 'hermite' || keys.scale === 'hermite')) wanted.push(slot);
  });
  const result = new Map<number, Float64Array>();
  if (wanted.length === 0) return result;
  const times = new Set<number>();
  for (const slot of wanted) for (const s of (slots[slot] as SlotKeys).seconds) times.add(s);
  const sampleAt = (seconds: number): Float64Array => {
    source.prepare(seconds);
    solver.solve(source);
    const out = new Float64Array(internals.controlCount * 6);
    for (const slot of wanted) {
      for (let c = 0; c < 3; c++) {
        out[slot * 6 + c] = solver.local.t[slot * 3 + c] as number;
        out[slot * 6 + 3 + c] = solver.local.s[slot * 3 + c] as number;
      }
    }
    return out;
  };
  const h = DERIVATIVE_STEP;
  const perTime = new Map<number, { left: Float64Array; right: Float64Array }>();
  for (const t of times) {
    const f0 = sampleAt(t);
    const fm1 = sampleAt(t - h);
    const fm2 = sampleAt(t - 2 * h);
    const fp1 = sampleAt(t + h);
    const fp2 = sampleAt(t + 2 * h);
    const left = new Float64Array(f0.length);
    const right = new Float64Array(f0.length);
    for (let i = 0; i < f0.length; i++) {
      left[i] = (3 * (f0[i] as number) - 4 * (fm1[i] as number) + (fm2[i] as number)) / (2 * h);
      right[i] = (-3 * (f0[i] as number) + 4 * (fp1[i] as number) - (fp2[i] as number)) / (2 * h);
    }
    perTime.set(t, { left, right });
  }
  for (const slot of wanted) {
    const keys = slots[slot] as SlotKeys;
    const out = new Float64Array(keys.seconds.length * 9 * 2);
    keys.seconds.forEach((t, k) => {
      const d = perTime.get(t) as { left: Float64Array; right: Float64Array };
      for (let c = 0; c < 3; c++) {
        out[(k * 9 + c) * 2] = d.left[slot * 6 + c] as number;
        out[(k * 9 + c) * 2 + 1] = d.right[slot * 6 + c] as number;
        out[(k * 9 + 6 + c) * 2] = d.left[slot * 6 + 3 + c] as number;
        out[(k * 9 + 6 + c) * 2 + 1] = d.right[slot * 6 + 3 + c] as number;
      }
    });
    result.set(slot, out);
  }
  return result;
}

/** Assembles the importer result. */
export function importedClip(
  fps: Fps,
  range: { readonly start: Frame; readonly end: Frame },
  curves: readonly ImportedCurve[],
  warnings: readonly string[],
): ImportedClipKeys {
  return { fps, range, curves, warnings };
}
