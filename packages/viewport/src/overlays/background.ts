// Pane backdrop (research 09 §8.2 `--viewport-top` → `--viewport-bottom`) and the floor grid.
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  GridHelper,
  type Material,
  Mesh,
  OrthographicCamera,
  Scene,
  ShaderMaterial,
} from 'three';
import { LAYER } from '../layers';
import { VIEWPORT_THEME } from '../theme';

/** A full-pane gradient drawn first in every pane (no depth). */
export class Backdrop {
  readonly scene = new Scene();
  readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly material: ShaderMaterial;
  private readonly mesh: Mesh;

  constructor() {
    const geometry = new BufferGeometry();
    // One triangle covering clip space: (-1,-1), (3,-1), (-1,3).
    geometry.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.material = new ShaderMaterial({
      uniforms: {
        top: { value: new Color(VIEWPORT_THEME.viewportTop) },
        bottom: { value: new Color(VIEWPORT_THEME.viewportBottom) },
      },
      vertexShader: /* glsl */ `
        varying float vY;
        void main() {
          vY = position.y * 0.5 + 0.5;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 top;
        uniform vec3 bottom;
        varying float vY;
        void main() {
          gl_FragColor = vec4(mix(bottom, top, clamp(vY, 0.0, 1.0)), 1.0);
          #include <colorspace_fragment>
        }`,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.mesh = new Mesh(geometry, this.material);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
    this.scene.matrixWorldAutoUpdate = false;
    this.scene.updateMatrixWorld(true);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

/** 10 m floor grid, 1 m cells, on the grid layer. */
export function createGrid(): GridHelper {
  const grid = new GridHelper(10, 10, VIEWPORT_THEME.gridMajor, VIEWPORT_THEME.gridMinor);
  grid.name = 'ekza.grid';
  grid.layers.set(LAYER.grid);
  const material = grid.material as Material | Material[];
  for (const m of Array.isArray(material) ? material : [material]) m.toneMapped = false;
  return grid;
}
