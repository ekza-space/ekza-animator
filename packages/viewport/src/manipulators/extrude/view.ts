// Drawing of the extrude manipulator and of the Inset/Bevel value handle (M6A-SPEC §5.8, §5.9; B12b), in the lazy
// topology kit. The parts live in the main scene on the helpers layer (always drawn, depth test off, above the
// geometry) and place themselves per pane right before they draw (`onBeforeRender` sees that pane's camera and
// viewport), so one object serves N panes at a constant pixel size, like the W/E/R manipulator (B9's kit).
import type { Vec3 } from '@ekza-animator/anim-core';
import type { ExtrudeManipFrame } from '@ekza-animator/editor-core';
import {
  BoxGeometry,
  type BufferGeometry,
  type Camera,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  OrthographicCamera,
  PerspectiveCamera,
  TorusGeometry,
  Vector3,
  Vector4,
  type WebGLRenderer,
} from 'three';
import { LAYER } from '../../layers';
import { PaneProjector } from '../../picking/geometry';
import { VIEWPORT_THEME } from '../../theme';
import { EXTRUDE_LAYOUT, type ExtrudeHandle, worldPerPixel } from './geometry';

const AXIS_COLORS = [VIEWPORT_THEME.axisX, VIEWPORT_THEME.axisY, VIEWPORT_THEME.axisZ] as const;
const CENTRE_COLOR = '#5fd3d3';
const TOGGLE_LOCAL = '#e6e7ea';
const TOGGLE_WORLD = VIEWPORT_THEME.axisActive;
const RENDER_ORDER = 1000;
const VALUE_COLOR = '#ffb454';

interface Part {
  readonly handle: ExtrudeHandle | 'value';
  readonly mesh: Mesh;
  readonly material: MeshBasicMaterial;
  base: string;
  /** Placement in manipulator units within the frame. */
  readonly local: Matrix4;
  /** Which axes the part follows: the handle axes, the scale (cap) axes, or none (a billboard-free point). */
  readonly frame: 'axes' | 'scale';
}

/** Rotation taking +Y (cylinders, cones) to axis `i`. */
function alongAxis(i: 0 | 1 | 2): Matrix4 {
  if (i === 0) return new Matrix4().makeRotationZ(-Math.PI / 2);
  if (i === 2) return new Matrix4().makeRotationX(Math.PI / 2);
  return new Matrix4();
}

/** Rotation taking the torus normal (+Z) to axis `i`. */
function ringNormal(i: 0 | 1 | 2): Matrix4 {
  if (i === 0) return new Matrix4().makeRotationY(Math.PI / 2);
  if (i === 1) return new Matrix4().makeRotationX(-Math.PI / 2);
  return new Matrix4();
}

const offset = (i: 0 | 1 | 2, length: number): Matrix4 => {
  const v = new Vector3();
  v.setComponent(i, length);
  return new Matrix4().makeTranslation(v.x, v.y, v.z);
};

function material(color: string): MeshBasicMaterial {
  return new MeshBasicMaterial({ color, depthTest: false, depthWrite: false, transparent: true, toneMapped: false });
}

/** Shared per-pane placement: world units per manipulator unit for the pane being drawn. */
class PanePlacement {
  private readonly projector = new PaneProjector();
  private readonly viewport = new Vector4();

  scale(renderer: WebGLRenderer, camera: Camera, pivot: Vec3, sizePx: number): number {
    renderer.getCurrentViewport(this.viewport);
    const ratio = renderer.getPixelRatio() || 1;
    const width = this.viewport.z / ratio;
    const height = this.viewport.w / ratio;
    const near = camera instanceof PerspectiveCamera || camera instanceof OrthographicCamera ? camera.near : 0.01;
    this.projector.set(camera, width, height, near);
    return worldPerPixel(camera, height, this.projector, pivot) * sizePx;
  }
}

const basis = new Matrix4();
const scaleMatrix = new Matrix4();
const xAxis = new Vector3();
const yAxis = new Vector3();
const zAxis = new Vector3();

export class ExtrudeManipView {
  readonly root = new Group();
  private frame: ExtrudeManipFrame | null = null;
  private sizePx = 90;
  private hover: ExtrudeHandle | null = null;
  private active: ExtrudeHandle | null = null;
  private readonly parts: Part[] = [];
  private readonly placement = new PanePlacement();
  private readonly geometries: BufferGeometry[] = [];

  constructor() {
    this.root.name = 'ekza.extrudeManipulator';
    this.root.visible = false;
    this.root.matrixAutoUpdate = false;
    const L = EXTRUDE_LAYOUT;
    const shaftLength = L.axisEnd - L.cone - L.axisStart;
    const shaft = this.geometry(new CylinderGeometry(0.012, 0.012, shaftLength, 8));
    const cone = this.geometry(new ConeGeometry(0.045, L.cone, 16));
    const cube = this.geometry(new BoxGeometry(2 * L.scaleHalf, 2 * L.scaleHalf, 2 * L.scaleHalf));
    const centre = this.geometry(new BoxGeometry(2 * L.centreHalf, 2 * L.centreHalf, 2 * L.centreHalf));
    const toggle = this.geometry(new BoxGeometry(2 * L.toggleHalf, 2 * L.toggleHalf, 2 * L.toggleHalf));
    const ring = this.geometry(new TorusGeometry(L.ring, 0.01, 6, 72));
    for (const i of [0, 1, 2] as const) {
      const color = AXIS_COLORS[i];
      const t = (['tx', 'ty', 'tz'] as const)[i];
      this.add(t, shaft, color, offset(i, L.axisStart + shaftLength / 2).multiply(alongAxis(i)), 'axes');
      this.add(t, cone, color, offset(i, L.axisEnd - L.cone / 2).multiply(alongAxis(i)), 'axes');
      this.add((['sx', 'sy', 'sz'] as const)[i], cube, color, offset(i, L.scaleAt), 'scale');
      this.add((['rx', 'ry', 'rz'] as const)[i], ring, color, ringNormal(i), 'axes');
    }
    this.add('suniform', centre, CENTRE_COLOR, new Matrix4(), 'scale');
    this.add(
      'space',
      toggle,
      TOGGLE_LOCAL,
      new Matrix4().makeTranslation(L.toggle[0], L.toggle[1], L.toggle[2]),
      'axes',
    );
  }

  get visible(): boolean {
    return this.frame !== null;
  }

  get current(): ExtrudeManipFrame | null {
    return this.frame;
  }

  get size(): number {
    return this.sizePx;
  }

  /** Shows the manipulator on `frame` (null hides it). */
  set(frame: ExtrudeManipFrame | null, sizePx: number): void {
    this.frame = frame;
    this.sizePx = sizePx;
    this.root.visible = frame !== null;
    const toggle = this.parts.find((part) => part.handle === 'space');
    if (toggle !== undefined) toggle.base = frame?.space === 'world' ? TOGGLE_WORLD : TOGGLE_LOCAL;
    this.refreshStyles();
  }

  setHover(handle: ExtrudeHandle | null): boolean {
    if (handle === this.hover) return false;
    this.hover = handle;
    this.refreshStyles();
    return true;
  }

  setActive(handle: ExtrudeHandle | null): void {
    this.active = handle;
    this.refreshStyles();
  }

  dispose(): void {
    this.root.removeFromParent();
    for (const geometry of this.geometries) geometry.dispose();
    for (const part of this.parts) part.material.dispose();
  }

  private geometry<G extends BufferGeometry>(geometry: G): G {
    this.geometries.push(geometry);
    return geometry;
  }

  private add(
    handle: ExtrudeHandle,
    geometry: BufferGeometry,
    color: string,
    local: Matrix4,
    frame: Part['frame'],
  ): void {
    const mat = material(color);
    const mesh = new Mesh(geometry, mat);
    mesh.name = `extrude:${handle}`;
    mesh.layers.set(LAYER.helpers);
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = RENDER_ORDER + (handle === 'suniform' || handle === 'space' ? 2 : 1);
    const part: Part = { handle, mesh, material: mat, base: color, local, frame };
    mesh.onBeforeRender = (renderer, _scene, camera) => this.place(part, renderer, camera);
    this.parts.push(part);
    this.root.add(mesh);
  }

  private place(part: Part, renderer: WebGLRenderer, camera: Camera): void {
    const frame = this.frame;
    if (frame === null) return;
    const s = this.placement.scale(renderer, camera, frame.pivot, this.sizePx);
    const axes = part.frame === 'scale' ? frame.scaleAxes : frame.axes;
    xAxis.set(axes[0][0], axes[0][1], axes[0][2]);
    yAxis.set(axes[1][0], axes[1][1], axes[1][2]);
    zAxis.set(axes[2][0], axes[2][1], axes[2][2]);
    basis.makeBasis(xAxis, yAxis, zAxis).setPosition(frame.pivot[0], frame.pivot[1], frame.pivot[2]);
    scaleMatrix.makeScale(s, s, s);
    part.mesh.matrixWorld.copy(basis).multiply(scaleMatrix).multiply(part.local);
  }

  private refreshStyles(): void {
    for (const part of this.parts) {
      const highlighted = part.handle === this.active || (this.active === null && part.handle === this.hover);
      part.material.color.set(highlighted ? VIEWPORT_THEME.axisActive : part.base);
      part.material.opacity = this.active !== null && part.handle !== this.active ? 0.35 : 1;
    }
  }
}

/** The Inset/Bevel value handle (§5.9): a diamond at the result with an arrow along the pane's right direction. */
export class ValueHandleView {
  readonly root = new Group();
  private pivot: Vec3 | null = null;
  private sizePx = 90;
  private hot = false;
  private readonly placement = new PanePlacement();
  private readonly geometries: BufferGeometry[] = [];
  private readonly materials: MeshBasicMaterial[] = [];

  constructor() {
    this.root.name = 'ekza.valueHandle';
    this.root.visible = false;
    this.root.matrixAutoUpdate = false;
    const diamond = new OctahedronGeometry(0.07);
    const arrow = new ConeGeometry(0.04, 0.12, 12);
    const shaft = new CylinderGeometry(0.01, 0.01, 0.42, 6);
    this.geometries.push(diamond, arrow, shaft);
    // Pane-right arrow: the parts are placed in camera axes (x right, y up) at the pivot.
    this.part(diamond, new Matrix4());
    this.part(shaft, new Matrix4().makeTranslation(0.3, 0, 0).multiply(alongAxis(0)));
    this.part(arrow, new Matrix4().makeTranslation(0.57, 0, 0).multiply(alongAxis(0)));
  }

  get visible(): boolean {
    return this.pivot !== null;
  }

  get size(): number {
    return this.sizePx;
  }

  get at(): Vec3 | null {
    return this.pivot;
  }

  set(pivot: Vec3 | null, sizePx: number): void {
    this.pivot = pivot;
    this.sizePx = sizePx;
    this.root.visible = pivot !== null;
  }

  setHot(hot: boolean): boolean {
    if (hot === this.hot) return false;
    this.hot = hot;
    for (const m of this.materials) m.color.set(hot ? VIEWPORT_THEME.axisActive : VALUE_COLOR);
    return true;
  }

  dispose(): void {
    this.root.removeFromParent();
    for (const geometry of this.geometries) geometry.dispose();
    for (const m of this.materials) m.dispose();
  }

  private part(geometry: BufferGeometry, local: Matrix4): void {
    const mat = material(VALUE_COLOR);
    this.materials.push(mat);
    const mesh = new Mesh(geometry, mat);
    mesh.layers.set(LAYER.helpers);
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = RENDER_ORDER + 3;
    mesh.onBeforeRender = (renderer, _scene, camera) => {
      const pivot = this.pivot;
      if (pivot === null) return;
      const s = this.placement.scale(renderer, camera, pivot, this.sizePx);
      basis.extractRotation(camera.matrixWorld).setPosition(pivot[0], pivot[1], pivot[2]);
      scaleMatrix.makeScale(s, s, s);
      mesh.matrixWorld.copy(basis).multiply(scaleMatrix).multiply(local);
    };
    this.root.add(mesh);
  }
}

/** Value handle layout in manipulator units, along the pane's right direction from the pivot. */
export const VALUE_HANDLE = { diamond: 0.07, arrowEnd: 0.63 } as const;
