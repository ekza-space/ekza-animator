// The shot camera an import creates when the project has none (MVP-SPEC §4.11.6 step 8): a 50 mm lens, 3/4 front
// view from chest height, framed on the character's height; locked, so the split layout's left pane is a stable shot.
import { mat4Decompose, type Quat, type ReadonlyVec3, type Vec3 } from '@ekza-animator/anim-core';

/** Vertical field of view of a 50 mm lens on a 24 mm-high full-frame sensor. */
export const SHOT_FOV_Y = 2 * Math.atan(12 / 50);
/** Yaw of the 3/4 front view, from +Z (character front) towards +X (character left). */
const THREE_QUARTER_YAW = Math.PI / 6;
/** Chest height and frame margin as fractions of the character height. */
const CHEST = 0.72;
const MARGIN = 1.1;

export interface ShotFrame {
  readonly position: Vec3;
  readonly quaternion: Quat;
  readonly target: readonly [number, number, number];
}

/** Rotation whose −Z axis looks from `eye` to `target` with +Y up (three.js camera convention). */
export function lookAtQuaternion(eye: ReadonlyVec3, target: ReadonlyVec3): Quat {
  const f: Vec3 = [target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]];
  const fl = Math.hypot(f[0], f[1], f[2]) || 1;
  // z = −forward, x = up × z, y = z × x.
  const z: Vec3 = [-f[0] / fl, -f[1] / fl, -f[2] / fl];
  let x: Vec3 = [z[2], 0, -z[0]];
  const xl = Math.hypot(x[0], x[1], x[2]);
  x = xl < 1e-12 ? [1, 0, 0] : [x[0] / xl, x[1] / xl, x[2] / xl];
  const y: Vec3 = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
  const m = new Float64Array([x[0], x[1], x[2], 0, y[0], y[1], y[2], 0, z[0], z[1], z[2], 0, 0, 0, 0, 1]);
  return mat4Decompose(m).q;
}

/** Frames a character of height `height` standing at `x` (character space = world in the MVP). */
export function frameShotCamera(height: number, x: number): ShotFrame {
  const h = Number.isFinite(height) && height > 0 ? height : 1.7;
  const target: [number, number, number] = [x, h * 0.5, 0];
  const distance = (h * 0.5 * MARGIN) / Math.tan(SHOT_FOV_Y / 2);
  const position: Vec3 = [
    x + distance * Math.sin(THREE_QUARTER_YAW),
    h * CHEST,
    distance * Math.cos(THREE_QUARTER_YAW),
  ];
  return { position, quaternion: lookAtQuaternion(position, target), target };
}
