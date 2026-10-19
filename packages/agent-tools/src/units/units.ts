// Units, time and spaces at the tool boundary (MCP-SPEC §5.2, §5.3): degrees for rotations and angle attributes,
// metres for translations and distance attributes, factors for scale; frames are clip frames; output numbers are
// rounded (angles 0.01°, metres 0.1 mm, factors 1e-4, frames 1e-3). Character space is canonical: +Y up, +Z forward
// (the character faces +Z), +X the character's left. Named orientation angles of effectors and bones (pitch, yaw,
// roll) are relative to the rest orientation, applied yaw, then pitch, then roll.
import {
  DEG2RAD,
  eulerToQuat,
  type Fps,
  type Quat,
  quatInvert,
  quatMultiply,
  quatNormalize,
  quatToEuler,
  RAD2DEG,
  type ReadonlyQuat,
  type Vec3,
} from '@ekza-animator/anim-core';
import type { ChannelId, ControlRecord } from '@ekza-animator/doc';
import { channelUnit } from '@ekza-animator/editor-core';
import { AgentToolFailure } from '../types';

/** The unit of a channel at the tool boundary (§5.2): what `…Deg`, `…M`, `…Factor` fields and `value`s carry. */
export type ToolUnit = 'deg' | 'm' | 'factor' | 'none';

export function isRotationChannel(channel: string): boolean {
  return channel === 'rx' || channel === 'ry' || channel === 'rz';
}
export function isTranslationChannel(channel: string): boolean {
  return channel === 'tx' || channel === 'ty' || channel === 'tz';
}
export function isScaleChannel(channel: string): boolean {
  return channel === 'sx' || channel === 'sy' || channel === 'sz';
}
export function isAttrChannel(channel: string): channel is `@${string}` {
  return channel.startsWith('@');
}

/** The tool unit of a control channel: rotations and angle attributes deg, translations and distance attributes m. */
export function unitOfChannel(control: ControlRecord | null, channel: ChannelId): ToolUnit {
  if (isScaleChannel(channel)) return 'factor';
  const unit = channelUnit(control, channel);
  return unit === 'angle' ? 'deg' : unit === 'distance' ? 'm' : 'none';
}

/** A stored value (radians, metres, factor) in its tool unit (degrees for angles). */
export function toToolValue(unit: ToolUnit, stored: number): number {
  return unit === 'deg' ? stored * RAD2DEG : stored;
}

/** A tool value (degrees for angles) in stored units (radians). */
export function toStoredValue(unit: ToolUnit, value: number): number {
  return unit === 'deg' ? value * DEG2RAD : value;
}

/** Rounding steps of output numbers (§5.3). */
export const ROUND_STEP: Readonly<Record<ToolUnit | 'frame', number>> = {
  deg: 0.01,
  m: 0.0001,
  factor: 0.0001,
  none: 0.0001,
  frame: 0.001,
};

/** `value` rounded to a multiple of `step`, without float noise (0.30000000000000004 → 0.3) and without −0. */
export function roundTo(value: number, step: number): number {
  if (!Number.isFinite(value)) return value;
  const decimals = Math.max(0, Math.ceil(-Math.log10(step) - 1e-9));
  const rounded = Number((Math.round(value / step) * step).toFixed(decimals));
  return rounded === 0 ? 0 : rounded;
}

/** An output value in a tool unit: rounded, unless `full` precision is asked for (`keys_read {precision}`). */
export function outValue(unit: ToolUnit, value: number, precision: 'display' | 'full' = 'display'): number {
  if (precision === 'full') return value === 0 ? 0 : value;
  return roundTo(value, ROUND_STEP[unit]);
}

/** An output frame number (1e-3). */
export function outFrame(frame: number): number {
  return roundTo(frame, ROUND_STEP.frame);
}

/** Stored key times are rounded to 1e-6 frames on every write (§5.2). */
export function keyTime(frame: number): number {
  return roundTo(frame, 1e-6);
}

// ---------- fps (§5.2) ----------
const NTSC: readonly (readonly [number, Fps])[] = [
  [23.976, { num: 24_000, den: 1_001 }],
  [29.97, { num: 30_000, den: 1_001 }],
  [59.94, { num: 60_000, den: 1_001 }],
];

/** `30` → 30/1; `29.97` → 30000/1001 (also 23.976, 59.94); other fractions are `invalid_args`. */
export function fpsOf(value: number, path = 'fps'): Fps {
  for (const [shown, fps] of NTSC) if (Math.abs(value - shown) < 0.0015) return fps;
  if (Number.isInteger(value) && value >= 1) return { num: value, den: 1 };
  throw new AgentToolFailure(
    'invalid_args',
    `${path} must be a whole number of frames per second or 23.976, 29.97 or 59.94.`,
    `pass ${path}: 30 (or 24, 25, 60, 29.97)`,
    { detail: { path } },
  );
}

/** The number an fps is shown as: 30, 29.97, 23.976. */
export function fpsNumber(fps: Fps): number {
  return roundTo(fps.num / fps.den, 0.001);
}

/** Clip frames per second as a float (exact ratio). */
export function fpsValue(fps: Fps): number {
  return fps.num / fps.den;
}

// ---------- character space (§5.2) ----------
const NAMED: Readonly<Record<string, Vec3>> = {
  up: [0, 1, 0],
  down: [0, -1, 0],
  forward: [0, 0, 1],
  back: [0, 0, -1],
  left: [1, 0, 0],
  right: [-1, 0, 0],
};

export function vecLength(v: readonly number[]): number {
  return Math.hypot(v[0] ?? 0, v[1] ?? 0, v[2] ?? 0);
}

export function normalize(v: readonly number[]): Vec3 | null {
  const length = vecLength(v);
  if (!(length > 1e-9) || !Number.isFinite(length)) return null;
  return [(v[0] ?? 0) / length, (v[1] ?? 0) / length, (v[2] ?? 0) / length];
}

/**
 * A direction argument (§5.2): `up`, `down`, `forward`, `back`, `left`, `right` (the character's) and `+`-sums, or a
 * vector; normalised. A zero vector (or `left+right`) is `invalid_args` at `path`.
 */
export function directionOf(direction: string | readonly number[], path: string): Vec3 {
  let sum: Vec3 = [0, 0, 0];
  if (typeof direction === 'string') {
    for (const part of direction.split('+')) {
      const named = NAMED[part];
      if (named === undefined) {
        throw new AgentToolFailure(
          'invalid_args',
          `${path}: unknown direction "${part}".`,
          'use up, down, forward, back, left, right or [x, y, z]',
          {
            detail: { path },
          },
        );
      }
      sum = [sum[0] + named[0], sum[1] + named[1], sum[2] + named[2]];
    }
  } else {
    sum = [direction[0] ?? 0, direction[1] ?? 0, direction[2] ?? 0];
  }
  const unit = normalize(sum);
  if (unit === null) {
    throw new AgentToolFailure(
      'invalid_args',
      `${path}: the direction has no length.`,
      'pass a direction that points somewhere, such as up+left or [0.8, 0.6, 0]',
      {
        detail: { path },
      },
    );
  }
  return unit;
}

/** Output vector: each component rounded to 1e-4. */
export function outVec(v: readonly number[], step = 0.0001): Vec3 {
  return [roundTo(v[0] ?? 0, step), roundTo(v[1] ?? 0, step), roundTo(v[2] ?? 0, step)];
}

/** Angle between two unit vectors, degrees. */
export function angleDeg(a: readonly number[], b: readonly number[]): number {
  const dot = (a[0] ?? 0) * (b[0] ?? 0) + (a[1] ?? 0) * (b[1] ?? 0) + (a[2] ?? 0) * (b[2] ?? 0);
  return Math.acos(Math.min(1, Math.max(-1, dot))) * RAD2DEG;
}

// ---------- named orientation angles (§5.2) ----------
/** Named angles in degrees, relative to rest, in character space. */
export interface OrientDeg {
  readonly pitchDeg: number;
  readonly yawDeg: number;
  readonly rollDeg: number;
}

/**
 * The rotation delta of named angles: yaw about +Y (toward the character's left), then pitch about the turned +X
 * (positive = the tip up, so a negative turn about +X), then roll about the turned +Z (positive = the left side up).
 * In DCC rotate-order terms R = Ry · Rx · Rz, rotate order `zxy` with the triple [−pitch, yaw, roll].
 */
export function orientDelta(orient: Partial<OrientDeg>): Quat {
  return eulerToQuat(
    [-(orient.pitchDeg ?? 0) * DEG2RAD, (orient.yawDeg ?? 0) * DEG2RAD, (orient.rollDeg ?? 0) * DEG2RAD],
    'zxy',
  );
}

/** Named angles of a rotation delta (the inverse of `orientDelta`), degrees. */
export function orientOfDelta(delta: ReadonlyQuat): OrientDeg {
  const e = quatToEuler(quatNormalize(delta), 'zxy');
  return { pitchDeg: -e[0] * RAD2DEG, yawDeg: e[1] * RAD2DEG, rollDeg: e[2] * RAD2DEG };
}

/** Orientation `rest` turned by named angles in character space: `delta · rest`. */
export function orientFromRest(rest: ReadonlyQuat, orient: Partial<OrientDeg>): Quat {
  return quatNormalize(quatMultiply(orientDelta(orient), rest));
}

/** Named angles of an orientation relative to its rest orientation: the delta `current · rest⁻¹`. */
export function orientRelativeToRest(current: ReadonlyQuat, rest: ReadonlyQuat): OrientDeg {
  return orientOfDelta(quatMultiply(current, quatInvert(rest)));
}

// ---------- §5.2 radians check ----------
/** "values look like radians; this field is in degrees": all within ±π, not all zero, below 4 in magnitude. */
export function looksLikeRadians(values: readonly number[]): boolean {
  if (values.length === 0) return false;
  let nonZero = false;
  for (const value of values) {
    if (Math.abs(value) > Math.PI || Math.abs(value) >= 4) return false;
    if (value !== 0) nonZero = true;
  }
  return nonZero;
}

export const RADIANS_WARNING = 'values look like radians; this field is in degrees';
