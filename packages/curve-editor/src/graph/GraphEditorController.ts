// GraphEditorController (MVP-SPEC §7 WP-6, §4.11.18; ADR 0007): two stacked canvases (base: grid, curves, keys,
// handles; overlay: playhead, hover, marquee, drag readout), a CurveSet of the visible curves, hit-testing, the
// interaction state machine (idle → pressed → drag → commit | cancel) and navigation per profile. Edits run through
// document previews and the editor-core edit kernel; selection changes go through operators.
import type { Disposer, Fps, Frame } from '@ekza-animator/anim-core';
import type { ChangeBatch, ClipRecord, CurveId, KeyId } from '@ekza-animator/doc';
import {
  type EditorApp,
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
import { HitScratch, hitTestScene } from '../hit/hitTest';
import { sizeBackingStore } from '../painters/canvas';
import type { OverlayState } from '../painters/overlay';
import { Canvas2DCurveRenderer, type CurveRenderer } from '../painters/renderer';
import { readGraphTheme, type GraphTheme } from '../painters/theme';
import { builtinGraphTool, GRAPH_SELECT_TOOL, type GraphToolHost } from '../tools/graphTools';
import type { GraphHit, GraphViewState } from '../types';
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
import { buildCurveSet, type CurveEntry, type CurveSet, EMPTY_CURVE_SET, updateCurveSet } from './curveSet';
import { curvesBounds, keysBounds } from './frame';
import { drawnValueAt, newInfinityMapping } from './geometry';
import {
  DRAG_THRESHOLD_PX,
  type Gesture,
  type GestureHost,
  type GesturePointer,
  PanGesture,
  ZoomGesture,
} from './gestures';
import { defaultPress, insertPress, middlePress, type PendingPress, type PressContext } from './press';
import { type GraphScene, handlePosition, handlesShown, keyX, keyY, type Point } from './scene';
import { KEY_PART, sameKeySelection } from './selection';

/** Wheel zoom rates per pixel of wheel delta: mouse wheels and pinch (Ctrl+wheel) gestures. */
const WHEEL_ZOOM_RATE = 0.0015;
const PINCH_ZOOM_RATE = 0.01;
/** F / A padding on each side (MVP-SPEC §4.11.18). */
const FRAME_PADDING = 0.08;
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
  private pendingFrame: 'all' | 'selection' | null = null;

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
  private hover: OverlayState['hover'] = null;
  /** The document changed under a resting pointer: the hover target is recomputed before the next overlay. */
  private hoverStale = false;
  private tool: { readonly id: string; readonly def: ToolDef; readonly instance: ToolInstance } | null = null;

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
      setView: (next) => this.setView(next),
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
    const valid =
      Number.isFinite(view.f0) && Number.isFinite(view.v0) && Number.isFinite(view.sx) && Number.isFinite(view.sy);
    if (!valid || !(view.sx > 0) || !(view.sy > 0)) return;
    const next: GraphViewState = {
      f0: view.f0,
      v0: view.v0,
      sx: Math.min(Math.max(view.sx, VIEW_LIMITS.minSx), VIEW_LIMITS.maxSx),
      sy: Math.min(Math.max(view.sy, VIEW_LIMITS.minSy), VIEW_LIMITS.maxSy),
    };
    if (sameView(next, this.viewState)) return;
    this.viewState = next;
    this.sceneCache = null;
    this.invalidateBase();
  }

  /**
   * Shows `curves`. A set that shares no curve with the previous one is framed (frame all) so newly loaded curves are
   * on screen.
   */
  setCurves(curves: readonly CurveId[]): void {
    const next = [...new Set(curves)];
    if (next.length === this.curveIds.length && next.every((id, i) => id === this.curveIds[i])) return;
    const previous = new Set(this.curveIds);
    const disjoint = next.length > 0 && !next.some((id) => previous.has(id));
    this.curveIds = next;
    this.curveListChanged = true;
    this.invalidateBase();
    if (disjoint) this.frame('all');
  }

  frame(what: 'all' | 'selection'): void {
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
    this.setView(fitView(this.viewState, bounds, this.cssWidth, this.cssHeight, FRAME_PADDING));
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
      this.baseDirty = true;
      this.overlayDirty = true;
      this.schedule();
    }
    if (this.pendingFrame !== null && width > 0 && height > 0) this.frame(this.pendingFrame);
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
    return this.onCanvas(frameToX(scene.view, frame), valueToY(scene.view, scene.height, value * entry.scale));
  }

  /** CSS cursor for the canvas: the active gesture's, else the tool's. */
  cursor(): string {
    if (this.gesture?.kind === 'pan') return 'grabbing';
    if (this.gesture?.kind === 'zoom') return 'zoom-in';
    if (this.gesture?.kind === 'keys' || this.gesture?.kind === 'handles') return 'move';
    return this.activeTool().cursor?.() ?? 'default';
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Input

  pointerDown(e: ToolPointerEvent): void {
    if (this.disposed) return;
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
    const consumed = this.activeTool().pointerDown?.(e) ?? false;
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
    const fy = e.alt ? 1 : factor;
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
    const drawBase = force === true || this.baseDirty;
    const drawOverlay = force === true || this.overlayDirty;
    if (!drawBase && !drawOverlay) return;
    const scene = this.scene();
    if (drawBase) {
      this.baseDirty = false;
      this.baseRedraws++;
      this.renderer.renderBase(scene);
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

  private invalidateBase(): void {
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
    if (this.disposed || this.frameRequest !== null || typeof requestAnimationFrame !== 'function') return;
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
    for (const change of batch.changes) {
      if (full) break;
      if (!WATCHED_TABLES.has(change.table)) continue;
      touched = true;
      if (change.table === 'keys') {
        if (change.before !== undefined) this.editedCurves.add(change.before.curve);
        if (change.after !== undefined) this.editedCurves.add(change.after.curve);
      } else if (change.table === 'curves') {
        this.editedCurves.add(change.id);
      } else {
        full = true;
      }
    }
    if (!touched) return;
    if (full || this.editedCurves.size > MAX_INCREMENTAL_CURVES) this.dropCurveSet();
    this.invalidateBase();
  }

  private dropCurveSet(): void {
    this.curveSetCache = null;
    this.editedCurves.clear();
    this.curveListChanged = false;
  }

  private onSession(state: SessionState, previous: SessionState): void {
    if (state.tools.graph !== previous.tools.graph) this.invalidateOverlay();
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
    return this.curveSetCache;
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
    for (const key of selection.keys.keys()) {
      const found = curves.byKey.get(key);
      if (found !== undefined) focus.add(found.entry.id);
    }
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
    this.sceneCache = {
      view: this.viewState,
      width: this.cssWidth,
      height: this.cssHeight,
      curves,
      selection: selection.keys,
      handles: this.app.prefs.getState().graphHandles,
      focus: focus.size === 0 ? null : focus,
      range,
      playhead,
    };
    return this.sceneCache;
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
