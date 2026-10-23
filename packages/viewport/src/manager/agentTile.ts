// M-AI (MCP-SPEC §4.3, §5.15.3; MVP cut §0.4.1 item 5): one offscreen tile of `view_capture` — the shared renderer
// draws the main scene's lights and meshes (and the floor grid on request) from a temporary camera into its own
// render target, with the character posed for the tile through the agent host, and reads the pixels back in the same
// task. It never touches a pane, a pane camera, the session or the playhead; manipulators, controls, selection,
// helpers and the HUD live on other layers or scenes and stay out. The renderer's target, viewport, scissor and clear
// colour are restored afterwards, so the next editor frame shows exactly what it showed before. A lazy chunk: only
// the editor's capture service (in the agent module) imports it.
import type { CharacterId } from '@ekza-studio/doc';
import {
  Color,
  type Camera,
  OrthographicCamera,
  PerspectiveCamera,
  Quaternion,
  Vector3,
  Vector4,
  WebGLRenderTarget,
} from 'three';
import { LAYER } from '../layers';
import { VIEWPORT_THEME } from '../theme';
import type { CameraSnapshot } from '../types';
import type { ViewportAgentHost } from './ViewportManager';

/** A tile camera in scene (world) space: a look-at camera, or a snapshot of a pane camera (`view: 'user'`). */
export type AgentTileCamera =
  | {
      readonly kind: 'look';
      readonly projection: 'perspective' | 'orthographic';
      readonly position: readonly [number, number, number];
      readonly target: readonly [number, number, number];
      readonly up: readonly [number, number, number];
      readonly fovYDeg: number;
      readonly orthoHeightM: number;
    }
  | { readonly kind: 'snapshot'; readonly snapshot: CameraSnapshot };

export interface AgentTileRequest {
  readonly character: CharacterId;
  /** Bone worlds to pose the character with (canonical character space), or null to draw the current pose. */
  readonly boneWorld: Float64Array | null;
  readonly camera: AgentTileCamera;
  /** Pixels, 16…1,568 each. */
  readonly width: number;
  readonly height: number;
  readonly grid: boolean;
  /** Clear colour (CSS hex); default the viewport's bottom colour. */
  readonly background?: string;
}

/** RGBA pixels, top row first. */
export interface AgentTileResult {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8ClampedArray;
}

const TILE_MIN = 16;
const TILE_MAX = 1_568;

function clampPx(value: number): number {
  return Math.min(TILE_MAX, Math.max(TILE_MIN, Math.round(value)));
}

/** A three camera for the tile (aspect = width / height). Exported for tests. */
export function tileCamera(spec: AgentTileCamera, aspect: number): Camera {
  if (spec.kind === 'snapshot') {
    const s = spec.snapshot;
    const position = new Vector3(...s.position);
    const target = new Vector3(...s.target);
    const distance = Math.max(position.distanceTo(target), 0.01);
    const near = Math.max(0.01, distance / 1_000);
    const far = distance * 100 + 100;
    let camera: Camera;
    if (s.projection === 'perspective') {
      camera = new PerspectiveCamera((s.fovY * 180) / Math.PI, aspect, near, far);
    } else {
      const half = s.orthoHeight / 2;
      camera = new OrthographicCamera(-half * aspect, half * aspect, half, -half, -far, far);
    }
    camera.position.copy(position);
    camera.quaternion.copy(new Quaternion(...s.quaternion));
    camera.updateMatrixWorld(true);
    (camera as PerspectiveCamera | OrthographicCamera).updateProjectionMatrix();
    return camera;
  }
  const position = new Vector3(...spec.position);
  const target = new Vector3(...spec.target);
  const distance = Math.max(position.distanceTo(target), 0.01);
  let camera: PerspectiveCamera | OrthographicCamera;
  if (spec.projection === 'perspective') {
    camera = new PerspectiveCamera(spec.fovYDeg, aspect, Math.max(0.01, distance / 1_000), distance * 100 + 100);
  } else {
    const half = spec.orthoHeightM / 2;
    camera = new OrthographicCamera(-half * aspect, half * aspect, half, -half, 0.01, distance * 4 + 100);
  }
  camera.up.set(...spec.up);
  camera.position.copy(position);
  camera.lookAt(target);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  return camera;
}

/**
 * Renders one tile. Synchronous apart from the host's pose hook; the caller composes tiles into a sheet. Throws when
 * the renderer cannot draw (context lost).
 */
export function renderAgentTile(host: ViewportAgentHost, req: AgentTileRequest): AgentTileResult {
  const renderer = host.renderer;
  const gl = renderer.getContext();
  if (gl.isContextLost()) throw new Error('WebGL context lost');
  const width = clampPx(req.width);
  const height = clampPx(req.height);
  const camera = tileCamera(req.camera, width / height);
  camera.layers.set(LAYER.always);
  camera.layers.enable(LAYER.mesh);
  if (req.grid) camera.layers.enable(LAYER.grid);

  const target = new WebGLRenderTarget(width, height, { depthBuffer: true });
  // Encode like the canvas (three applies the target texture's colour space when drawing into a target).
  target.texture.colorSpace = renderer.outputColorSpace;
  const previousTarget = renderer.getRenderTarget();
  const previousViewport = renderer.getViewport(new Vector4());
  const previousScissor = renderer.getScissor(new Vector4());
  const previousScissorTest = renderer.getScissorTest();
  const previousClear = renderer.getClearColor(new Color());
  const previousAlpha = renderer.getClearAlpha();
  const pixels = new Uint8Array(width * height * 4);
  try {
    const draw = (): void => {
      renderer.setRenderTarget(target);
      renderer.setViewport(0, 0, width, height);
      renderer.setScissorTest(false);
      renderer.setClearColor(new Color(req.background ?? VIEWPORT_THEME.viewportBottom), 1);
      renderer.clear(true, true, true);
      renderer.render(host.scene, camera);
      renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);
    };
    if (req.boneWorld === null) draw();
    else host.withPose(req.character, req.boneWorld, draw);
  } finally {
    renderer.setRenderTarget(previousTarget);
    renderer.setViewport(previousViewport);
    renderer.setScissor(previousScissor);
    renderer.setScissorTest(previousScissorTest);
    renderer.setClearColor(previousClear, previousAlpha);
    target.dispose();
  }
  // WebGL rows start at the bottom; the tile's start at the top.
  const rgba = new Uint8ClampedArray(width * height * 4);
  const row = width * 4;
  for (let y = 0; y < height; y++) rgba.set(pixels.subarray((height - 1 - y) * row, (height - y) * row), y * row);
  return { width, height, rgba };
}
