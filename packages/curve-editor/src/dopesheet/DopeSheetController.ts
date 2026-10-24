// The Dope Sheet controller (M2A-SPEC §5.10, §8 A3 public API): rows of the shown controls, glyph and hold data,
// a cached base layer plus the playhead, hit-testing, selection (shared `Selection.keys`), key drags through
// `beginKeyEditGesture` (one history step; ripple §5.11 and breakdown retiming §5.12 in the kernel), the region bar,
// navigation per profile and framing. Canvas2D, no React; the panel draws the row labels from `rows()`.
import { type Disposer, EkzaError, type Frame } from '@ekza-studio/anim-core';
import type { ChangeBatch, ClipId, ControlId, CurveId, KeyId, Tx } from '@ekza-studio/doc';
import {
  beginKeyEditGesture,
  controlVisibility,
  type EditorApp,
  type KeyEditGesture,
  type KeyEditOptions,
  type KeyPartSelection,
  moveKeys,
  PANEL,
  type RippleScope,
  type SelectMode,
  type SessionState,
  scaleKeys,
  type ToolKeyEvent,
  type ToolPointerEvent,
  type ToolWheelEvent,
} from '@ekza-studio/editor-core';
import { applyKeySelection, KEY_PART, selectModeFor } from '../graph/selection';
import { bandMoveDelta, bandScale, snapFrame } from '../timeline/band';
import type { DopeSheetHit, DopeSheetRow, DopeSheetRowKind, DopeSheetViewState } from '../types';
import { DopeSheetData, SAME_TIME } from './data';
import {
  clampScale,
  clampScroll,
  DEFAULT_DOPE_VIEW,
  FRAME_PADDING,
  fitFrames,
  frameToX,
  REGION_HEIGHT,
  ROW_HEIGHT,
  ROWS_TOP,
  RULER_HEIGHT,
  rowAt,
  rowTop,
  sameDopeView,
  xToFrame,
  zoomAt,
} from './layout';
import { type DopeSheetScene, paintDopeSheet } from './painter';
import { buildRows, expandedByDefault, shownControls } from './rows';
import { CURVE_TOLERANCE, setCurvePointer } from '../painters/theme';
import { type DopeSheetTheme, readDopeSheetTheme } from './theme';

/** Wheel zoom rates per pixel of wheel delta (mouse wheel; pinch arrives as Ctrl+wheel). */
const WHEEL_ZOOM_RATE = 0.0015;
const PINCH_ZOOM_RATE = 0.01;
/** Alt+RMB drag zoom rate per pixel. */
const DRAG_ZOOM_RATE = 0.01;
const MOVE_LABEL = 'Move Keys';
const SCALE_LABEL = 'Scale Keys';
/** Tables whose changes can alter the rows (structure, labels, keyed curves). */
const ROW_TABLES: ReadonlySet<string> = new Set([
  'keys',
  'curves',
  'controls',
  'rigs',
  'characters',
  'clips',
  'layers',
]);
/** PointerEvent.buttons bit of each PointerEvent.button (left, middle, right). */
const BUTTON_BITS: readonly number[] = [1, 4, 2];

export type DopeSheetShow = 'selected' | 'character';

interface Point {
  readonly x: number;
  readonly y: number;
}

interface KeyDragState {
  readonly kind: 'move' | 'scale';
  readonly handle: KeyEditGesture;
  readonly keys: readonly KeyId[];
  readonly scope: RippleScope | null;
  /** Pointer frame → (offset or pivot/factor) of the edit; null: nothing to apply yet. */
  readonly plan: (frame: Frame, snap: boolean) => { readonly a: number; readonly b: number } | null;
  last: { readonly a: number; readonly b: number } | null;
}

type Gesture =
  | { readonly kind: 'scrub'; last: number }
  | { readonly kind: 'marquee'; readonly start: Point; end: Point; readonly mode: SelectMode }
  | { readonly kind: 'keys'; readonly drag: KeyDragState; snap: boolean }
  | { readonly kind: 'pan'; readonly start: Point; readonly view: DopeSheetViewState }
  | { readonly kind: 'zoom'; readonly start: Point; readonly view: DopeSheetViewState };

interface Pending {
  readonly start: Point;
  readonly drag: (() => Gesture | null) | null;
  readonly click: (() => void) | null;
}

/** The probe's view of one row (§4.8 `dopeSheet().rows[]`). */
export interface DopeSheetRowState {
  readonly keys: number[];
  readonly breakdowns: number[];
  readonly selected: number[];
  readonly holds: [number, number][];
}

export class DopeSheetController {
  readonly app: EditorApp;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx2d: CanvasRenderingContext2D;
  /** Everything but the playhead (redrawn when content changes). */
  private readonly base: HTMLCanvasElement;
  private readonly baseCtx: CanvasRenderingContext2D;
  private readonly data: DopeSheetData;
  private theme: DopeSheetTheme;
  private viewState: DopeSheetViewState = DEFAULT_DOPE_VIEW;
  private cssWidth = 0;
  private cssHeight = 0;
  private dpr = 1;
  private showMode: DopeSheetShow = 'selected';
  /** The user's expand/collapse choices; other rows follow `expandedByDefault`. */
  private readonly expansion = new Map<string, boolean>();
  private rowCache: readonly DopeSheetRow[] | null = null;
  /** The last rows handed out (kept when a rebuild yields the same rows). */
  private lastRows: readonly DopeSheetRow[] | null = null;
  /** The clip the view was last framed on (the view frames a new clip's range once). */
  private framedClip: ClipId | null = null;
  private gesture: Gesture | null = null;
  private pending: Pending | null = null;
  private pressButton = 0;
  private hover: DopeSheetHit | null = null;
  private baseDirty = true;
  private overlayDirty = true;
  private frameRequest = 0;
  private disposed = false;
  private readonly listeners = new Set<() => void>();
  private readonly disposers: Disposer[] = [];

  constructor(opts: { readonly app: EditorApp; readonly canvas: HTMLCanvasElement }) {
    this.app = opts.app;
    this.canvas = opts.canvas;
    this.ctx2d = context2d(opts.canvas);
    this.base = opts.canvas.ownerDocument.createElement('canvas');
    this.baseCtx = context2d(this.base);
    this.data = new DopeSheetData(this.app);
    this.theme = readDopeSheetTheme(opts.canvas);
    this.disposers.push(
      this.app.store.subscribe((batch) => this.onBatch(batch)),
      this.app.session.subscribe((state, previous) => this.onSession(state, previous)),
      this.app.evaluation.subscribe(() => this.onPose()),
    );
  }

  // ---------------------------------------------------------------------------------------------------------------
  // View, rows, show

  get view(): DopeSheetViewState {
    return this.viewState;
  }

  setView(view: DopeSheetViewState): void {
    const next: DopeSheetViewState = {
      f0: Number.isFinite(view.f0) ? view.f0 : this.viewState.f0,
      sx: clampScale(Number.isFinite(view.sx) && view.sx > 0 ? view.sx : this.viewState.sx),
      scrollY: clampScroll(Number.isFinite(view.scrollY) ? view.scrollY : 0, this.rows().length, this.cssHeight),
    };
    if (sameDopeView(next, this.viewState)) return;
    this.viewState = next;
    this.invalidate(true);
    this.notify();
  }

  /** "Selected" or "Character" (§5.10 `ds-show`). */
  get show(): DopeSheetShow {
    return this.showMode;
  }

  setShow(show: DopeSheetShow): void {
    if (show !== 'selected' && show !== 'character') {
      throw new EkzaError('unsupported', `Unknown show '${String(show)}'`);
    }
    if (show === this.showMode) return;
    this.showMode = show;
    this.rowsChanged();
  }

  /** The controls the Dope Sheet shows (also the ripple control set, §5.11). */
  shownControls(): readonly ControlId[] {
    return shownControls(this.app, this.showMode);
  }

  /** The rows (rebuilt lazily; an unchanged rebuild keeps the previous array, so labels do not re-render). */
  rows(): readonly DopeSheetRow[] {
    if (this.rowCache === null) {
      const next = buildRows(this.app, { clip: this.activeClip(), controls: this.shownControls() }, (id, kind) =>
        this.isExpanded(id, kind),
      );
      this.rowCache = sameRows(this.lastRows, next) ? (this.lastRows as readonly DopeSheetRow[]) : next;
      if (this.rowCache !== this.lastRows) {
        this.lastRows = this.rowCache;
        queueMicrotask(() => this.notify());
      }
    }
    return this.rowCache;
  }

  setExpanded(row: string, expanded: boolean): void {
    this.expansion.set(row, expanded);
    this.rowsChanged();
  }

  /** The user's expansion choices (for the panel to persist with the layout). */
  expansionState(): Readonly<Record<string, boolean>> {
    return Object.fromEntries(this.expansion);
  }

  /** Restores persisted expansion choices. */
  restoreExpansion(state: Readonly<Record<string, boolean>>): void {
    this.expansion.clear();
    for (const [id, value] of Object.entries(state)) if (typeof value === 'boolean') this.expansion.set(id, value);
    this.rowsChanged();
  }

  /** Called with no arguments whenever the rows or the view changed (the panel re-renders its labels). */
  subscribe(listener: () => void): Disposer {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Frames the selected keys (else every row's keys, else the clip range) with 8 % padding (`F` / `A`). */
  frame(what: 'all' | 'selection'): void {
    let range = what === 'selection' ? this.selectionRange() : null;
    if (range === null) {
      const glyphs = this.rows()[0] === undefined ? null : this.data.glyphs(this.rows()[0] as DopeSheetRow);
      if (glyphs !== null && glyphs.times.length > 0) {
        range = { start: glyphs.times[0] as number, end: glyphs.times[glyphs.times.length - 1] as number };
      }
    }
    if (range === null) {
      const clip = this.clipRecord();
      if (clip === undefined) return;
      range = clip.range;
    }
    this.setView(fitFrames(this.viewState, this.cssWidth, range.start, range.end, FRAME_PADDING));
  }

  resize(cssWidth: number, cssHeight: number, dpr: number): void {
    if (this.disposed) return;
    this.cssWidth = Math.max(0, cssWidth);
    this.cssHeight = Math.max(0, cssHeight);
    this.dpr = dpr > 0 && Number.isFinite(dpr) ? dpr : 1;
    const width = Math.max(1, Math.round(this.cssWidth * this.dpr));
    const height = Math.max(1, Math.round(this.cssHeight * this.dpr));
    for (const canvas of [this.canvas, this.base]) {
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
    }
    this.theme = readDopeSheetTheme(this.canvas);
    const scrollY = clampScroll(this.viewState.scrollY, this.rows().length, this.cssHeight);
    if (scrollY !== this.viewState.scrollY) this.viewState = { ...this.viewState, scrollY };
    this.redraw(true);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Probes

  /** Glyph, region, ruler or empty space under canvas CSS (x, y). */
  hitTest(x: number, y: number): DopeSheetHit {
    const view = this.viewState;
    const frame = xToFrame(view, x);
    if (y < RULER_HEIGHT) return { kind: 'ruler', frame: snapFrame(frame, this.snapping()) };
    if (y < ROWS_TOP) {
      const region = this.selectionRange();
      if (region !== null) {
        const x0 = frameToX(view, region.start);
        const x1 = frameToX(view, region.end);
        const span = region.end - region.start > SAME_TIME;
        // The handles reach the region handle tolerance outside the bar and at most a quarter of it inside, so the
        // middle of a narrow bar can still be grabbed (the time slider's band rule); by pointer type (§5.4).
        const reach = CURVE_TOLERANCE.regionHandlePx;
        const inside = Math.min(reach, (x1 - x0) / 4);
        if (span && x >= x0 - reach && x <= x0 + inside) return { kind: 'region-start', frame };
        if (span && x >= x1 - inside && x <= x1 + reach) return { kind: 'region-end', frame };
        if (x >= x0 - reach && x <= x1 + reach) return { kind: 'region-middle', frame };
      }
      return { kind: 'none', row: null, frame };
    }
    const rows = this.rows();
    const index = rowAt(view, y);
    const row = rows[index];
    if (row === undefined) return { kind: 'none', row: null, frame };
    const glyphs = this.data.glyphs(row);
    const nearest = nearestTime(glyphs.times, frame);
    if (nearest !== null && Math.abs(frameToX(view, nearest) - x) <= CURVE_TOLERANCE.glyphPx) {
      return { kind: 'glyph', row: row.id, frame: nearest };
    }
    return { kind: 'none', row: row.id, frame };
  }

  /** Centre of the glyph of `row` at `frame` (canvas CSS px); null when there is none or it is off screen. */
  glyphPoint(row: string, frame: Frame): { readonly x: number; readonly y: number } | null {
    const rows = this.rows();
    const index = rows.findIndex((candidate) => candidate.id === row);
    if (index === -1) return null;
    const glyphs = this.data.glyphs(rows[index] as DopeSheetRow);
    const nearest = nearestTime(glyphs.times, frame);
    if (nearest === null || Math.abs(nearest - frame) >= SAME_TIME) return null;
    const x = frameToX(this.viewState, nearest);
    const y = rowTop(this.viewState, index) + ROW_HEIGHT / 2;
    if (x < 0 || x > this.cssWidth || y < ROWS_TOP || y > this.cssHeight) return null;
    return { x, y };
  }

  /** A grab point (canvas CSS px) of the region bar; null without selected keys (ends: without a span). */
  regionPoint(part: 'start' | 'middle' | 'end'): { readonly x: number; readonly y: number } | null {
    const region = this.selectionRange();
    if (region === null) return null;
    const y = RULER_HEIGHT + REGION_HEIGHT / 2;
    const x0 = frameToX(this.viewState, region.start);
    const x1 = frameToX(this.viewState, region.end);
    if (part === 'middle') return { x: (x0 + x1) / 2, y };
    if (region.end - region.start <= SAME_TIME) return null;
    return { x: part === 'start' ? x0 : x1, y };
  }

  /** What the probe reports for a row (§4.8): key times, all-breakdown and all-selected times, hold intervals. */
  rowState(row: DopeSheetRow): DopeSheetRowState {
    const glyphs = this.data.glyphs(row);
    const keys: number[] = [];
    const breakdowns: number[] = [];
    const selected: number[] = [];
    for (let i = 0; i < glyphs.times.length; i++) {
      const t = glyphs.times[i] as number;
      const total = glyphs.total[i] as number;
      keys.push(t);
      if ((glyphs.breakdowns[i] as number) === total) breakdowns.push(t);
      if ((glyphs.selected[i] as number) === total) selected.push(t);
    }
    return { keys, breakdowns, selected, holds: this.data.holds(row).map(([a, b]) => [a, b]) };
  }

  /** Canvas size in CSS px. */
  get size(): { readonly width: number; readonly height: number } {
    return { width: this.cssWidth, height: this.cssHeight };
  }

  /** CSS cursor for the current hover or gesture. */
  cursor(): string {
    const gesture = this.gesture;
    if (gesture?.kind === 'pan') return 'grabbing';
    if (gesture?.kind === 'zoom') return 'ew-resize';
    if (gesture?.kind === 'keys') return gesture.drag.kind === 'move' ? 'grabbing' : 'ew-resize';
    const hover = this.hover;
    if (hover === null) return '';
    if (hover.kind === 'region-start' || hover.kind === 'region-end') return 'ew-resize';
    if (hover.kind === 'region-middle') return 'grab';
    return '';
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Selection

  /** Selects every key of a row (double-click on its label), by `mode`. */
  selectRowKeys(row: string, mode: SelectMode): void {
    const target = this.rows().find((candidate) => candidate.id === row);
    if (target === undefined) return;
    this.applySelection(this.keyItems(this.data.keysIn(target, -Infinity, Infinity)), mode);
  }

  /** Every key of the shown rows (Mod+A over the Dope Sheet). */
  selectAll(): void {
    const summary = this.rows()[0];
    if (summary === undefined) return;
    this.applySelection(this.keyItems(this.data.keysIn(summary, -Infinity, Infinity)), 'replace');
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Input

  /** True while a pointer gesture is pressed or in progress. */
  get dragging(): boolean {
    return this.gesture !== null || this.pending !== null;
  }

  pointerDown(e: ToolPointerEvent): void {
    if (this.disposed) return;
    setCurvePointer(e.pointerType); // §5.4: the tolerances follow the pointer
    if (this.dragging) {
      // One gesture at a time; a press whose button is no longer down lost its release: start fresh.
      if ((e.buttons & (BUTTON_BITS[this.pressButton] ?? 0)) !== 0) return;
      this.cancel();
    }
    this.pressButton = e.button;
    const start: Point = { x: e.x, y: e.y };
    const navigation = this.navigation(e, start);
    if (navigation !== null) {
      this.gesture = navigation;
      this.invalidate(false);
      return;
    }
    const hit = this.hitTest(e.x, e.y);
    if (e.button === 1) {
      // MMB drag anywhere moves the selected keys.
      this.pending = { start, drag: () => this.moveGesture(e.x), click: null };
      return;
    }
    if (e.button !== 0) return;
    if (hit.kind === 'ruler') {
      const gesture: Gesture = { kind: 'scrub', last: Number.NaN };
      this.gesture = gesture;
      this.scrub(gesture, e.x);
      return;
    }
    if (hit.kind === 'region-start' || hit.kind === 'region-end') {
      const side = hit.kind === 'region-start' ? 'start' : 'end';
      this.pending = { start, drag: () => this.regionScaleGesture(side, e.x), click: null };
      return;
    }
    if (hit.kind === 'region-middle') {
      this.pending = { start, drag: () => this.moveGesture(e.x), click: null };
      return;
    }
    const tool = this.app.session.getState().tools.dopeSheet;
    const keyDrag = (): Gesture | null => (tool === 'scale' ? this.pressScaleGesture(e.x) : this.moveGesture(e.x));
    const mode = selectModeFor(e);
    const current = this.app.session.getState().selection.keys;
    if (hit.kind === 'glyph') {
      const row = this.rows().find((candidate) => candidate.id === hit.row);
      const items = row === undefined ? [] : this.keyItems(this.data.keysAt(row, hit.frame));
      const allSelected = items.length > 0 && items.every((item) => current.get(item.key)?.key === true);
      // A press on selected keys keeps the selection so it can be dragged; a click without a drag then narrows the
      // selection to them (or toggles them off with Shift) — the Graph Editor rule (INT-34).
      const deferred = (mode === 'replace' || mode === 'toggle') && allSelected;
      if (!deferred) this.applySelection(items, mode);
      const selectedNow = this.app.session.getState().selection.keys;
      const draggable = items.some((item) => selectedNow.get(item.key)?.key === true);
      this.pending = {
        start,
        drag: draggable ? keyDrag : null,
        click: deferred ? () => this.applySelection(items, mode) : null,
      };
      return;
    }
    // Empty canvas: a click clears the key selection (Graph Editor rule); a drag draws a marquee (Select tool) or
    // moves/scales the selected keys (Move/Scale tools).
    const clear = mode === 'replace' ? () => this.applySelection([], 'replace') : null;
    if (tool !== 'select' && current.size > 0) {
      this.pending = { start, drag: keyDrag, click: clear };
      return;
    }
    this.pending = {
      start,
      drag: () => ({ kind: 'marquee', start, end: start, mode }),
      click: clear,
    };
  }

  pointerMove(e: ToolPointerEvent): void {
    if (this.disposed) return;
    setCurvePointer(e.pointerType);
    const gesture = this.gesture;
    if (gesture !== null) {
      this.updateGesture(gesture, e);
      return;
    }
    const pending = this.pending;
    if (pending !== null) {
      if (Math.hypot(e.x - pending.start.x, e.y - pending.start.y) < CURVE_TOLERANCE.dragPx) return;
      this.pending = null;
      this.gesture = pending.drag?.() ?? null;
      if (this.gesture !== null) this.updateGesture(this.gesture, e);
      return;
    }
    if (e.buttons === 0) this.hover = this.hitTest(e.x, e.y);
  }

  pointerUp(e: ToolPointerEvent): void {
    if (this.disposed) return;
    const gesture = this.gesture;
    if (gesture !== null) {
      this.updateGesture(gesture, e);
      if (this.gesture !== gesture) return; // cancelled while applying the last position
      this.gesture = null;
      this.commitGesture(gesture);
      this.invalidate(true);
      return;
    }
    const pending = this.pending;
    if (pending !== null) {
      this.pending = null;
      pending.click?.();
    }
  }

  wheel(e: ToolWheelEvent): void {
    if (this.disposed || this.dragging) return;
    const view = this.viewState;
    const profile = this.app.prefs.getState().navProfile;
    if (profile === 'trackpad' && !e.ctrl) {
      // Two-finger scroll pans: horizontal moves time, vertical scrolls rows.
      this.setView({ ...view, f0: view.f0 + e.deltaX / view.sx, scrollY: view.scrollY + e.deltaY });
      return;
    }
    if (e.shift && !e.ctrl) {
      // Shift+wheel scrolls rows.
      this.setView({ ...view, scrollY: view.scrollY + (e.deltaY !== 0 ? e.deltaY : e.deltaX) });
      return;
    }
    const delta = e.deltaY !== 0 ? e.deltaY : e.deltaX;
    this.setView(zoomAt(view, e.x, Math.exp(-delta * (e.ctrl ? PINCH_ZOOM_RATE : WHEEL_ZOOM_RATE))));
  }

  /** Esc cancels a gesture; Mod+A selects every shown key. Returns true when consumed. */
  key(e: ToolKeyEvent): boolean {
    if (this.disposed || e.type !== 'down') return false;
    if (e.code === 'Escape' && this.dragging) {
      this.cancel();
      return true;
    }
    if (e.code === 'KeyA' && e.mod && !e.shift && !e.alt && !this.dragging) {
      this.selectAll();
      return true;
    }
    return false;
  }

  /** Cancels the gesture in progress (Esc, lost capture): a key drag leaves no trace. */
  cancel(): void {
    const gesture = this.gesture;
    this.gesture = null;
    this.pending = null;
    if (gesture?.kind === 'keys') gesture.drag.handle.cancel();
    if (gesture !== null) this.invalidate(true);
  }

  /** Draws what changed (`force`: everything). Draws nothing at zero size (a hidden dock tab). */
  redraw(force?: boolean): void {
    if (this.disposed) return;
    if (force !== true && !this.baseDirty && !this.overlayDirty) return;
    if (this.cssWidth <= 0 || this.cssHeight <= 0) return;
    this.frameOnce();
    if (force === true || this.baseDirty) {
      paintDopeSheet(this.baseCtx, this.dpr, this.scene(), this.theme);
      this.baseDirty = false;
    }
    const target = this.ctx2d;
    target.setTransform(1, 0, 0, 1, 0, 0);
    target.clearRect(0, 0, this.canvas.width, this.canvas.height);
    target.drawImage(this.base, 0, 0);
    const playhead = this.playhead();
    if (playhead !== null) {
      const x = frameToX(this.viewState, playhead);
      if (x >= -2 && x <= this.cssWidth + 2) {
        target.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        target.fillStyle = this.theme.playhead;
        target.fillRect(Math.round((x - 1) * this.dpr) / this.dpr, 0, 2, this.cssHeight);
      }
    }
    this.overlayDirty = false;
  }

  dispose(): void {
    if (this.disposed) return;
    this.cancel();
    this.disposed = true;
    if (this.frameRequest !== 0) this.canvas.ownerDocument.defaultView?.cancelAnimationFrame(this.frameRequest);
    this.frameRequest = 0;
    for (const dispose of this.disposers.splice(0).reverse()) dispose();
    this.listeners.clear();
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Internals: gestures

  private navigation(e: ToolPointerEvent, start: Point): Gesture | null {
    const profile = this.app.prefs.getState().navProfile;
    if (profile === 'trackpad' || !e.alt) return null;
    if (e.button === 1) return { kind: 'pan', start, view: this.viewState };
    if (e.button === 2) return { kind: 'zoom', start, view: this.viewState };
    return null;
  }

  private updateGesture(gesture: Gesture, e: ToolPointerEvent): void {
    switch (gesture.kind) {
      case 'scrub':
        this.scrub(gesture, e.x);
        return;
      case 'marquee':
        gesture.end = { x: e.x, y: e.y };
        this.invalidate(true);
        return;
      case 'pan': {
        const { view, start } = gesture;
        this.setView({ ...view, f0: view.f0 - (e.x - start.x) / view.sx, scrollY: view.scrollY - (e.y - start.y) });
        return;
      }
      case 'zoom': {
        const factor = Math.exp((e.x - gesture.start.x) * DRAG_ZOOM_RATE);
        this.setView(zoomAt(gesture.view, gesture.start.x, factor));
        return;
      }
      case 'keys': {
        gesture.snap = this.snapping() && !e.alt;
        this.applyDrag(gesture.drag, xToFrame(this.viewState, e.x), gesture.snap, false);
        return;
      }
    }
  }

  private commitGesture(gesture: Gesture): void {
    switch (gesture.kind) {
      case 'marquee': {
        const items = this.keyItems(this.keysInRect(gesture.start, gesture.end));
        this.applySelection(items, gesture.mode);
        return;
      }
      case 'keys': {
        const { drag } = gesture;
        if (drag.last === null || (drag.kind === 'move' ? drag.last.a === 0 : drag.last.b === 1)) {
          drag.handle.cancel();
          return;
        }
        const last = drag.last;
        let deleted: readonly KeyId[] = [];
        try {
          drag.handle.commit((tx) => {
            deleted = this.edit(drag, tx, last, gesture.snap, true);
          });
        } catch (error) {
          this.report(drag.kind === 'move' ? MOVE_LABEL : SCALE_LABEL, error);
          return;
        }
        this.forgetKeys(deleted);
        return;
      }
      case 'scrub':
      case 'pan':
      case 'zoom':
        return;
    }
  }

  /** Applies the drag's plan for the pointer at `frame` as a preview update (or the final edit). */
  private applyDrag(drag: KeyDragState, frame: Frame, snap: boolean, final: boolean): void {
    const plan = drag.plan(frame, snap);
    if (plan === null || (drag.last !== null && plan.a === drag.last.a && plan.b === drag.last.b && !final)) return;
    drag.last = plan;
    drag.handle.update((tx) => {
      this.edit(drag, tx, plan, snap, final);
    });
    this.invalidate(true);
  }

  private edit(
    drag: KeyDragState,
    tx: Tx,
    plan: { readonly a: number; readonly b: number },
    snap: boolean,
    final: boolean,
  ): readonly KeyId[] {
    const opts: KeyEditOptions = { snap, resolveCollisions: final, ripple: drag.scope !== null };
    const scope = drag.scope ?? undefined;
    const result =
      drag.kind === 'move'
        ? moveKeys(this.app, tx, drag.keys, plan.a, 0, opts, scope)
        : scaleKeys(this.app, tx, drag.keys, plan.a, plan.b, opts, scope);
    return result.deleted;
  }

  /** Starts a key drag of the selected keys; null without selected keys or when a preview is active. */
  private keyDrag(kind: 'move' | 'scale', plan: KeyDragState['plan']): Gesture | null {
    const keys = this.selectedKeys();
    if (keys.length === 0) return null;
    let handle: KeyEditGesture;
    try {
      handle = beginKeyEditGesture(this.app, kind === 'move' ? MOVE_LABEL : SCALE_LABEL);
    } catch (error) {
      this.report(kind === 'move' ? MOVE_LABEL : SCALE_LABEL, error);
      return null;
    }
    const scope = this.app.session.getState().tools.ripple ? this.rippleScope() : null;
    return {
      kind: 'keys',
      drag: { kind, handle, keys, scope, plan, last: null },
      snap: this.snapping(),
    };
  }

  /** Move: Δ = pointer frame − press frame (whole frames when snapping). */
  private moveGesture(pressX: number): Gesture | null {
    const origin = xToFrame(this.viewState, pressX);
    return this.keyDrag('move', (frame, snap) => ({ a: bandMoveDelta(origin, frame, snap), b: 0 }));
  }

  /** Region end drag: scales around the opposite end; the dragged end lands on whole frames when snapping. */
  private regionScaleGesture(side: 'start' | 'end', pressX: number): Gesture | null {
    const band = this.selectionRange();
    if (band === null) return null;
    const grab = xToFrame(this.viewState, pressX) - (side === 'start' ? band.start : band.end);
    return this.keyDrag('scale', (frame, snap) => {
      const scale = bandScale(band, side, frame - grab, snap);
      return scale === null ? null : { a: scale.pivot, b: scale.factor };
    });
  }

  /**
   * Scale tool (`R`) drag outside the region: scales around the press frame; the region end farther from it follows
   * the pointer (whole frames when snapping), so the factor is (end′ − pivot)/(end − pivot), at least 0.01.
   */
  private pressScaleGesture(pressX: number): Gesture | null {
    const band = this.selectionRange();
    if (band === null) return null;
    const press = xToFrame(this.viewState, pressX);
    const pivot = snapFrame(press, this.snapping());
    const far = Math.abs(band.end - pivot) >= Math.abs(band.start - pivot) ? band.end : band.start;
    const reach = far - pivot;
    if (Math.abs(reach) <= SAME_TIME) return null;
    return this.keyDrag('scale', (frame, snap) => {
      const moved = snapFrame(far + (frame - press), snap);
      return { a: pivot, b: Math.max((moved - pivot) / reach, 0.01) };
    });
  }

  private scrub(gesture: Extract<Gesture, { kind: 'scrub' }>, x: number): void {
    const clip = this.clipRecord();
    const frame = snapFrame(xToFrame(this.viewState, x), this.snapping());
    const target = clip === undefined ? frame : Math.min(Math.max(frame, clip.range.start), clip.range.end);
    if (target === gesture.last) return;
    gesture.last = target;
    void this.app.run('time.setFrame', { frame: target, unit: 'clip' }, { panel: PANEL.dopeSheet });
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Internals: data

  private activeClip(): ClipId | null {
    const state = this.app.session.getState();
    const character = state.activeCharacter;
    if (character === null) return null;
    const clip = state.activeClip[character];
    return clip === undefined || this.app.store.get('clips', clip) === undefined ? null : clip;
  }

  private clipRecord() {
    const clip = this.activeClip();
    return clip === null ? undefined : this.app.store.get('clips', clip);
  }

  private isExpanded(id: string, kind: DopeSheetRowKind): boolean {
    return this.expansion.get(id) ?? expandedByDefault(kind);
  }

  private snapping(): boolean {
    return this.app.session.getState().time.snapToFrames;
  }

  private playhead(): Frame | null {
    const character = this.app.session.getState().activeCharacter;
    return character === null ? null : this.app.evaluation.clipFrame(character);
  }

  /** Selected keys (key part) that exist, in selection order. */
  private selectedKeys(): KeyId[] {
    const out: KeyId[] = [];
    for (const [id, parts] of this.app.session.getState().selection.keys) {
      if (parts.key && this.app.store.get('keys', id) !== undefined) out.push(id);
    }
    return out;
  }

  /** Min…max time of the selected keys (the region bar), or null. */
  private selectionRange(): { readonly start: Frame; readonly end: Frame } | null {
    let start = Infinity;
    let end = -Infinity;
    for (const [id, parts] of this.app.session.getState().selection.keys) {
      if (!parts.key) continue;
      const key = this.app.store.get('keys', id);
      if (key === undefined) continue;
      if (key.t < start) start = key.t;
      if (key.t > end) end = key.t;
    }
    return Number.isFinite(start) ? { start, end } : null;
  }

  /** §5.11: the curves of the controls the Dope Sheet shows (its summary row), the region by default. */
  private rippleScope(): RippleScope {
    const summary = this.rows()[0];
    const curves: CurveId[] = summary === undefined ? [] : [...summary.curves];
    return { curves };
  }

  private keyItems(keys: readonly KeyId[]): { key: KeyId; parts: KeyPartSelection }[] {
    return keys.map((key) => ({ key, parts: KEY_PART }));
  }

  /** Key selection (U state shared with the Graph Editor and the time slider), written at once. */
  private applySelection(items: readonly { key: KeyId; parts: KeyPartSelection }[], mode: SelectMode): void {
    const state = this.app.session.getState();
    const keys = applyKeySelection(state.selection.keys, items, mode, { group: true });
    if (keys.size === 0 && state.selection.keys.size === 0) return;
    this.app.session.setState({ selection: { ...state.selection, keys } });
  }

  private forgetKeys(keys: readonly KeyId[]): void {
    if (keys.length === 0) return;
    const state = this.app.session.getState();
    const drop = new Set(keys);
    if (![...state.selection.keys.keys()].some((key) => drop.has(key))) return;
    const next = new Map([...state.selection.keys].filter(([key]) => !drop.has(key)));
    this.app.session.setState({ selection: { ...state.selection, keys: next } });
  }

  /** Keys of the rows a marquee crosses, between its frames. */
  private keysInRect(a: Point, b: Point): KeyId[] {
    const view = this.viewState;
    const f0 = xToFrame(view, Math.min(a.x, b.x));
    const f1 = xToFrame(view, Math.max(a.x, b.x));
    const y0 = Math.max(Math.min(a.y, b.y), ROWS_TOP);
    const y1 = Math.max(a.y, b.y);
    if (y1 < ROWS_TOP) return [];
    const rows = this.rows();
    const first = Math.max(rowAt(view, y0), 0);
    const last = Math.min(rowAt(view, y1), rows.length - 1);
    const keys = new Set<KeyId>();
    for (let i = first; i <= last; i++)
      for (const key of this.data.keysIn(rows[i] as DopeSheetRow, f0, f1)) keys.add(key);
    return [...keys];
  }

  private scene(): DopeSheetScene {
    const clip = this.clipRecord();
    const gesture = this.gesture;
    return {
      width: this.cssWidth,
      height: this.cssHeight,
      view: this.viewState,
      rows: this.rows(),
      data: this.data,
      playback: clip === undefined ? null : clip.range,
      playhead: null,
      region: this.selectionRange(),
      marquee:
        gesture?.kind === 'marquee'
          ? { x0: gesture.start.x, y0: gesture.start.y, x1: gesture.end.x, y1: gesture.end.y }
          : null,
    };
  }

  /** Frames a newly shown clip's range once the canvas has a size. */
  private frameOnce(): void {
    const clip = this.clipRecord();
    if (clip === undefined || clip.id === this.framedClip || this.cssWidth <= 0) return;
    this.framedClip = clip.id;
    this.viewState = fitFrames(this.viewState, this.cssWidth, clip.range.start, clip.range.end, 0.04);
    this.notify();
  }

  private rowsChanged(): void {
    this.rowCache = null;
    this.invalidate(true);
    this.notify();
  }

  private notify(): void {
    if (this.disposed) return;
    for (const listener of Array.from(this.listeners)) listener();
  }

  private invalidate(base: boolean): void {
    if (this.disposed) return;
    if (base) this.baseDirty = true;
    this.overlayDirty = true;
    if (this.frameRequest !== 0) return;
    const view = this.canvas.ownerDocument.defaultView;
    if (view === null) return;
    this.frameRequest = view.requestAnimationFrame(() => {
      this.frameRequest = 0;
      this.redraw();
    });
  }

  private onBatch(batch: ChangeBatch): void {
    if (batch.origin === 'load') {
      this.data.invalidate(null);
      this.rowsChanged();
      return;
    }
    const curves = new Set<CurveId>();
    let rows = false;
    for (const change of batch.changes) {
      if (change.table === 'keys') {
        if (change.before !== undefined) curves.add(change.before.curve);
        if (change.after !== undefined) curves.add(change.after.curve);
        // Only an added, removed or re-parented key can make a curve keyed or unkeyed; moves (drags) keep the rows.
        if (change.before?.curve !== change.after?.curve) rows = true;
      } else if (change.table === 'curves') {
        curves.add(change.id);
        rows = true;
      } else if (ROW_TABLES.has(change.table)) rows = true;
    }
    if (curves.size > 0) {
      this.data.invalidate(curves);
      this.invalidate(true);
    }
    if (rows) this.rowsChanged();
  }

  private onSession(state: SessionState, previous: SessionState): void {
    if (
      state.activeCharacter !== previous.activeCharacter ||
      state.activeClip !== previous.activeClip ||
      state.hiddenControls !== previous.hiddenControls ||
      state.showSecondary !== previous.showSecondary ||
      (state.selection.controls !== previous.selection.controls && this.showMode === 'selected')
    ) {
      this.rowsChanged();
    }
    if (state.selection.keys !== previous.selection.keys) {
      this.data.invalidateSelection();
      this.invalidate(true);
    }
    if (state.time.sceneFrame !== previous.time.sceneFrame) this.invalidate(false);
    if (state.tools.dopeSheet !== previous.tools.dopeSheet) this.invalidate(false);
  }

  /** The IK/FK visibility rule follows the pose (§5.5): dimmed rows may change with it. */
  private onPose(): void {
    const rows = this.rowCache;
    if (rows === null) return;
    const changed = rows.some(
      (row) =>
        row.kind === 'control' &&
        row.control !== undefined &&
        row.dimmed !== (controlVisibility(this.app, row.control) !== 'visible'),
    );
    if (changed) this.rowsChanged();
  }

  private report(label: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.app.services.notify.toast({ kind: 'error', text: `${label} failed: ${message}` });
  }
}

/** Rows equal for drawing and labels (ids, structure, curves): then the previous array is kept. */
function sameRows(a: readonly DopeSheetRow[] | null, b: readonly DopeSheetRow[]): boolean {
  if (a === null || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] as DopeSheetRow;
    const y = b[i] as DopeSheetRow;
    if (
      x.id !== y.id ||
      x.expanded !== y.expanded ||
      x.dimmed !== y.dimmed ||
      x.label !== y.label ||
      x.depth !== y.depth ||
      x.curves.length !== y.curves.length ||
      x.curves.some((curve, k) => curve !== y.curves[k])
    ) {
      return false;
    }
  }
  return true;
}

/** The time in ascending `times` nearest to `frame`, or null. */
function nearestTime(times: Float64Array, frame: number): number | null {
  if (times.length === 0) return null;
  let lo = 0;
  let hi = times.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((times[mid] as number) < frame) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && frame - (times[lo - 1] as number) <= (times[lo] as number) - frame) return times[lo - 1] as number;
  return times[lo] as number;
}

function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new EkzaError('unsupported', 'DopeSheetController: the canvas has no 2D context');
  return ctx;
}
