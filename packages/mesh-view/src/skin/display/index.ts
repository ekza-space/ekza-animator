// The weight display of a bound mesh in Skin mode (M6B-SPEC §5.12, §8.3; C6): greyscale (`--weight-0` black →
// `--weight-1` white, Maya's colour feedback), a colour-blind-safe ramp (`--weight-ramp-0…4`) or influence colours
// (each joint its golden-angle hue, the vertex colour `Σ w_i·c_i`), with the clay light rig's shading; unweighted points
// read `--danger`.
//
// It is a second draw of the `SkinnedSurface`'s geometry (the posed positions and the `skinIndex`/`skinWeight`
// attributes C1 uploads per corner) with its own material, added to the surface's root just in front of it. The shader
// reads the active influence's weight as `w = dot(skinWeight, vec4(equal(skinIndex, vec4(uActive))))`, so switching the
// active influence or the mode changes uniforms only: no buffer upload (0 bytes, the §5.25 gate) and no program
// recompile. Weight edits reach it through the surface's partial `skinWeight` uploads.
import { BufferGeometry, Color, DoubleSide, type IUniform, Mesh, type Object3D, ShaderMaterial, Vector3 } from 'three';
import { LIGHT_RIG } from '../../style';

export type WeightDisplayMode = 'off' | 'greyscale' | 'ramp' | 'influences';

/** The colours of the display (sRGB hex), defaults = the §8.14 tokens. */
export interface WeightDisplayColors {
  readonly weight0: number;
  readonly weight1: number;
  readonly ramp: readonly [number, number, number, number, number];
  readonly danger: number;
}

export const DEFAULT_WEIGHT_COLORS: WeightDisplayColors = {
  weight0: 0x000000,
  weight1: 0xffffff,
  ramp: [0x2d1b4e, 0x6a2c70, 0xc2410c, 0xf59e0b, 0xfde68a],
  danger: 0xef6b6b,
};

/** Bones the influence-colour table holds (VRM humanoids have ≤ 64 mapped bones; generic rigs share colours). */
export const MAX_DISPLAY_BONES = 128;

const MODE_CODE: Readonly<Record<WeightDisplayMode, number>> = { off: 0, greyscale: 0, ramp: 1, influences: 2 };

const f = (x: number): string => (Number.isInteger(x) ? `${x}.0` : `${x}`);
const v3 = (v: readonly number[]): string => `vec3(${v.map(f).join(', ')})`;

const VERTEX = `
attribute vec4 skinIndex;
attribute vec4 skinWeight;
uniform float uActive;
uniform vec3 uBones[${MAX_DISPLAY_BONES}];
varying vec3 vNormal;
varying float vWeight;
varying float vTotal;
varying vec3 vInfluence;
vec3 boneColor(float index) {
  int i = int(index + 0.5);
  return i >= 0 && i < ${MAX_DISPLAY_BONES} ? uBones[i] : vec3(0.5);
}
void main() {
  vNormal = normalize(normalMatrix * normal);
  vWeight = dot(skinWeight, vec4(equal(skinIndex, vec4(uActive))));
  vTotal = skinWeight.x + skinWeight.y + skinWeight.z + skinWeight.w;
  vInfluence = skinWeight.x * boneColor(skinIndex.x) + skinWeight.y * boneColor(skinIndex.y)
    + skinWeight.z * boneColor(skinIndex.z) + skinWeight.w * boneColor(skinIndex.w);
  vec4 view = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * view;
}
`;

const FRAGMENT = `
uniform int uMode;
uniform vec3 uWeight0;
uniform vec3 uWeight1;
uniform vec3 uRamp[5];
uniform vec3 uDanger;
varying vec3 vNormal;
varying float vWeight;
varying float vTotal;
varying vec3 vInfluence;
vec3 ramp(float w) {
  float x = clamp(w, 0.0, 1.0) * 4.0;
  if (x < 1.0) return mix(uRamp[0], uRamp[1], x);
  if (x < 2.0) return mix(uRamp[1], uRamp[2], x - 1.0);
  if (x < 3.0) return mix(uRamp[2], uRamp[3], x - 2.0);
  return mix(uRamp[3], uRamp[4], x - 3.0);
}
void main() {
  vec3 n = normalize(vNormal);
  if (!gl_FrontFacing) n = -n;
  float key = max(dot(n, normalize(${v3(LIGHT_RIG.keyDir)})), 0.0);
  float fill = max(dot(n, normalize(${v3(LIGHT_RIG.fillDir)})), 0.0);
  float light = 0.62 + 0.3 * key + 0.08 * fill;
  vec3 base;
  if (vTotal < 0.5) base = uDanger;
  else if (uMode == 1) base = ramp(vWeight);
  else if (uMode == 2) base = vInfluence;
  else base = mix(uWeight0, uWeight1, clamp(vWeight, 0.0, 1.0));
  gl_FragColor = vec4(base * light, 1.0);
  #include <colorspace_fragment>
}
`;

/** The golden-angle hue of a joint by its topological index (§5.12 influence colours), in the linear working space. */
export function influenceColor(index: number): [number, number, number] {
  const hue = (index * 137.508) % 360;
  const c = new Color().setHSL(hue / 360, 0.65, 0.55);
  return [c.r, c.g, c.b];
}

/** The weight display of one skinned surface (attach to the `SkinnedSurface`'s root). */
export class WeightDisplay {
  readonly material: ShaderMaterial;
  private mesh: Mesh | null = null;
  private source: Mesh | null = null;
  private mode: WeightDisplayMode = 'off';
  private active = -1;
  private readonly uniforms: Record<string, IUniform>;
  /** Times the display changed a buffer (it never does; the gate reads it with the surface's own counter). */
  readonly uploadedBytes = 0;

  constructor(
    private readonly root: Object3D,
    colors: WeightDisplayColors = DEFAULT_WEIGHT_COLORS,
  ) {
    const bones = Array.from({ length: MAX_DISPLAY_BONES }, (_, i) => new Vector3(...influenceColor(i)));
    this.uniforms = {
      uActive: { value: -1 },
      uMode: { value: 0 },
      uBones: { value: bones },
      uWeight0: { value: new Color(colors.weight0) },
      uWeight1: { value: new Color(colors.weight1) },
      uRamp: { value: colors.ramp.map((c) => new Color(c)) },
      uDanger: { value: new Color(colors.danger) },
    };
    this.material = new ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      side: DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -4,
      toneMapped: false,
    });
  }

  /** The surface draw this display follows: the mesh under the root whose geometry carries `skinWeight`. */
  private findSource(): Mesh | null {
    let found: Mesh | null = null;
    this.root.traverse((object) => {
      if (found !== null || object === this.mesh) return;
      const mesh = object as Mesh;
      // The colour draw (the x-ray depth pre-pass shares the geometry but writes no colour).
      const material = mesh.material as { colorWrite?: boolean } | undefined;
      if (
        mesh.isMesh === true &&
        mesh.geometry instanceof BufferGeometry &&
        mesh.geometry.getAttribute('skinWeight') !== undefined &&
        material?.colorWrite !== false
      ) {
        found = mesh;
      }
    });
    return found;
  }

  /** Re-finds the surface's draw (after a rebuild replaced its attributes) and keeps the overlay on it. */
  sync(): void {
    const source = this.findSource();
    if (source === null) {
      if (this.mesh !== null) this.mesh.visible = false;
      return;
    }
    if (this.mesh === null || this.source !== source) {
      this.mesh?.removeFromParent();
      const mesh = new Mesh(source.geometry, this.material);
      mesh.layers.mask = source.layers.mask;
      mesh.renderOrder = source.renderOrder + 0.5;
      mesh.frustumCulled = false;
      mesh.matrixAutoUpdate = false;
      mesh.raycast = () => {};
      source.parent?.add(mesh);
      this.mesh = mesh;
      this.source = source;
    }
    this.mesh.matrix.copy(source.matrix);
    this.mesh.matrixWorldNeedsUpdate = true;
    this.mesh.visible = this.mode !== 'off' && source.visible;
  }

  /**
   * The mode and the active influence's bone index (−1 for none): uniforms only (0 bytes, no recompile). Returns
   * true when anything changed (the caller redraws).
   */
  set(mode: WeightDisplayMode, active: number): boolean {
    const changed = mode !== this.mode || active !== this.active;
    this.mode = mode;
    this.active = active;
    (this.uniforms['uMode'] as IUniform<number>).value = MODE_CODE[mode];
    (this.uniforms['uActive'] as IUniform<number>).value = active;
    this.material.uniformsNeedUpdate = true;
    this.sync();
    return changed;
  }

  /** Influence colours per bone index (linear 0…1, as `influenceColor` gives them); bones beyond the table keep their golden-angle hue. */
  setBoneColors(colors: ReadonlyMap<number, readonly [number, number, number]>): void {
    const bones = (this.uniforms['uBones'] as IUniform<Vector3[]>).value;
    for (const [bone, rgb] of colors) bones[bone]?.set(rgb[0], rgb[1], rgb[2]);
    this.material.uniformsNeedUpdate = true;
  }

  get state(): { readonly mode: WeightDisplayMode; readonly active: number; readonly visible: boolean } {
    return { mode: this.mode, active: this.active, visible: this.mesh?.visible === true };
  }

  dispose(): void {
    this.mesh?.removeFromParent();
    this.mesh = null;
    this.source = null;
    this.material.dispose();
  }
}
