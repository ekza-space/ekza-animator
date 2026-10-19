// A batch of screen-space lines (instanced quads, shaders.ts) with an optional occluded pass for x-ray: edges, normals,
// triangulation diagonals and the symmetry plane outline. Per-segment endpoints and a state byte; widths and colours
// are uniforms set per pane.
import {
  BufferAttribute,
  type Camera,
  Color,
  GreaterDepth,
  type IUniform,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  LessEqualDepth,
  Mesh,
  type Object3D,
  ShaderMaterial,
  Vector4,
  type WebGLRenderer,
} from 'three';
import { MESH_VIEW_STYLE } from '../style';
import { LINE_FRAGMENT, LINE_VERTEX } from './shaders';

const viewport = new Vector4();

export interface LineStyle {
  readonly width: number;
  readonly widthHard: number;
  readonly widthHot: number;
}

export class LineBatch {
  readonly visible: Mesh;
  readonly occluded: Mesh;
  readonly uniforms: Record<string, IUniform>;
  private geometry: InstancedBufferGeometry;
  start: InstancedBufferAttribute;
  end: InstancedBufferAttribute;
  state: InstancedBufferAttribute;

  constructor(opts: {
    readonly layer: number;
    readonly order: number;
    readonly occludedOrder: number;
    readonly style: LineStyle;
    readonly halo: number;
    readonly mirroredMix: number;
  }) {
    this.uniforms = {
      uViewport: { value: new Vector4(0, 0, 1, 1) },
      uPixelRatio: { value: 1 },
      uHalo: { value: MESH_VIEW_STYLE.haloPx },
      uWidth: { value: opts.style.width },
      uWidthHard: { value: opts.style.widthHard },
      uWidthHot: { value: opts.style.widthHot },
      uShowHard: { value: false },
      uOnlyHard: { value: false },
      uShowState: { value: false },
      uBase: { value: new Color() },
      uHard: { value: new Color() },
      uSelected: { value: new Color() },
      uHover: { value: new Color() },
      uHaloColour: { value: new Color(opts.halo) },
      uMirroredMix: { value: opts.mirroredMix },
    };
    this.geometry = new InstancedBufferGeometry();
    this.start = new InstancedBufferAttribute(new Float32Array(0), 3);
    this.end = new InstancedBufferAttribute(new Float32Array(0), 3);
    this.state = new InstancedBufferAttribute(new Uint8Array(0), 1);
    this.setGeometry(0);
    const material = (alpha: number, occluded: boolean): ShaderMaterial =>
      new ShaderMaterial({
        uniforms: { ...this.uniforms, uAlpha: { value: alpha } },
        vertexShader: LINE_VERTEX,
        fragmentShader: LINE_FRAGMENT,
        transparent: true,
        depthWrite: false,
        depthFunc: occluded ? GreaterDepth : LessEqualDepth,
        toneMapped: false,
      });
    this.visible = this.object(material(1, false), opts.layer, opts.order);
    this.occluded = this.object(material(MESH_VIEW_STYLE.occludedAlpha, true), opts.layer, opts.occludedOrder);
    this.occluded.visible = false;
  }

  private object(material: ShaderMaterial, layer: number, order: number): Mesh {
    const mesh = new Mesh(this.geometry, material);
    mesh.layers.set(layer);
    mesh.renderOrder = order;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.raycast = () => {};
    mesh.onBeforeRender = (renderer: WebGLRenderer, _scene: Object3D, _camera: Camera) => {
      renderer.getCurrentViewport(viewport);
      (this.uniforms['uViewport'] as IUniform<Vector4>).value.copy(viewport);
      (this.uniforms['uPixelRatio'] as IUniform<number>).value = renderer.getPixelRatio();
      mesh.material.uniformsNeedUpdate = true;
    };
    return mesh;
  }

  /** Reallocates for `count` segments (contents zero). */
  setGeometry(count: number): void {
    const old = this.geometry;
    const geometry = new InstancedBufferGeometry();
    // Unit quad: x 0/1 = start/end, y −1/1 = side.
    geometry.setAttribute('position', new BufferAttribute(new Float32Array([0, -1, 0, 0, 1, 0, 1, -1, 0, 1, 1, 0]), 3));
    geometry.setIndex([0, 2, 1, 1, 2, 3]);
    this.start = new InstancedBufferAttribute(new Float32Array(3 * count), 3);
    this.end = new InstancedBufferAttribute(new Float32Array(3 * count), 3);
    this.state = new InstancedBufferAttribute(new Uint8Array(count), 1);
    geometry.setAttribute('instanceStart', this.start);
    geometry.setAttribute('instanceEnd', this.end);
    geometry.setAttribute('instanceState', this.state);
    geometry.instanceCount = count;
    this.geometry = geometry;
    if (this.visible !== undefined) {
      this.visible.geometry = geometry;
      this.occluded.geometry = geometry;
    }
    old.dispose();
  }

  get count(): number {
    return this.geometry.instanceCount;
  }

  setColours(base: number | Color, hard: number, selected: number, hover: number): void {
    const u = this.uniforms;
    (u['uBase'] as IUniform<Color>).value.set(base);
    (u['uHard'] as IUniform<Color>).value.set(hard);
    (u['uSelected'] as IUniform<Color>).value.set(selected);
    (u['uHover'] as IUniform<Color>).value.set(hover);
    this.touchUniforms();
  }

  /** Alpha of the visible pass and of the occluded (x-ray) pass. */
  setAlpha(visible: number, occluded: number): void {
    ((this.visible.material as ShaderMaterial).uniforms['uAlpha'] as IUniform<number>).value = visible;
    ((this.occluded.material as ShaderMaterial).uniforms['uAlpha'] as IUniform<number>).value = occluded;
    this.touchUniforms();
  }

  setUniform(name: string, value: number | boolean): void {
    (this.uniforms[name] as IUniform<number | boolean>).value = value;
    this.touchUniforms();
  }

  touchUniforms(): void {
    (this.visible.material as ShaderMaterial).uniformsNeedUpdate = true;
    (this.occluded.material as ShaderMaterial).uniformsNeedUpdate = true;
  }

  /** Shows the batch (and its occluded pass when `xray`). */
  show(on: boolean, xray: boolean): void {
    this.visible.visible = on;
    this.occluded.visible = on && xray;
  }

  addTo(parent: Object3D): void {
    parent.add(this.occluded, this.visible);
  }

  dispose(): void {
    this.geometry.dispose();
    (this.visible.material as ShaderMaterial).dispose();
    (this.occluded.material as ShaderMaterial).dispose();
    this.visible.removeFromParent();
    this.occluded.removeFromParent();
  }
}
