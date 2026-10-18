// GraphEditorController (MVP-SPEC §7 WP-6, §4.11.18; ADR 0007): two stacked canvases (base: grid, curves, keys,
// handles; overlay: playhead, hover, marquee, region box, drag readout), a CurveSet of the visible curves,
// hit-testing, the interaction state machine (idle → pressed → drag → commit | cancel) and navigation per profile.
// Edits run through key-edit gestures and the editor-core edit kernel; selection changes go through operators.
//
// M2a (A4): normalized and stacked views (§5.15.2) map each curve affinely (`CurveEntry.scale`/`offset`) with ranges
// frozen while a document preview runs; buffer curves (§5.15.1) draw dashed behind the curves; the scale tool's
// region box (§5.15.3); breakdown glyphs (§5.12). M-1: drags repaint only their curves over a cached static layer,
// and the scheduled (coalesced) preview update runs before each redraw.
import type { CompiledAnimCurve, Disposer, Fps, Frame } from '@ekza-animator/anim-core';
import type { ChangeBatch, ClipRecord, CurveId, KeyId } from '@ekza-animator/doc';
import {
  compileWithAppEngine,
  type CurveBuffer,
  type EditorApp,
  GRAPH_TOOL,
  type KeyPartSelection,
  type OperatorResult,
  PANEL,
  type SelectMode,
  type SessionState,
  type ToolDef,
  type ToolInstance,
  type ToolKeyEvent,
  type ToolPointerEvent,
  type ToolWheelEvent,
} from '@ekza-animator/editor-core';
import { channelLabel } from '../channel-tree/colors';
import { HitScratch, hitTestScene } from '../hit/hitTest';
import { sizeBackingStore } from '../painters/canvas';
import type { OverlayState } from '../painters/overlay';
import { Canvas2DCurveRenderer, type CurveRenderer } from '../painters/renderer';
import { type GraphTheme, readGraphTheme } from '../painters/theme';
import { builtinGraphTool, GRAPH_SELECT_TOOL, type GraphToolHost } from '../tools/graphTools';
import type { GraphHit, GraphViewMode, GraphViewState, RegionHandle } from '../types';
import {
  DEFAULT_VIEW,
  fitView,
  frameToX,
  panView,
  sameView,
  VIEW_LIMITS,
  type ViewBounds,
  valueToY,
  zoomView,
} from '../view/transform';
import { buildCurveSet, type CurveEntry, type CurveSet, drawnOf, EMPTY_CURVE_SET, updateCurveSet } from './curveSet';
import { curvesBounds, keysBounds } from './frame';
import { drawnValueAt, newInfinityMapping } from './geometry';
import {
  DRAG_THRESHOLD_PX,
  type Gesture,
  type GestureHost,
  type GesturePointer,
  KeyMoveGesture,
  PanGesture,
  ZoomGesture,
} from './gestures';
import { defaultPress, draggableKeys, insertPress, middlePress, type PendingPress, type PressContext } from './press';
import { regionHandlePointOf, regionHit, regionOf, ScaleKeysGesture } from './region';
import { type GraphScene, handlePosition, handlesShown, keyX, keyY, type Point } from './scene';
import { KEY_PART, sameKeySelection } from './selection';
import { applyViewMapping, type CurveRange, clampStackedScroll, curveRange, stackedVertical } from './viewMode';

/** Wheel zoom rates per pixel of wheel delta: mouse wheels and pinch (Ctrl+wheel) gestures. */
const WHEEL_ZOOM_RATE = 0.0015;
const PINCH_ZOOM_RATE = 0.01;
/** F / A padding on each side (MVP-SPEC §4.11.18). */
const FRAME_PADDING = 0.08;
/** The value bounds F / A frame in the normalized view (M2A-SPEC §5.15.2). */
const NORMALIZED_BOUNDS = { v0: -1, v1: 1 } as const;
/** Tables whose changes can alter what the Graph Editor draws. */
const WATCHED_TABLES = new Set(['curves', 'keys', 'controls', 'clips', 'project', 'layers']);
/** Above this many edited curves in one batch the whole curve set is rebuilt. */
const MAX_INCREMENTAL_CURVES = 64;

/** PointerEvent.buttons bit of each PointerEvent.button (left, middle, right). */
const BUTTON_BITS: readonly number[] = [1, 4, 2];

const toGesturePointer = (e: ToolPointerEvent): GesturePointer => ({
  x: e.x,
  y: e.y,
  button: e.button,
  shift: e.shift,
  alt: e.alt,
  mod: e.mod,
  ctrl: e.ctrl,
});

export class GraphEditorController {
  readonly app: EditorApp;
  private readonly base: HTMLCanvasElement;
  private readonly overlayCanvas: HTMLCanvasElement;
  private readonly renderer: CurveRenderer;
  private theme: GraphTheme;

  private viewState: GraphViewState = DEFAULT_VIEW;
  private cssWidth = 0;
  private cssHeight = 0;
  private dpr = 1;
  private curveIds: readonly CurveId[] = [];
  private curveSetCache: CurveSet | null = null;
  /** Curves edited since `curveSetCache` was built (their entries are rebuilt on the next read). */
  private readonly editedCurves = new Set<CurveId>();
  /** `setCurves` changed the list since `curveSetCache` was built (entries of curves still shown are reused). */
  private curveListChanged = false;
  private sceneCache: GraphScene | null = null;
  /**
   * The curves of the selected keys, per key selection (M-1: a drag rebuilds the scene every frame, and finding the
   * curve of each of 1,000 selected keys is a store read per key). Dropped by batches that add or remove keys or
   * move one to another curve.
   */
  private selectedCurvesCache: {
    readonly keys: ReadonlyMap<KeyId, unknown>;
    readonly curves: ReadonlySet<CurveId>;
  } | null = null;
  private pendingFrame: 'all' | 'selection' | null = null;
  /**
   * The view follows the shown curves until the user works in the Graph Editor (v0.3 integration): a newly shown set
   * is framed, and again after document edits made elsewhere (keys set from the viewport or the Channel Box), so
   * the first keys — whose curve appeared with a static value and no key — and later ones stay on screen. Any press,
   * wheel, pan or zoom in the editor and an explicit F/A hand the view to the user until the next new curve set.
   */
  private autoFrame = false;
  /** The document changed since the last automatic framing. */
  private autoFrameDirty = false;

  private baseDirty = true;
  private overlayDirty = true;
  private frameRequest: number | null = null;
  private baseRedraws = 0;
  private overlayRedraws = 0;

  private gesture: Gesture | null = null;
  private pending: PendingPress | null = null;
  private toolCapture = false;
  private pointer: GesturePointer | null = null;
  private pressButton = 0;
  /** Tool of the last LMB press: a double-click needs both presses on the same tool (acceptance round 1). */
  private lastPressTool: string | null = null;
  private hover: OverlayState['hover'] = null;
  /** The document changed under a resting pointer: the hover target is recomputed before the next overlay. */
  private hoverStale = false;
  private tool: { readonly id: string; readonly def: ToolDef; readonly instance: ToolInstance } | null = null;

  // ---------- M2a (A4) ----------
  private mode: GraphViewMode = 'absolute';
  private readonly viewModeListeners = new Set<(mode: GraphViewMode) => void>();
  /** Per-curve value ranges of the mapped views, frozen while a document preview runs (§5.15.2). */
  private readonly ranges = new Map<CurveId, CurveRange>();
  private readonly rangeCache = new WeakMap<CurveEntry, CurveRange | null>();
  /** The set the view mapping was last applied to, and under which mode / freeze state. */
  private mapped: { set: CurveSet; mode: GraphViewMode; frozen: boolean } | null = null;
  /** Lanes the stacked view was last fitted to. */
  private stackedLanes = -1;
  private fittingLanes = false;
  private readonly bufferCache = new WeakMap<CurveBuffer, CompiledAnimCurve>();
  /** M-1 mechanism 5: bumps whenever what the static layer shows changes. */
  private staticVersion = 0;
  private drawing = false;

  private readonly hitScratch = new HitScratch();
  private readonly valueScratch = new Float64Array(8);
  private readonly mapping = newInfinityMapping();
  private readonly point: Point = { x: 0, y: 0 };
  private readonly disposers: Disposer[] = [];
  private disposed = false;

  /** The interface tools use (GraphToolHost). */
  readonly host: GraphToolHost;
  private readonly gestureHost: GestureHost;
  private readonly pressContext: PressContext;

  constructor(opts: {
    readonly app: EditorApp;
    readonly base: HTMLCanvasElement;
    readonly overlay: HTMLCanvasElement;
  }) {
    this.app = opts.app;
    this.base = opts.base;
    this.overlayCanvas = opts.overlay;
    this.theme = readGraphTheme(opts.base);
    this.renderer = new Canvas2DCurveRenderer(opts.base, opts.overlay, () => this.theme);
    this.host = {
      controller: this,
      hitTest: (x, y) => this.hitTest(x, y),
      press: (e, o) => this.pressDefault(e, o.empty),
      pressInsert: (e, hit) => this.pressInsert(e, hit),
      pressScale: (e) => this.pressScale(e),
    };
    const view = (): GraphViewState => this.viewState;
    const height = (): number => this.cssHeight;
    this.gestureHost = {
      app: this.app,
      get view() {
        return view();
      },
      get height() {
        return height();
      },
      scene: () => this.scene(),
      setView: (next) => {
        this.autoFrame = false;
        this.setView(next);
      },
      invalidateOverlay: () => this.invalidateOverlay(),
      report: (label, error) => this.report(label, error),
      selectKeys: (items, mode) => this.selectKeys(items, mode),
      forgetKeys: (keys) => this.forgetKeys(keys),
    };
    this.pressContext = {
      app: this.app,
      gestures: this.gestureHost,
      hitScratch: this.hitScratch,
      scene: () => this.scene(),
      hitTest: (x, y) => this.hitTest(x, y),
      selectKeys: (items, mode) => this.selectKeys(items, mode),
      selectCurveKeys: (curve, mode) => this.run('select.curveKeys', { curve, mode }),
      insertKey: (curve, frame) => this.insertKey(curve, frame),
    };
    this.disposers.push(
      this.app.store.subscribe((batch) => this.onBatch(batch)),
      this.app.session.subscribe((state, previous) => this.onSession(state, previous)),
      this.app.prefs.subscribe((prefs, previous) => {
        if (prefs.graphHandles !== previous.graphHandles) this.invalidateBase();
      }),
    );
  }

  // ---------------------------------------------------------------------------------------------------------------
  // View and curves

  /** M2a §5.15.2: how curves are drawn (absolute values, normalized to −1…1, or one normalized lane each). */
  get viewMode(): GraphViewMode {
    return this.mode;
  }

  /**
   * M2a §5.15.2: switches the view mode. The time axis is kept; the value axis is refitted (absolute: every curve's
   * values, normalized: −1…1, stacked: the lanes). The data never changes.
   */
  setViewMode(mode: GraphViewMode): void {
    if (mode !== 'absolute' && mode !== 'normalized' && mode !== 'stacked') return;
    if (mode === this.mode) return;
    this.mode = mode;
    this.ranges.clear();
    this.mapped = null;
    this.stackedLanes = -1;
    this.sceneCache = null;
    this.fitValueAxis();
    this.invalidateBase();
    for (const listener of this.viewModeListeners) listener(mode);
  }

  /** Called after every view-mode change (the panel persists it with the layout). */
  onViewModeChange(listener: (mode: GraphViewMode) => void): Disposer {
    this.viewModeListeners.add(listener);
    return () => {
      this.viewModeListeners.delete(listener);
    };
  }

  /**
   * M2a §5.15.3: a grab point of the scale tool's region box (canvas CSS px); null unless the scale tool is active
   * with selected keys shown.
   */
  regionHandlePoint(handle: RegionHandle): { readonly x: number; readonly y: number } | null {
    const region = this.scene().region;
    if (region === null) return null;
    const point = regionHandlePointOf(region, handle);
    return this.onCanvas(point.x, point.y);
  }

  /** M-1: static-layer repaints of the renderer (tests). */
  get staticRenders(): number {
    return (this.renderer as { staticRenders?: number }).staticRenders ?? 0;
  }

  get view(): GraphViewState {
    return this.viewState;
  }

  /** Curves shown (in `setCurves` order, duplicates removed). */
  get curves(): readonly CurveId[] {
    return this.curveIds;
  }

  /** Canvas CSS size. */
  get size(): { readonly width: number; readonly height: number } {
    return { width: this.cssWidth, height: this.cssHeight };
  }

  /** True while a drag or a press is in progress. */
  get busy(): boolean {
    return this.gesture !== null || this.pending !== null || this.toolCapture;
  }

  /** Redraw counters (the idle budget expects them to stay put while nothing changes). */
  get stats(): { readonly baseRedraws: number; readonly overlayRedraws: number } {
    return { baseRedraws: this.baseRedraws, overlayRedraws: this.overlayRedraws };
  }

  setView(view: GraphViewState): void {
    // The stacked view keeps its lane height (only the lane fit changes it); time zoom and vertical scroll work.
    if (this.mode === 'stacked' && !this.fittingLanes && this.viewState.sy !== view.sy) {
      this.setView({ ...view, v0: this.viewState.v0, sy: this.viewState.sy });
      return;
    }
    const valid =
      Number.isFinite(view.f0) && Number.isFinite(view.v0) && Number.isFinite(view.sx) && Number.isFinite(view.sy);
    if (!valid || !(view.sx > 0) || !(view.sy > 0)) return;
    const next: GraphViewState = {
      f0: view.f0,
      v0: view.v0,
      sx: Math.min(Math.max(view.sx, VIEW_LIMITS.minSx), VIEW_LIMITS.maxSx),
      sy: Math.min(Math.max(view.sy, VIEW_LIMITS.minSy), VIEW_LIMITS.maxSy),
    };
    const clamped =
      this.mode === 'stacked' ? clampStackedScroll(next, this.curveSet().entries.length, this.cssHeight) : next;
    if (sameView(clamped, this.viewState)) return;
    this.viewState = clamped;
    this.sceneCache = null;
    this.invalidateBase();
  }

  /**
   * Shows `curves`. A set that shares no curve with the previous one is framed (frame all) so newly loaded curves are
   * on screen — once it has keys (`autoFrame`).
   */
  setCurves(curves: readonly CurveId[]): void {
    const next = [...new Set(curves)];
    if (next.length === this.curveIds.length && next.every((id, i) => id === this.curveIds[i])) return;
    const previous = new Set(this.curveIds);
    const disjoint = next.length > 0 && !next.some((id) => previous.has(id));
    this.curveIds = next;
    this.curveListChanged = true;
    this.invalidateBase();
    if (disjoint) {
      this.autoFrame = true;
      this.frameView('all');
    }
  }

  /** F / A: frames the selection or every shown curve; the view is the user's from now on. */
  frame(what: 'all' | 'selection'): void {
    this.autoFrame = false;
    this.frameView(what);
  }

  private frameView(what: 'all' | 'selection'): void {
    if (!(this.cssWidth > 0 && this.cssHeight > 0)) {
      this.pendingFrame = what;
      return;
    }
    this.pendingFrame = null;
    const set = this.curveSet();
    let bounds: ViewBounds | null = null;
    if (what === 'selection') {
      const selection = this.app.session.getState().selection.keys;
      const keys: { entry: CurveEntry; index: number }[] = [];
      for (const [key, parts] of selection) {
        const found = set.byKey.get(key);
        if (found !== undefined && (parts.key || parts.in || parts.out)) keys.push(found);
      }
      if (keys.length > 0) bounds = keysBounds(keys);
      else {
        const focus = this.scene().focus;
        bounds = curvesBounds(focus === null ? set.entries : set.entries.filter((entry) => focus.has(entry.id)));
      }
    } else {
      bounds = curvesBounds(set.entries);
    }
    if (bounds === null) {
      // Nothing to frame: show the active clip's range and keep the value axis.
      const clip = this.activeClip();
      if (clip === null) return;
      const range = { f0: clip.range.start, f1: clip.range.end, v0: 0, v1: 0 };
      const fitted = fitView(this.viewState, range, this.cssWidth, this.cssHeight, FRAME_PADDING);
      this.setView({ ...fitted, v0: this.viewState.v0, sy: this.viewState.sy });
      return;
    }
    // §5.15.2: F / A frame time in the stacked view, time and −1…1 in the normalized view.
    if (this.mode === 'normalized') bounds = { ...bounds, ...NORMALIZED_BOUNDS };
    const fitted = fitView(this.viewState, bounds, this.cssWidth, this.cssHeight, FRAME_PADDING);
    if (this.mode === 'stacked') this.setView({ ...fitted, v0: this.viewState.v0, sy: this.viewState.sy });
    else this.setView(fitted);
  }

  /** The value axis for the current mode, keeping the time axis (mode switches, stacked lane changes). */
  private fitValueAxis(): void {
    if (!(this.cssWidth > 0 && this.cssHeight > 0)) return;
    if (this.mode === 'stacked') {
      const lanes = this.curveSet().entries.length;
      this.stackedLanes = lanes;
      const vertical = stackedVertical(lanes, this.cssHeight);
      this.fittingLanes = true;
      try {
        this.setView({ ...this.viewState, ...vertical });
      } finally {
        this.fittingLanes = false;
      }
      return;
    }
    this.ensureMapping(this.curveSet());
    const bounds =
      this.mode === 'normalized' ? { f0: 0, f1: 0, ...NORMALIZED_BOUNDS } : curvesBounds(this.curveSet().entries);
    if (bounds === null) return;
    const fitted = fitView(this.viewState, bounds, this.cssWidth, this.cssHeight, FRAME_PADDING);
    this.setView({ ...this.viewState, v0: fitted.v0, sy: fitted.sy });
  }

  resize(cssWidth: number, cssHeight: number, dpr: number): void {
    const width = Math.max(0, cssWidth);
    const height = Math.max(0, cssHeight);
    const ratio = dpr > 0 && Number.isFinite(dpr) ? dpr : 1;
    const changed = width !== this.cssWidth || height !== this.cssHeight || ratio !== this.dpr;
    this.cssWidth = width;
    this.cssHeight = height;
    this.dpr = ratio;
    const baseResized = sizeBackingStore(this.base, width, height, ratio);
    const overlayResized = sizeBackingStore(this.overlayCanvas, width, height, ratio);
    if (this.base.isConnected) this.theme = readGraphTheme(this.base);
    if (changed || baseResized || overlayResized) {
      this.sceneCache = null;
      this.staticVersion++;
      this.baseDirty = true;
      this.overlayDirty = true;
      if (this.mode === 'stacked' && changed) this.fitValueAxis();
      this.schedule();
    }
    if (this.pendingFrame !== null && width > 0 && height > 0) this.frameView(this.pendingFrame);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Queries (canvas CSS px)

  hitTest(x: number, y: number): GraphHit {
    return hitTestScene(this.scene(), x, y, this.hitScratch);
  }

  keyPoint(key: KeyId): { readonly x: number; readonly y: number } | null {
    const scene = this.scene();
    const found = scene.curves.byKey.get(key);
    if (found === undefined) return null;
    return this.onCanvas(keyX(scene, found.entry, found.index), keyY(scene, found.entry, found.index));
  }

  handlePoint(key: KeyId, side: 'in' | 'out'): { readonly x: number; readonly y: number } | null {
    const scene = this.scene();
    const found = scene.curves.byKey.get(key);
    if (found === undefined || found.entry.locked || !handlesShown(scene, found.entry, found.index)) return null;
    const p = handlePosition(scene, found.entry, found.index, side, this.point);
    return this.onCanvas(p.x, p.y);
  }

  curvePoint(curve: CurveId, frame: Frame): { readonly x: number; readonly y: number } | null {
    const scene = this.scene();
    const entry = scene.curves.byCurve.get(curve);
    if (entry === undefined) return null;
    const value = drawnValueAt(entry.compiled, frame, this.valueScratch, this.mapping);
    if (!Number.isFinite(value)) return null;
    return this.onCanvas(frameToX(scene.view, frame), valueToY(scene.view, scene.height, drawnOf(entry, value)));
  }

  /** CSS cursor for the canvas: the active gesture's, else the tool's. */
  cursor(): string {
    if (this.gesture?.kind === 'pan') return 'grabbing';
    if (this.gesture?.kind === 'zoom') return 'zoom-in';
    if (this.gesture?.kind === 'keys' || this.gesture?.kind === 'handles') return 'move';
    if (this.gesture?.kind === 'scale') return 'ew-resize';
    return this.activeTool().cursor?.() ?? 'default';
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Input

  pointerDown(e: ToolPointerEvent): void {
    if (this.disposed) return;
    this.autoFrame = false;
    if (this.busy) {
      // One gesture at a time; a press whose button is no longer down lost its release (outside the window
      // without capture), so its gesture is cancelled and the new press starts fresh.
      if ((e.buttons & (BUTTON_BITS[this.pressButton] ?? 0)) !== 0) return;
      this.cancel();
    }
    this.pointer = toGesturePointer(e);
    this.pressButton = e.button;
    this.setHover(null);
    const navigation = this.navigationGesture(e);
    if (navigation !== null) {
      this.gesture = navigation;
      return;
    }
    if (e.button === 1) {
      // Maya: MMB drag anywhere moves the current key/handle selection.
      this.pending = middlePress(this.pressContext, toGesturePointer(e));
      return;
    }
    if (e.button !== 0) return;
    this.toolCapture = false;
    // An Insert-tool click followed by a Select-tool click (Q in between) is two single clicks, not a double-click
    // on the curve that would select all its keys.
    const toolId = this.app.session.getState().tools.graph;
    const press = this.lastPressTool === toolId || e.detail <= 1 ? e : { ...e, detail: 1 };
    this.lastPressTool = toolId;
    const consumed = this.activeTool().pointerDown?.(press) ?? false;
    // A tool that consumed the press without starting a host press receives the rest of the pointer stream.
    if (consumed && this.pending === null && this.gesture === null) this.toolCapture = true;
  }

  pointerMove(e: ToolPointerEvent): void {
    if (this.disposed) return;
    const p = toGesturePointer(e);
    this.pointer = p;
    if (this.gesture !== null) {
      this.gesture.update(p);
      this.invalidateOverlay();
      return;
    }
    const pending = this.pending;
    if (pending !== null) {
      if (Math.hypot(p.x - pending.start.x, p.y - pending.start.y) < DRAG_THRESHOLD_PX) return;
      this.pending = null;
      this.gesture = pending.drag?.() ?? null;
      this.gesture?.update(p);
      this.invalidateOverlay();
      return;
    }
    if (this.toolCapture) {
      this.activeTool().pointerMove?.(e);
      return;
    }
    if (e.buttons === 0) this.updateHover(p);
  }

  pointerUp(e: ToolPointerEvent): void {
    if (this.disposed) return;
    const p = toGesturePointer(e);
    this.pointer = p;
    const gesture = this.gesture;
    if (gesture !== null) {
      this.gesture = null;
      gesture.commit(p);
      this.invalidateOverlay();
      return;
    }
    const pending = this.pending;
    if (pending !== null) {
      this.pending = null;
      pending.click?.();
      return;
    }
    if (this.toolCapture) {
      this.toolCapture = false;
      this.activeTool().pointerUp?.(e);
    }
  }

  wheel(e: ToolWheelEvent): void {
    if (this.disposed || this.busy) return;
    this.autoFrame = false;
    const profile = this.app.prefs.getState().navProfile;
    if (profile === 'trackpad' && !e.ctrl) {
      // Two-finger scroll pans (content follows the fingers like a scrolled page).
      this.setView(panView(this.viewState, -e.deltaX, -e.deltaY));
      return;
    }
    // Maya wheel (and pinch, which arrives as Ctrl+wheel): zoom around the cursor; Shift value axis, Alt time axis.
    const delta = e.deltaY !== 0 ? e.deltaY : e.deltaX;
    const factor = Math.exp(-delta * (e.ctrl ? PINCH_ZOOM_RATE : WHEEL_ZOOM_RATE));
    const fx = e.shift ? 1 : factor;
    // The stacked view keeps its lane height (§5.15.2): the wheel zooms time only.
    const fy = e.alt || this.mode === 'stacked' ? 1 : factor;
    this.setView(zoomView(this.viewState, this.cssHeight, e.x, e.y, fx, fy));
  }

  key(e: ToolKeyEvent): boolean {
    if (this.disposed) return false;
    if (this.gesture !== null || this.pending !== null) {
      if (e.type === 'down' && e.code === 'Escape') {
        this.cancel();
        return true;
      }
      const pointer = this.pointer;
      if (this.gesture !== null && pointer !== null && isModifierCode(e.code)) {
        const p = { ...pointer, shift: e.shift, alt: e.alt, mod: e.mod };
        this.pointer = p;
        this.gesture.update(p);
        this.invalidateOverlay();
      }
      return false;
    }
    if (this.toolCapture && e.type === 'down' && e.code === 'Escape') {
      this.toolCapture = false;
      this.activeTool().cancel?.();
      return true;
    }
    return this.activeTool().key?.(e) ?? false;
  }

  /** Cancels the press or drag in progress (Esc, pointer cancel, blur): previews roll back, no history step. */
  cancel(): void {
    const gesture = this.gesture;
    this.gesture = null;
    this.pending = null;
    gesture?.cancel();
    if (this.toolCapture) {
      this.toolCapture = false;
      this.activeTool().cancel?.();
    }
    this.invalidateOverlay();
  }

  /** The pointer left the canvas: drop the hover highlight. */
  pointerLeave(): void {
    if (!this.busy) this.pointer = null;
    this.setHover(null);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Drawing

  /** Draws dirty layers; call from R3F addAfterEffect or rAF. */
  redraw(force?: boolean): void {
    if (this.disposed) return;
    if (this.frameRequest !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this.frameRequest);
    }
    this.frameRequest = null;
    if (!(this.cssWidth > 0 && this.cssHeight > 0)) return;
    // M-1: a coalesced drag update scheduled for this frame lands before the frame is drawn (whichever of the
    // GL frame loop and this canvas's own rAF runs first), so a frame never shows the previous pointer position.
    this.drawing = true;
    try {
      this.app.flushScheduled();
    } catch (error) {
      this.report('Update', error);
    } finally {
      this.drawing = false;
    }
    if (this.autoFrame && this.autoFrameDirty && this.gesture === null && this.pending === null) {
      this.autoFrameDirty = false;
      this.frameView('all');
    }
    const drawBase = force === true || this.baseDirty;
    const drawOverlay = force === true || this.overlayDirty;
    if (!drawBase && !drawOverlay) return;
    const scene = this.scene();
    if (drawBase) {
      this.baseDirty = false;
      this.baseRedraws++;
      const dynamic = this.gesture?.dynamic;
      this.renderer.renderBase(
        scene,
        dynamic === undefined || force === true ? null : { dynamic, staticVersion: this.staticVersion },
      );
    }
    if (drawOverlay) {
      if (this.hoverStale) {
        this.hoverStale = false;
        const pointer = this.pointer;
        if (pointer !== null && !this.busy) this.updateHover(pointer);
      }
      this.overlayDirty = false;
      this.overlayRedraws++;
      this.renderer.renderOverlay(scene, {
        hover: this.gesture === null ? this.hover : null,
        marquee: null,
        readout: null,
        ...this.gesture?.overlay(),
      });
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.cancel();
    this.disposed = true;
    if (this.frameRequest !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this.frameRequest);
    }
    this.frameRequest = null;
    for (const dispose of this.disposers.splice(0).reverse()) dispose();
    this.tool?.instance.deactivate?.();
    this.tool = null;
    this.renderer.dispose();
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Internals

  private invalidateBase(staticToo = true): void {
    if (staticToo) this.staticVersion++;
    this.sceneCache = null;
    this.baseDirty = true;
    // Keys may have moved under a resting pointer: the overlay redraws with a recomputed hover target.
    this.overlayDirty = true;
    if (this.hover !== null) this.hoverStale = true;
    this.schedule();
  }

  private invalidateOverlay(): void {
    this.overlayDirty = true;
    this.schedule();
  }

  private schedule(): void {
    if (this.disposed || this.drawing || this.frameRequest !== null || typeof requestAnimationFrame !== 'function') {
      return;
    }
    this.frameRequest = requestAnimationFrame(() => {
      this.frameRequest = null;
      this.redraw();
    });
  }

  /**
   * Document changes: key and curve edits (drags, operators) rebuild only the edited curves' entries; anything else
   * that affects drawing (controls, clips, layers, project, loads) rebuilds the whole curve set.
   */
  private onBatch(batch: ChangeBatch): void {
    let full = batch.origin === 'load';
    let touched = full;
    // M-1 mechanism 5: a drag's own preview batches change only its dynamic curves; the static layer stays.
    const dynamic = this.gesture?.dynamic;
    let staticTouched = dynamic === undefined;
    // M-1: a drag batch is 1,000 key updates in runs of one curve; an update on the curve of the update before it
    // changes nothing below (one comparison instead of the set work per key).
    let lastCurve: CurveId | undefined;
    for (const change of batch.changes) {
      if (full) break;
      if (!WATCHED_TABLES.has(change.table)) continue;
      touched = true;
      if (change.table === 'keys') {
        const before = change.before?.curve;
        const after = change.after?.curve;
        if (before === after && before === lastCurve) continue;
        lastCurve = before === after ? before : undefined;
        if (before !== undefined) this.editedCurves.add(before);
        if (after !== undefined) this.editedCurves.add(after);
        if (before !== after) this.selectedCurvesCache = null;
        if (
          !staticTouched &&
          ((before !== undefined && !dynamic?.has(before)) || (after !== undefined && !dynamic?.has(after)))
        ) {
          staticTouched = true;
        }
      } else if (change.table === 'curves') {
        this.editedCurves.add(change.id);
        staticTouched ||= dynamic?.has(change.id) !== true;
      } else {
        full = true;
      }
    }
    if (!touched) return;
    if (full) this.selectedCurvesCache = null;
    this.autoFrameDirty = true;
    if (full || this.editedCurves.size > MAX_INCREMENTAL_CURVES) this.dropCurveSet();
    // A preview that just ended (commit, cancel) unfreezes the mapped views' ranges.
    if (this.mapped?.frozen === true && this.app.store.preview === null) this.mapped = null;
    this.invalidateBase(full || staticTouched);
  }

  private dropCurveSet(): void {
    this.curveSetCache = null;
    this.editedCurves.clear();
    this.curveListChanged = false;
    this.mapped = null;
  }

  private onSession(state: SessionState, previous: SessionState): void {
    if (state.tools.graph !== previous.tools.graph) {
      // The scale tool's region box is part of the scene (§5.15.3).
      this.sceneCache = null;
      this.invalidateOverlay();
    }
    if (state.curveBuffers !== previous.curveBuffers) this.invalidateBase();
    if (state.activeCharacter !== previous.activeCharacter || state.activeClip !== previous.activeClip) {
      this.dropCurveSet();
      this.invalidateBase();
      return;
    }
    if (
      !sameKeySelection(state.selection.keys, previous.selection.keys) ||
      state.selection.channels !== previous.selection.channels ||
      state.time.playbackRange !== previous.time.playbackRange
    ) {
      this.invalidateBase();
    }
    if (state.time.sceneFrame !== previous.time.sceneFrame) {
      this.sceneCache = null;
      this.invalidateOverlay();
    }
  }

  private curveSet(): CurveSet {
    if (this.curveSetCache === null) {
      this.curveSetCache = this.curveIds.length === 0 ? EMPTY_CURVE_SET : buildCurveSet(this.app, this.curveIds);
    } else if (this.editedCurves.size > 0 || this.curveListChanged) {
      this.curveSetCache = updateCurveSet(this.app, this.curveSetCache, this.curveIds, this.editedCurves);
    }
    this.editedCurves.clear();
    this.curveListChanged = false;
    this.ensureMapping(this.curveSetCache);
    return this.curveSetCache;
  }

  /**
   * §5.15.2: applies the view mapping to the set's entries. Ranges are frozen while a document preview runs (a drag
   * in this or another panel): a curve keeps the range it had when the preview began; afterwards they are recomputed.
   */
  private ensureMapping(set: CurveSet): void {
    const frozen = this.app.store.preview !== null;
    const mapped = this.mapped;
    if (mapped !== null && mapped.set === set && mapped.mode === this.mode && mapped.frozen === frozen) return;
    const rangeOf = (entry: CurveEntry): CurveRange | null => {
      const held = this.ranges.get(entry.id);
      if (frozen && held !== undefined) return held;
      let range = this.rangeCache.get(entry);
      if (range === undefined) {
        range = curveRange(entry, this.valueScratch);
        this.rangeCache.set(entry, range);
      }
      if (range === null) this.ranges.delete(entry.id);
      else this.ranges.set(entry.id, range);
      return range;
    };
    applyViewMapping(set.entries, this.mode, rangeOf);
    this.mapped = { set, mode: this.mode, frozen };
  }

  private activeClip(): ClipRecord | null {
    const state = this.app.session.getState();
    const character = state.activeCharacter;
    const clipId = character === null ? undefined : state.activeClip[character];
    return clipId === undefined ? null : (this.app.store.get('clips', clipId) ?? null);
  }

  private scene(): GraphScene {
    if (this.sceneCache !== null) return this.sceneCache;
    const curves = this.curveSet();
    const state = this.app.session.getState();
    const selection = state.selection;
    const focus = new Set<CurveId>();
    for (const curve of this.selectedCurves(selection.keys)) if (curves.byCurve.has(curve)) focus.add(curve);
    if (selection.channels.length > 0) {
      for (const entry of curves.entries) {
        if (selection.channels.some((ref) => ref.control === entry.record.control && ref.channel === entry.channel)) {
          focus.add(entry.id);
        }
      }
    }
    const clip = this.activeClip();
    const character = state.activeCharacter;
    const playhead = clip === null || character === null ? null : this.app.evaluation.clipFrame(character);
    let range: GraphScene['range'] = clip === null ? null : clip.range;
    const playback = state.time.playbackRange;
    if (clip !== null && playback !== null) {
      const sceneFps = this.app.store.get('project', 'project')?.sceneFps ?? { num: 30, den: 1 };
      range = { start: sceneToClip(sceneFps, clip, playback.start), end: sceneToClip(sceneFps, clip, playback.end) };
    }
    // §5.15.2: the stacked view refits its lanes when the number of curves changes.
    if (this.mode === 'stacked' && curves.entries.length !== this.stackedLanes) this.fitValueAxis();
    const base = {
      view: this.viewState,
      width: this.cssWidth,
      height: this.cssHeight,
      curves,
      selection: selection.keys,
      handles: this.app.prefs.getState().graphHandles,
      focus: focus.size === 0 ? null : focus,
      range,
      playhead,
      mode: this.mode,
      buffers: this.buffersOf(curves, state.curveBuffers),
      lanes: this.mode === 'stacked' ? this.lanesOf(curves) : null,
      region: null,
    };
    this.sceneCache = { ...base, region: state.tools.graph === GRAPH_TOOL.scale ? regionOf(base) : null };
    return this.sceneCache;
  }

  /** The curves the selected keys belong to (cached per selection, see `selectedCurvesCache`). */
  private selectedCurves(keys: ReadonlyMap<KeyId, unknown>): ReadonlySet<CurveId> {
    const cached = this.selectedCurvesCache;
    if (cached !== null && cached.keys === keys) return cached.curves;
    const curves = new Set<CurveId>();
    for (const key of keys.keys()) {
      const curve = this.app.store.get('keys', key)?.curve;
      if (curve !== undefined) curves.add(curve);
    }
    this.selectedCurvesCache = { keys, curves };
    return curves;
  }

  /** §5.15.1: compiled buffers of the shown curves (compiled once per buffer with the app's curve engine). */
  private buffersOf(
    curves: CurveSet,
    buffers: ReadonlyMap<CurveId, CurveBuffer>,
  ): ReadonlyMap<CurveId, CompiledAnimCurve> {
    const out = new Map<CurveId, CompiledAnimCurve>();
    if (buffers.size === 0) return out;
    for (const entry of curves.entries) {
      const buffer = buffers.get(entry.id);
      if (buffer === undefined) continue;
      let compiled = this.bufferCache.get(buffer);
      if (compiled === undefined) {
        compiled = compileWithAppEngine(this.app, buffer.curve);
        this.bufferCache.set(buffer, compiled);
      }
      out.set(entry.id, compiled);
    }
    return out;
  }

  /** §5.15.2: one lane per shown curve, labelled with its control and channel. */
  private lanesOf(curves: CurveSet): GraphScene['lanes'] {
    return curves.entries.map((entry) => {
      const control = this.app.store.get('controls', entry.record.control);
      return {
        curve: entry.id,
        label: `${control?.name ?? ''} ${channelLabel(entry.channel)}`.trim(),
        color: entry.color,
      };
    });
  }

  private onCanvas(x: number, y: number): { readonly x: number; readonly y: number } | null {
    const slack = 0.5;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    if (x < -slack || y < -slack || x > this.cssWidth + slack || y > this.cssHeight + slack) return null;
    return { x, y };
  }

  private activeTool(): ToolInstance {
    const id = this.app.session.getState().tools.graph;
    if (this.tool !== null && this.tool.id === id) return this.tool.instance;
    const def: ToolDef = this.app.tools.get(PANEL.graph, id) ?? builtinGraphTool(id) ?? GRAPH_SELECT_TOOL;
    if (this.tool !== null && this.tool.def === def) return this.tool.instance;
    this.tool?.instance.deactivate?.();
    const instance = def.create(this.app, this.host);
    instance.activate?.();
    this.tool = { id, def, instance };
    return instance;
  }

  private navigationGesture(e: ToolPointerEvent): Gesture | null {
    const start = toGesturePointer(e);
    // Maya: Alt+MMB pan, Alt+RMB zoom (every profile; a trackpad user with a mouse keeps them).
    if (e.alt && e.button === 1) return new PanGesture(this.gestureHost, start);
    if (e.alt && e.button === 2) return new ZoomGesture(this.gestureHost, start);
    // One-button macOS profile (M1-stretch): Option+Cmd+LMB pan, Option+Ctrl+LMB zoom.
    if (this.app.prefs.getState().navProfile === 'mayaOneButton' && e.alt && e.button === 0) {
      if (e.ctrl) return new ZoomGesture(this.gestureHost, start);
      if (e.mod) return new PanGesture(this.gestureHost, start);
    }
    return null;
  }

  /** GraphToolHost.press: the Select/Move tool press. */
  private pressDefault(e: ToolPointerEvent, empty: 'marquee' | 'move'): void {
    this.pending = defaultPress(this.pressContext, toGesturePointer(e), e.detail, empty);
  }

  /**
   * GraphToolHost.pressScale (§5.15.3, Scale tool): on a region edge or corner a drag scales around the opposite
   * one; inside the region (off keys) a drag moves the keys; outside, with keys selected, a drag scales around the
   * press point and a click clears the selection; presses on keys, handles and curves select like the Select tool.
   */
  private pressScale(e: ToolPointerEvent): void {
    const start = toGesturePointer(e);
    const scene = this.scene();
    const region = scene.region;
    const handle = region === null ? null : regionHit(region, e.x, e.y);
    if (region !== null && handle !== null && handle !== 'inside') {
      this.pending = { start, drag: () => new ScaleKeysGesture(this.gestureHost, start, region, handle), click: null };
      return;
    }
    const hit = this.hitTest(e.x, e.y);
    if (hit.kind !== 'none' || region === null) {
      this.pressDefault(e, 'marquee');
      return;
    }
    if (handle === 'inside') {
      const keys = draggableKeys(scene, scene.selection);
      this.pending = { start, drag: () => new KeyMoveGesture(this.gestureHost, start, keys), click: null };
      return;
    }
    const clear = e.shift || e.mod ? null : () => this.selectKeys([], 'replace');
    this.pending = { start, drag: () => new ScaleKeysGesture(this.gestureHost, start, region, null), click: clear };
  }

  /** GraphToolHost.pressInsert: click inserts a key on the curve (Insert tool). */
  private pressInsert(e: ToolPointerEvent, hit: Extract<GraphHit, { readonly kind: 'curve' }>): void {
    this.pending = insertPress(this.pressContext, toGesturePointer(e), hit);
  }

  private insertKey(curve: CurveId, frame: number): void {
    void this.app.run('graph.key.insert', { curve, frame }, { panel: PANEL.graph }).then((result) => {
      this.reportResult('Insert Key', result);
      if (result.status === 'finished') this.selectKeys([{ key: result.value.key, parts: KEY_PART }], 'replace');
    });
  }

  private selectKeys(
    items: readonly { readonly key: KeyId; readonly parts: KeyPartSelection }[],
    mode: SelectMode,
  ): void {
    this.run('select.keys', { items, mode });
  }

  private forgetKeys(keys: readonly KeyId[]): void {
    const state = this.app.session.getState();
    const drop = new Set(keys);
    if (![...state.selection.keys.keys()].some((key) => drop.has(key))) return;
    const next = new Map([...state.selection.keys].filter(([key]) => !drop.has(key)));
    this.app.session.setState({ selection: { ...state.selection, keys: next } });
  }

  private run(id: 'select.keys' | 'select.curveKeys', args: unknown): void {
    void this.app.runUntyped(id, args, { panel: PANEL.graph }).then((result) => this.reportResult(id, result));
  }

  private reportResult(label: string, result: OperatorResult<unknown>): void {
    if (result.status === 'failed') this.report(label, result.error);
  }

  private report(label: string, error: unknown): void {
    const message =
      error instanceof Error
        ? error.message
        : typeof error === 'object' && error !== null && 'message' in error
          ? String((error as { readonly message: unknown }).message)
          : String(error);
    this.app.services.notify.toast({ kind: 'error', text: `${label} failed: ${message}` });
  }

  private updateHover(p: GesturePointer): void {
    if (!(this.cssWidth > 0 && this.cssHeight > 0)) return;
    const hit = this.hitTest(p.x, p.y);
    let hover: OverlayState['hover'] = null;
    if (hit.kind === 'key') {
      const point = this.keyPoint(hit.key);
      if (point !== null) hover = { kind: 'key', x: point.x, y: point.y };
    } else if (hit.kind === 'handle') {
      const point = this.handlePoint(hit.key, hit.side);
      if (point !== null) hover = { kind: 'handle', x: point.x, y: point.y };
    } else if (hit.kind === 'curve') {
      const point = this.curvePoint(hit.curve, hit.frame);
      if (point !== null) hover = { kind: 'curve', x: point.x, y: point.y };
    }
    this.setHover(hover);
  }

  private setHover(hover: OverlayState['hover']): void {
    const same =
      hover === this.hover ||
      (hover !== null &&
        this.hover !== null &&
        hover.kind === this.hover.kind &&
        hover.x === this.hover.x &&
        hover.y === this.hover.y);
    if (same) return;
    this.hover = hover;
    this.invalidateOverlay();
  }
}

/** Scene frame → active-clip frame (MVP-SPEC §4.11.8): clip frame 0 plays at `sceneStart`. */
function sceneToClip(sceneFps: Fps, clip: ClipRecord, sceneFrame: number): number {
  return ((sceneFrame - clip.sceneStart) * (clip.fps.num * sceneFps.den)) / (clip.fps.den * sceneFps.num);
}

function isModifierCode(code: string): boolean {
  return (
    code === 'ShiftLeft' ||
    code === 'ShiftRight' ||
    code === 'AltLeft' ||
    code === 'AltRight' ||
    code === 'MetaLeft' ||
    code === 'MetaRight' ||
    code === 'ControlLeft' ||
    code === 'ControlRight'
  );
}
