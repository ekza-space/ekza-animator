import { EkzaError } from '../errors';
import type { Fps, Handle, TangentFields } from '../types';
import { MIN_HANDLE_DT } from './keys';

const DEG = 180 / Math.PI;
/** Typed angles are clamped just inside ±90° so the inverse stays finite (tan 90° is not a slope). */
const MAX_TYPED_ANGLE_DEG = 90 - 1e-6;

function framesPerSecond(fps: Fps): number {
  const value = fps.num / fps.den;
  if (!Number.isFinite(value) || value <= 0) {
    throw new EkzaError('unsupported', `Invalid frame rate ${fps.num}/${fps.den}`);
  }
  return value;
}

function checkScale(displayScale: number): void {
  if (!Number.isFinite(displayScale) || displayScale <= 0) {
    throw new EkzaError('unsupported', `Invalid display scale ${displayScale}`);
  }
}

/**
 * Graph Editor numeric fields of a handle in Maya convention (MVP-SPEC §4.11.4): time in seconds, value in display
 * units (`displayScale` = 180/π for rotation channels, 1 otherwise). The angle is measured on the forward-pointing
 * vector (out: (dt, dv), in: (−dt, −dv)), ±90° when |dt| < 1e-6 frames; weight = 3·hypot(|dt|/fps, dv·k).
 */
export function tangentFields(h: Handle, side: 'in' | 'out', fps: Fps, displayScale: number): TangentFields {
  const fpsS = framesPerSecond(fps);
  checkScale(displayScale);
  const forwardY = (side === 'out' ? h.dv : -h.dv) * displayScale;
  const forwardX = (side === 'out' ? h.dt : -h.dt) / fpsS;
  let angleDeg: number;
  if (Math.abs(h.dt) < MIN_HANDLE_DT) angleDeg = forwardY === 0 ? 0 : Math.sign(forwardY) * 90;
  else angleDeg = Math.min(90, Math.max(-90, Math.atan2(forwardY, forwardX) * DEG));
  const weight = 3 * Math.hypot(Math.abs(h.dt) / fpsS, h.dv * displayScale);
  return { angleDeg, weight };
}

/**
 * Inverse of `tangentFields` for a typed angle and/or weight (MVP-SPEC §4.11.4). `current` is the side's resolved
 * handle (`resolveKeyHandles`; non-weighted: a third of the span).
 * - Angle only: keeps |dt| of `current` and sets dv = ±tan(angle)·(|dt|/fps)/k.
 * - Weight only: scales `current` along its angle to the new weight.
 * - Both: the handle of that length along that angle.
 * Typing an in-angle of +30° on a rising curve gives a positive incoming slope.
 */
export function handleFromFields(
  fields: Partial<TangentFields>,
  current: Handle,
  side: 'in' | 'out',
  fps: Fps,
  displayScale: number,
): Handle {
  const fpsS = framesPerSecond(fps);
  checkScale(displayScale);
  const sign = side === 'out' ? 1 : -1;
  const { angleDeg, weight } = fields;
  if (angleDeg !== undefined && !Number.isFinite(angleDeg)) {
    throw new EkzaError('unsupported', `Invalid tangent angle ${angleDeg}`);
  }
  if (weight !== undefined && (!Number.isFinite(weight) || weight < 0)) {
    throw new EkzaError('unsupported', `Invalid tangent weight ${weight}`);
  }
  if (angleDeg === undefined && weight === undefined) return { dt: current.dt, dv: current.dv };

  const typedAngle =
    angleDeg === undefined ? undefined : Math.min(MAX_TYPED_ANGLE_DEG, Math.max(-MAX_TYPED_ANGLE_DEG, angleDeg));

  if (weight === undefined) {
    const absDt = Math.max(Math.abs(current.dt), MIN_HANDLE_DT);
    const slopeDisplay = Math.tan((typedAngle as number) / DEG); // display units per second
    return { dt: sign * absDt, dv: (sign * slopeDisplay * (absDt / fpsS)) / displayScale };
  }

  const theta = (typedAngle ?? tangentFields(current, side, fps, displayScale).angleDeg) / DEG;
  const length = weight / 3; // hypot(seconds, display units)
  const seconds = length * Math.cos(theta);
  const display = length * Math.sin(theta);
  return { dt: sign * seconds * fpsS, dv: (sign * display) / displayScale };
}
