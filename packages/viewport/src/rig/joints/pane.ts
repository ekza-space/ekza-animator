// Pane geometry the Rig & Skin overlays share (M6B-SPEC §8.3, §0.4.2; C3): projection of world points to pane CSS px,
// metres per pixel at a point (constant-size glyphs, the 4 px joint minimum), pointer rays and their hits on the
// axis-aligned plane through a marker (the axis rule's drag plane).
import { type Camera, OrthographicCamera, PerspectiveCamera, Raycaster, Vector2, Vector3 } from 'three';

export type Vec3 = readonly [number, number, number];

/** A pane's camera sized to the pane and its size in CSS px (`ViewportManager.paneView`). */
export interface PaneProjection {
  readonly camera: Camera;
  readonly width: number;
  readonly height: number;
}

export interface PanePoint {
  readonly x: number;
  readonly y: number;
  /** NDC depth (−1 near … 1 far). */
  readonly depth: number;
}

const scratch = new Vector3();

/** Pane CSS px of a world point; null behind the camera or beyond its clip range. */
export function projectPoint(view: PaneProjection, p: Vec3): PanePoint | null {
  scratch.set(p[0], p[1], p[2]).project(view.camera);
  if (!Number.isFinite(scratch.x) || scratch.z < -1 || scratch.z > 1) return null;
  return { x: ((scratch.x + 1) / 2) * view.width, y: ((1 - scratch.y) / 2) * view.height, depth: scratch.z };
}

/** Whether a pane point lies inside the pane. */
export function onPane(view: PaneProjection, point: PanePoint | null): point is PanePoint {
  return point !== null && point.x >= 0 && point.y >= 0 && point.x <= view.width && point.y <= view.height;
}

/** Metres per CSS pixel at a world point (orthographic: the frustum height; perspective: at the point's depth). */
export function worldPerPx(view: PaneProjection, p: Vec3): number {
  const camera = view.camera;
  const h = Math.max(view.height, 1);
  if (camera instanceof OrthographicCamera) return (camera.top - camera.bottom) / camera.zoom / h;
  if (camera instanceof PerspectiveCamera) {
    camera.getWorldDirection(scratch);
    const dx = p[0] - camera.position.x;
    const dy = p[1] - camera.position.y;
    const dz = p[2] - camera.position.z;
    const depth = Math.max(dx * scratch.x + dy * scratch.y + dz * scratch.z, camera.near);
    return (2 * depth * Math.tan((camera.getEffectiveFOV() * Math.PI) / 360)) / h;
  }
  return 0.01;
}

/** The pointer ray of a pane point (pane CSS px). */
export function pointerRay(view: PaneProjection, x: number, y: number): { origin: Vec3; dir: Vec3 } {
  const raycaster = new Raycaster();
  raycaster.setFromCamera(new Vector2((x / view.width) * 2 - 1, 1 - (y / view.height) * 2), view.camera);
  const o = raycaster.ray.origin;
  const d = raycaster.ray.direction;
  return { origin: [o.x, o.y, o.z], dir: [d.x, d.y, d.z] };
}

/** The ray's point on the plane `p[axis] = value`; null when the ray runs along the plane. */
export function rayOnAxisPlane(ray: { origin: Vec3; dir: Vec3 }, axis: 0 | 1 | 2, value: number): Vec3 | null {
  const d = ray.dir[axis];
  if (Math.abs(d) < 1e-9) return null;
  const t = (value - ray.origin[axis]) / d;
  const out: [number, number, number] = [
    ray.origin[0] + ray.dir[0] * t,
    ray.origin[1] + ray.dir[1] * t,
    ray.origin[2] + ray.dir[2] * t,
  ];
  out[axis] = value;
  return out;
}

/** The camera's unit view direction (from the camera into the scene). */
export function viewDirection(view: PaneProjection): Vec3 {
  view.camera.getWorldDirection(scratch);
  return [scratch.x, scratch.y, scratch.z];
}

/** Distance (px) from a point to the segment a–b in pane px, and the segment parameter of the closest point. */
export function segmentDistance(
  p: { readonly x: number; readonly y: number },
  a: { readonly x: number; readonly y: number },
  b: { readonly x: number; readonly y: number },
): { readonly distance: number; readonly t: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length2 = dx * dx + dy * dy;
  const t = length2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2));
  return { distance: Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t)), t };
}
