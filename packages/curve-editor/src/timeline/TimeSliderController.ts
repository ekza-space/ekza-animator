// Time slider (MVP-SPEC §7 WP-6t, §4.11.17; ADR 0007 §7): ruler, key ticks of the target controls, playhead, scrub,
// playback-range shading and markers, auto-key border, and Maya range editing — Shift+click/drag selects a band with
// its keys, dragging the band's middle moves them, dragging an end scales them (one history step per drag), RMB
// opens the band menu. Everything is in active-clip frames (§4.11.8). Canvas2D, no React.
import { type Disposer, EkzaError, type Frame } from '@ekza-animator/anim-core';
import type { ChangeBatch, KeyId } from '@ekza-animator/doc';
import {
  type EditorApp,
  type MenuItemDef,
  moveKeys,
  PANEL,
  type Prefs,
  type SessionState,
  scaleKeys,
  type ToolPointerEvent,
} from '@ekza-animator/editor-core';
import type { TimeSliderHit } from '../types';
import {
  type BandScale,
  bandHasSpan,
  bandMoveDelta,
  bandScale,
  type FrameRange,
  makeBand,
  sameRange,
  shiftBand,
  snapFrame,
} from './band';
import { activeTimelineContext, currentFrame, playbackRangeInClip, sliderRange, type TimelineContext } from './context';
import { registerContributions, TIMELINE_CONTEXT_MENU } from './contributions';
import { KeyDrag } from './keyDrag';
import { bandKeys, collectTicks, nearestTick, TICK_EPSILON, type TickSet } from './keys';
import { layoutFrameToX, layoutXToFrame, type SliderLayout, sliderLayout, tickCentreY } from './layout';
import { bandExtent, formatFrame, paintBase, paintPlayhead } from './painter';
import { readTimelineTheme, type TimelineTheme } from './theme';

/** Hit tolerances (CSS px). */
const TICK_HIT_PX = 4;
const HANDLE_INSIDE_PX = 6;
const HANDLE_OUTSIDE_PX = 4;
export const MOVE_KEYS_LABEL = 'Move Keys';
export const SCALE_KEYS_LABEL = 'Scale Keys';
/** Menu operators that act on the band's keys: without a band the menu leaves them out. */
const BAND_OPS: ReadonlySet<string> = new Set([
  'graph.keys.delete',
  'graph.keys.copy',
  'graph.tangent.set',
  'time.selectBand',
]);
const GROUP_ORDER: readonly string[] = ['edit', 'tangent', 'select'];
/** Tables whose changes move the slider's frames (clip range, fps, scene clock) or its ticks. */
const VIEW_TABLES: ReadonlySet<string> = new Set(['clips', 'project', 'characters']);
const TICK_TABLES: ReadonlySet<string> = new Set(['keys', 'curves', 'layers', 'controls', 'rigs']);

export interface TimelineMenuItem {
  readonly id: string;
  readonly label: string;
  readonly op: string;
  readonly args?: unknown;
}

type Gesture =
  | { readonly kind: 'scrub'; lastFrame: number }
  | { readonly kind: 'select'; readonly anchor: Frame; band: FrameRange }
  | {
      readonly kind: 'move';
      readonly origin: Frame;
      readonly band: FrameRange;
      readonly keys: readonly KeyId[];
      readonly snap: boolean;
      readonly drag: KeyDrag;
      delta: number;
    }
  | {
      readonly kind: 'scale';
      readonly side: 'start' | 'end';
      /** Pointer frame minus the grabbed band end, so the end does not jump to the pointer. */
      readonly grab: number;
      readonly band: FrameRange;
      readonly keys: readonly KeyId[];
      readonly snap: boolean;
      readonly drag: KeyDrag;
      scale: BandScale | null;
    };

interface View {
  readonly ctx: TimelineContext | null;
  readonly layout: SliderLayout;
}

export class TimeSliderController {
  private readonly app: EditorApp;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx2d: CanvasRenderingContext2D;
  /** Cached base layer (ruler, shading, band, ticks); the visible canvas is base + playhead. */
  private readonly base: HTMLCanvasElement;
  private readonly baseCtx: CanvasRenderingContext2D;
  private theme: TimelineTheme;
  private cssWidth = 0;
  private cssHeight = 0;
  private dpr = 1;
  private baseDirty = true;
  private overlayDirty = true;
  private frameRequest = 0;
  private view: View | null = null;
  private ticks: TickSet | null = null;
  private gesture: Gesture | null = null;
  private badgeFrame = Number.NaN;
  private badgeText = '';
  private disposed = false;
  private readonly disposers: Disposer[] = [];

  constructor(opts: { readonly app: EditorApp; readonly canvas: HTMLCanvasElement }) {
    this.app = opts.app;
    this.canvas = opts.canvas;
    this.ctx2d = context2d(opts.canvas);
    this.base = opts.canvas.ownerDocument.createElement('canvas');
    this.baseCtx = context2d(this.base);
    this.theme = readTimelineTheme(opts.canvas);
    this.disposers.push(
      this.app.session.subscribe((state, previous) => this.onSession(state, previous)),
      this.app.prefs.subscribe((prefs, previous) => this.onPrefs(prefs, previous)),
      this.app.store.subscribe((batch) => this.onBatch(batch)),
    );
  }

  /** Sizes the backing stores (device pixels) and redraws at once, so a resize never shows a blank canvas. */
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
    this.theme = readTimelineTheme(this.canvas);
    this.view = null;
    this.redraw(true);
  }

  /** Canvas CSS x of an active-clip frame. */
  frameToX(frame: Frame): number {
    return layoutFrameToX(this.currentView().layout, frame);
  }

  /** Active-clip frame (fractional) at canvas CSS x. */
  xToFrame(x: number): Frame {
    return layoutXToFrame(this.currentView().layout, x);
  }

  /** Band ends > band middle > key tick (±4 px) > ruler. Only x matters: every row of the slider behaves alike. */
  hitTest(x: number, _y: number): TimeSliderHit {
    const { layout } = this.currentView();
    const band = this.displayBand();
    if (band !== null) {
      const { left, right } = bandExtent(layout, band);
      if (bandHasSpan(band)) {
        const inside = Math.min(HANDLE_INSIDE_PX, (right - left) / 4);
        if (x >= left - HANDLE_OUTSIDE_PX && x <= left + inside) return { kind: 'band-start', frame: band.start };
        if (x >= right - inside && x <= right + HANDLE_OUTSIDE_PX) return { kind: 'band-end', frame: band.end };
      }
      if (x >= left && x <= right) return { kind: 'band-middle', frame: Math.round(layoutXToFrame(layout, x)) };
    }
    const ticks = this.tickSet();
    const index = nearestTick(ticks, layoutXToFrame(layout, x));
    if (index >= 0) {
      const t = ticks.times[index]!;
      if (Math.abs(layoutFrameToX(layout, t) - x) <= TICK_HIT_PX) return { kind: 'tick', frame: t };
    }
    const frame = layoutXToFrame(layout, x);
    return { kind: 'ruler', frame: snapFrame(frame, this.app.session.getState().time.snapToFrames) };
  }

  /** Centre of the key tick at `frame` (canvas CSS px), or null when no shown key sits there. */
  tickPoint(frame: Frame): { readonly x: number; readonly y: number } | null {
    const ticks = this.tickSet();
    const index = nearestTick(ticks, frame);
    if (index < 0 || Math.abs(ticks.times[index]! - frame) >= TICK_EPSILON) return null;
    const { layout } = this.currentView();
    return { x: layoutFrameToX(layout, ticks.times[index]!), y: tickCentreY(layout) };
  }

  pointerDown(e: ToolPointerEvent): void {
    if (this.disposed) return;
    if (this.gesture !== null) this.cancel();
    if (e.button !== 0) return;
    const { ctx } = this.currentView();
    const time = this.app.session.getState().time;
    const frame = this.xToFrame(e.x);

    if (e.shift) {
      if (ctx === null) return;
      const anchor = this.clampToSlider(snapFrame(frame, time.snapToFrames));
      const band = makeBand(anchor, anchor);
      this.gesture = { kind: 'select', anchor, band };
      this.selectBand(band);
      this.invalidate(true);
      return;
    }

    const snap = time.snapToFrames && !e.alt;
    if (ctx !== null && time.band !== null) {
      const hit = this.hitTest(e.x, e.y);
      if (hit.kind === 'band-middle') {
        this.gesture = {
          kind: 'move',
          origin: frame,
          band: time.band,
          keys: bandKeys(this.app, ctx, time.band),
          snap,
          drag: new KeyDrag(this.app, MOVE_KEYS_LABEL),
          delta: 0,
        };
        return;
      }
      if (hit.kind === 'band-start' || hit.kind === 'band-end') {
        const side = hit.kind === 'band-start' ? 'start' : 'end';
        this.gesture = {
          kind: 'scale',
          side,
          grab: frame - (side === 'start' ? time.band.start : time.band.end),
          band: time.band,
          keys: bandKeys(this.app, ctx, time.band),
          snap,
          drag: new KeyDrag(this.app, SCALE_KEYS_LABEL),
          scale: null,
        };
        return;
      }
    }
    // A plain click outside the band clears it, then scrubs.
    if (time.band !== null) this.selectBand(null);
    const gesture: Gesture = { kind: 'scrub', lastFrame: Number.NaN };
    this.gesture = gesture;
    this.scrub(gesture, frame);
  }

  pointerMove(e: ToolPointerEvent): void {
    const gesture = this.gesture;
    if (gesture === null || this.disposed) return;
    const frame = this.xToFrame(e.x);
    switch (gesture.kind) {
      case 'scrub':
        this.scrub(gesture, frame);
        return;
      case 'select': {
        const end = this.clampToSlider(snapFrame(frame, this.app.session.getState().time.snapToFrames));
        const band = makeBand(gesture.anchor, end);
        if (sameRange(band, gesture.band)) return;
        gesture.band = band;
        this.selectBand(band);
        this.invalidate(true);
        return;
      }
      case 'move': {
        const delta = bandMoveDelta(gesture.origin, frame, gesture.snap);
        if (delta === gesture.delta) return;
        gesture.delta = delta;
        const { keys, snap } = gesture;
        if (keys.length > 0) {
          const ok = gesture.drag.update((tx) => {
            moveKeys(this.app, tx, keys, delta, 0, { snap, resolveCollisions: false });
          });
          if (!ok) this.gesture = null;
        }
        this.invalidate(true);
        return;
      }
      case 'scale': {
        const scale = bandScale(gesture.band, gesture.side, frame - gesture.grab, gesture.snap);
        if (scale === null || scale.factor === (gesture.scale?.factor ?? 1)) return;
        gesture.scale = scale;
        const { keys, snap } = gesture;
        if (keys.length > 0) {
          const ok = gesture.drag.update((tx) => {
            scaleKeys(this.app, tx, keys, scale.pivot, scale.factor, { snap, resolveCollisions: false });
          });
          if (!ok) this.gesture = null;
        }
        this.invalidate(true);
        return;
      }
    }
  }

  pointerUp(e: ToolPointerEvent): void {
    const gesture = this.gesture;
    if (gesture === null || this.disposed) return;
    this.pointerMove(e);
    if (this.gesture !== gesture) return; // the drag failed or was cancelled while applying the last position
    this.gesture = null;
    switch (gesture.kind) {
      case 'scrub':
      case 'select':
        break;
      case 'move': {
        const { keys, snap, delta } = gesture;
        if (delta === 0) {
          gesture.drag.cancel();
          break;
        }
        const committed =
          keys.length === 0 ||
          gesture.drag.commit((tx) => {
            moveKeys(this.app, tx, keys, delta, 0, { snap, resolveCollisions: true });
          });
        if (committed) this.selectBand(shiftBand(gesture.band, delta));
        break;
      }
      case 'scale': {
        const { keys, snap, scale } = gesture;
        if (scale === null || scale.factor === 1) {
          gesture.drag.cancel();
          break;
        }
        const committed =
          keys.length === 0 ||
          gesture.drag.commit((tx) => {
            scaleKeys(this.app, tx, keys, scale.pivot, scale.factor, { snap, resolveCollisions: true });
          });
        if (committed) this.selectBand(scale.band);
        break;
      }
    }
    this.invalidate(true);
  }

  /**
   * Cancels the gesture in progress (Esc, pointer cancel, lost capture): a key drag drops its preview; a scrub or a
   * band selection keeps what it already set. Not part of the §7 contract; the panel calls it on pointer cancel.
   */
  cancel(): void {
    const gesture = this.gesture;
    this.gesture = null;
    if (gesture?.kind === 'move' || gesture?.kind === 'scale') gesture.drag.cancel();
    if (gesture !== null) this.invalidate(true);
  }

  /** True while a pointer gesture is in progress. */
  get dragging(): boolean {
    return this.gesture !== null;
  }

  /**
   * RMB menu (§4.11.17) from the 'timeline.context' menu items, in group order (edit, tangent, select, then others).
   * Items acting on the band's keys appear only while a band exists; `time.selectBand` gets the current band.
   */
  contextMenu(_x: number, _y: number): readonly TimelineMenuItem[] {
    const band = this.app.session.getState().time.band;
    return this.app.menus
      .list()
      .filter((def) => def.menu === TIMELINE_CONTEXT_MENU && (band !== null || !BAND_OPS.has(def.op)))
      .sort(compareMenuItems)
      .map((def): TimelineMenuItem => {
        const label = def.label ?? this.app.operators.get(def.op)?.label ?? def.op;
        const args = def.args ?? (def.op === 'time.selectBand' ? { band, mode: 'replace' } : undefined);
        return args === undefined ? { id: def.id, label, op: def.op } : { id: def.id, label, op: def.op, args };
      });
  }

  /** Draws what changed (base layer, then the playhead); `force` repaints everything. Cheap when nothing changed. */
  redraw(force?: boolean): void {
    if (this.disposed) return;
    if (force !== true && !this.baseDirty && !this.overlayDirty) return;
    if (this.cssWidth <= 0 || this.cssHeight <= 0) return;
    const { ctx, layout } = this.currentView();
    if (force === true || this.baseDirty) {
      const time = this.app.session.getState().time;
      paintBase(
        this.baseCtx,
        this.dpr,
        {
          layout,
          playback: ctx === null ? { start: layout.start, end: layout.end } : playbackRangeInClip(this.app, ctx),
          playbackMarkers: ctx !== null && time.playbackRange !== null,
          ticks: this.tickSet(),
          band: this.displayBand(),
          autoKey: this.app.prefs.getState().autoKey,
        },
        this.theme,
      );
      this.baseDirty = false;
    }
    const target = this.ctx2d;
    target.setTransform(1, 0, 0, 1, 0, 0);
    target.clearRect(0, 0, this.canvas.width, this.canvas.height);
    target.drawImage(this.base, 0, 0);
    const frame = currentFrame(this.app, ctx);
    if (frame !== this.badgeFrame) {
      this.badgeFrame = frame;
      this.badgeText = formatFrame(frame);
    }
    paintPlayhead(target, this.dpr, layout, frame, this.badgeText, this.theme);
    this.overlayDirty = false;
  }

  dispose(): void {
    if (this.disposed) return;
    this.cancel();
    this.disposed = true;
    if (this.frameRequest !== 0) this.canvas.ownerDocument.defaultView?.cancelAnimationFrame(this.frameRequest);
    this.frameRequest = 0;
    for (const dispose of this.disposers.splice(0).reverse()) dispose();
  }

  // ---------- internals ----------

  private currentView(): View {
    if (this.view === null) {
      const ctx = activeTimelineContext(this.app);
      this.view = { ctx, layout: sliderLayout(this.cssWidth, this.cssHeight, sliderRange(this.app, ctx)) };
    }
    return this.view;
  }

  private tickSet(): TickSet {
    this.ticks ??= collectTicks(this.app, this.currentView().ctx);
    return this.ticks;
  }

  /** The band being dragged, else the session band. */
  private displayBand(): FrameRange | null {
    const gesture = this.gesture;
    if (gesture?.kind === 'select') return gesture.band;
    if (gesture?.kind === 'move') return shiftBand(gesture.band, gesture.delta);
    if (gesture?.kind === 'scale') return gesture.scale?.band ?? gesture.band;
    return this.app.session.getState().time.band;
  }

  private clampToSlider(frame: Frame): Frame {
    const { layout } = this.currentView();
    return Math.min(Math.max(frame, layout.start), layout.end);
  }

  /** `time.setFrame` with an active-clip frame inside the clip range (whole frames when snapping). */
  private scrub(gesture: Extract<Gesture, { kind: 'scrub' }>, frame: Frame): void {
    const { ctx, layout } = this.currentView();
    const range = ctx?.clip.range ?? layout;
    const snapped = snapFrame(frame, this.app.session.getState().time.snapToFrames);
    const target = Math.min(Math.max(snapped, range.start), range.end);
    if (target === gesture.lastFrame) return;
    gesture.lastFrame = target;
    void this.app.run(
      'time.setFrame',
      { frame: target, unit: ctx === null ? 'scene' : 'clip' },
      { panel: PANEL.timeline },
    );
  }

  private selectBand(band: FrameRange | null): void {
    void this.app.run('time.selectBand', { band, mode: 'replace' }, { panel: PANEL.timeline });
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

  private onSession(state: SessionState, previous: SessionState): void {
    const time = state.time;
    const before = previous.time;
    if (
      state.activeCharacter !== previous.activeCharacter ||
      state.activeClip !== previous.activeClip ||
      time.playbackRange !== before.playbackRange
    ) {
      this.view = null;
      this.ticks = null;
      this.invalidate(true);
    }
    if (state.selection.controls !== previous.selection.controls || state.selection.keys !== previous.selection.keys) {
      this.ticks = null;
      this.invalidate(true);
    }
    if (time.band !== before.band) this.invalidate(true);
    if (time.sceneFrame !== before.sceneFrame) this.invalidate(false);
  }

  private onPrefs(prefs: Prefs, previous: Prefs): void {
    if (prefs.autoKey !== previous.autoKey) this.invalidate(true);
  }

  private onBatch(batch: ChangeBatch): void {
    let ticks = batch.origin === 'load';
    let view = ticks;
    for (const change of batch.changes) {
      if (VIEW_TABLES.has(change.table)) view = ticks = true;
      else if (TICK_TABLES.has(change.table)) ticks = true;
    }
    if (view) this.view = null;
    if (ticks) {
      this.ticks = null;
      this.invalidate(true);
    }
  }
}

/** Registers time.selectBand (acting on the focused controller) and the slider's RMB menu items. */
export function registerTimelineContributions(app: EditorApp, focused: () => TimeSliderController | null): Disposer {
  return registerContributions(app, focused);
}

function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new EkzaError('unsupported', 'TimeSliderController: the canvas has no 2D context');
  return ctx;
}

function compareMenuItems(a: MenuItemDef, b: MenuItemDef): number {
  const rank = (group: string): number => {
    const index = GROUP_ORDER.indexOf(group);
    return index === -1 ? GROUP_ORDER.length : index;
  };
  return (
    rank(a.group) - rank(b.group) || a.group.localeCompare(b.group) || a.order - b.order || a.id.localeCompare(b.id)
  );
}
