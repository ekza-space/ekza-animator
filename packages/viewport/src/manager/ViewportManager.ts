// ViewportManager (ADR 0006, MVP-SPEC §7 WP-5): one WebGL canvas, one shared scene, N panes. Panes register a
// surface element, a camera binding and display flags; `render()` (called from R3F `useFrame(…, 1)`) draws every
// visible pane with viewport/scissor rectangles: backdrop → main scene → control lines (two passes) → clearDepth →
// manipulator. The manager also routes pointer input inside panes to navigation and the active viewport tool, and
// answers picking/projection queries for tools, operators and the e2e test API.
//
// M6a (M6A-SPEC §4.7, §5.17, §5.26; B9): pane display flags and camera bindings are remembered per workspace; each
// pane render applies its shading to the character models and hands its display to the mesh layers (B6) that joined
// through `addMeshLayer`; reference image planes draw in their ortho pane (behind or in front of the geometry); the
// pointer platform rules (no context-menu RMB, the Model MMB stand-in) and the marking-menu press hook route input;
// the Scale tool's manipulator sits on controls or, in Model, on the selected scene objects.
import {
  type Disposer,
  EkzaError,
  eulerToQuat,
  mat4Decompose,
  type Quat,
  quatInvert,
  quatMultiply,
  type ReadonlyVec3,
  type Vec3,
} from '@ekza-studio/anim-core';
import {
  batchTables,
  type CameraId,
  type CameraRecord,
  type CharacterId,
  type ControlId,
  type ControlRecord,
  type PreviewSession,
} from '@ekza-studio/doc';
import {
  type EditorApp,
  type NavProfile,
  PANEL,
  type ToolInstance,
  type ToolPointerEvent,
  VIEWPORT_TOOL,
} from '@ekza-studio/editor-core';
import { controlForNode } from '@ekza-studio/rig';
import {
  AmbientLight,
  type BufferGeometry,
  type Camera,
  DirectionalLight,
  HemisphereLight,
  NoToneMapping,
  type Object3D,
  OrthographicCamera,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Vector2,
  type WebGLRenderer,
} from 'three';
import {
  applyShotRecord,
  createShotCamera,
  createViewCamera,
  firstShotCamera,
  fitCameraToAspect,
  type ShotCamera,
  setOrthoHeight,
  shotTransformOf,
  snapshotOf,
  type ViewCamera,
} from '../cameras/cameras';
import { type ControlEntry, ControlLayer, multiplyAt } from '../controls/ControlLayer';
import { measureSpatialBounds, pointBounds, type SpatialBounds, unionBounds } from '../framing/bounds';
import { fitCameraFrame, fitOrthoHeight, fitOrthoViewHeight } from '../framing/fit';
import { applyMainLayers, LAYER } from '../layers';
import { type DragControl, type DragSession, dragControl, rotateDrag, translateDrag } from '../manipulators/drag';
import { type ManipMode, type ManipTarget, ManipulatorKit, RING_RADIUS } from '../manipulators/ManipulatorKit';
import { onScaleKitLoaded, requestScaleKit, scaleKit } from '../manipulators/scale/load';
import type { ObjectScaleSession } from '../manipulators/scale/math';
import type { NavigationController, NavState } from '../navigation/NavigationController';
import type { NavigationOverride } from '../navigation/override';
import { isMmbStandIn, type NavGesture, pointerGesture, wheelAction } from '../navigation/profiles';
import { Backdrop, createGrid } from '../overlays/background';
import { MarqueeBox } from '../overlays/marquee';
import { SkeletonLayer } from '../overlays/skeleton';
import { paneGl } from '../panes/layout';
import { PaneProjector } from '../picking/geometry';
import { MeshPicker } from '../picking/meshPicker';
import { ControlPicker } from '../picking/picker';
import { SceneSync } from '../sync/SceneSync';
import type { ViewportToolHost } from '../tools/host';
import type { ManipulatorFrame, ModelManipulator } from '../tools/model/transform/types';
import { startVirtualSliderDrag, type VirtualSliderDrag } from '../tools/virtualSliderDrag';
import type {
  CameraSnapshot,
  DisplayFlags,
  ManipHandle,
  MarqueeRect,
  PaneCamera,
  PaneDescriptor,
  PickResult,
  ScreenPoint,
  ViewPreset,
} from '../types';
import type { ImagePlaneLayer, ImagePlaneSpec } from './imagePlanes';
import { type MeshLayerHost, meshPaneDisplay } from './meshLayers';
import { setManagerOf } from './registry';
import { CharacterShading } from './shading';
import { DEFAULT_DISPLAY, defaultCameraOf, defaultDisplayOf, paneKey } from './workspaceViews';

export { DEFAULT_DISPLAY };

/**
 * A pointer press a marking menu may take (M6A-SPEC §5.17, §5.18): RMB (`button 2`, never `contextmenu`), or LMB
 * while a key is held (`Q`, `W`/`E`/`R`). Pane CSS px and page px.
 */
export interface PanePointerPress {
  readonly paneId: string;
  readonly x: number;
  readonly y: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly button: number;
  readonly pointerId: number;
  readonly shift: boolean;
  readonly ctrl: boolean;
  readonly alt: boolean;
  /** Cmd on macOS, Ctrl elsewhere. */
  readonly mod: boolean;
  /** Whether a mesh (a character mesh or a mesh-view surface) is under the press (marking menus' `when.over`). */
  overMesh(): boolean;
}

/** The handler of marking-menu presses: true = it opened a menu (the press goes nowhere else). */
export type PanePointerMenus = (press: PanePointerPress) => boolean;

/**
 * M6b (C3): a pointer layer above the active viewport tool. Presses go to it after navigation and the marking menus
 * and before the tool; a press it takes (`true`) keeps its moves and release, `Esc` and blur cancel it. Hover moves
 * reach it too. Rig & Skin uses it for the Quick Rig markers and the joints of Skeleton mode (§5.7, §0.4.2), so the
 * shipped select, move and rotate tools keep their behaviour everywhere else.
 */
export interface ViewportPointerLayer {
  pointerDown(e: ToolPointerEvent): boolean;
  pointerMove(e: ToolPointerEvent): void;
  pointerUp(e: ToolPointerEvent): void;
  cancel(): void;
  hover?(paneId: string, x: number, y: number): void;
}

/** What the viewport panel shows for a pane (header, HUD, lock badge). Immutable snapshots. */
export interface PaneState {
  readonly id: string;
  /** The binding the pane asked for. */
  readonly binding: PaneCamera;
  /** What it actually looks through (a missing shot camera falls back, see FIRST_SHOT_CAMERA). */
  readonly cameraKind: 'shot' | 'view';
  readonly preset: ViewPreset | null;
  readonly shotCameraId: CameraId | null;
  readonly cameraName: string;
  readonly locked: boolean;
  readonly display: DisplayFlags;
  /** Incremented whenever a locked camera swallowed navigation (the panel flashes LOCKED). */
  readonly lockFlash: number;
  /** Centre (pane CSS px) of the open Space-hold camera radial (M1-stretch), or null. */
  readonly radial: { readonly x: number; readonly y: number } | null;
}

/** Pane CSS px the radial keeps between its centre and the pane edges (when the pane is large enough). */
export const RADIAL_MARGIN_PX = 96;

interface PaneRuntime {
  readonly id: string;
  readonly element: HTMLElement;
  camera: PaneCamera;
  display: DisplayFlags;
  readonly abort: AbortController;
  readonly resize: ResizeObserver | null;
  readonly marquee: MarqueeBox;
  state: PaneState;
  lockFlash: number;
  radial: { readonly x: number; readonly y: number } | null;
}

type Resolved =
  | { readonly kind: 'shot'; readonly shot: ShotCamera; readonly nav: NavigationController }
  | { readonly kind: 'view'; readonly view: ViewCamera; readonly nav: NavigationController };

interface NavDrag {
  readonly paneId: string;
  readonly pointerId: number;
  readonly gesture: NavGesture;
  readonly startX: number;
  readonly startY: number;
  lastX: number;
  lastY: number;
  /** The gesture hit a locked camera (or could not start): moves are swallowed. */
  readonly swallowed: boolean;
  readonly shot: ShotNav | null;
  /** View camera and its state at the start, restored when the gesture is cancelled (Esc, blur). */
  readonly view: { readonly nav: NavigationController; readonly state: NavState } | null;
}

interface ShotNav {
  readonly cameraId: CameraId;
  readonly nav: NavigationController;
  readonly preview: PreviewSession;
}

interface WheelBurst extends ShotNav {
  timer: ReturnType<typeof setTimeout> | null;
}

/** A shot-camera wheel burst ends after this idle time (ms) and commits once (MVP-SPEC §4.11.16). */
export const WHEEL_BURST_MS = 120;

/** M-AI (MCP-SPEC §4.3): an overlay drawn into every pane after the control pass (P8's presence outline). */
export interface AgentOverlayPass {
  readonly id: string;
  draw(target: { readonly camera: Camera; readonly scene: Scene }): void;
}
/**
 * M-AI (MCP-SPEC §4.3): what capture (P5) and the presence outline (P8) need; never changes a pane, a pane camera,
 * the session or the playhead.
 */
export interface ViewportAgentHost {
  readonly renderer: WebGLRenderer; // the shared renderer (three.js types never leave viewport)
  readonly scene: Scene;
  /**
   * The pane the user last interacted with (keyboard focus inside a pane, else the last pointer press or wheel), else
   * the hovered one, else null.
   */
  activePaneId(): string | null;
  paneCamera(paneId: string): CameraSnapshot; // world space, a copy
  /** Poses `character` from evaluated bone worlds for the duration of `draw`, then restores the current pose. */
  withPose<T>(character: CharacterId, boneWorld: Float64Array, draw: () => T): T;
  /** Overlay layer hook (also used by P8's presence outline, §7.6); returns a disposer. */
  addOverlayPass(pass: AgentOverlayPass): Disposer;
}
const SHOT_LABEL = 'Move Shot Camera';

export class ViewportManager {
  readonly scene = new Scene();
  readonly app: EditorApp;
  readonly renderer: WebGLRenderer;
  /** What tools may ask of the viewport (`ToolDef<ViewportToolHost>`). */
  readonly toolHost: ViewportToolHost;
  private readonly controlScene = new Scene();
  private readonly controls = new ControlLayer();
  private readonly skeleton = new SkeletonLayer();
  private readonly kit = new ManipulatorKit();
  private readonly backdrop = new Backdrop();
  private readonly sync: SceneSync;
  private readonly picker = new ControlPicker();
  private readonly meshPicker = new MeshPicker();
  private readonly panes = new Map<string, PaneRuntime>();
  /** Camera binding and display per `<workspace>:<paneId>` (M6a: per workspace). */
  private readonly memory = new Map<string, { camera: PaneCamera; display: DisplayFlags }>();
  /** The workspace whose pane memory is current (follows `session.workspace`). */
  private workspace: string;
  private readonly meshHosts = new Set<MeshLayerHost>();
  private readonly shading = new CharacterShading();
  /** Reference image planes (§5.26): a lazy chunk, loaded when B13 first sets planes. */
  private planes: ImagePlaneLayer | null = null;
  private planeSpecs: readonly ImagePlaneSpec[] = [];
  private planesLoad: Promise<void> | null = null;
  private pointerMenus: PanePointerMenus | null = null;
  /** M6a (B10): what `F`/`A` frame in Model (component and object selections, meshes); null = the shipped bounds. */
  private frameBounds: ((what: 'selection' | 'all') => SpatialBounds | null) | null = null;
  /** M6a (B10): whether a mesh-view mesh is under a pane point (its meshes take no raycasts); null = none. */
  private meshHitTest: ((paneId: string, x: number, y: number) => boolean) | null = null;
  /** The pointer whose Alt+Shift+LMB press is the MMB stand-in (M6a rule (b)), or null. */
  private standIn: number | null = null;
  /** The Scale tool's manipulator sits on the selected scene objects (Model object mode), not on a control. */
  private objectTarget = false;
  /**
   * The manipulator sits on a control carried over into Model (§5.17): it draws and takes presses only in the panes
   * that draw controls (Show ▸ Controls), the same rule as the MMB virtual slider (M6A-B9-21).
   */
  private controlTargetInModel = false;
  /** M6a (B12a): Model's transform runtime places the manipulator first (components, objects, pivot editing). */
  private modelManipulator: ModelManipulator | null = null;
  /** True while the manipulator sits on a target of Model's transform runtime (its drags are the runtime's). */
  private modelTarget = false;
  /**
   * The manager has asked for the lazy scale chunk since the Scale tool was last chosen: a failed load is not tried
   * again on every manipulator refresh (playback refreshes each frame), only when the tool is chosen again.
   */
  private scaleKitRequested = false;
  private readonly views = new Map<string, Map<ViewPreset, ViewCamera>>();
  private readonly shots = new Map<CameraId, ShotCamera>();
  private readonly listeners = new Set<() => void>();
  private readonly disposers: Disposer[] = [];
  private readonly toolInstances = new Map<string, ToolInstance>();
  private activeToolId: string | null = null;
  private profile: NavProfile;
  private dirty = true;
  private frames = 0;
  private nav: NavDrag | null = null;
  private wheel: WheelBurst | null = null;
  private toolPointer: { readonly paneId: string; readonly pointerId: number } | null = null;
  /** M6b (C3): the pointer layer above the tool and the press it owns. */
  private pointerLayer: ViewportPointerLayer | null = null;
  private layerPointer: { readonly paneId: string; readonly pointerId: number } | null = null;
  /** AUTORIG-SPEC §8.1: the mounted shell's navigation override, asked before the profile on every press. */
  private navOverride: NavigationOverride | null = null;
  /** M2a §5.18: a plain MMB drag running the Channel Box virtual slider on the selected channels. */
  private virtualDrag: VirtualSliderDrag | null = null;
  /** Pointer Lock for the virtual slider (the e2e URL switch `pointerLock=off` turns it off). */
  private pointerLockAllowed = true;
  private hoverControl: ControlId | null = null;
  private stylesDirty = true;
  private manipulatorDirty = true;
  private entryMap: { readonly version: number; readonly map: Map<ControlId, ControlEntry> } | null = null;
  private lastPointerPane: string | null = null;
  /** Last pointer position over a pane (page CSS px): where the camera radial opens. */
  private pointerAt: { readonly paneId: string; readonly clientX: number; readonly clientY: number } | null = null;
  private disposed = false;
  /** Untouched view cameras should be (re)framed at the next frame preparation. */
  private autoFrame = true;
  private readonly projector = new PaneProjector();
  /** M-AI (MCP-SPEC §4.3, §7.6): overlay passes of the agent host, drawn after the control pass. */
  private readonly overlayPasses = new Set<AgentOverlayPass>();
  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === 'Escape') this.cancelInteraction();
  };
  private readonly onBlur = (): void => this.cancelInteraction();

  constructor(opts: { readonly app: EditorApp; readonly renderer: WebGLRenderer }) {
    this.app = opts.app;
    this.workspace = opts.app.session.getState().workspace;
    this.renderer = opts.renderer;
    this.renderer.autoClear = false;
    this.renderer.toneMapping = NoToneMapping;
    this.profile = this.app.prefs.getState().navProfile;
    this.scene.name = 'ekza.viewport';
    this.scene.matrixWorldAutoUpdate = false;
    this.controlScene.matrixWorldAutoUpdate = false;
    this.controlScene.add(this.controls.root);
    this.scene.add(this.skeleton.root);
    this.scene.add(createGrid());
    for (const light of [
      new HemisphereLight(0xffffff, 0x50525a, 1.1),
      new AmbientLight(0xffffff, 0.25),
      directionalLight(),
    ]) {
      light.layers.enableAll();
      this.scene.add(light);
    }
    this.sync = new SceneSync({
      app: this.app,
      scene: this.scene,
      controls: this.controls,
      skeleton: this.skeleton,
      onChange: () => {
        this.manipulatorDirty = true;
        this.autoFrame = true;
        this.invalidate();
      },
    });
    this.toolHost = this.createToolHost();
    this.syncShots();
    this.subscribe();
    const canvas = this.renderer.domElement;
    const restored = (): void => {
      this.sync.invalidatePoses();
      this.invalidate();
    };
    canvas.addEventListener('webglcontextrestored', restored);
    const canvasObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => this.invalidate());
    canvasObserver?.observe(canvas);
    this.disposers.push(() => {
      canvas.removeEventListener('webglcontextrestored', restored);
      canvasObserver?.disconnect();
    });
    setManagerOf(this.app, this);
  }

  /** WebGL frames rendered so far (the e2e idle check: constant while nothing changes). */
  get renderedFrames(): number {
    return this.frames;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // panes

  registerPane(desc: PaneDescriptor): void {
    if (this.panes.has(desc.id)) this.unregisterPane(desc.id);
    const abort = new AbortController();
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => this.invalidate());
    resize?.observe(desc.element);
    const pane: PaneRuntime = {
      id: desc.id,
      element: desc.element,
      camera: desc.camera,
      display: desc.display,
      abort,
      resize,
      marquee: new MarqueeBox(desc.element),
      state: undefined as unknown as PaneState,
      lockFlash: 0,
      radial: null,
    };
    pane.state = this.stateOf(pane);
    this.panes.set(desc.id, pane);
    this.memory.set(paneKey(this.workspace, desc.id), { camera: desc.camera, display: desc.display });
    this.attachInput(pane);
    this.autoFrame = true;
    this.manipulatorDirty = true;
    this.notify();
    this.invalidate();
  }

  updatePane(id: string, patch: Partial<Pick<PaneDescriptor, 'camera' | 'display'>>): void {
    const pane = this.panes.get(id);
    const key = paneKey(this.workspace, id);
    const remembered = this.memory.get(key);
    const camera = patch.camera ?? pane?.camera ?? remembered?.camera ?? defaultCameraOf(this.workspace, id);
    const display = patch.display ?? pane?.display ?? remembered?.display ?? defaultDisplayOf(this.workspace);
    this.memory.set(key, { camera, display });
    if (pane === undefined) return;
    pane.camera = camera;
    pane.display = display;
    this.autoFrame = true;
    this.manipulatorDirty = true;
    this.picker.forget(id);
    this.refreshPaneStates();
    this.invalidate();
  }

  unregisterPane(id: string): void {
    const pane = this.panes.get(id);
    if (pane === undefined) return;
    if (this.nav?.paneId === id) this.endNav(true);
    if (this.toolPointer?.paneId === id) this.cancelInteraction();
    pane.abort.abort();
    pane.resize?.disconnect();
    pane.marquee.dispose();
    this.panes.delete(id);
    this.picker.forget(id);
    this.manipulatorDirty = true;
    this.notify();
    this.invalidate();
  }

  paneIds(): readonly string[] {
    return [...this.panes.keys()];
  }

  paneAt(clientX: number, clientY: number): string | null {
    for (const pane of this.panes.values()) {
      const r = pane.element.getBoundingClientRect();
      if (r.width > 0 && clientX >= r.left && clientX < r.right && clientY >= r.top && clientY < r.bottom)
        return pane.id;
    }
    return null;
  }

  /** The pane's state for the panel (header, HUD), or null for an unknown pane. */
  /** Rig & Skin frames orthographic panes tightly (M6b acceptance: the character fills the front and side panes). */
  private tightOrthoFrame(): boolean {
    return this.app.session.getState().workspace === 'rig';
  }

  paneState(id: string): PaneState | null {
    return this.panes.get(id)?.state ?? null;
  }

  /** Camera binding and display flags last used for a pane id in the current workspace (survive layout switches),
   *  or null. */
  rememberedPane(id: string): { readonly camera: PaneCamera; readonly display: DisplayFlags } | null {
    return this.memory.get(paneKey(this.workspace, id)) ?? null;
  }

  /** What a pane id shows in the current workspace: its remembered binding and display, else the workspace's
   *  defaults (Model: `colours`, wire on shaded, flat, M-Side `front | persp`). */
  paneSetup(id: string): { readonly camera: PaneCamera; readonly display: DisplayFlags } {
    return (
      this.rememberedPane(id) ?? {
        camera: defaultCameraOf(this.workspace, id),
        display: defaultDisplayOf(this.workspace),
      }
    );
  }

  /** The workspace whose pane memory is current. */
  get currentWorkspace(): string {
    return this.workspace;
  }

  /**
   * Switches the pane memory to another workspace (§5.17): every registered pane keeps its view camera but takes the
   * binding and display flags it had in that workspace (or the workspace's defaults); a running tool gesture or
   * navigation is cancelled. Called when `session.workspace` changes.
   */
  setWorkspace(workspace: string): void {
    if (workspace === this.workspace) return;
    this.cancelInteraction();
    this.workspace = workspace;
    for (const pane of this.panes.values()) {
      const setup = this.paneSetup(pane.id);
      pane.camera = setup.camera;
      pane.display = setup.display;
      this.memory.set(paneKey(workspace, pane.id), setup);
      this.picker.forget(pane.id);
    }
    this.autoFrame = true;
    this.manipulatorDirty = true;
    this.refreshPaneStates();
    this.invalidate();
  }

  // ---------------------------------------------------------------------------------------------------------------
  // M6a: mesh layers, image planes, pixel probes, marking-menu presses

  /**
   * Adds a mesh-view host to the shared scene (§4.7): its root renders on the mesh layers, and `applyPane` runs before
   * every pane render with that pane's display. The disposer removes the root (the host owns its disposal).
   */
  addMeshLayer(host: MeshLayerHost): Disposer {
    this.meshHosts.add(host);
    this.scene.add(host.root);
    this.invalidate();
    return () => {
      if (!this.meshHosts.delete(host)) return;
      this.scene.remove(host.root);
      this.invalidate();
    };
  }

  /** The mesh layers currently in the scene. */
  meshLayers(): readonly MeshLayerHost[] {
    return [...this.meshHosts];
  }

  /**
   * Replaces the reference image planes (§5.26; B13 decodes the images and passes the record fields). The drawing
   * code loads on the first call with planes; the promise resolves once they are in the scene.
   */
  setImagePlanes(planes: readonly ImagePlaneSpec[]): Promise<void> {
    this.planeSpecs = planes;
    if (this.planes !== null) {
      this.planes.set(planes);
      this.invalidate();
      return Promise.resolve();
    }
    if (planes.length === 0 && this.planesLoad === null) return Promise.resolve();
    this.planesLoad ??= import('./imagePlanes').then(
      ({ ImagePlaneLayer: Layer }) => {
        if (this.disposed) return;
        this.planes ??= new Layer();
      },
      (error: unknown) => {
        this.planesLoad = null;
        throw error;
      },
    );
    return this.planesLoad.then(() => {
      if (this.disposed || this.planes === null) return;
      this.planes.set(this.planeSpecs);
      this.invalidate();
    });
  }

  /** Ids of the image planes a pane draws (behind and in front of the geometry). */
  imagePlanesIn(paneId: string): readonly string[] {
    const pane = this.panes.get(paneId);
    if (pane === undefined || !pane.display.imagePlanes || this.planes === null) return [];
    const resolved = this.resolve(pane);
    const preset = resolved.kind === 'view' ? resolved.view.preset : null;
    return [...this.planes.planesFor(preset, 'behind'), ...this.planes.planesFor(preset, 'front')];
  }

  /** Sets the handler of marking-menu presses (the shell's marking menus), or null. */
  setPointerMenus(handler: PanePointerMenus | null): void {
    this.pointerMenus = handler;
  }
  /** AUTORIG-SPEC §8.1 (D3): installs (or with null removes) a shell's navigation override. */
  setNavigationOverride(o: NavigationOverride | null): void {
    this.navOverride = o;
  }

  /** M6b (C3): sets the pointer layer above the tool (null removes it); the disposer removes this layer. */
  setPointerLayer(layer: ViewportPointerLayer | null): Disposer {
    if (this.layerPointer !== null) {
      this.layerPointer = null;
      this.pointerLayer?.cancel();
    }
    this.pointerLayer = layer;
    return () => {
      if (this.pointerLayer !== layer) return;
      if (this.layerPointer !== null) {
        this.layerPointer = null;
        layer?.cancel();
      }
      this.pointerLayer = null;
    };
  }

  /**
   * M6a (B10, §5.6 framing): a provider of the bounds `F` (selection) and `A` (all) frame; null from it (or no
   * provider) keeps the shipped bounds. The Model select runtime frames component and object selections with it.
   */
  setFrameBounds(provider: ((what: 'selection' | 'all') => SpatialBounds | null) | null): void {
    this.frameBounds = provider;
  }

  /**
   * M6a (B10): the hit test of the meshes mesh-view draws (they opt out of three's raycasting), consulted by
   * `isOverMesh` for marking menus' `when.over` (the RMB mode menu on a mesh, §8.4).
   */
  setMeshHitTest(test: ((paneId: string, x: number, y: number) => boolean) | null): void {
    this.meshHitTest = test;
  }

  /**
   * M6a (B12a, §5.15): Model's transform runtime, asked for the manipulator target before B9's object scale target and
   * the control target (null removes it). Its targets are dragged by the runtime itself, never by the control drags.
   */
  setModelManipulator(provider: ModelManipulator | null): void {
    this.modelManipulator = provider;
    this.manipulatorDirty = true;
    this.invalidate();
  }

  /** M6a (B12a): places the manipulator again before the next frame or query (a selection or geometry changed). */
  refreshManipulatorSoon(): void {
    this.manipulatorDirty = true;
    this.invalidate();
  }

  /** M6a (B12a): the pane camera and the manipulator's frame for Model's transform drags; null for an unknown pane. */
  manipulatorFrame(paneId: string): ManipulatorFrame | null {
    const view = this.queryView(paneId);
    if (view === null) return null;
    const kit = this.kit;
    const target = this.kitIn(view.pane) ? kit.currentTarget : null;
    const camera = view.camera;
    const at = target?.pivot ?? null;
    const depth =
      at === null
        ? camera.position.distanceTo(this.resolve(view.pane).nav.target())
        : Math.max(view.projector.depth(at[0], at[1], at[2]), 1e-4);
    const unitsPerPx =
      camera instanceof OrthographicCamera
        ? (camera.top - camera.bottom) / camera.zoom / Math.max(view.height, 1)
        : camera instanceof PerspectiveCamera
          ? (2 * depth * Math.tan((camera.getEffectiveFOV() * Math.PI) / 360)) / Math.max(view.height, 1)
          : 0.01;
    return {
      camera,
      projector: view.projector,
      width: view.width,
      height: view.height,
      pivot: at,
      axes: kit.axes(),
      mode: target === null ? null : kit.currentMode,
      sizePx: kit.size,
      unitsPerPx,
      ringAxis: (handle) => kit.ringAxis(handle, camera),
      ringGrab: (handle, x, y) => kit.ringGrab(handle, camera, view.projector, view.height, x, y),
    };
  }

  /**
   * M6a (B10): the camera a pane looks through, sized to the pane, with its size (CSS px) and display flags, for
   * mesh-view's component picking (B6's `MeshDisplay.pick`/`marquee`/`screenOf`). Null for an unknown or empty pane.
   */
  paneView(paneId: string): {
    readonly camera: Camera;
    readonly width: number;
    readonly height: number;
    readonly display: DisplayFlags;
  } | null {
    const view = this.queryView(paneId);
    return view === null
      ? null
      : { camera: view.camera, width: view.width, height: view.height, display: view.pane.display };
  }

  /**
   * The colour at a page point (CSS px) after a render (test API `pixel`, §4.8): the panes are drawn again and the
   * pixel is read before the browser composites the frame. Null outside the canvas.
   */
  readPixel(clientX: number, clientY: number): [number, number, number, number] | null {
    if (this.disposed) return null;
    const canvas = this.renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    if (clientX < rect.left || clientX >= rect.right || clientY < rect.top || clientY >= rect.bottom) return null;
    this.dirty = true;
    this.render(true);
    const gl = this.renderer.getContext();
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    const x = Math.min(width - 1, Math.max(0, Math.floor(((clientX - rect.left) / rect.width) * width)));
    const y = Math.min(height - 1, Math.max(0, height - 1 - Math.floor(((clientY - rect.top) / rect.height) * height)));
    const out = new Uint8Array(4);
    gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
    return [out[0] as number, out[1] as number, out[2] as number, out[3] as number];
  }

  /**
   * The colours of a page rectangle (CSS px) after a render (test API `pixels`, E2E-MOD-30): RGBA rows top-down in
   * drawing-buffer pixels, clipped to the canvas; null when nothing of it is on the canvas.
   */
  readPixels(
    clientX: number,
    clientY: number,
    w: number,
    h: number,
  ): { readonly width: number; readonly height: number; readonly data: Uint8Array } | null {
    if (this.disposed) return null;
    const canvas = this.renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    const gl = this.renderer.getContext();
    const sx = gl.drawingBufferWidth / rect.width;
    const sy = gl.drawingBufferHeight / rect.height;
    const x0 = Math.max(0, Math.floor((clientX - rect.left) * sx));
    const x1 = Math.min(gl.drawingBufferWidth, Math.ceil((clientX + w - rect.left) * sx));
    const top = Math.max(0, Math.floor((clientY - rect.top) * sy));
    const bottom = Math.min(gl.drawingBufferHeight, Math.ceil((clientY + h - rect.top) * sy));
    if (x1 <= x0 || bottom <= top) return null;
    this.dirty = true;
    this.render(true);
    const width = x1 - x0;
    const height = bottom - top;
    const raw = new Uint8Array(width * height * 4);
    gl.readPixels(x0, gl.drawingBufferHeight - bottom, width, height, gl.RGBA, gl.UNSIGNED_BYTE, raw);
    // GL rows run bottom-up: flip to top-down.
    const data = new Uint8Array(raw.length);
    for (let row = 0; row < height; row++) {
      data.set(raw.subarray((height - 1 - row) * width * 4, (height - row) * width * 4), row * width * 4);
    }
    return { width, height, data };
  }

  /**
   * Sets a VRM expression's weight on a character's display model and applies it (test API `setExpression`,
   * E2E-MOD-30). False when the character has no VRM display model or no such expression.
   */
  setExpression(character: CharacterId, name: string, weight: number): boolean {
    const manager = this.sync.model(character)?.vrm?.expressionManager ?? null;
    if (manager === null || manager.getExpression(name) === null) return false;
    manager.setValue(name, weight);
    manager.update();
    this.invalidate();
    return true;
  }

  /** A character's display model as drawn: its meshes and their vertices (a rebuild shows as a new count). */
  displayModelInfo(
    character: CharacterId,
  ): { readonly meshes: number; readonly vertices: number; readonly drawn: number } | null {
    const root = this.sync.model(character)?.root ?? null;
    if (root === null) return null;
    let meshes = 0;
    let vertices = 0;
    let drawn = 0;
    root.traverse((object) => {
      const geometry = (object as { readonly isMesh?: boolean; readonly geometry?: BufferGeometry }).geometry;
      if ((object as { readonly isMesh?: boolean }).isMesh !== true || geometry === undefined) return;
      meshes++;
      vertices += geometry.getAttribute('position')?.count ?? 0;
      // On the mesh layer: drawn (Model hides the meshes mesh-view draws, §5.23).
      if (object.layers.isEnabled(LAYER.mesh)) drawn++;
    });
    return { meshes, vertices, drawn };
  }

  /** World position of a display-model node by name, as last drawn (springs included); null without one. */
  displayNodeWorld(character: CharacterId, name: string): [number, number, number] | null {
    const node = this.sync.model(character)?.root.getObjectByName(name) ?? null;
    if (node === null) return null;
    const e = node.matrixWorld.elements;
    return [e[12], e[13], e[14]];
  }

  /** Whether a mesh is under a pane point: a character mesh or a mesh-view surface (marking menus' `when.over`). */
  isOverMesh(paneId: string, x: number, y: number): boolean {
    const view = this.queryView(paneId);
    if (view === null || !view.pane.display.mesh) return false;
    const ndcX = (x / view.width) * 2 - 1;
    const ndcY = 1 - (y / view.height) * 2;
    // Skinned character meshes through the mesh picker (posed skin); every other surface by a plain raycast.
    if (this.meshPicker.pick(view.camera, ndcX, ndcY, this.sync.meshTargets(), this.sync.poseStamp) !== null) {
      return true;
    }
    if (this.meshHitTest?.(paneId, x, y) === true) return true;
    const raycaster = new Raycaster();
    raycaster.layers.set(LAYER.mesh);
    raycaster.setFromCamera(new Vector2(ndcX, ndcY), view.camera);
    const roots = [...this.characterRoots(), ...[...this.meshHosts].map((host) => host.root)];
    return roots.some((root) => root.visible && raycaster.intersectObject(root, true).length > 0);
  }

  /** The pane's element rectangle in page CSS px, or null. */
  paneRect(id: string): { readonly x: number; readonly y: number; readonly w: number; readonly h: number } | null {
    const pane = this.panes.get(id);
    if (pane === undefined) return null;
    const r = pane.element.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  }

  /** The pane that last received pointer input (fallback target of view operators), or the first pane. */
  activePaneId(): string | null {
    if (this.lastPointerPane !== null && this.panes.has(this.lastPointerPane)) return this.lastPointerPane;
    return this.panes.keys().next().value ?? null;
  }

  /** Listens to pane state changes (panes added/removed, camera, lock, display, LOCKED flash). */
  subscribePanes(listener: () => void): Disposer {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Opens the Space-hold camera radial (M1-stretch) of a pane at the last pointer position over it (else its centre),
   * kept RADIAL_MARGIN_PX inside the pane. Closes any other radial. False for an unknown pane.
   */
  openRadial(paneId: string): boolean {
    const pane = this.panes.get(paneId);
    if (pane === undefined) return false;
    const r = pane.element.getBoundingClientRect();
    const at = this.pointerAt?.paneId === paneId ? this.pointerAt : null;
    const clamp = (v: number, size: number): number =>
      size <= 2 * RADIAL_MARGIN_PX ? size / 2 : Math.min(Math.max(v, RADIAL_MARGIN_PX), size - RADIAL_MARGIN_PX);
    const x = clamp(at === null ? r.width / 2 : at.clientX - r.left, r.width);
    const y = clamp(at === null ? r.height / 2 : at.clientY - r.top, r.height);
    for (const other of this.panes.values()) other.radial = null;
    pane.radial = { x, y };
    this.refreshPaneStates();
    return true;
  }

  closeRadial(): void {
    let open = false;
    for (const pane of this.panes.values()) {
      open ||= pane.radial !== null;
      pane.radial = null;
    }
    if (open) this.refreshPaneStates();
  }

  // ---------------------------------------------------------------------------------------------------------------
  // rendering

  /** Render dirty panes. Call from R3F useFrame(…, 1). `probe`: a pixel-probe render, not counted as a frame. */
  render(probe = false): void {
    if (this.disposed) return;
    this.prepareFrame();
    if (!this.dirty) return;
    this.dirty = false;
    // The scene's matrixWorldAutoUpdate is off and SceneSync's world pass runs only for a character pose or placement
    // change, so mesh-view hosts (whose roots carry `matrixAutoUpdate = false` and flag `matrixWorldNeedsUpdate` on
    // `setWorld`) propagate their world matrices here: otherwise a moved mesh keeps drawing at its old transform while
    // picking, the manipulator and framing follow the new one (acceptance fix round 1).
    for (const host of this.meshHosts) host.root.updateMatrixWorld();
    const renderer = this.renderer;
    const canvasRect = renderer.domElement.getBoundingClientRect();
    let rendered = 0;
    // Without preserveDrawingBuffer the browser may discard the canvas after compositing, so every visible pane is
    // drawn whenever anything changed.
    for (const pane of this.panes.values()) {
      const gl = paneGl(canvasRect, pane.element.getBoundingClientRect());
      if (gl === null) continue;
      this.renderPane(pane, gl);
      rendered++;
    }
    renderer.setScissorTest(false);
    this.sync.setXray(false);
    if (rendered > 0 && !probe) this.frames++;
  }

  invalidate(_paneId?: string): void {
    if (this.disposed) return;
    this.dirty = true;
    this.app.requestFrame();
  }

  // ---------------------------------------------------------------------------------------------------------------
  // picking and projection

  pick(paneId: string, x: number, y: number): PickResult | null {
    return this.pickCandidates(paneId, x, y)[0] ?? null;
  }

  pickCandidates(paneId: string, x: number, y: number): readonly PickResult[] {
    const view = this.queryView(paneId);
    if (view === null) return [];
    const results: PickResult[] = [];
    const handle = this.kitIn(view.pane) ? this.kit.pick(view.camera, view.projector, view.height, x, y) : null;
    if (handle !== null) results.push({ kind: 'manipulator', handle });
    const mask = this.app.session.getState().tools.selectionMask;
    if (view.pane.display.controls && mask.controls) {
      const projected = this.picker.projections(paneId, view.key, view.projector, this.controls.entries());
      for (const hit of this.picker.controlHits(projected, this.entries(), x, y)) {
        results.push({ kind: 'control', control: hit.control, distancePx: hit.distancePx, depth: hit.depth });
      }
    }
    if (view.pane.display.skeleton && mask.joints) {
      for (const hit of this.picker.jointHits(this.skeleton.jointSets(), view.projector, x, y)) {
        results.push({ kind: 'joint', character: hit.character, node: hit.node });
      }
    }
    if (view.pane.display.mesh && mask.meshes) {
      // M1-stretch mesh click: lowest priority, the nearest surface only.
      const ndcX = (x / view.width) * 2 - 1;
      const ndcY = 1 - (y / view.height) * 2;
      const hit = this.meshPicker.pick(view.camera, ndcX, ndcY, this.sync.meshTargets(), this.sync.poseStamp);
      if (hit !== null) {
        const control = this.controlForNode(hit.character, hit.node);
        results.push({ kind: 'mesh', character: hit.character, node: hit.node, control });
      }
    }
    return results;
  }

  marquee(paneId: string, rect: MarqueeRect): readonly ControlId[] {
    const view = this.queryView(paneId);
    if (view === null || !view.pane.display.controls) return [];
    if (!this.app.session.getState().tools.selectionMask.controls) return [];
    return this.picker.marquee(
      this.picker.projections(paneId, view.key, view.projector, this.controls.entries()),
      rect,
    );
  }

  frame(paneId: string, what: 'selection' | 'all'): void {
    const pane = this.panes.get(paneId);
    if (pane === undefined) return;
    this.prepareForQuery();
    const resolved = this.resolve(pane);
    if (resolved.kind === 'shot' && resolved.shot.record.locked) {
      this.flashLocked(pane);
      return;
    }
    const bounds = this.boundsFor(what);
    const rect = pane.element.getBoundingClientRect();
    const aspect = rect.width > 0 && rect.height > 0 ? rect.width / rect.height : 1;
    const apply = (): void => frameCamera(resolved.nav, bounds, aspect, this.tightOrthoFrame());
    if (resolved.kind === 'shot') {
      this.withShotPreview(resolved.shot, () => apply());
    } else {
      apply();
      resolved.view.touched = true;
    }
    this.picker.forget(paneId);
    this.invalidate();
  }

  project(paneId: string, world: ReadonlyVec3): ScreenPoint | null {
    const view = this.queryView(paneId);
    if (view === null) return null;
    const out = [0, 0, 0];
    if (!view.projector.project(world[0], world[1], world[2], out)) return null;
    return { x: out[0] as number, y: out[1] as number, depth: out[2] as number };
  }

  controlScreenPoint(paneId: string, control: ControlId): ScreenPoint | null {
    return this.controlPickPoint(paneId, control)?.point ?? null;
  }

  /**
   * The best click point of a control in a pane and its distance to every other visible control's polyline
   * (MVP-SPEC §4.11.15 finger acceptance: ≥ 6 px). Null when the control is not visible in the pane.
   */
  controlPickPoint(
    paneId: string,
    control: ControlId,
  ): { readonly point: ScreenPoint; readonly separationPx: number } | null {
    const view = this.queryView(paneId);
    if (view === null || !view.pane.display.controls) return null;
    const projected = this.picker.projections(paneId, view.key, view.projector, this.controls.entries());
    return this.picker.bestPickPoint(projected, control, view.width, view.height);
  }

  manipulatorScreenPoint(paneId: string, handle: ManipHandle): ScreenPoint | null {
    const view = this.queryView(paneId);
    if (view === null || !this.kitIn(view.pane)) return null;
    return this.kit.grabPoint(handle, view.camera, view.projector, view.height);
  }

  /** Scene-space axes of the manipulator handles (translate: world/object; rotate: world/object/gimbal), or null. */
  manipulatorAxes(): readonly [Vec3, Vec3, Vec3] | null {
    this.prepareForQuery();
    return this.kit.visible ? this.kit.axes() : null;
  }

  camera(paneId: string): CameraSnapshot {
    const pane = this.panes.get(paneId);
    if (pane === undefined) throw new EkzaError('unsupported', `No viewport pane '${paneId}'`);
    return snapshotOf(this.resolve(pane).nav);
  }

  /**
   * M-AI (MCP-SPEC §4.3): the agent host — the shared renderer and scene, the user's active pane and its camera, a
   * temporary pose for one draw and overlay passes. Reading it changes nothing the user sees. Async: the pose code is a
   * lazy chunk (§0.4).
   */
  async agentHost(): Promise<ViewportAgentHost> {
    const { withAgentPose } = await import('./agentPose');
    return {
      renderer: this.renderer,
      scene: this.scene,
      // Keyboard focus inside a pane (its menu, a focused pane element) is the user's current interaction; else the
      // pane of the last pointer press or wheel; else the hovered pane; else null (MAI-D0-15).
      activePaneId: () => {
        const focus = typeof document === 'undefined' ? null : document.activeElement;
        if (focus !== null && focus !== document.body) {
          for (const [id, pane] of this.panes) if (pane.element.contains(focus)) return id;
        }
        if (this.lastPointerPane !== null && this.panes.has(this.lastPointerPane)) return this.lastPointerPane;
        const hovered = this.pointerAt?.paneId ?? null;
        return hovered !== null && this.panes.has(hovered) ? hovered : null;
      },
      paneCamera: (paneId) => this.camera(paneId),
      withPose: (character, boneWorld, draw) =>
        withAgentPose(this.scene, this.sync.model(character), this.app.characters.get(character), boneWorld, draw),
      addOverlayPass: (pass) => {
        this.overlayPasses.add(pass);
        this.invalidate();
        return () => {
          if (this.overlayPasses.delete(pass)) this.invalidate();
        };
      },
    };
  }

  setNavProfile(profile: NavProfile): void {
    this.profile = profile;
  }

  /**
   * M2a §5.5: how a control is drawn after the frame preparation: 'visible' (pickable), 'ghost' (25 % alpha, never
   * pickable) or 'hidden'; null for a control the viewport does not know.
   */
  controlDrawState(control: ControlId): 'visible' | 'ghost' | 'hidden' | null {
    this.prepareForQuery();
    const entry = this.controls.entry(control);
    if (entry === undefined) return null;
    return entry.visible ? 'visible' : entry.ghost ? 'ghost' : 'hidden';
  }

  /** M2a §5.5 rule 4: the pole annotation lines drawn for a character (scene space: mid bone → pole). */
  poleLines(
    character: CharacterId,
  ): readonly { readonly pole: ControlId; readonly from: readonly number[]; readonly to: readonly number[] }[] {
    this.prepareForQuery();
    return this.controls.poleLines(character);
  }

  /** M2a §5.18: whether the viewport's virtual slider may use Pointer Lock (else pointer capture). */
  setPointerLockAllowed(allowed: boolean): void {
    this.pointerLockAllowed = allowed;
  }

  /** True while a plain-MMB virtual slider drag runs in a pane. */
  get virtualSliderActive(): boolean {
    return this.virtualDrag?.active === true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.cancelInteraction();
    for (const id of this.panes.keys()) this.unregisterPane(id);
    this.disposed = true;
    for (const dispose of this.disposers.splice(0).reverse()) dispose();
    for (const tool of this.toolInstances.values()) tool.deactivate?.();
    this.toolInstances.clear();
    for (const host of this.meshHosts) {
      this.scene.remove(host.root);
      host.dispose();
    }
    this.meshHosts.clear();
    this.shading.dispose();
    this.planes?.dispose();
    this.pointerMenus = null;
    this.sync.dispose();
    this.controls.dispose();
    this.skeleton.dispose();
    this.kit.dispose();
    this.backdrop.dispose();
    for (const shot of this.shots.values()) shot.nav.dispose();
    for (const map of this.views.values()) for (const view of map.values()) view.nav.dispose();
    this.listeners.clear();
    setManagerOf<ViewportManager>(this.app, null, this);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // internals: frame preparation

  /** Pose sync, styles and manipulator placement; runs before rendering and before every query. */
  private prepareFrame(): void {
    const session = this.app.session.getState();
    let springs = false;
    if (session.time.playing) for (const pane of this.panes.values()) springs ||= pane.display.springBones;
    if (this.sync.update({ springs, nowMs: performance.now() })) {
      this.dirty = true;
      this.manipulatorDirty = true;
    }
    if (this.stylesDirty) {
      this.stylesDirty = false;
      // The pointer's hover in a pane wins; otherwise the Outliner's hovered row pre-highlights (FR-OUT-03).
      const hover = this.hoverControl ?? session.hoverControl;
      if (this.controls.setStyles(session.selection.controls, hover)) this.dirty = true;
    }
    if (this.autoFrame) {
      this.autoFrame = false;
      if (this.frameUntouchedViews()) this.dirty = true;
    }
    if (this.manipulatorDirty) {
      this.manipulatorDirty = false;
      this.refreshManipulator();
      this.dirty = true;
    }
    this.controls.flush();
  }

  private prepareForQuery(): void {
    this.app.evaluation.tick();
    this.prepareFrame();
  }

  private refreshManipulator(): void {
    const session = this.app.session.getState();
    const prefs = this.app.prefs.getState();
    const tool = session.tools.viewport;
    const mode: ManipMode | null =
      tool === VIEWPORT_TOOL.move
        ? 'translate'
        : tool === VIEWPORT_TOOL.rotate
          ? 'rotate'
          : tool === VIEWPORT_TOOL.scale
            ? 'scale'
            : null;
    const space = mode === 'translate' ? prefs.moveSpace : mode === 'rotate' ? prefs.rotateSpace : 'object';
    // M6a (B12a, §5.15): in Model the transform runtime places the manipulator first — component selections,
    // objects for Move and Rotate, the pivot while it is edited — with its own frame (object axes of the target).
    this.modelTarget = false;
    const modelTarget =
      this.workspace === 'model' && mode !== null && this.modelManipulator !== null
        ? this.modelManipulator.target({ mode, characterWorld: (character) => this.sync.placement(character) })
        : null;
    this.kit.setDashed(modelTarget?.dashed === true);
    if (modelTarget !== null) {
      this.objectTarget = false;
      this.controlTargetInModel = false;
      this.modelTarget = true;
      this.kit.configure(modelTarget.mode, 'object', session.tools.manipulatorSize);
      this.kit.setTarget(modelTarget.target);
      return;
    }
    this.kit.configure(mode, space, session.tools.manipulatorSize);
    // M6a: in Model's object mode the Scale tool sits on the selected scene objects (meshes and groups). Model does
    // not draw or pick rig controls, so a control selection carried over from Animate is edited there only where it
    // is seen (§5.17, M6A-B9-21): in object mode, with no object target, the transform tools sit on the lead control
    // in the panes that draw controls (Show ▸ Controls) and nowhere else — the MMB virtual slider's rule. Component
    // modes show none until B12a's component targets land. In Animate the transform tools sit on the lead control.
    let target: ManipTarget | null = null;
    this.objectTarget = false;
    this.controlTargetInModel = false;
    const model = this.workspace === 'model';
    const objectMode = session.model.componentMode === 'object';
    // The scale handles and drags live in the lazy scale chunk: until it has loaded no scale manipulator shows.
    const scale = mode === 'scale' ? scaleKit() : null;
    if (mode === 'scale' && scale === null) {
      // Loaded handles show through `onScaleKitLoaded` (whoever's load it was); a failure is toasted once.
      if (!this.scaleKitRequested) {
        this.scaleKitRequested = true;
        void requestScaleKit(this.app.services.notify);
      }
    } else if (mode !== null) {
      if (scale !== null && model && objectMode) {
        target = scale.objectManipTarget(this.app, (character) => this.sync.placement(character));
        this.objectTarget = target !== null;
      }
      if (target === null && !model) target = this.manipTarget(session.selection.controls.at(-1) ?? null);
      if (target === null && model && objectMode && this.anyPaneDrawsControls()) {
        target = this.manipTarget(session.selection.controls.at(-1) ?? null);
        this.controlTargetInModel = target !== null;
      }
    }
    this.kit.setTarget(target);
  }

  /** Whether any registered pane draws controls (Show ▸ Controls). */
  private anyPaneDrawsControls(): boolean {
    for (const pane of this.panes.values()) if (pane.display.controls) return true;
    return false;
  }

  /**
   * Whether the manipulator draws and takes presses in a pane: always where it shows, except that a control target in
   * Model is limited to the panes that draw controls (M6A-B9-21).
   */
  private kitIn(pane: PaneRuntime): boolean {
    return this.kit.visible && (!this.controlTargetInModel || pane.display.controls);
  }

  private manipTarget(lead: ControlId | null): ManipTarget | null {
    if (lead === null) return null;
    const entry = this.controls.entry(lead);
    if (entry === undefined || !entry.visible) return null;
    const runtime = this.app.characters.get(entry.character);
    const placement = this.sync.placement(entry.character);
    const record = this.app.store.get('controls', lead);
    if (runtime === undefined || placement === null || record === undefined) return null;
    const world = new Float64Array(16);
    multiplyAt(placement, runtime.pose.controlWorld, entry.slot * 16, world);
    const xf = mat4Decompose(world);
    const values = this.app.evaluation.channelValues(lead);
    const r: Vec3 = [values.rx, values.ry, values.rz];
    const parentQ: Quat = quatMultiply(xf.q, quatInvert(eulerToQuat(r, record.rotateOrder)));
    const flags = dragFlags(record);
    return {
      pivot: [xf.t[0], xf.t[1], xf.t[2]],
      worldQ: xf.q,
      parentQ,
      r,
      order: record.rotateOrder,
      keyable: flags.free,
      locked: { t: flags.locked.t, r: flags.locked.r },
    };
  }

  private renderPane(pane: PaneRuntime, gl: NonNullable<ReturnType<typeof paneGl>>): void {
    const renderer = this.renderer;
    const { viewport, scissor } = gl;
    const resolved = this.resolve(pane);
    const camera = resolved.nav.camera;
    const preset = resolved.kind === 'view' ? resolved.view.preset : null;
    fitCameraToAspect(camera, viewport.width / viewport.height);
    camera.updateMatrixWorld();
    renderer.setViewport(viewport.x, viewport.y, viewport.width, viewport.height);
    renderer.setScissor(scissor.x, scissor.y, scissor.width, scissor.height);
    renderer.setScissorTest(true);
    renderer.clear(true, true, true);
    renderer.render(this.backdrop.scene, this.backdrop.camera);

    const display = pane.display;
    // M6a §5.26: image planes behind the geometry draw first, without depth (the geometry covers them).
    const planes = display.imagePlanes ? this.planes : null;
    if (planes !== null && planes.prepare(preset, 'behind')) {
      camera.layers.set(LAYER.helpers);
      renderer.render(planes.scene, camera);
    }
    this.sync.setXray(display.xray);
    applyMainLayers(camera, display);
    this.skeleton.lineMaterial.resolution.set(viewport.width, viewport.height);
    // M6a §4.7: the mesh layers take this pane's display; the character models its shading (lit = their own look).
    if (this.meshHosts.size > 0) {
      const meshDisplay = meshPaneDisplay(display);
      for (const host of this.meshHosts) host.applyPane(meshDisplay, pane.id);
    }
    const roots = display.mesh ? this.characterRoots() : [];
    this.shading.begin(roots, display);
    renderer.render(this.scene, camera);
    this.shading.end();
    if (
      display.wireOnShaded &&
      display.shading !== 'wire' &&
      roots.length > 0 &&
      this.shading.beginWireOverlay(roots)
    ) {
      // The characters' wireframe over their shading; the mesh-view surfaces draw their own (hidden for this pass).
      for (const host of this.meshHosts) host.root.visible = false;
      camera.layers.set(LAYER.mesh);
      renderer.render(this.scene, camera);
      this.shading.end();
      for (const host of this.meshHosts) host.root.visible = true;
    }
    if (display.controls) {
      for (const material of this.controls.allMaterials()) material.resolution.set(viewport.width, viewport.height);
      camera.layers.set(LAYER.controlsOccluded);
      renderer.render(this.controlScene, camera);
      camera.layers.set(LAYER.controlsVisible);
      renderer.render(this.controlScene, camera);
    }
    if (planes !== null && planes.prepare(preset, 'front')) {
      camera.layers.set(LAYER.helpers);
      renderer.render(planes.scene, camera);
    }
    // M-AI (MCP-SPEC §7.6): agent overlay passes after the control pass, before the manipulator.
    for (const pass of this.overlayPasses) pass.draw({ camera, scene: this.scene });
    renderer.clearDepth();
    if (this.kitIn(pane)) {
      this.projector.set(camera, viewport.width, viewport.height, camera.near);
      this.kit.prepare(camera, viewport.width, viewport.height, this.projector);
      camera.layers.set(LAYER.always);
      renderer.render(this.kit.scene, camera);
    }
    camera.layers.set(LAYER.always);
  }

  /** The display models of the characters in the scene (what a pane's shading applies to). */
  private characterRoots(): Object3D[] {
    const roots: Object3D[] = [];
    for (const id of this.sync.characterIds()) {
      const root = this.sync.model(id)?.root;
      if (root !== undefined) roots.push(root);
    }
    return roots;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // internals: cameras

  private resolve(pane: PaneRuntime): Resolved {
    if (pane.camera.kind === 'shot') {
      const shot = this.shotFor(pane.camera.cameraId);
      if (shot !== null) return { kind: 'shot', shot, nav: shot.nav };
      const view = this.viewCamera(pane.id, 'persp');
      return { kind: 'view', view, nav: view.nav };
    }
    const view = this.viewCamera(pane.id, pane.camera.preset);
    return { kind: 'view', view, nav: view.nav };
  }

  private shotFor(id: CameraId): ShotCamera | null {
    const exact = this.shots.get(id);
    if (exact !== undefined) return exact;
    const first = firstShotCamera(this.app.store.list('cameras'));
    return first === null ? null : (this.shots.get(first.id) ?? null);
  }

  private viewCamera(paneId: string, preset: ViewPreset): ViewCamera {
    let map = this.views.get(paneId);
    if (map === undefined) {
      map = new Map();
      this.views.set(paneId, map);
    }
    let view = map.get(preset);
    if (view === undefined) {
      view = createViewCamera(preset);
      map.set(preset, view);
      this.autoFrame = true;
    }
    return view;
  }

  /**
   * Frames every untouched view camera shown in a pane on the current characters (first load, another character
   * imported). Returns true when a camera moved. Runs after the pose sync, so the bounds are current.
   */
  private frameUntouchedViews(): boolean {
    const ids = this.sync.characterIds();
    if (ids.length === 0) return false;
    // A character whose display model is still loading keys apart, so its views frame again once it is there (a frame
    // on the joints alone cuts the head top and the hands; AR-D8-4).
    const key = ids
      .map((id) => (this.sync.model(id) === null ? `${id}?` : id))
      .sort()
      .join('|');
    let moved = false;
    for (const pane of this.panes.values()) {
      const resolved = this.resolve(pane);
      if (resolved.kind !== 'view' || resolved.view.touched || resolved.view.autoFramedFor === key) continue;
      this.frameView(pane.id, resolved.view);
      resolved.view.autoFramedFor = key;
      moved = true;
    }
    return moved;
  }

  private frameView(paneId: string, view: ViewCamera): void {
    const pane = this.panes.get(paneId);
    const rect = pane?.element.getBoundingClientRect();
    const aspect = rect !== undefined && rect.width > 0 && rect.height > 0 ? rect.width / rect.height : 1;
    frameCamera(view.nav, this.boundsFor('all'), aspect, this.tightOrthoFrame());
    this.picker.forget(paneId);
  }

  private boundsFor(what: 'selection' | 'all'): SpatialBounds {
    const provided = this.frameBounds?.(what) ?? null;
    if (provided !== null) return provided;
    const selection = this.app.session.getState().selection.controls;
    if (what === 'selection' && selection.length > 0) {
      // Like a DCC transform's bounding box, a selected control frames with the visible controls below it: F on a
      // hand shows its fingers (acceptance round 1: the distal fingers ended up off-screen).
      const selected = new Set(selection);
      const below = new Map<ControlId, boolean>();
      const underSelection = (id: ControlId): boolean => {
        const known = below.get(id);
        if (known !== undefined) return known;
        below.set(id, false); // guards a parent cycle in a damaged document
        const parent = this.app.store.get('controls', id)?.parent ?? null;
        const result = parent !== null && (selected.has(parent) || underSelection(parent));
        below.set(id, result);
        return result;
      };
      const worlds: Float32Array[] = [];
      for (const entry of this.controls.entries()) {
        if (selected.has(entry.id) || (entry.visible && underSelection(entry.id))) worlds.push(entry.world);
      }
      const bounds = pointBounds(worlds);
      if (bounds !== null) return bounds;
    }
    const models = this.sync
      .characterIds()
      .map((id) => this.sync.model(id)?.root)
      .filter((root): root is NonNullable<typeof root> => root !== undefined);
    const worlds: Float32Array[] = [];
    // Rig & Skin frames the character (meshes and joints) for joint fitting: IK pole targets sit far in front of the
    // knees and would shrink the side view to a third (M6b acceptance). Controls belong to characters, whose meshes and
    // joints are framed anyway.
    if (!this.tightOrthoFrame())
      for (const entry of this.controls.entries()) if (entry.visible) worlds.push(entry.world);
    for (const set of this.skeleton.jointSets()) worlds.push(set.positions);
    // Rig & Skin draws bound meshes through mesh-view and hides them in the display model: they count all the same
    // (else the frame fits the joints alone and cuts the head top and the hands; AR-D8-4).
    return (
      unionBounds(measureSpatialBounds(models, this.tightOrthoFrame()), pointBounds(worlds)) ?? {
        minX: -0.4,
        maxX: 0.4,
        minY: 0,
        maxY: 1.8,
        minZ: -0.3,
        maxZ: 0.3,
      }
    );
  }

  private syncShots(): void {
    const records = this.app.store.list('cameras');
    const live = new Set<CameraId>();
    for (const record of records) {
      if (record.deleted !== null) continue;
      live.add(record.id);
      const shot = this.shots.get(record.id);
      const navigating = this.isNavigating(record.id);
      if (shot === undefined) {
        this.shots.set(record.id, createShotCamera(record));
      } else if (!navigating && projectionOf(shot) !== record.projection) {
        // A three camera cannot change its projection: replace it (e.g. an ortho view copied to the shot camera).
        shot.nav.dispose();
        this.shots.set(record.id, createShotCamera(record));
      } else if (shot.record !== record && !navigating) {
        applyShotRecord(shot, record);
      } else {
        shot.record = record;
      }
    }
    for (const [id, shot] of this.shots) {
      if (live.has(id)) continue;
      shot.nav.dispose();
      this.shots.delete(id);
    }
  }

  private isNavigating(id: CameraId): boolean {
    return this.nav?.shot?.cameraId === id || this.wheel?.cameraId === id;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // internals: queries

  private entries(): ReadonlyMap<ControlId, ControlEntry> {
    const version = this.controls.version;
    if (this.entryMap?.version !== version) {
      this.entryMap = { version, map: new Map([...this.controls.entries()].map((entry) => [entry.id, entry])) };
    }
    return this.entryMap.map;
  }

  /** Pane, camera and projector for a query, with poses and the manipulator brought up to date. */
  private queryView(paneId: string): {
    readonly pane: PaneRuntime;
    readonly camera: Camera;
    readonly projector: PaneProjector;
    readonly width: number;
    readonly height: number;
    readonly key: string;
  } | null {
    const pane = this.panes.get(paneId);
    if (pane === undefined) return null;
    this.prepareForQuery();
    const rect = pane.element.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;
    const camera = this.resolve(pane).nav.camera;
    fitCameraToAspect(camera, rect.width / rect.height);
    camera.updateMatrixWorld();
    const projector = new PaneProjector().set(camera, rect.width, rect.height, camera.near);
    const key = `${camera.uuid}|${camera.matrixWorld.elements.join(',')}|${camera.projectionMatrix.elements.join(',')}|${rect.width}x${rect.height}|${this.controls.version}`;
    return { pane, camera, projector, width: rect.width, height: rect.height, key };
  }

  // ---------------------------------------------------------------------------------------------------------------
  // internals: input

  private attachInput(pane: PaneRuntime): void {
    const element = pane.element;
    const signal = pane.abort.signal;
    element.style.touchAction = 'none';
    element.addEventListener('pointerdown', (e) => this.pointerDown(pane, e), { signal });
    element.addEventListener('pointermove', (e) => this.pointerMove(pane, e), { signal });
    element.addEventListener('pointerup', (e) => this.pointerUp(pane, e), { signal });
    element.addEventListener('pointercancel', (e) => this.pointerUp(pane, e, true), { signal });
    element.addEventListener('pointerleave', () => this.setHover(null, null), { signal });
    element.addEventListener('wheel', (e) => this.wheelInput(pane, e), { signal, passive: false });
    element.addEventListener('contextmenu', (e) => e.preventDefault(), { signal });
    element.addEventListener('auxclick', (e) => e.preventDefault(), { signal });
  }

  private local(
    pane: PaneRuntime,
    e: { readonly clientX: number; readonly clientY: number },
  ): { x: number; y: number } {
    const r = pane.element.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private toolEvent(pane: PaneRuntime, e: PointerEvent): ToolPointerEvent {
    const { x, y } = this.local(pane, e);
    const mac = this.app.keymap.platform === 'mac';
    // M6a rule (b): the MMB stand-in reaches the tool as the middle button, Alt and Shift cleared.
    const standIn = this.standIn === e.pointerId;
    return {
      panel: PANEL.viewport,
      paneId: pane.id,
      x,
      y,
      button: standIn && e.button === 0 ? 1 : e.button,
      buttons: standIn ? (e.buttons & 1 ? (e.buttons & ~1) | 4 : e.buttons) : e.buttons,
      shift: standIn ? false : e.shiftKey,
      alt: standIn ? false : e.altKey,
      mod: mac ? e.metaKey : e.ctrlKey,
      ctrl: e.ctrlKey,
      pointerType: e.pointerType === 'pen' || e.pointerType === 'touch' ? e.pointerType : 'mouse',
      timeStamp: e.timeStamp,
      detail: e.detail,
    };
  }

  private pointerDown(pane: PaneRuntime, e: PointerEvent): void {
    this.lastPointerPane = pane.id;
    this.pointerAt = { paneId: pane.id, clientX: e.clientX, clientY: e.clientY };
    if (e.button === 1) e.preventDefault(); // no autoscroll / primary-selection paste
    if (this.nav !== null || this.toolPointer !== null || this.layerPointer !== null || this.virtualSliderActive)
      return;
    // M6a rule (b) (§5.17): in Model on the trackpad and one-button profiles, Alt+Shift+LMB is the MMB stand-in.
    const standIn = isMmbStandIn(this.profile, this.workspace, e);
    this.standIn = standIn ? e.pointerId : null;
    if (standIn) e.preventDefault();
    const button = standIn ? 1 : e.button;
    const alt = standIn ? false : e.altKey;
    // M2a §5.18: a plain MMB drag (no Alt) with Channel Box channels selected runs the virtual slider; Alt+MMB stays
    // navigation, and without selected channels a plain MMB drag does nothing (M1).
    if (button === 1 && !alt && this.startVirtualSlider(pane, e, standIn)) {
      this.standIn = null;
      return;
    }
    const gesture = standIn
      ? null
      : (this.navOverride?.gesture(e, pane.id, this.local(pane, e)) ?? pointerGesture(this.profile, e));
    if (gesture !== null) {
      e.preventDefault();
      this.capture(pane, e.pointerId);
      this.startNav(pane, e, gesture);
      return;
    }
    const tool = this.tool();
    // M6a rule (a) (§5.17, §5.18): marking menus open on the press of their button (RMB is `button 2` only, never the
    // `contextmenu` event); a tool that is placing or dragging keeps its presses (Multi-Cut completes on RMB).
    const phase = tool?.phase?.() ?? 'idle';
    if (!standIn && this.pointerMenus !== null && phase !== 'placing' && phase !== 'dragging') {
      const { x, y } = this.local(pane, e);
      const mac = this.app.keymap.platform === 'mac';
      const press: PanePointerPress = {
        paneId: pane.id,
        x,
        y,
        clientX: e.clientX,
        clientY: e.clientY,
        button: e.button,
        pointerId: e.pointerId,
        shift: e.shiftKey,
        ctrl: e.ctrlKey,
        alt: e.altKey,
        mod: mac ? e.metaKey : e.ctrlKey,
        overMesh: () => this.isOverMesh(pane.id, x, y),
      };
      if (this.pointerMenus(press)) {
        e.preventDefault();
        this.setHover(null, null);
        return;
      }
    }
    if (!standIn && this.pointerLayer?.pointerDown(this.toolEvent(pane, e)) === true) {
      this.layerPointer = { paneId: pane.id, pointerId: e.pointerId };
      this.capture(pane, e.pointerId);
      this.setHover(null, null);
      window.addEventListener('keydown', this.onKeyDown);
      window.addEventListener('blur', this.onBlur);
      this.invalidate();
      return;
    }
    if (tool?.pointerDown?.(this.toolEvent(pane, e)) === true) {
      this.toolPointer = { paneId: pane.id, pointerId: e.pointerId };
      this.capture(pane, e.pointerId);
      this.setHover(null, null);
      window.addEventListener('keydown', this.onKeyDown);
      window.addEventListener('blur', this.onBlur);
      this.invalidate();
    }
  }

  private startVirtualSlider(pane: PaneRuntime, e: PointerEvent, standIn: boolean): boolean {
    if (!this.app.prefs.getState().virtualSlider.viewportMmb) return false;
    const refs = this.app.session.getState().selection.channels;
    if (refs.length === 0) return false;
    // M6a §5.17: the selected channels are rig controls'. Model does not draw them (unless the pane's Show ▸ Controls
    // is on), and a control selection carried over from Animate is never edited or keyed unseen there.
    if (this.workspace === 'model' && !pane.display.controls) return false;
    const drag = startVirtualSliderDrag(this.app, refs, pane.element, e, {
      pointerLock: this.pointerLockAllowed,
      // §5.17 (b): the MMB stand-in is delivered as MMB with Alt and Shift cleared (no ×0.1 from the chord's Shift).
      standIn,
      onEnd: () => {
        this.virtualDrag = null;
        this.invalidate();
      },
    });
    if (drag === null) return false;
    this.virtualDrag = drag;
    this.setHover(null, null);
    return true;
  }

  private pointerMove(pane: PaneRuntime, e: PointerEvent): void {
    this.pointerAt = { paneId: pane.id, clientX: e.clientX, clientY: e.clientY };
    if (this.virtualSliderActive) return;
    const nav = this.nav;
    if (nav !== null) {
      if (nav.pointerId === e.pointerId) this.moveNav(pane, e, nav);
      return;
    }
    const layer = this.layerPointer;
    if (layer !== null) {
      if (layer.pointerId === e.pointerId && layer.paneId === pane.id) {
        this.pointerLayer?.pointerMove(this.toolEvent(pane, e));
        this.invalidate();
      }
      return;
    }
    if (this.toolPointer !== null) {
      if (this.toolPointer.pointerId === e.pointerId && this.toolPointer.paneId === pane.id) {
        this.tool()?.pointerMove?.(this.toolEvent(pane, e));
        this.invalidate();
      }
      return;
    }
    if (e.buttons !== 0) return;
    const { x, y } = this.local(pane, e);
    this.hoverAt(pane.id, x, y);
    this.pointerLayer?.hover?.(pane.id, x, y);
  }

  private pointerUp(pane: PaneRuntime, e: PointerEvent, cancelled = false): void {
    const nav = this.nav;
    if (nav !== null && nav.pointerId === e.pointerId) {
      this.endNav(false);
      this.release(pane, e.pointerId);
      return;
    }
    const layer = this.layerPointer;
    if (layer !== null && layer.pointerId === e.pointerId && layer.paneId === pane.id) {
      this.layerPointer = null;
      this.removeDragListeners();
      if (cancelled) this.pointerLayer?.cancel();
      else this.pointerLayer?.pointerUp(this.toolEvent(pane, e));
      this.release(pane, e.pointerId);
      this.invalidate();
      return;
    }
    const pointer = this.toolPointer;
    if (pointer !== null && pointer.pointerId === e.pointerId && pointer.paneId === pane.id) {
      this.toolPointer = null;
      this.removeDragListeners();
      const tool = this.tool();
      if (cancelled) tool?.cancel?.();
      else tool?.pointerUp?.(this.toolEvent(pane, e));
      this.release(pane, e.pointerId);
      this.invalidate();
    }
    if (this.standIn === e.pointerId) this.standIn = null;
  }

  /** Esc or window blur during a drag: cancel the tool gesture and any navigation in progress. */
  private cancelInteraction(): void {
    this.standIn = null;
    this.virtualDrag?.end(false);
    if (this.layerPointer !== null) {
      this.layerPointer = null;
      this.pointerLayer?.cancel();
      this.invalidate();
    }
    if (this.toolPointer !== null) {
      this.toolPointer = null;
      this.tool()?.cancel?.();
      this.invalidate();
    }
    this.removeDragListeners();
    if (this.nav !== null) this.endNav(true);
  }

  private removeDragListeners(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('blur', this.onBlur);
  }

  private capture(pane: PaneRuntime, pointerId: number): void {
    try {
      pane.element.setPointerCapture(pointerId);
    } catch {
      // Synthetic events in tests have no active pointer to capture.
    }
  }

  private release(pane: PaneRuntime, pointerId: number): void {
    try {
      if (pane.element.hasPointerCapture(pointerId)) pane.element.releasePointerCapture(pointerId);
    } catch {
      // See capture().
    }
  }

  private hoverAt(paneId: string, x: number, y: number): void {
    const view = this.queryView(paneId);
    if (view === null) return;
    const handle = this.kitIn(view.pane) ? this.kit.pick(view.camera, view.projector, view.height, x, y) : null;
    let control: ControlId | null = null;
    if (handle === null && view.pane.display.controls && this.app.session.getState().tools.selectionMask.controls) {
      const projected = this.picker.projections(paneId, view.key, view.projector, this.controls.entries());
      control = this.picker.controlHits(projected, this.entries(), x, y)[0]?.control ?? null;
    }
    this.setHover(control, handle);
  }

  private setHover(control: ControlId | null, handle: ManipHandle | null): void {
    let changed = this.kit.setHover(handle);
    if (control !== this.hoverControl) {
      this.hoverControl = control;
      this.stylesDirty = true;
      changed = true;
    }
    if (changed) this.invalidate();
  }

  /** The session's viewport tool (created on first use), for the keyboard's tool-key bridge (M6A-SPEC §5.17). */
  activeTool(): ToolInstance | null {
    return this.disposed ? null : this.tool();
  }

  private tool(): ToolInstance | null {
    const id = this.app.session.getState().tools.viewport;
    if (id !== this.activeToolId) {
      if (this.activeToolId !== null) this.toolInstances.get(this.activeToolId)?.deactivate?.();
      this.activeToolId = id;
      this.toolInstances.get(id)?.activate?.();
    }
    let instance = this.toolInstances.get(id);
    if (instance === undefined) {
      const def = this.app.tools.get(PANEL.viewport, id);
      if (def === undefined) return null;
      instance = def.create(this.app, this.toolHost);
      this.toolInstances.set(id, instance);
      instance.activate?.();
    }
    return instance;
  }

  // navigation ------------------------------------------------------------------------------------------------------

  private startNav(pane: PaneRuntime, e: PointerEvent, gesture: NavGesture): void {
    this.endWheelBurst();
    const resolved = this.resolve(pane);
    let swallowed = false;
    let shot: ShotNav | null = null;
    let view: NavDrag['view'] = null;
    if (resolved.kind === 'shot') {
      if (resolved.shot.record.locked) {
        swallowed = true;
        this.flashLocked(pane);
      } else {
        shot = this.beginShotNav(resolved.shot);
        swallowed = shot === null;
      }
    } else {
      resolved.view.touched = true;
      view = { nav: resolved.nav, state: resolved.nav.saveState() };
    }
    this.nav = {
      paneId: pane.id,
      pointerId: e.pointerId,
      gesture,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      swallowed,
      shot,
      view,
    };
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('blur', this.onBlur);
  }

  private moveNav(pane: PaneRuntime, e: PointerEvent, nav: NavDrag): void {
    const dx = e.clientX - nav.lastX;
    const dy = e.clientY - nav.lastY;
    nav.lastX = e.clientX;
    nav.lastY = e.clientY;
    if (nav.swallowed || (dx === 0 && dy === 0)) return;
    const resolved = this.resolve(pane);
    const rect = pane.element.getBoundingClientRect();
    const controller = nav.shot?.nav ?? resolved.nav;
    if (nav.gesture === 'tumble') controller.tumble(dx, dy, rect.height);
    else if (nav.gesture === 'track') controller.track(dx, dy, rect.width, rect.height);
    else {
      const ndcX = ((nav.startX - rect.left) / Math.max(rect.width, 1)) * 2 - 1;
      const ndcY = 1 - ((nav.startY - rect.top) / Math.max(rect.height, 1)) * 2;
      controller.dolly((dx - dy) * 0.005, ndcX, ndcY);
    }
    if (nav.shot !== null) this.writeShot(nav.shot);
    this.picker.forget(pane.id);
    this.invalidate();
  }

  private endNav(cancelled: boolean): void {
    const nav = this.nav;
    if (nav === null) return;
    this.nav = null;
    this.removeDragListeners();
    if (nav.shot !== null) this.finishShotNav(nav.shot, cancelled);
    if (cancelled && nav.view !== null) {
      nav.view.nav.restoreState(nav.view.state);
      this.picker.forget(nav.paneId);
      this.invalidate();
    }
  }

  private wheelInput(pane: PaneRuntime, e: WheelEvent): void {
    this.lastPointerPane = pane.id;
    e.preventDefault();
    if (this.nav !== null || this.toolPointer !== null) return;
    const rect = pane.element.getBoundingClientRect();
    const action = wheelAction(this.profile, e, rect.height);
    const resolved = this.resolve(pane);
    let controller = resolved.nav;
    if (resolved.kind === 'shot') {
      if (resolved.shot.record.locked) {
        this.flashLocked(pane);
        return;
      }
      if (this.wheel === null || this.wheel.cameraId !== resolved.shot.id) {
        this.endWheelBurst();
        const shot = this.beginShotNav(resolved.shot);
        if (shot === null) return;
        this.wheel = { ...shot, timer: null };
      }
      controller = this.wheel.nav;
    } else {
      this.endWheelBurst();
      resolved.view.touched = true;
    }
    if (action.kind === 'dolly') {
      const ndcX = ((e.clientX - rect.left) / Math.max(rect.width, 1)) * 2 - 1;
      const ndcY = 1 - ((e.clientY - rect.top) / Math.max(rect.height, 1)) * 2;
      controller.dolly(action.amount, ndcX, ndcY);
    } else if (action.kind === 'tumble') {
      controller.tumble(action.dx, action.dy, rect.height);
    } else {
      controller.track(action.dx, action.dy, rect.width, rect.height);
    }
    const burst = this.wheel;
    if (burst !== null && resolved.kind === 'shot') {
      this.writeShot(burst);
      if (burst.timer !== null) clearTimeout(burst.timer);
      burst.timer = setTimeout(() => this.endWheelBurst(), WHEEL_BURST_MS);
    }
    this.picker.forget(pane.id);
    this.invalidate();
  }

  private endWheelBurst(): void {
    const burst = this.wheel;
    if (burst === null) return;
    this.wheel = null;
    if (burst.timer !== null) clearTimeout(burst.timer);
    this.finishShotNav(burst, false);
  }

  /** Opens the preview that persists a shot-camera gesture; null when another gesture holds the document. */
  private beginShotNav(shot: ShotCamera): ShotNav | null {
    try {
      const preview = this.app.store.beginPreview(SHOT_LABEL);
      shot.nav.lookAt(shot.record.transform.t, shot.record.target);
      return { cameraId: shot.id, nav: shot.nav, preview };
    } catch (error) {
      if (error instanceof EkzaError && (error.code === 'preview-active' || error.code === 'read-only')) return null;
      throw error;
    }
  }

  private writeShot(shot: ShotNav): void {
    if (!shot.preview.active) return;
    const fields = shotTransformOf(shot.nav);
    shot.preview.update((tx) => tx.patch('cameras', shot.cameraId, fields));
  }

  /** One commit per gesture, never on the undo stack (desktop DCCs keep camera moves out of undo too). */
  private finishShotNav(shot: ShotNav, cancelled: boolean): void {
    if (!shot.preview.active) return;
    if (cancelled) shot.preview.cancel();
    else shot.preview.commit({ label: SHOT_LABEL, undoable: false });
  }

  /** Runs a programmatic shot-camera move (framing) as one non-undoable commit. */
  private withShotPreview(shot: ShotCamera, move: () => void): void {
    const nav = this.beginShotNav(shot);
    if (nav === null) return;
    move();
    this.writeShot(nav);
    this.finishShotNav(nav, false);
  }

  private flashLocked(pane: PaneRuntime): void {
    pane.lockFlash++;
    this.refreshPaneStates();
  }

  // ---------------------------------------------------------------------------------------------------------------
  // internals: state and subscriptions

  private subscribe(): void {
    const { app } = this;
    this.disposers.push(
      onScaleKitLoaded(() => {
        this.manipulatorDirty = true;
        this.invalidate();
      }),
      app.evaluation.subscribe(() => {
        this.manipulatorDirty = true;
        this.invalidate();
      }),
      app.store.subscribe((batch) => {
        // M-1: one table scan per batch for every listener (`batchTables`), not two scans of a 1,000-key drag here.
        const tables = batchTables(batch);
        if (batch.origin === 'load' || tables.has('cameras')) {
          this.syncShots();
          this.refreshPaneStates();
          for (const pane of this.panes.values()) this.picker.forget(pane.id);
          this.invalidate();
        }
        if (tables.has('controls') || tables.has('meshes') || tables.has('groups')) this.manipulatorDirty = true;
      }),
      app.session.subscribe((state, previous) => {
        // M6a (§5.17): pane memory per workspace; leaving a workspace cancels a running tool gesture.
        if (state.workspace !== previous.workspace) this.setWorkspace(state.workspace);
        if (
          state.selection.objects !== previous.selection.objects ||
          state.model.componentMode !== previous.model.componentMode
        ) {
          this.manipulatorDirty = true;
          this.invalidate();
        }
        if (state.selection.controls !== previous.selection.controls) {
          this.stylesDirty = true;
          this.manipulatorDirty = true;
          this.invalidate();
        }
        if (state.hoverControl !== previous.hoverControl) {
          this.stylesDirty = true;
          this.invalidate();
        }
        if (state.tools !== previous.tools) {
          if (state.tools.viewport !== previous.tools.viewport) {
            this.scaleKitRequested = false;
            this.tool();
          }
          this.manipulatorDirty = true;
          for (const pane of this.panes.values()) this.picker.forget(pane.id);
          this.invalidate();
        }
        if (state.overrides !== previous.overrides || state.activeClip !== previous.activeClip)
          this.manipulatorDirty = true;
        if (state.time.playing !== previous.time.playing) this.invalidate();
      }),
      app.prefs.subscribe((prefs, previous) => {
        if (prefs.navProfile !== previous.navProfile) this.setNavProfile(prefs.navProfile);
        if (prefs.moveSpace !== previous.moveSpace || prefs.rotateSpace !== previous.rotateSpace) {
          this.manipulatorDirty = true;
          this.invalidate();
        }
      }),
    );
  }

  private stateOf(pane: PaneRuntime): PaneState {
    const binding = pane.camera;
    let cameraKind: 'shot' | 'view' = 'view';
    let preset: ViewPreset | null = binding.kind === 'view' ? binding.preset : 'persp';
    let shotCameraId: CameraId | null = null;
    let cameraName: string = preset ?? 'persp';
    let locked = false;
    if (binding.kind === 'shot') {
      const shot = this.shotFor(binding.cameraId);
      if (shot !== null) {
        cameraKind = 'shot';
        preset = null;
        shotCameraId = shot.id;
        cameraName = shot.record.name;
        locked = shot.record.locked;
      }
    }
    return {
      id: pane.id,
      binding,
      cameraKind,
      preset,
      shotCameraId,
      cameraName,
      locked,
      display: pane.display,
      lockFlash: pane.lockFlash,
      radial: pane.radial,
    };
  }

  private refreshPaneStates(): void {
    let changed = false;
    for (const pane of this.panes.values()) {
      const next = this.stateOf(pane);
      if (!sameState(next, pane.state)) {
        pane.state = next;
        changed = true;
      }
    }
    if (changed) this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  private createToolHost(): ViewportToolHost {
    return {
      pickCandidates: (paneId, x, y) => this.pickCandidates(paneId, x, y),
      pickManipulator: (paneId, x, y) => {
        const view = this.queryView(paneId);
        return view === null || !this.kitIn(view.pane)
          ? null
          : this.kit.pick(view.camera, view.projector, view.height, x, y);
      },
      marquee: (paneId, rect) => this.marquee(paneId, rect),
      setMarquee: (paneId, rect) => this.panes.get(paneId)?.marquee.show(rect),
      beginManipulatorDrag: (paneId, handle, x, y) => this.beginManipulatorDrag(paneId, handle, x, y),
      lockedChannel: (handle) => this.kit.lockedChannel(handle),
      setActiveHandle: (handle) => {
        this.kit.setActive(handle);
        this.invalidate();
      },
      controlForJoint: (character: CharacterId, node: number) => this.controlForNode(character, node),
      beginObjectDrag: (paneId, handle, x, y) => this.beginObjectDrag(paneId, handle, x, y),
    };
  }

  /** The control driving a node (nearest driven ancestor), or null (also while the rig kernel is stubbed). */
  private controlForNode(character: CharacterId, node: number): ControlId | null {
    const runtime = this.app.characters.get(character);
    if (runtime === undefined) return null;
    try {
      return controlForNode(runtime.program, node);
    } catch (error) {
      if (error instanceof EkzaError && error.code === 'not-implemented') return null;
      throw error;
    }
  }

  /** M6a: a Scale tool drag on the selected scene objects (Model object mode), when the manipulator sits on them. */
  private beginObjectDrag(paneId: string, handle: ManipHandle, x: number, y: number): ObjectScaleSession | null {
    const view = this.queryView(paneId);
    const target = this.kit.currentTarget;
    const scale = scaleKit();
    if (view === null || target === null || scale === null || !this.objectTarget || this.modelTarget) return null;
    if (this.kit.currentMode !== 'scale' || !scale.isScaleHandle(handle) || !this.kit.handles().includes(handle)) {
      return null;
    }
    const objects = scale.scaleObjects(this.app);
    if (objects.length === 0) return null;
    return scale.objectScaleDrag({
      handle,
      pivot: target.pivot,
      axes: this.kit.axes(),
      view: { camera: view.camera, projector: view.projector },
      start: { x, y },
      sizePx: this.kit.size,
      objects,
    });
  }

  private beginManipulatorDrag(paneId: string, handle: ManipHandle, x: number, y: number): DragSession | null {
    const view = this.queryView(paneId);
    const target = this.kit.currentTarget;
    if (view === null || target === null || this.objectTarget || this.modelTarget) return null;
    if (!this.kit.handles().includes(handle)) return null;
    // M6A-B9-21: a control target in Model is edited only from a pane that draws controls.
    if (!this.kitIn(view.pane)) return null;
    const controls: DragControl[] = [];
    for (const id of this.app.session.getState().selection.controls) {
      const entry = this.controls.entry(id);
      const record = this.app.store.get('controls', id);
      const runtime = entry === undefined ? undefined : this.app.characters.get(entry.character);
      const placement = entry === undefined ? null : this.sync.placement(entry.character);
      if (entry === undefined || record === undefined || runtime === undefined || placement === null) continue;
      const world = new Float64Array(16);
      multiplyAt(placement, runtime.pose.controlWorld, entry.slot * 16, world);
      const v = this.app.evaluation.channelValues(id);
      const flags = dragFlags(record);
      controls.push(
        dragControl({
          control: id,
          order: record.rotateOrder,
          world,
          t: [v.tx, v.ty, v.tz],
          r: [v.rx, v.ry, v.rz],
          s: [v.sx, v.sy, v.sz],
          keyable: flags.free,
          lockedR: flags.locked.r,
        }),
      );
    }
    if (controls.length === 0) return null;
    const dragView = { camera: view.camera, projector: view.projector };
    if (this.kit.currentMode === 'scale') {
      const scale = scaleKit();
      if (scale === null || !scale.isScaleHandle(handle)) return null;
      return scale.scaleDrag({
        handle,
        pivot: target.pivot,
        axes: this.kit.axes(),
        controls,
        view: dragView,
        start: { x, y },
        sizePx: this.kit.size,
      });
    }
    if (this.kit.currentMode === 'translate') {
      return translateDrag({
        handle,
        pivot: target.pivot,
        axes: this.kit.axes(),
        controls,
        view: dragView,
        start: { x, y },
      });
    }
    const axis = this.kit.ringAxis(handle, view.camera);
    const grab =
      this.kit.ringGrab(handle, view.camera, view.projector, view.height, x, y) ??
      ([target.pivot[0], target.pivot[1] + RING_RADIUS, target.pivot[2]] as Vec3);
    return rotateDrag({
      handle,
      space: this.kit.currentSpace,
      pivot: target.pivot,
      axis,
      grab,
      controls,
      view: dragView,
      start: { x, y },
    });
  }
}

type Axes = [boolean, boolean, boolean];

/**
 * Per-axis translate/rotate flags of a control for the manipulator: `free` channels (keyable and unlocked) are the
 * ones a drag writes; `locked` ones (keyable but locked) make their axis handle report the lock (§4.11.16).
 */
function dragFlags(record: ControlRecord): {
  readonly free: { readonly t: Axes; readonly r: Axes; readonly s: Axes };
  readonly locked: { readonly t: Axes; readonly r: Axes; readonly s: Axes };
} {
  const axes = (test: (k: 0 | 1 | 2) => boolean): Axes => [test(0), test(1), test(2)];
  const free = (keyable: readonly boolean[], locked: readonly boolean[]): Axes =>
    axes((k) => (keyable[k] ?? false) && !(locked[k] ?? false));
  const locked = (keyable: readonly boolean[], lock: readonly boolean[]): Axes =>
    axes((k) => (keyable[k] ?? false) && (lock[k] ?? false));
  return {
    free: {
      t: free(record.keyable.t, record.locked.t),
      r: free(record.keyable.r, record.locked.r),
      s: free(record.keyable.s, record.locked.s),
    },
    locked: {
      t: locked(record.keyable.t, record.locked.t),
      r: locked(record.keyable.r, record.locked.r),
      s: locked(record.keyable.s, record.locked.s),
    },
  };
}

function sameState(a: PaneState, b: PaneState | undefined): boolean {
  if (b === undefined) return false;
  return (
    a.binding === b.binding &&
    a.cameraKind === b.cameraKind &&
    a.preset === b.preset &&
    a.shotCameraId === b.shotCameraId &&
    a.cameraName === b.cameraName &&
    a.locked === b.locked &&
    a.display === b.display &&
    a.lockFlash === b.lockFlash &&
    a.radial === b.radial
  );
}

function projectionOf(shot: ShotCamera): CameraRecord['projection'] {
  return shot.nav.camera instanceof OrthographicCamera ? 'orthographic' : 'perspective';
}

function directionalLight(): DirectionalLight {
  const light = new DirectionalLight(0xffffff, 1.6);
  light.position.set(2.5, 4, 3);
  light.updateMatrixWorld();
  light.target.updateMatrixWorld();
  return light;
}

/** Frames bounds keeping the camera's view direction (perspective: distance; orthographic: zoom). */
function frameCamera(nav: NavigationController, bounds: SpatialBounds, aspect: number, tight: boolean): void {
  const camera = nav.camera;
  const target = nav.target();
  const dir = camera.position.clone().sub(target);
  if (dir.lengthSq() < 1e-12) dir.set(0, 0, 1);
  dir.normalize();
  if (camera instanceof PerspectiveCamera) {
    const fit = fitCameraFrame({ bounds, aspect, verticalFovDegrees: camera.fov });
    const c = fit.target;
    nav.lookAt([c.x + dir.x * fit.distance, c.y + dir.y * fit.distance, c.z + dir.z * fit.distance], [c.x, c.y, c.z]);
    return;
  }
  if (camera instanceof OrthographicCamera) {
    // Rig & Skin fits the bounds as the view sees them (its right and up axes) for joint fitting; elsewhere the padded
    // bounding sphere keeps the room around the content that Model's reference image planes rely on.
    camera.updateMatrixWorld();
    const axes = camera.matrixWorld.elements; // columns 0 and 1: the view's right and up
    const height = tight
      ? fitOrthoViewHeight(bounds, axes.slice(0, 3), axes.slice(4, 7), aspect)
      : fitOrthoHeight(bounds, aspect);
    const c = {
      x: (bounds.minX + bounds.maxX) / 2,
      y: (bounds.minY + bounds.maxY) / 2,
      z: (bounds.minZ + bounds.maxZ) / 2,
    };
    const distance = Math.max(camera.position.distanceTo(target), 10);
    setOrthoHeight(camera, height, aspect);
    camera.updateProjectionMatrix();
    nav.lookAt([c.x + dir.x * distance, c.y + dir.y * distance, c.z + dir.z * distance], [c.x, c.y, c.z]);
    nav.setZoom(1);
  }
}
