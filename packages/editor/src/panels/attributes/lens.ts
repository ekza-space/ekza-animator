// Shot-camera lens fields (research 09 §4.6): focal length ↔ vertical field of view on a 24 mm-high sensor
// (35 mm full frame), fov = 2·atan(sensorH / (2·f)). 35 mm ≈ 37.8°.
import { DEG2RAD, RAD2DEG } from '@ekza-studio/anim-core';

export const SENSOR_HEIGHT_MM = 24;
export const MIN_FOCAL_MM = 1;
export const MAX_FOCAL_MM = 5000;
export const MIN_FOV_DEG = 0.1;
export const MAX_FOV_DEG = 179;

/** Vertical FOV (radians) → focal length (mm). */
export function focalLengthFromFov(fovY: number): number {
  return SENSOR_HEIGHT_MM / (2 * Math.tan(fovY / 2));
}

/** Focal length (mm) → vertical FOV (radians). */
export function fovFromFocalLength(focalMm: number): number {
  return 2 * Math.atan(SENSOR_HEIGHT_MM / (2 * focalMm));
}

export const fovToDegrees = (fovY: number): number => fovY * RAD2DEG;
export const fovFromDegrees = (degrees: number): number => degrees * DEG2RAD;

export function validateFocalLength(focalMm: number): string | null {
  return focalMm >= MIN_FOCAL_MM && focalMm <= MAX_FOCAL_MM
    ? null
    : `Focal length must be ${MIN_FOCAL_MM}–${MAX_FOCAL_MM} mm`;
}

export function validateFovDegrees(degrees: number): string | null {
  return degrees >= MIN_FOV_DEG && degrees <= MAX_FOV_DEG
    ? null
    : `Field of view must be ${MIN_FOV_DEG}–${MAX_FOV_DEG}°`;
}
