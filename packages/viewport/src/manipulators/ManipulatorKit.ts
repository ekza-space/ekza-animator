// ManipulatorKit (ADR 0006 §7, MVP-SPEC §4.11.16): translate (3 axes, 3 planes, view-plane centre) in object/world
// space, rotate (3 rings + view ring) in object/world/gimbal space and (M6a, B9) scale (3 axes with cube ends and a
// uniform centre cube) in object space, drawn in the overlay pass at a constant pixel size per pane and picked
// analytically in screen space. Drags produce channel edits (./drag.ts, ./scale/math.ts); the viewport tools feed
// them into the editor-core gesture helper.
import {
  gimbalAxes,
  type Quat,
  quatRotateVec3,
  type ReadonlyVec3,
  rotateOrderAxes,
  type RotateOrder,
  type Vec3,
} from '@ekza-animator/anim-core';
import type { ManipSpace } from '@ekza-animator/editor-core';
import {
  BoxGeometry,
  type Camera,
  Color,
  ConeGeometry,
  DoubleSide,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  Scene,
  SphereGeometry,
  Vector3,
} from 'three';
import type { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { lineMaterial } from '../overlays/lineBatch';
import { type PaneProjector, pointSegmentDistance } from '../picking/geometry';
import { PICK, VIEWPORT_THEME } from '../theme';
import type { ManipHandle, ScreenPoint } from '../types';
import { cross, ringScreenTangent } from './drag';

export type ManipMode = 'translate' | 'rotate' | 'scale';

/** What the manipulator sits on: the lead selected control. Scene space. */
export interface ManipTarget {
  readonly pivot: ReadonlyVec3;
  /** Rotation of the control's world matrix (object space axes). */
  readonly worldQ: Quat;
  /** Rotation of the parent·offset frame (gimbal axes live in it). */
  readonly parentQ: Quat;
  readonly r: ReadonlyVec3;
  readonly order: RotateOrder;
  /** Channels a drag may edit: keyable and not locked (`s`, M6a: the Scale tool's; absent = all three). */
  readonly keyable: {
    readonly t: readonly [boolean, boolean, boolean];
    readonly r: readonly [boolean, boolean, boolean];
    readonly s?: readonly [boolean, boolean, boolean];
  };
  /**
   * Keyable channels that are locked. Their axis handles (translate arrows, rotate rings) are drawn dimmed and never
   * drag, but stay pickable so a press on one can say why nothing moves (Maya). Absent: nothing is locked.
   */
  readonly locked?: {
    readonly t: readonly [boolean, boolean, boolean];
    readonly r: readonly [boolean, boolean, boolean];
  };
}

// Handle geometry in manipulator units (1 unit = the manipulator size in px at the pivot).
const AXIS_START = 0.18;
const AXIS_END = 1;
const CONE_LENGTH = 0.16;
const CONE_RADIUS = 0.045;
const PLANE_MIN = 0.22;
const PLANE_MAX = 0.42;
const CENTER_HALF = 0.07;
/** Scale handles (M6a): cube ends of the axes and the uniform centre cube, in manipulator units. */
const SCALE_CUBE = 0.08;
const UNIFORM_HALF = 0.09;
export const RING_RADIUS = 0.75;
export const VIEW_RING_RADIUS = 0.95;
const RING_SEGMENTS = 64;
/** Gimbal rings within 10° of lock turn `--danger` (|cos middle| < cos 80°). */
const GIMBAL_DANGER_COS = Math.cos((80 * Math.PI) / 180);

export const TRANSLATE_HANDLES: readonly ManipHandle[] = ['tx', 'ty', 'tz', 'txy', 'tyz', 'txz', 'tview'];
export const ROTATE_HANDLES: readonly ManipHandle[] = ['rx', 'ry', 'rz', 'rview'];
export const SCALE_HANDLES: readonly ManipHandle[] = ['sx', 'sy', 'sz', 'suniform'];
/** Handles that stand for exactly one channel each; the channel has the handle's name. */
export type AxisHandle = 'tx' | 'ty' | 'tz' | 'rx' | 'ry' | 'rz';
const AXIS_HANDLES: { readonly t: readonly AxisHandle[]; readonly r: readonly AxisHandle[] } = {
  t: ['tx', 'ty', 'tz'],
  r: ['rx', 'ry', 'rz'],
};
const PLANE_AXES: Readonly<Record<'txy' | 'tyz' | 'txz', readonly [0 | 1 | 2, 0 | 1 | 2, 0 | 1 | 2]>> = {
  txy: [0, 1, 2],
  tyz: [1, 2, 0],
  txz: [0, 2, 1],
};
const AXIS_COLORS = [VIEWPORT_THEME.axisX, VIEWPORT_THEME.axisY, VIEWPORT_THEME.axisZ] as const;

interface HandleVisual {
  readonly handle: ManipHandle;
  readonly root: Object3D;
  readonly lines: LineMaterial[];
  readonly meshes: MeshBasicMaterial[];
  readonly baseColor: string;
}

const X = new Vector3(1, 0, 0);
const Z = new Vector3(0, 0, 1);

export class ManipulatorKit {
  /** Overlay scene (drawn after `clearDepth`). */
  readonly scene = new Scene();
  private readonly root = new Group();
  private readonly visuals = new Map<ManipHandle, HandleVisual>();
  private readonly occluder: Mesh;
  private mode: ManipMode | null = null;
  private space: ManipSpace = 'object';
  private target: ManipTarget | null = null;
  private sizePx = 90;
  private hover: ManipHandle | null = null;
  private active: ManipHandle | null = null;
  private axesCache: [Vec3, Vec3, Vec3] = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  private danger: readonly boolean[] = [false, false, false];
  /** M6a (B12a): pivot editing draws the manipulator dashed (§5.15). */
  private dashed = false;
  /** Bumped on every visual change. */
  version = 0;

  constructor() {
    this.scene.matrixWorldAutoUpdate = false;
    this.scene.add(this.root);
    this.root.name = 'ekza.manipulator';
    this.root.visible = false;
    this.occluder = new Mesh(
      new SphereGeometry(RING_RADIUS * 0.985, 32, 16),
      new MeshBasicMaterial({ colorWrite: false }),
    );
    this.occluder.renderOrder = -1;
    this.root.add(this.occluder);
    for (let k = 0; k < 3; k++) {
      this.add(this.axisVisual((['tx', 'ty', 'tz'] as const)[k] as ManipHandle, AXIS_COLORS[k] as string));
      this.add(this.ringVisual((['rx', 'ry', 'rz'] as const)[k] as ManipHandle, AXIS_COLORS[k] as string, RING_RADIUS));
      this.add(this.scaleAxisVisual((['sx', 'sy', 'sz'] as const)[k] as ManipHandle, AXIS_COLORS[k] as string));
    }
    this.add(this.uniformVisual());
    for (const handle of ['txy', 'tyz', 'txz'] as const) {
      this.add(this.planeVisual(handle, AXIS_COLORS[PLANE_AXES[handle][2]]));
    }
    this.add(this.centerVisual());
    this.add(this.ringVisual('rview', VIEWPORT_THEME.axisView, VIEW_RING_RADIUS));
  }

  /** Tool mode (move → translate, rotate → rotate, scale → scale, otherwise null), handle space and size in CSS px.
   *  Scale handles always use object axes (each object scales in its own axes). */
  configure(mode: ManipMode | null, space: ManipSpace, sizePx: number): void {
    const s: ManipSpace = mode === 'scale' ? 'object' : mode === 'translate' && space === 'gimbal' ? 'object' : space;
    if (mode === this.mode && s === this.space && sizePx === this.sizePx) return;
    this.mode = mode;
    this.space = s;
    this.sizePx = sizePx;
    this.refresh();
  }

  setTarget(target: ManipTarget | null): void {
    this.target = target;
    this.refresh();
  }

  /** M6a (B12a, §5.15): dashed lines while the pivot is edited. */
  setDashed(dashed: boolean): void {
    if (dashed === this.dashed) return;
    this.dashed = dashed;
    for (const visual of this.visuals.values()) {
      for (const material of visual.lines) {
        material.dashed = dashed;
        material.dashSize = 0.05;
        material.gapSize = 0.04;
        material.needsUpdate = true;
      }
    }
    this.version++;
  }

  get isDashed(): boolean {
    return this.dashed;
  }

  setHover(handle: ManipHandle | null): boolean {
    if (handle === this.hover) return false;
    this.hover = handle;
    this.refreshStyles();
    return true;
  }

  setActive(handle: ManipHandle | null): void {
    if (handle === this.active) return;
    this.active = handle;
    this.refreshStyles();
  }

  get visible(): boolean {
    return this.mode !== null && this.target !== null;
  }

  get currentMode(): ManipMode | null {
    return this.mode;
  }

  get currentSpace(): ManipSpace {
    return this.space;
  }

  get currentTarget(): ManipTarget | null {
    return this.target;
  }

  /** Size of the manipulator in CSS px. */
  get size(): number {
    return this.sizePx;
  }

  /**
   * Scene-space unit axes of the handles: translate x/y/z (world or object), rotate rings x/y/z (world, object or
   * the gimbal axes of the rotate order: outer fixed in the parent·offset frame, middle rotated by the outer angle,
   * inner by outer then middle).
   */
  axes(): readonly [Vec3, Vec3, Vec3] {
    return this.axesCache;
  }

  /**
   * Handles of the current mode that can be dragged. Handles of non-keyable channels are dimmed and not pickable;
   * those of locked channels are dimmed too (see `lockedHandles`).
   */
  handles(): readonly ManipHandle[] {
    if (!this.visible) return [];
    const target = this.target as ManipTarget;
    if (this.mode === 'scale') {
      const s = target.keyable.s ?? [true, true, true];
      return SCALE_HANDLES.filter((h) => (h === 'suniform' ? s.some(Boolean) : s[axisIndex(h)]));
    }
    if (this.mode === 'translate') {
      const t = target.keyable.t;
      return TRANSLATE_HANDLES.filter((h) => {
        if (h === 'tview') return t.some(Boolean);
        if (h === 'tx' || h === 'ty' || h === 'tz') return t[axisIndex(h)];
        const [a, b] = PLANE_AXES[h as 'txy'];
        return t[a] || t[b];
      });
    }
    const r = target.keyable.r;
    const locked = target.locked?.r;
    return ROTATE_HANDLES.filter((h) => {
      if (h === 'rview') return r.some(Boolean);
      // A ring whose own channel is locked never turns the control, in any space (not even about the other axes).
      if (locked?.[axisIndex(h)] === true) return false;
      return this.space !== 'gimbal' ? r.some(Boolean) : r[axisIndex(h)];
    });
  }

  /**
   * Axis handles of the current mode whose channel is locked on the target (translate arrows, rotate rings): dimmed
   * like the disabled handles and never dragged, but pickable, so the tool can report the lock instead of selecting
   * through the handle.
   */
  lockedHandles(): readonly AxisHandle[] {
    if (!this.visible || this.mode === 'scale') return [];
    const locked = (this.target as ManipTarget).locked;
    if (locked === undefined) return [];
    const axes: readonly AxisHandle[] = this.mode === 'translate' ? AXIS_HANDLES.t : AXIS_HANDLES.r;
    const flags = this.mode === 'translate' ? locked.t : locked.r;
    return axes.filter((h) => flags[axisIndex(h)]);
  }

  /** The channel a locked axis handle stands for (see `lockedHandles`; named like the handle), or null. */
  lockedChannel(handle: ManipHandle): AxisHandle | null {
    return this.lockedHandles().find((h) => h === handle) ?? null;
  }

  /** Handles a press can land on: the draggable ones and the locked axis handles. */
  private pickable(): readonly ManipHandle[] {
    return [...this.handles(), ...this.lockedHandles()];
  }

  /** Scene-space units per manipulator unit in a pane (constant pixel size). */
  worldScale(camera: Camera, heightPx: number, projector: PaneProjector): number {
    const target = this.target;
    if (target === null) return 1;
    const perPx =
      camera instanceof OrthographicCamera
        ? (camera.top - camera.bottom) / camera.zoom / Math.max(heightPx, 1)
        : camera instanceof PerspectiveCamera
          ? (2 *
              Math.max(projector.depth(target.pivot[0], target.pivot[1], target.pivot[2]), 1e-4) *
              Math.tan((camera.getEffectiveFOV() * Math.PI) / 360)) /
            Math.max(heightPx, 1)
          : 0.01;
    return perPx * this.sizePx;
  }

  /** Places the manipulator for a pane before its overlay pass. */
  prepare(camera: Camera, widthPx: number, heightPx: number, projector: PaneProjector): void {
    const target = this.target;
    this.root.visible = this.visible;
    if (target === null || !this.visible) return;
    const s = this.worldScale(camera, heightPx, projector);
    this.root.position.set(target.pivot[0], target.pivot[1], target.pivot[2]);
    this.root.scale.setScalar(s);
    const billboard = camera.quaternion;
    this.visuals.get('rview')?.root.quaternion.copy(billboard);
    this.visuals.get('tview')?.root.quaternion.copy(billboard);
    for (const visual of this.visuals.values())
      for (const material of visual.lines) material.resolution.set(widthPx, heightPx);
    this.scene.updateMatrixWorld(true);
  }

  /** The handle under a pane point, or null. Priority: view-plane centre, then the nearest handle within 7 px. */
  pick(camera: Camera, projector: PaneProjector, heightPx: number, x: number, y: number): ManipHandle | null {
    if (!this.visible) return null;
    const s = this.worldScale(camera, heightPx, projector);
    let best: ManipHandle | null = null;
    let bestDistance: number = PICK.manipulatorPx;
    for (const handle of this.pickable()) {
      const d = this.handleDistance(handle, camera, projector, s, x, y);
      if ((handle === 'tview' || handle === 'suniform') && d === 0) return handle;
      if (d <= bestDistance) {
        best = handle;
        bestDistance = d;
      }
    }
    return best;
  }

  /**
   * A grab point on a handle in pane CSS px: axes at 70 % of their length, planes at their centre, rings at the
   * front point farthest from the other handles with the most horizontal screen tangent (so a horizontal drag turns
   * it), the view ring at its top.
   */
  grabPoint(handle: ManipHandle, camera: Camera, projector: PaneProjector, heightPx: number): ScreenPoint | null {
    if (!this.pickable().includes(handle)) return null;
    const target = this.target as ManipTarget;
    const s = this.worldScale(camera, heightPx, projector);
    const out = [0, 0, 0];
    const project = (p: ReadonlyVec3): ScreenPoint | null =>
      projector.project(p[0], p[1], p[2], out)
        ? { x: out[0] as number, y: out[1] as number, depth: out[2] as number }
        : null;
    const pivot = target.pivot;
    if (handle === 'tview' || handle === 'suniform') return project(pivot);
    if (
      handle === 'tx' ||
      handle === 'ty' ||
      handle === 'tz' ||
      handle === 'sx' ||
      handle === 'sy' ||
      handle === 'sz'
    ) {
      const u = this.axesCache[axisIndex(handle)];
      return project(add(pivot, scale(u, 0.7 * s)));
    }
    if (handle === 'txy' || handle === 'tyz' || handle === 'txz') {
      const [a, b] = PLANE_AXES[handle];
      const mid = ((PLANE_MIN + PLANE_MAX) / 2) * s;
      return project(add(add(pivot, scale(this.axesCache[a], mid)), scale(this.axesCache[b], mid)));
    }
    const ring = this.ringPoints(handle, camera, s);
    const others = this.pickable()
      .filter((h) => h !== handle)
      .map((h) => this.screenPolyline(h, camera, projector, s));
    let best: { point: ScreenPoint; score: number } | null = null;
    for (const p of ring) {
      const screen = project(p);
      if (screen === null) continue;
      const axis = this.ringAxis(handle, camera);
      const tangent = ringScreenTangent(projector, pivot, axis, p);
      const speed = Math.hypot(tangent[0], tangent[1]);
      if (speed < 1e-6) continue;
      let separation = Number.POSITIVE_INFINITY;
      const tmp = [0, 0];
      for (const poly of others) {
        for (let i = 0; i + 3 < poly.length; i += 4) {
          separation = Math.min(
            separation,
            pointSegmentDistance(
              screen.x,
              screen.y,
              poly[i] as number,
              poly[i + 1] as number,
              poly[i + 2] as number,
              poly[i + 3] as number,
              tmp,
            ),
          );
        }
      }
      const score = Math.min(separation, 12) * 10 + (Math.abs(tangent[0]) / speed) * 5 + Math.min(speed / 100, 1);
      if (best === null || score > best.score) best = { point: screen, score };
    }
    return best?.point ?? null;
  }

  /** Scene-space point on a ring nearest to a pane point (front half), for starting a rotate drag. */
  ringGrab(
    handle: ManipHandle,
    camera: Camera,
    projector: PaneProjector,
    heightPx: number,
    x: number,
    y: number,
  ): Vec3 | null {
    const s = this.worldScale(camera, heightPx, projector);
    const out = [0, 0, 0];
    let best: Vec3 | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const p of this.ringPoints(handle, camera, s)) {
      if (!projector.project(p[0], p[1], p[2], out)) continue;
      const d = Math.hypot((out[0] as number) - x, (out[1] as number) - y);
      if (d < bestDistance) {
        bestDistance = d;
        best = p;
      }
    }
    return best;
  }

  /** Rotation axis (scene space) of a ring handle; the view ring turns about the view axis (towards the viewer). */
  ringAxis(handle: ManipHandle, camera: Camera): Vec3 {
    if (handle === 'rview') {
      const e = camera.matrixWorld.elements;
      const len = Math.hypot(e[8], e[9], e[10]) || 1;
      return [e[8] / len, e[9] / len, e[10] / len];
    }
    return [...this.axesCache[axisIndex(handle)]] as Vec3;
  }

  dispose(): void {
    this.scene.traverse((object) => {
      const mesh = object as Mesh;
      if (mesh.geometry !== undefined) mesh.geometry.dispose();
      const material = mesh.material;
      if (Array.isArray(material)) for (const m of material) m.dispose();
      else if (material !== undefined) material.dispose();
    });
  }

  // ---------------------------------------------------------------------------------------------------------------

  private refresh(): void {
    this.computeAxes();
    const mode = this.mode;
    const show = this.visible;
    this.root.visible = show;
    for (const visual of this.visuals.values()) {
      const handleMode: ManipMode = TRANSLATE_HANDLES.includes(visual.handle)
        ? 'translate'
        : SCALE_HANDLES.includes(visual.handle)
          ? 'scale'
          : 'rotate';
      visual.root.visible = show && handleMode === mode;
    }
    this.occluder.visible = show && mode === 'rotate';
    this.orientHandles();
    this.refreshStyles();
  }

  private computeAxes(): void {
    const target = this.target;
    if (target === null) return;
    const world: [Vec3, Vec3, Vec3] = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ];
    this.danger = [false, false, false];
    if (this.space === 'world') {
      this.axesCache = world;
    } else if (this.space === 'gimbal' && this.mode === 'rotate') {
      const local = gimbalAxes(target.r, target.order);
      this.axesCache = [
        normalize(quatRotateVec3(target.parentQ, local[0])),
        normalize(quatRotateVec3(target.parentQ, local[1])),
        normalize(quatRotateVec3(target.parentQ, local[2])),
      ];
      const [inner, middle, outer] = rotateOrderAxes(target.order);
      const near = Math.abs(Math.cos(target.r[middle])) < GIMBAL_DANGER_COS;
      const danger = [false, false, false];
      danger[inner] = near;
      danger[outer] = near;
      this.danger = danger;
    } else {
      this.axesCache = [
        normalize(quatRotateVec3(target.worldQ, world[0])),
        normalize(quatRotateVec3(target.worldQ, world[1])),
        normalize(quatRotateVec3(target.worldQ, world[2])),
      ];
    }
  }

  private orientHandles(): void {
    const axes = this.axesCache;
    const q = new Quaternion();
    for (let k = 0; k < 3; k++) {
      const axis = new Vector3(...(axes[k] as Vec3));
      this.visuals
        .get((['tx', 'ty', 'tz'] as const)[k] as ManipHandle)
        ?.root.quaternion.copy(q.setFromUnitVectors(X, axis));
      this.visuals
        .get((['sx', 'sy', 'sz'] as const)[k] as ManipHandle)
        ?.root.quaternion.copy(q.setFromUnitVectors(X, axis));
      this.visuals
        .get((['rx', 'ry', 'rz'] as const)[k] as ManipHandle)
        ?.root.quaternion.copy(q.setFromUnitVectors(Z, axis));
    }
    this.visuals
      .get('suniform')
      ?.root.quaternion.setFromRotationMatrix(
        new Matrix4().makeBasis(new Vector3(...axes[0]), new Vector3(...axes[1]), new Vector3(...axes[2])),
      );
    for (const handle of ['txy', 'tyz', 'txz'] as const) {
      const [a, b] = PLANE_AXES[handle];
      const u = new Vector3(...axes[a]);
      const v = new Vector3(...axes[b]);
      const n = new Vector3().crossVectors(u, v).normalize();
      v.crossVectors(n, u).normalize();
      this.visuals.get(handle)?.root.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(u, v, n));
    }
    this.version++;
  }

  private refreshStyles(): void {
    const dimmedHandles = new Set(this.visible ? this.handles() : []);
    const dragging = this.active !== null;
    for (const visual of this.visuals.values()) {
      const axis =
        visual.handle === 'rx' || visual.handle === 'ry' || visual.handle === 'rz' ? axisIndex(visual.handle) : -1;
      let color = visual.baseColor;
      if (axis !== -1 && this.space === 'gimbal' && this.danger[axis] === true) color = VIEWPORT_THEME.danger;
      if (visual.handle === this.active || (!dragging && visual.handle === this.hover))
        color = VIEWPORT_THEME.axisActive;
      const enabled = dimmedHandles.has(visual.handle);
      const opacity = !enabled ? 0.25 : dragging && visual.handle !== this.active ? 0.3 : 1;
      const c = new Color(color);
      for (const material of visual.lines) {
        material.color.copy(c);
        material.opacity = opacity;
        material.transparent = opacity < 1;
      }
      for (const material of visual.meshes) {
        material.color.copy(c);
        material.opacity =
          opacity * (visual.handle === 'txy' || visual.handle === 'tyz' || visual.handle === 'txz' ? 0.35 : 1);
        const transparent = material.opacity < 1;
        // Mesh materials bake `transparent` into the shader (three's OPAQUE define): switch variants explicitly.
        if (material.transparent !== transparent) {
          material.transparent = transparent;
          material.needsUpdate = true;
        }
      }
    }
    this.version++;
  }

  private add(visual: HandleVisual): void {
    this.visuals.set(visual.handle, visual);
    visual.root.name = `ekza.manipulator.${visual.handle}`;
    this.root.add(visual.root);
  }

  private line(positions: number[], material: LineMaterial): LineSegments2 {
    const geometry = new LineSegmentsGeometry();
    geometry.setPositions(positions);
    const line = new LineSegments2(geometry, material);
    line.computeLineDistances(); // M6a: dashed pivot editing (setDashed)
    line.frustumCulled = false;
    return line;
  }

  private axisVisual(handle: ManipHandle, color: string): HandleVisual {
    const root = new Group();
    const material = lineMaterial({ width: 2, vertexColors: false, color, depthTest: false });
    root.add(this.line([AXIS_START, 0, 0, AXIS_END - CONE_LENGTH, 0, 0], material));
    const coneGeometry = new ConeGeometry(CONE_RADIUS, CONE_LENGTH, 12);
    coneGeometry.rotateZ(-Math.PI / 2);
    coneGeometry.translate(AXIS_END - CONE_LENGTH / 2, 0, 0);
    const coneMaterial = new MeshBasicMaterial({ color, depthTest: false, toneMapped: false });
    const cone = new Mesh(coneGeometry, coneMaterial);
    cone.frustumCulled = false;
    root.add(cone);
    return { handle, root, lines: [material], meshes: [coneMaterial], baseColor: color };
  }

  /** A scale axis (M6a): a line from the centre to a cube. */
  private scaleAxisVisual(handle: ManipHandle, color: string): HandleVisual {
    const root = new Group();
    const material = lineMaterial({ width: 2, vertexColors: false, color, depthTest: false });
    root.add(this.line([AXIS_START, 0, 0, AXIS_END - SCALE_CUBE, 0, 0], material));
    const cubeGeometry = new BoxGeometry(SCALE_CUBE, SCALE_CUBE, SCALE_CUBE);
    cubeGeometry.translate(AXIS_END - SCALE_CUBE / 2, 0, 0);
    const cubeMaterial = new MeshBasicMaterial({ color, depthTest: false, toneMapped: false });
    const cube = new Mesh(cubeGeometry, cubeMaterial);
    cube.frustumCulled = false;
    root.add(cube);
    return { handle, root, lines: [material], meshes: [cubeMaterial], baseColor: color };
  }

  /** The uniform scale handle (M6a): a cube at the centre. */
  private uniformVisual(): HandleVisual {
    const root = new Group();
    const size = 2 * UNIFORM_HALF;
    const material = new MeshBasicMaterial({ color: VIEWPORT_THEME.axisView, depthTest: false, toneMapped: false });
    const cube = new Mesh(new BoxGeometry(size, size, size), material);
    cube.frustumCulled = false;
    root.add(cube);
    return { handle: 'suniform', root, lines: [], meshes: [material], baseColor: VIEWPORT_THEME.axisView };
  }

  private planeVisual(handle: 'txy' | 'tyz' | 'txz', color: string): HandleVisual {
    const root = new Group();
    const size = PLANE_MAX - PLANE_MIN;
    const center = (PLANE_MIN + PLANE_MAX) / 2;
    const fillGeometry = new PlaneGeometry(size, size);
    fillGeometry.translate(center, center, 0);
    const fillMaterial = new MeshBasicMaterial({
      color,
      side: DoubleSide,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    const fill = new Mesh(fillGeometry, fillMaterial);
    fill.frustumCulled = false;
    root.add(fill);
    const a = PLANE_MIN;
    const b = PLANE_MAX;
    const material = lineMaterial({ width: 1.5, vertexColors: false, color, depthTest: false });
    root.add(this.line([a, a, 0, b, a, 0, b, a, 0, b, b, 0, b, b, 0, a, b, 0, a, b, 0, a, a, 0], material));
    return { handle, root, lines: [material], meshes: [fillMaterial], baseColor: color };
  }

  private centerVisual(): HandleVisual {
    const root = new Group();
    const h = CENTER_HALF;
    const material = lineMaterial({ width: 2, vertexColors: false, color: VIEWPORT_THEME.axisView, depthTest: false });
    root.add(this.line([-h, -h, 0, h, -h, 0, h, -h, 0, h, h, 0, h, h, 0, -h, h, 0, -h, h, 0, -h, -h, 0], material));
    return { handle: 'tview', root, lines: [material], meshes: [], baseColor: VIEWPORT_THEME.axisView };
  }

  private ringVisual(handle: ManipHandle, color: string, radius: number): HandleVisual {
    const root = new Group();
    const positions: number[] = [];
    for (let i = 0; i < RING_SEGMENTS; i++) {
      const a0 = (i / RING_SEGMENTS) * Math.PI * 2;
      const a1 = ((i + 1) / RING_SEGMENTS) * Math.PI * 2;
      positions.push(Math.cos(a0) * radius, Math.sin(a0) * radius, 0, Math.cos(a1) * radius, Math.sin(a1) * radius, 0);
    }
    // Axis rings are depth-tested against the occluder sphere, so only their front half shows (Maya look).
    const material = lineMaterial({ width: 2, vertexColors: false, color, depthTest: handle !== 'rview' });
    root.add(this.line(positions, material));
    return { handle, root, lines: [material], meshes: [], baseColor: color };
  }

  /** Front-half sample points of a ring in scene space (the view ring: all of it). */
  private ringPoints(handle: ManipHandle, camera: Camera, s: number): Vec3[] {
    const target = this.target as ManipTarget;
    const pivot = target.pivot;
    const radius = (handle === 'rview' ? VIEW_RING_RADIUS : RING_RADIUS) * s;
    const axis = this.ringAxis(handle, camera);
    const [e1, e2] = basisOf(axis, camera, handle === 'rview');
    const toViewer = viewerDirection(camera, pivot);
    const points: Vec3[] = [];
    for (let i = 0; i < RING_SEGMENTS; i++) {
      const a = (i / RING_SEGMENTS) * Math.PI * 2;
      const offset = add(scale(e1, Math.cos(a) * radius), scale(e2, Math.sin(a) * radius));
      if (handle !== 'rview' && dot(offset, toViewer) < -0.02 * radius) continue;
      points.push(add(pivot, offset));
    }
    return points;
  }

  /** A handle's outline in pane px as flat [x0, y0, x1, y1, …] segment pairs. */
  private screenPolyline(handle: ManipHandle, camera: Camera, projector: PaneProjector, s: number): number[] {
    const target = this.target as ManipTarget;
    const pivot = target.pivot;
    const out: number[] = [];
    const seg = [0, 0, 0, 0, 0, 0];
    const push = (a: ReadonlyVec3, b: ReadonlyVec3): void => {
      if (projector.projectSegment(a[0], a[1], a[2], b[0], b[1], b[2], seg)) {
        out.push(seg[0] as number, seg[1] as number, seg[3] as number, seg[4] as number);
      }
    };
    if (
      handle === 'tx' ||
      handle === 'ty' ||
      handle === 'tz' ||
      handle === 'sx' ||
      handle === 'sy' ||
      handle === 'sz'
    ) {
      const u = this.axesCache[axisIndex(handle)];
      push(add(pivot, scale(u, AXIS_START * s)), add(pivot, scale(u, AXIS_END * s)));
    } else if (handle === 'suniform') {
      const [e1, e2] = basisOf(this.ringAxis('rview', camera), camera, true);
      const h = UNIFORM_HALF * 1.2 * s;
      const c = [
        add(pivot, add(scale(e1, -h), scale(e2, -h))),
        add(pivot, add(scale(e1, h), scale(e2, -h))),
        add(pivot, add(scale(e1, h), scale(e2, h))),
        add(pivot, add(scale(e1, -h), scale(e2, h))),
      ];
      for (let i = 0; i < 4; i++) push(c[i] as Vec3, c[(i + 1) % 4] as Vec3);
    } else if (handle === 'txy' || handle === 'tyz' || handle === 'txz') {
      const corners = planeCorners(pivot, this.axesCache, PLANE_AXES[handle], s);
      for (let i = 0; i < 4; i++) push(corners[i] as Vec3, corners[(i + 1) % 4] as Vec3);
    } else if (handle === 'tview') {
      const [e1, e2] = basisOf(this.ringAxis('rview', camera), camera, true);
      const h = CENTER_HALF * s;
      const c = [
        add(pivot, add(scale(e1, -h), scale(e2, -h))),
        add(pivot, add(scale(e1, h), scale(e2, -h))),
        add(pivot, add(scale(e1, h), scale(e2, h))),
        add(pivot, add(scale(e1, -h), scale(e2, h))),
      ];
      for (let i = 0; i < 4; i++) push(c[i] as Vec3, c[(i + 1) % 4] as Vec3);
    } else {
      const points = this.ringPoints(handle, camera, s);
      const full = handle === 'rview';
      for (let i = 0; i + 1 < points.length; i++) push(points[i] as Vec3, points[i + 1] as Vec3);
      if (full && points.length > 2) push(points[points.length - 1] as Vec3, points[0] as Vec3);
    }
    return out;
  }

  /** Screen distance from a point to a handle; 0 inside a plane square or the centre square. */
  private handleDistance(
    handle: ManipHandle,
    camera: Camera,
    projector: PaneProjector,
    s: number,
    x: number,
    y: number,
  ): number {
    const poly = this.screenPolyline(handle, camera, projector, s);
    if (poly.length === 0) return Number.POSITIVE_INFINITY;
    const filled =
      handle === 'tview' || handle === 'suniform' || handle === 'txy' || handle === 'tyz' || handle === 'txz';
    if (filled && poly.length >= 16 && insideQuad(poly, x, y)) return 0;
    let best = Number.POSITIVE_INFINITY;
    const tmp = [0, 0];
    for (let i = 0; i + 3 < poly.length; i += 4) {
      best = Math.min(
        best,
        pointSegmentDistance(
          x,
          y,
          poly[i] as number,
          poly[i + 1] as number,
          poly[i + 2] as number,
          poly[i + 3] as number,
          tmp,
        ),
      );
    }
    return best;
  }
}

function axisIndex(handle: ManipHandle): 0 | 1 | 2 {
  return handle === 'tx' || handle === 'rx' || handle === 'sx'
    ? 0
    : handle === 'ty' || handle === 'ry' || handle === 'sy'
      ? 1
      : 2;
}

function planeCorners(
  pivot: ReadonlyVec3,
  axes: readonly Vec3[],
  plane: readonly [number, number, number],
  s: number,
): Vec3[] {
  const u = axes[plane[0]] as Vec3;
  const v = axes[plane[1]] as Vec3;
  const corner = (i: number, j: number): Vec3 => add(pivot, add(scale(u, i * s), scale(v, j * s)));
  return [
    corner(PLANE_MIN, PLANE_MIN),
    corner(PLANE_MAX, PLANE_MIN),
    corner(PLANE_MAX, PLANE_MAX),
    corner(PLANE_MIN, PLANE_MAX),
  ];
}

/** Two unit vectors spanning the plane ⟂ axis; for billboards the camera's right and up. */
function basisOf(axis: ReadonlyVec3, camera: Camera, billboard: boolean): [Vec3, Vec3] {
  if (billboard) {
    const e = camera.matrixWorld.elements;
    return [normalize([e[0], e[1], e[2]]), normalize([e[4], e[5], e[6]])];
  }
  const helper: Vec3 = Math.abs(axis[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const e1 = normalize(cross(axis, helper));
  return [e1, normalize(cross(axis, e1))];
}

/** Unit vector from the pivot towards the viewer (orthographic: against the view direction). */
function viewerDirection(camera: Camera, pivot: ReadonlyVec3): Vec3 {
  const e = camera.matrixWorld.elements;
  if (camera instanceof OrthographicCamera) return normalize([e[8], e[9], e[10]]);
  return normalize([e[12] - pivot[0], e[13] - pivot[1], e[14] - pivot[2]]);
}

/** Point-in-convex-quad test on the first 4 segment starts of a closed outline. */
function insideQuad(poly: readonly number[], x: number, y: number): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const o = i * 4;
    const ax = poly[o] as number;
    const ay = poly[o + 1] as number;
    const bx = poly[o + 2] as number;
    const by = poly[o + 3] as number;
    const c = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
    if (c === 0) continue;
    const s = c > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

function add(a: ReadonlyVec3, b: ReadonlyVec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function scale(a: ReadonlyVec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}

function dot(a: ReadonlyVec3, b: ReadonlyVec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function normalize(a: ReadonlyVec3): Vec3 {
  const len = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / len, a[1] / len, a[2] / len];
}
