// Cameras (ADR 0006 §3): per-pane view cameras (persp/top/front/side, user state) and shot cameras (CameraRecord,
// document state, shared by every pane that looks through them). Canonical space: +Y up, characters face +Z.
import type { ReadonlyXf } from '@ekza-studio/anim-core';
import type { CameraId, CameraRecord } from '@ekza-studio/doc';
import { OrthographicCamera, PerspectiveCamera, Vector3 } from 'three';
import { type NavCamera, NavigationController } from '../navigation/NavigationController';
import type { CameraSnapshot, ViewPreset } from '../types';

/** Maya's persp camera: 35 mm on a 36 × 24 mm gate → vertical FOV 37.8° (research 09 §5.2). */
export const PERSP_FOV_DEG = 37.8;
const ORTHO_DISTANCE = 100;
const DEFAULT_TARGET: readonly [number, number, number] = [0, 0.9, 0];

/** A pane's own camera: the three camera plus its navigation state. */
export interface ViewCamera {
  readonly preset: ViewPreset;
  readonly nav: NavigationController;
  /** False until the user navigates or frames this camera; untouched views re-frame when the characters change. */
  touched: boolean;
  /** Character set (ids joined) this untouched camera was last framed for, or null. */
  autoFramedFor: string | null;
}

export function createViewCamera(preset: ViewPreset): ViewCamera {
  if (preset === 'persp') {
    const camera = new PerspectiveCamera(PERSP_FOV_DEG, 1, 0.01, 2000);
    const nav = new NavigationController(camera, { canTumble: true });
    nav.lookAt([2.4, 1.7, 3.6], DEFAULT_TARGET);
    return { preset, nav, touched: false, autoFramedFor: null };
  }
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.01, 2 * ORTHO_DISTANCE + 100);
  const [x, y, z] = DEFAULT_TARGET;
  let position: [number, number, number];
  if (preset === 'top') {
    camera.up.set(0, 0, -1);
    position = [x, y + ORTHO_DISTANCE, z];
  } else if (preset === 'front') {
    position = [x, y, z + ORTHO_DISTANCE];
  } else {
    position = [x + ORTHO_DISTANCE, y, z];
  }
  setOrthoHeight(camera, 3, 1);
  const nav = new NavigationController(camera, { canTumble: false });
  nav.lookAt(position, DEFAULT_TARGET);
  return { preset, nav, touched: false, autoFramedFor: null };
}

/** Sets the orthographic frustum for a visible height (metres, before zoom) and a pane aspect. */
export function setOrthoHeight(camera: OrthographicCamera, height: number, aspect: number): void {
  const half = height / 2;
  camera.top = half;
  camera.bottom = -half;
  camera.left = -half * aspect;
  camera.right = half * aspect;
}

/** Adapts a camera's projection to a pane aspect before rendering or projecting. */
export function fitCameraToAspect(camera: NavCamera, aspect: number): void {
  if (camera instanceof PerspectiveCamera) {
    if (camera.aspect !== aspect) {
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
    }
    return;
  }
  const half = (camera.top - camera.bottom) / 2;
  if (camera.right - camera.left !== 2 * half * aspect) {
    camera.left = -half * aspect;
    camera.right = half * aspect;
    camera.updateProjectionMatrix();
  }
}

/** A document camera with its three camera and navigation (created on demand, synced from the record). */
export interface ShotCamera {
  readonly id: CameraId;
  record: CameraRecord;
  readonly nav: NavigationController;
}

export function createShotCamera(record: CameraRecord): ShotCamera {
  const camera =
    record.projection === 'orthographic'
      ? new OrthographicCamera(-1, 1, 1, -1, record.near, record.far)
      : new PerspectiveCamera((record.fovY * 180) / Math.PI, 1, record.near, record.far);
  const nav = new NavigationController(camera, { canTumble: true });
  const shot: ShotCamera = { id: record.id, record, nav };
  applyShotRecord(shot, record);
  return shot;
}

/** Copies a CameraRecord into its three camera (projection, transform, orbit pivot). */
export function applyShotRecord(shot: ShotCamera, record: CameraRecord): void {
  shot.record = record;
  const camera = shot.nav.camera;
  if (camera instanceof PerspectiveCamera) {
    camera.fov = (record.fovY * 180) / Math.PI;
  } else {
    setOrthoHeight(
      camera,
      record.orthoHeight,
      (camera.right - camera.left) / Math.max(camera.top - camera.bottom, 1e-9),
    );
  }
  camera.near = record.near;
  camera.far = record.far;
  camera.updateProjectionMatrix();
  // The record's orthoHeight is the visible height: navigation zoom is folded into it (shotTransformOf).
  if (camera instanceof OrthographicCamera && camera.zoom !== 1) shot.nav.setZoom(1);
  shot.nav.lookAt(record.transform.t, record.target);
  // setLookAt goes through spherical coordinates and derives the orientation from position and pivot; keep the
  // record's exact position and rotation (roll included).
  const t = record.transform.t;
  const q = record.transform.q;
  camera.position.set(t[0], t[1], t[2]);
  camera.quaternion.set(q[0], q[1], q[2], q[3]);
  camera.updateMatrixWorld();
}

/**
 * The record fields a navigation gesture writes: world transform (s = 1), orbit pivot and, for an orthographic
 * camera, the visible height with the zoom folded in.
 */
export function shotTransformOf(
  nav: NavigationController,
): Pick<CameraRecord, 'transform' | 'target'> & Partial<Pick<CameraRecord, 'orthoHeight'>> {
  const camera = nav.camera;
  const target = nav.target(new Vector3());
  const transform: ReadonlyXf = {
    t: [camera.position.x, camera.position.y, camera.position.z],
    q: [camera.quaternion.x, camera.quaternion.y, camera.quaternion.z, camera.quaternion.w],
    s: [1, 1, 1],
  };
  const fields = { transform, target: [target.x, target.y, target.z] as [number, number, number] };
  return camera instanceof OrthographicCamera
    ? { ...fields, orthoHeight: (camera.top - camera.bottom) / camera.zoom }
    : fields;
}

/** Projection-independent description of a navigated camera (CameraSnapshot, MVP-SPEC §4.6). */
export function snapshotOf(nav: NavigationController): CameraSnapshot {
  const camera = nav.camera;
  const target = nav.target(new Vector3());
  const perspective = camera instanceof PerspectiveCamera;
  return {
    projection: perspective ? 'perspective' : 'orthographic',
    position: [camera.position.x, camera.position.y, camera.position.z],
    quaternion: [camera.quaternion.x, camera.quaternion.y, camera.quaternion.z, camera.quaternion.w],
    target: [target.x, target.y, target.z],
    fovY: perspective ? (camera.fov * Math.PI) / 180 : 0,
    orthoHeight: perspective ? 0 : (camera.top - camera.bottom) / camera.zoom,
  };
}

/** The first live shot camera by order, then id. */
export function firstShotCamera(records: readonly CameraRecord[]): CameraRecord | null {
  let best: CameraRecord | null = null;
  for (const record of records) {
    if (record.deleted !== null) continue;
    if (best === null || record.order < best.order || (record.order === best.order && record.id < best.id))
      best = record;
  }
  return best;
}
