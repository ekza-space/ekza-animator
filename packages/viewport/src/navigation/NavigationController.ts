// Camera navigation of one camera (ADR 0006 §4): camera-controls keeps the orbit state (spherical around a target)
// and does the camera maths; gestures arrive already classified by the navigation profile and move the camera at
// once (no damping), so navigation is deterministic and an idle editor renders nothing.
import CameraControls from 'camera-controls';
import {
  Box3,
  Matrix4,
  OrthographicCamera,
  PerspectiveCamera,
  Quaternion,
  Raycaster,
  Sphere,
  Spherical,
  Vector2,
  Vector3,
  Vector4,
} from 'three';

let installed = false;

/** camera-controls needs three injected once; done lazily so importing the module registers nothing. */
function ensureInstalled(): void {
  if (installed) return;
  CameraControls.install({
    THREE: { Vector2, Vector3, Vector4, Quaternion, Matrix4, Spherical, Box3, Sphere, Raycaster },
  });
  installed = true;
}

/** Radians of tumble per pane height of drag (DCC feel: half a turn). */
const TUMBLE_PER_HEIGHT = Math.PI;
const MIN_DISTANCE = 0.02;
const MAX_DISTANCE = 5000;

export type NavCamera = PerspectiveCamera | OrthographicCamera;

/** Enough to put a camera back where a cancelled gesture found it. */
export interface NavState {
  readonly position: readonly [number, number, number];
  readonly target: readonly [number, number, number];
  readonly zoom: number;
}

const v1 = new Vector3();
const v2 = new Vector3();
const v3 = new Vector3();

export class NavigationController {
  readonly camera: NavCamera;
  private readonly controls: CameraControls;
  /** Orthographic views do not tumble (the DCC default). */
  readonly canTumble: boolean;

  constructor(camera: NavCamera, opts: { readonly canTumble: boolean }) {
    ensureInstalled();
    this.camera = camera;
    this.canTumble = opts.canTumble;
    this.controls = new CameraControls(camera);
    this.controls.smoothTime = 0;
    this.controls.draggingSmoothTime = 0;
    this.controls.minDistance = MIN_DISTANCE;
    this.controls.maxDistance = MAX_DISTANCE;
    this.controls.minZoom = 1e-3;
    this.controls.maxZoom = 1e4;
    this.controls.dollyToCursor = false;
    this.controls.enabled = false; // never bound to DOM events: gestures come from the viewport's input router
  }

  /** Places the camera at `position` looking at `target` (orbit pivot). */
  lookAt(position: readonly [number, number, number], target: readonly [number, number, number]): void {
    void this.controls.setLookAt(position[0], position[1], position[2], target[0], target[1], target[2], false);
    this.apply();
  }

  saveState(): NavState {
    const p = this.camera.position;
    const t = this.target(new Vector3());
    return { position: [p.x, p.y, p.z], target: [t.x, t.y, t.z], zoom: this.camera.zoom };
  }

  restoreState(state: NavState): void {
    void this.controls.zoomTo(state.zoom, false);
    this.lookAt(state.position, state.target);
  }

  /** Orbit pivot. */
  target(out: Vector3 = new Vector3()): Vector3 {
    return this.controls.getTarget(out, false);
  }

  /** Distance from the camera to the pivot. */
  get distance(): number {
    return this.controls.distance;
  }

  /** Tumble by a pointer delta in CSS px (drag right/down = positive) over a pane `height` px tall. */
  tumble(dx: number, dy: number, height: number): void {
    if (!this.canTumble) return;
    const scale = TUMBLE_PER_HEIGHT / Math.max(height, 1);
    void this.controls.rotate(-dx * scale, -dy * scale, false);
    this.apply();
  }

  /** Track (pan) so the scene follows the pointer: delta in CSS px over a pane of `width` × `height` px. */
  track(dx: number, dy: number, width: number, height: number): void {
    const perPx = this.worldPerPixel(height);
    const perPxX = this.camera instanceof OrthographicCamera ? this.orthoWidth() / Math.max(width, 1) : perPx;
    void this.controls.truck(-dx * perPxX, -dy * perPx, false);
    this.apply();
  }

  /**
   * Dolly by `amount` (positive = closer; the distance scales by e^−amount) keeping the point under the cursor fixed
   * on screen. `ndcX`/`ndcY` are the cursor in normalized device coordinates of the pane. Orthographic cameras zoom.
   */
  dolly(amount: number, ndcX: number, ndcY: number): void {
    const k = Math.exp(-amount);
    const camera = this.camera;
    const target = this.target(v1);
    const cursor = this.cursorOnTargetPlane(ndcX, ndcY, v2);
    if (camera instanceof PerspectiveCamera) {
      const position = v3.copy(camera.position);
      const distance = position.distanceTo(target);
      const clamped = Math.min(Math.max(distance * k, MIN_DISTANCE), MAX_DISTANCE);
      const f = clamped / distance;
      const newTarget = target.clone().lerp(cursor, 1 - f);
      const newPosition = position.sub(target).multiplyScalar(f).add(newTarget);
      void this.controls.setLookAt(
        newPosition.x,
        newPosition.y,
        newPosition.z,
        newTarget.x,
        newTarget.y,
        newTarget.z,
        false,
      );
    } else {
      const zoom = Math.min(Math.max(camera.zoom / k, 1e-3), 1e4);
      const f = camera.zoom / zoom;
      const shift = cursor.sub(target).multiplyScalar(1 - f);
      const position = v3.copy(camera.position).add(shift);
      const newTarget = target.add(shift);
      void this.controls.setLookAt(position.x, position.y, position.z, newTarget.x, newTarget.y, newTarget.z, false);
      void this.controls.zoomTo(zoom, false);
    }
    this.apply();
  }

  /** World units per CSS px at the pivot depth for a pane `height` px tall. */
  worldPerPixel(height: number): number {
    const camera = this.camera;
    if (camera instanceof PerspectiveCamera) {
      return (2 * this.controls.distance * Math.tan((camera.getEffectiveFOV() * Math.PI) / 360)) / Math.max(height, 1);
    }
    return (camera.top - camera.bottom) / camera.zoom / Math.max(height, 1);
  }

  /** Orthographic zoom (1 for perspective cameras). */
  get zoom(): number {
    return this.camera.zoom;
  }

  setZoom(zoom: number): void {
    void this.controls.zoomTo(zoom, false);
    this.apply();
  }

  dispose(): void {
    this.controls.dispose();
  }

  private orthoWidth(): number {
    const camera = this.camera as OrthographicCamera;
    return (camera.right - camera.left) / camera.zoom;
  }

  /** Point under the cursor on the plane through the pivot facing the camera. */
  private cursorOnTargetPlane(ndcX: number, ndcY: number, out: Vector3): Vector3 {
    const camera = this.camera;
    camera.updateMatrixWorld();
    const target = this.controls.getTarget(new Vector3(), false);
    const forward = camera.getWorldDirection(new Vector3());
    const origin = new Vector3(ndcX, ndcY, -1).unproject(camera);
    const far = new Vector3(ndcX, ndcY, 1).unproject(camera);
    const dir = far.sub(origin).normalize();
    const denom = dir.dot(forward);
    if (Math.abs(denom) < 1e-9) return out.copy(target);
    const t = target.clone().sub(origin).dot(forward) / denom;
    return out.copy(origin).addScaledVector(dir, t);
  }

  /** Writes the orbit state into the camera immediately. */
  private apply(): void {
    this.controls.update(0);
    this.camera.updateMatrixWorld();
  }
}
