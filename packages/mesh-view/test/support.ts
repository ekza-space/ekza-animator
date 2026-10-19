// Browser-mode test kit for mesh-view: a real WebGL canvas (local Chrome with its GPU), the reference kernel's meshes
// with their triangulation and normals, fixed cameras, pixel reads and the colour arithmetic of the shaders.
import {
  type EditMesh,
  editMeshFrom,
  type MeshData,
  type Normals,
  primitive,
  setKernelDebug,
  type Triangulation,
  triangulate,
  computeNormals,
} from '@ekza-animator/mesh-core';
import {
  type Camera,
  Color,
  LinearSRGBColorSpace,
  Matrix4,
  OrthographicCamera,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import { LIGHT_RIG } from '../src/style';
import type { MeshPaneDisplay, MeshViewLayers, MeshViewTheme } from '../src/types';

// M6A-SPEC §3 rule 8: every test setup runs the kernel with its debug switch on.
setKernelDebug(true);

export const THEME: MeshViewTheme & { readonly clay: number } = {
  halo: 0x14151a,
  vertex: 0xd17bff,
  selected: 0xffa31a,
  hover: 0xffe58a,
  wire: 0x14151a,
  wireMode: 0xc8ccd4,
  hardEdge: 0x14151a,
  normalFace: 0x3fd1d9,
  normalVertex: 0xb18cff,
  faceFront: 0x56b4e9,
  faceBack: 0xe69f00,
  symPlane: 0x5cc8ff,
  lintNgon: 0xe3b34a,
  lintError: 0xef6b6b,
  soft: [0xffd84d, 0xff8a3d, 0xd9363e, 0x4a1a1e],
  clay: 0x6e7179,
};
export const LAYERS: MeshViewLayers = { surface: 1, components: 6, normals: 7, lint: 8, helpers: 9 };

/** The Model defaults of a shaded pane (§4.6 DisplayFlags), as a `MeshPaneDisplay`. */
export const DISPLAY: MeshPaneDisplay = {
  shading: 'shaded',
  wireOnShaded: false,
  flat: false,
  cull: false,
  xray: false,
  components: true,
  normals: 'off',
  faceOrientation: false,
  triangulation: false,
  hardEdges: false,
  meshCheck: false,
  symmetryPlane: true,
  dimmed: false,
};

export const BACKGROUND = 0x202020;

export interface Derived {
  readonly data: MeshData;
  readonly mesh: EditMesh;
  readonly tri: Triangulation;
  readonly normals: Normals;
}

export function derived(data: MeshData): Derived {
  const mesh = editMeshFrom(data);
  return { data, mesh, tri: triangulate(mesh), normals: computeNormals(mesh) };
}

export function cube(params: Readonly<Record<string, number>> = {}): Derived {
  return derived(primitive('cube', params));
}

export function plane(params: Readonly<Record<string, number>> = {}): Derived {
  return derived(primitive('plane', params));
}

export const IDENTITY = new Float64Array(new Matrix4().elements);

export function matrixOf(m: Matrix4): Float64Array {
  return new Float64Array(m.elements);
}

export interface Canvas {
  readonly renderer: WebGLRenderer;
  readonly scene: Scene;
  readonly width: number;
  readonly height: number;
  render(camera: Camera): void;
  /** sRGB bytes at CSS pixel (x, y), top-left origin, read right after a render. */
  pixel(x: number, y: number): [number, number, number, number];
  dispose(): void;
}

export function canvas(width = 400, height = 300): Canvas {
  const element = document.createElement('canvas');
  Object.assign(element.style, {
    position: 'fixed',
    left: '0px',
    top: '0px',
    width: `${width}px`,
    height: `${height}px`,
  });
  document.body.append(element);
  const renderer = new WebGLRenderer({ canvas: element, antialias: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  renderer.setClearColor(BACKGROUND, 1);
  const scene = new Scene();
  const gl = renderer.getContext();
  const out = new Uint8Array(4);
  return {
    renderer,
    scene,
    width,
    height,
    render(camera) {
      renderer.setViewport(0, 0, width, height);
      renderer.render(scene, camera);
    },
    pixel(x, y) {
      gl.readPixels(Math.floor(x), height - 1 - Math.floor(y), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
      return [out[0] as number, out[1] as number, out[2] as number, out[3] as number];
    },
    dispose() {
      renderer.dispose();
      element.remove();
    },
  };
}

/** A camera that sees every layer the views use. */
export function seeAll<C extends Camera>(camera: C): C {
  camera.layers.enableAll();
  camera.updateMatrixWorld();
  return camera;
}

/** Perspective camera at `eye` looking at the origin. */
export function perspective(eye: readonly [number, number, number], aspect = 4 / 3, fov = 40): PerspectiveCamera {
  const camera = new PerspectiveCamera(fov, aspect, 0.05, 100);
  camera.position.set(...eye);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  return seeAll(camera);
}

/** Orthographic front camera (looking along −Z) showing `height` metres. */
export function orthoFront(height = 2, aspect = 4 / 3): OrthographicCamera {
  const camera = new OrthographicCamera(
    (-height * aspect) / 2,
    (height * aspect) / 2,
    height / 2,
    -height / 2,
    0.05,
    100,
  );
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  return seeAll(camera);
}

/** Orthographic top camera (looking along −Y, +X right, −Z up on screen). */
export function orthoTop(height = 2, aspect = 4 / 3): OrthographicCamera {
  const camera = new OrthographicCamera(
    (-height * aspect) / 2,
    (height * aspect) / 2,
    height / 2,
    -height / 2,
    0.05,
    100,
  );
  camera.position.set(0, 10, 0);
  camera.up.set(0, 0, -1);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  return seeAll(camera);
}

/** Screen point (CSS px, top-left origin) of world point `p`. */
export function screen(camera: Camera, p: readonly [number, number, number], w: number, h: number): [number, number] {
  const v = new Vector3(...p).project(camera);
  return [((v.x + 1) / 2) * w, ((1 - v.y) / 2) * h];
}

/** NDC of a CSS pixel. */
export function ndc(x: number, y: number, w: number, h: number): [number, number] {
  return [(x / w) * 2 - 1, 1 - (y / h) * 2];
}

/** Local position of vertex v. */
export function vertexOf(d: Derived, v: number): [number, number, number] {
  const p = d.mesh.position;
  return [p[3 * v] as number, p[3 * v + 1] as number, p[3 * v + 2] as number];
}

/** Vertex average of face f. */
export function centroidOf(d: Derived, f: number): [number, number, number] {
  const m = d.mesh;
  const out: [number, number, number] = [0, 0, 0];
  const start = m.faceCorner(f);
  let c = start;
  let n = 0;
  do {
    const p = vertexOf(d, m.cornerVert(c));
    out[0] += p[0];
    out[1] += p[1];
    out[2] += p[2];
    n++;
    c = m.cornerNext(c);
  } while (c !== start);
  return [out[0] / n, out[1] / n, out[2] / n];
}

/** The face whose Newell normal is closest to `dir` (local). */
export function faceFacing(d: Derived, dir: readonly [number, number, number]): number {
  let best = -1;
  let bestDot = -Infinity;
  for (let f = 0; f < d.mesh.counts.faces; f++) {
    const n = [d.normals.face[3 * f], d.normals.face[3 * f + 1], d.normals.face[3 * f + 2]] as number[];
    const dot = (n[0] as number) * dir[0] + (n[1] as number) * dir[1] + (n[2] as number) * dir[2];
    if (dot > bestDot) {
      bestDot = dot;
      best = f;
    }
  }
  return best;
}

/** The vertex nearest `p`. */
export function vertexAt(d: Derived, p: readonly [number, number, number]): number {
  let best = -1;
  let bestD = Infinity;
  for (let v = 0; v < d.mesh.counts.points; v++) {
    const q = vertexOf(d, v);
    const dd = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 + (q[2] - p[2]) ** 2;
    if (dd < bestD) {
      bestD = dd;
      best = v;
    }
  }
  return best;
}

/** The edge between two vertices (−1 none). */
export function edgeBetween(d: Derived, a: number, b: number): number {
  return d.mesh.findEdge(a, b);
}

// ---------- colour arithmetic of the shaders ----------

/** Linear-light RGB of a theme colour. */
export function linear(hex: number): [number, number, number] {
  const c = new Color(hex);
  return [c.r, c.g, c.b];
}

export function mix(a: readonly number[], b: readonly number[], t: number): [number, number, number] {
  return [0, 1, 2].map((i) => (a[i] as number) * (1 - t) + (b[i] as number) * t) as [number, number, number];
}

export function scale(a: readonly number[], k: number): [number, number, number] {
  return [(a[0] as number) * k, (a[1] as number) * k, (a[2] as number) * k];
}

/** sRGB bytes of a linear-light colour (what the colour-space chunk writes). */
export function bytes(rgb: readonly number[]): [number, number, number] {
  const c = new Color().setRGB(rgb[0] as number, rgb[1] as number, rgb[2] as number, LinearSRGBColorSpace);
  const out = { r: 0, g: 0, b: 0 };
  c.getRGB(out, SRGBColorSpace);
  return [Math.round(out.r * 255), Math.round(out.g * 255), Math.round(out.b * 255)];
}

export function hexBytes(hex: number): [number, number, number] {
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
}

/** The rig's light factor for a view-space normal (front-facing). */
export function light(n: readonly [number, number, number]): number {
  const dot = (d: readonly number[]): number => {
    const len = Math.hypot(d[0] as number, d[1] as number, d[2] as number);
    return Math.max(0, (n[0] * (d[0] as number) + n[1] * (d[1] as number) + n[2] * (d[2] as number)) / len);
  };
  return LIGHT_RIG.ambient + LIGHT_RIG.key * dot(LIGHT_RIG.keyDir) + LIGHT_RIG.fill * dot(LIGHT_RIG.fillDir);
}

export function expectClose(actual: readonly number[], expected: readonly number[], tolerance = 3): void {
  for (let i = 0; i < 3; i++) {
    if (Math.abs((actual[i] as number) - (expected[i] as number)) > tolerance) {
      throw new Error(
        `colour ${JSON.stringify(actual.slice(0, 3))} is not within ${tolerance} of ${JSON.stringify(expected)}`,
      );
    }
  }
}

/** A deterministic PRNG (mulberry32) for randomized checks. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
