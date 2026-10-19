// A batch of point glyphs at constant pixel size with a halo (shaders.ts) and an optional occluded pass for x-ray:
// vertices, face dots and Mesh Check markers. Per-glyph position, state byte and soft-selection weight.
import {
  BufferAttribute,
  BufferGeometry,
  type Camera,
  Color,
  GreaterDepth,
  type IUniform,
  LessEqualDepth,
  type Object3D,
  Points,
  ShaderMaterial,
  type WebGLRenderer,
} from 'three';
import { MESH_VIEW_STYLE } from '../style';
import { GLYPH_FRAGMENT, GLYPH_VERTEX } from './shaders';

/** Glyph shapes (`uShape` / `uAltShape`). */
export const SHAPE = { square: 0, diamond: 1, cross: 2 } as const;

export class GlyphBatch {
  readonly visible: Points;
  readonly occluded: Points;
  readonly uniforms: Record<string, IUniform>;
  private geometry: BufferGeometry;
  position: BufferAttribute;
  state: BufferAttribute;
  soft: BufferAttribute;

  constructor(opts: {
    readonly layer: number;
    readonly order: number;
    readonly occludedOrder: number;
    readonly size: number;
    readonly sizeHot: number;
    readonly shape: number;
    readonly altShape?: number;
    readonly halo: number;
    readonly mirroredMix: number;
    readonly soft: readonly [number, number, number, number];
  }) {
    this.uniforms = {
      uPixelRatio: { value: 1 },
      uHalo: { value: MESH_VIEW_STYLE.haloPx },
      uSize: { value: opts.size },
      uSizeHot: { value: opts.sizeHot },
      uDepthBias: { value: MESH_VIEW_STYLE.glyphDepthBias },
      uShowState: { value: false },
      uShowSoft: { value: false },
      uShape: { value: opts.shape },
      uAltShape: { value: opts.altShape ?? opts.shape },
      uBase: { value: new Color() },
      uAltColour: { value: new Color() },
      uSelected: { value: new Color() },
      uHover: { value: new Color() },
      uHaloColour: { value: new Color(opts.halo) },
      uMirroredMix: { value: opts.mirroredMix },
      uSoft: { value: opts.soft.map((c) => new Color(c)) },
    };
    this.geometry = new BufferGeometry();
    this.position = new BufferAttribute(new Float32Array(0), 3);
    this.state = new BufferAttribute(new Uint8Array(0), 1);
    this.soft = new BufferAttribute(new Uint8Array(0), 1, true);
    const material = (alpha: number, occluded: boolean): ShaderMaterial =>
      new ShaderMaterial({
        uniforms: { ...this.uniforms, uAlpha: { value: alpha } },
        vertexShader: GLYPH_VERTEX,
        fragmentShader: GLYPH_FRAGMENT,
        transparent: true,
        depthWrite: false,
        depthFunc: occluded ? GreaterDepth : LessEqualDepth,
        toneMapped: false,
      });
    this.visible = this.object(material(1, false), opts.layer, opts.order);
    this.occluded = this.object(material(MESH_VIEW_STYLE.occludedAlpha, true), opts.layer, opts.occludedOrder);
    this.occluded.visible = false;
    this.setGeometry(0);
  }

  private object(material: ShaderMaterial, layer: number, order: number): Points {
    const points = new Points(this.geometry, material);
    points.layers.set(layer);
    points.renderOrder = order;
    points.frustumCulled = false;
    points.matrixAutoUpdate = false;
    points.raycast = () => {};
    points.onBeforeRender = (renderer: WebGLRenderer, _scene: Object3D, _camera: Camera) => {
      (this.uniforms['uPixelRatio'] as IUniform<number>).value = renderer.getPixelRatio();
      points.material.uniformsNeedUpdate = true;
    };
    return points;
  }

  /** Reallocates for `count` glyphs (positions zero, state 0, soft 0). */
  setGeometry(count: number): void {
    const old = this.geometry;
    const geometry = new BufferGeometry();
    this.position = new BufferAttribute(new Float32Array(3 * count), 3);
    this.state = new BufferAttribute(new Uint8Array(count), 1);
    this.soft = new BufferAttribute(new Uint8Array(count), 1, true);
    geometry.setAttribute('position', this.position);
    geometry.setAttribute('state', this.state);
    geometry.setAttribute('soft', this.soft);
    this.geometry = geometry;
    this.visible.geometry = geometry;
    this.occluded.geometry = geometry;
    old.dispose();
  }

  get count(): number {
    return this.state.count;
  }

  setColours(base: number, alt: number, selected: number, hover: number): void {
    const u = this.uniforms;
    (u['uBase'] as IUniform<Color>).value.set(base);
    (u['uAltColour'] as IUniform<Color>).value.set(alt);
    (u['uSelected'] as IUniform<Color>).value.set(selected);
    (u['uHover'] as IUniform<Color>).value.set(hover);
    this.touchUniforms();
  }

  setUniform(name: string, value: number | boolean): void {
    (this.uniforms[name] as IUniform<number | boolean>).value = value;
    this.touchUniforms();
  }

  setAlpha(visible: number, occluded: number): void {
    ((this.visible.material as ShaderMaterial).uniforms['uAlpha'] as IUniform<number>).value = visible;
    ((this.occluded.material as ShaderMaterial).uniforms['uAlpha'] as IUniform<number>).value = occluded;
    this.touchUniforms();
  }

  touchUniforms(): void {
    (this.visible.material as ShaderMaterial).uniformsNeedUpdate = true;
    (this.occluded.material as ShaderMaterial).uniformsNeedUpdate = true;
  }

  show(on: boolean, xray: boolean): void {
    this.visible.visible = on && this.count > 0;
    this.occluded.visible = on && xray && this.count > 0;
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
