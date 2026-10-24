// Time slider (MVP-SPEC §7 WP-6t, §4.11.17; ADR 0007 §7): ruler, key ticks of the target controls, playhead, scrub,
// playback-range shading and markers, auto-key border, and range editing — Shift+click/drag selects a band with
// its keys, dragging the band's middle moves them, dragging an end scales them (one history step per drag), RMB
// opens the band menu. Everything is in active-clip frames (§4.11.8). Canvas2D, no React.
// M2a (M2A-SPEC §5.9, §5.11): Mod+drag on the band middle copies its keys, band moves and scales ripple when
// `tools.ripple` is on (one global region: the band), an MMB drag scrubs carrying the pose, breakdown ticks are green.
import { type Disposer, EkzaError, type Frame } from '@ekza-studio/anim-core';
import {
  type AnyChange,
  batchTables,
  type ChangeBatch,
  type CurveId,
  type KeyId,
  type TableName,
  type Tx,
} from '@ekza-studio/doc';
import {
  copyKeys,
  type EditorApp,
  type KeyEditOptions,
  type MenuItemDef,
  moveKeys,
  PANEL,
  type Prefs,
  type RippleScope,
  rippleMoveShift,
  type SessionState,
  scaleKeys,
  type ToolPointerEvent,
} from '@ekza-studio/editor-core';
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
import { registerContributions, TIMELINE_CHECKED_OPS, TIMELINE_CONTEXT_MENU } from './contributions';
import { KeyDrag } from './keyDrag';
import { bandKeys, collectTicks, nearestTick, TICK_EPSILON, type TickSet, targetCurves, timelineTargets } from './keys';
import { layoutFrameToX, layoutXToFrame, type SliderLayout, sliderLayout, tickCentreY } from './layout';
import { badgeFont, bandExtent, type PlayheadBadge, paintBase, paintPlayhead, updateBadge } from './painter';
import { readTimelineTheme, type TimelineTheme } from './theme';

/** Hit tolerances (CSS px). */
const TICK_HIT_PX = 4;
const HANDLE_INSIDE_PX = 6;
const HANDLE_OUTSIDE_PX = 4;
export const MOVE_KEYS_LABEL = 'Move Keys';
export const SCALE_KEYS_LABEL = 'Scale Keys';
export const COPY_KEYS_LABEL = 'Copy Keys';
/** Menu operators that act on the band's keys: without a band the menu leaves them out. */
const BAND_OPS: ReadonlySet<string> = new Set([
  'graph.keys.delete',
  'graph.keys.copy',
  'graph.tangent.set',
  'time.selectBand',
]);
const GROUP_ORDER: readonly string[] = ['edit', 'tangent', 'select', 'time'];
/** Tables whose changes move the slider's frames (clip range, fps, scene clock) or its ticks. */
const VIEW_TABLES: readonly TableName[] = ['clips', 'project', 'characters'];
/**
 * Tables whose changes rebuild the ticks; `keys` only when a key's time, curve or breakdown flag changes (see
 * `onBatch`; the flag colours the tick, M2A-SPEC §5.9).
 */
const TICK_TABLES: readonly TableName[] = ['curves', 'layers', 'controls', 'rigs'];

export interface TimelineMenuItem {
  readonly id: string;
  readonly label: string;
  readonly op: string;
  readonly args?: unknown;
  /** M2a: a toggle item (Ripple Edit) and whether it is on. */
  readonly checked?: boolean;
}

/** A key tick as the e2e test API reports it (M2A-SPEC §4.8 `timelineTicks`). */
export interface TimelineTick {
  readonly frame: Frame;
  readonly breakdown: boolean;
  readonly selected: boolean;
}

/**
 * A layer drawn over the slider's base and owning its own drag handles, loaded lazily by its feature
 * (CHARACTER-CONTRACT-SPEC §8.8: the contract's markers, window bracket and lead-in band). It draws in CSS px; a drag
 * gets the pointer's frame on every move and `done` on release (NaN: cancelled).
 */
export interface TimeSliderLayer {
  paint(ctx: CanvasRenderingContext2D, layout: SliderLayout, theme: TimelineTheme): void;
  grab(x: number, y: number, layout: SliderLayout): ((frame: Frame, done: boolean) => void) | null;
}

type Gesture =
  | { readonly kind: 'layer'; readonly drag: (frame: Frame, done: boolean) => void }
  | { readonly kind: 'scrub'; lastFrame: number; readonly carry: boolean }
  | { readonly kind: 'select'; readonly anchor: Frame; band: FrameRange }
  | {
      readonly kind: 'move';
      readonly origin: Frame;
      readonly band: FrameRange;
      readonly keys: readonly KeyId[];
      readonly snap: boolean;
      readonly drag: KeyDrag;
      /** M2a: the ripple scope (§5.11; the band is the region), null without ripple. */
      readonly ripple: RippleScope | null;
      /** M2a: Mod+drag copies the band's keys instead of moving them (§5.9). */
      readonly copy: boolean;
      delta: number;
      /** The offset the keys really got (the ripple's Δ < 0 stop); the band moves by it. */
      shift: number;
      /** The keys moved at some point of the gesture (a press released in place is a click: it sets the time). */
      moved: boolean;
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
      readonly ripple: RippleScope | null;
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
  private badgeFont: string;
  private readonly badge: PlayheadBadge = { frame: Number.NaN, text: '', width: 0, font: '' };
  private disposed = false;
  private readonly disposers: Disposer[] = [];
  private layer: TimeSliderLayer | null = null;

  /** Told the active clip each time the view is laid out (a lazy layer's loader watches it). */
  private readonly onView: ((clip: TimelineContext['clip'] | undefined) => void) | undefined;

  constructor(opts: {
    readonly app: EditorApp;
    readonly canvas: HTMLCanvasElement;
    readonly onView?: (clip: TimelineContext['clip'] | undefined) => void;
  }) {
    this.app = opts.app;
    this.canvas = opts.canvas;
    this.onView = opts.onView;
    this.ctx2d = context2d(opts.canvas);
    this.base = opts.canvas.ownerDocument.createElement('canvas');
    this.baseCtx = context2d(this.base);
    this.theme = readTimelineTheme(opts.canvas);
    this.badgeFont = badgeFont(this.theme);
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
    this.badgeFont = badgeFont(this.theme);
    this.view = null;
    this.redraw(true);
  }

  /** Sets (or clears) the lazy layer; setting it again repaints it. */
  setLayer(layer: TimeSliderLayer | null): void {
    this.layer = layer;
    this.invalidate(true);
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

  /** M2a (§4.8 `timelineTicks`): the ticks of the current key set, in time order. */
  keyTicks(): readonly TimelineTick[] {
    const ticks = this.tickSet();
    const out: TimelineTick[] = [];
    for (let i = 0; i < ticks.times.length; i++) {
      out.push({ frame: ticks.times[i]!, breakdown: ticks.breakdown[i] === 1, selected: ticks.selected[i] === 1 });
    }
    return out;
  }

  /**
   * M2a (§4.8 `screenOfBand`): a grab point (canvas CSS px) on the band's start or end handle or its middle; null
   * without a band, and for the ends of a 1-frame band (it only moves).
   */
  bandPoint(part: 'start' | 'middle' | 'end'): { readonly x: number; readonly y: number } | null {
    const band = this.displayBand();
    if (band === null) return null;
    const { layout } = this.currentView();
    const { left, right } = bandExtent(layout, band);
    const y = tickCentreY(layout);
    if (part === 'middle') return { x: (left + right) / 2, y };
    if (!bandHasSpan(band)) return null;
    const inside = Math.min(HANDLE_INSIDE_PX, (right - left) / 4);
    return { x: part === 'start' ? left + inside / 2 : right - inside / 2, y };
  }

  pointerDown(e: ToolPointerEvent): void {
    if (this.disposed) return;
    if (this.gesture !== null) this.cancel();
    const { ctx } = this.currentView();
    const time = this.app.session.getState().time;
    const frame = this.xToFrame(e.x);
    if (e.button === 1) {
      // M2a §5.9 (FR-TIME-10): an MMB drag scrubs and carries the pose to the new frame.
      const gesture: Gesture = { kind: 'scrub', lastFrame: Number.NaN, carry: ctx !== null };
      this.gesture = gesture;
      this.scrub(gesture, frame);
      return;
    }
    if (e.button !== 0) return;
    const drag = e.shift ? null : (this.layer?.grab(e.x, e.y, this.currentView().layout) ?? null);
    if (drag !== null) {
      this.gesture = { kind: 'layer', drag };
      return;
    }

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
      const ripple = this.app.session.getState().tools.ripple ? this.rippleScope(ctx, time.band) : null;
      if (hit.kind === 'band-middle') {
        this.gesture = {
          kind: 'move',
          origin: frame,
          band: time.band,
          keys: bandKeys(this.app, ctx, time.band),
          snap,
          drag: new KeyDrag(this.app, e.mod ? COPY_KEYS_LABEL : MOVE_KEYS_LABEL),
          // Ripple does not apply to copies (§5.9).
          ripple: e.mod ? null : ripple,
          copy: e.mod,
          delta: 0,
          shift: 0,
          moved: false,
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
          ripple,
          scale: null,
        };
        return;
      }
    }
    // A plain click outside the band clears it, then scrubs.
    if (time.band !== null) this.selectBand(null);
    const gesture: Gesture = { kind: 'scrub', lastFrame: Number.NaN, carry: false };
    this.gesture = gesture;
    this.scrub(gesture, frame);
  }

  pointerMove(e: ToolPointerEvent): void {
    const gesture = this.gesture;
    if (gesture === null || this.disposed) return;
    const frame = this.xToFrame(e.x);
    switch (gesture.kind) {
      case 'layer':
        gesture.drag(frame, false);
        this.invalidate(true);
        return;
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
        gesture.moved = true;
        if (gesture.keys.length > 0) {
          const ok = gesture.drag.update((tx) => this.applyMove(gesture, tx, false));
          if (!ok) this.gesture = null;
        } else gesture.shift = delta;
        this.invalidate(true);
        return;
      }
      case 'scale': {
        const scale = bandScale(gesture.band, gesture.side, frame - gesture.grab, gesture.snap);
        if (scale === null || scale.factor === (gesture.scale?.factor ?? 1)) return;
        gesture.scale = scale;
        const { keys, snap, ripple } = gesture;
        if (keys.length > 0) {
          const ok = gesture.drag.update((tx) => {
            const opts: KeyEditOptions = { snap, resolveCollisions: false, ripple: ripple !== null };
            scaleKeys(this.app, tx, keys, scale.pivot, scale.factor, opts, ripple ?? undefined);
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
      case 'layer':
        gesture.drag(this.xToFrame(e.x), true);
        break;
      case 'scrub':
      case 'select':
        break;
      case 'move': {
        if (gesture.delta === 0) {
          gesture.drag.cancel();
          if (!gesture.moved) {
            // A click inside the band (no drag) sets the time there and drops the band (acceptance round 2:
            // it read as a dead click).
            this.selectBand(null);
            this.scrub({ kind: 'scrub', lastFrame: Number.NaN, carry: false }, gesture.origin);
          }
          break;
        }
        const committed = gesture.keys.length === 0 || gesture.drag.commit((tx) => this.applyMove(gesture, tx, true));
        // The band follows the keys: the copies, or the moved keys (by the offset they really got).
        if (committed) this.selectBand(shiftBand(gesture.band, gesture.shift));
        break;
      }
      case 'scale': {
        const { keys, snap, scale, ripple } = gesture;
        if (scale === null || scale.factor === 1) {
          gesture.drag.cancel();
          break;
        }
        const committed =
          keys.length === 0 ||
          gesture.drag.commit((tx) => {
            const opts: KeyEditOptions = { snap, resolveCollisions: true, ripple: ripple !== null };
            scaleKeys(this.app, tx, keys, scale.pivot, scale.factor, opts, ripple ?? undefined);
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
    if (gesture?.kind === 'layer') gesture.drag(Number.NaN, true);
    if (gesture !== null) this.invalidate(true);
  }

  /** True while a pointer gesture is in progress. */
  get dragging(): boolean {
    return this.gesture !== null;
  }

  /**
   * RMB menu (§4.11.17) from the 'timeline.context' menu items, in group order (edit, tangent, select, then others).
   * Without a band the menu acts on the current frame (acceptance round 3): opening it selects the
   * current frame as a 1-frame band (what Shift+click there does), so Delete, Copy and the tangent types act on the
   * keys at the playhead. Items acting on the band's keys appear only while a band exists (no active clip: Paste
   * only); `time.selectBand` gets the current band.
   */
  contextMenu(_x: number, _y: number): readonly TimelineMenuItem[] {
    let band = this.app.session.getState().time.band;
    const ctx = activeTimelineContext(this.app);
    if (band === null && ctx !== null && this.gesture === null) {
      const frame = this.clampToSlider(
        snapFrame(currentFrame(this.app, ctx), this.app.session.getState().time.snapToFrames),
      );
      band = makeBand(frame, frame);
      this.selectBand(band);
      this.invalidate(true);
    }
    return this.app.menus
      .list()
      .filter((def) => def.menu === TIMELINE_CONTEXT_MENU && (band !== null || !BAND_OPS.has(def.op)))
      .sort(compareMenuItems)
      .map((def): TimelineMenuItem => {
        const label = def.label ?? this.app.operators.get(def.op)?.label ?? def.op;
        const args = def.args ?? (def.op === 'time.selectBand' ? { band, mode: 'replace' } : undefined);
        const item: TimelineMenuItem =
          args === undefined ? { id: def.id, label, op: def.op } : { id: def.id, label, op: def.op, args };
        return TIMELINE_CHECKED_OPS.has(def.op) ? { ...item, checked: this.app.session.getState().tools.ripple } : item;
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
      this.layer?.paint(this.baseCtx, layout, this.theme);
      this.baseDirty = false;
    }
    const target = this.ctx2d;
    target.setTransform(1, 0, 0, 1, 0, 0);
    target.clearRect(0, 0, this.canvas.width, this.canvas.height);
    target.drawImage(this.base, 0, 0);
    const frame = currentFrame(this.app, ctx);
    updateBadge(target, this.badge, frame, this.badgeFont);
    paintPlayhead(target, this.dpr, layout, frame, this.badge, this.theme);
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
      this.onView?.(ctx?.clip);
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
    if (gesture?.kind === 'move') return shiftBand(gesture.band, gesture.shift);
    if (gesture?.kind === 'scale') return gesture.scale?.band ?? gesture.band;
    return this.app.session.getState().time.band;
  }

  private clampToSlider(frame: Frame): Frame {
    const { layout } = this.currentView();
    return Math.min(Math.max(frame, layout.start), layout.end);
  }

  /**
   * `time.setFrame` with an active-clip frame inside the clip range (whole frames when snapping); an MMB scrub
   * carries the pose (§5.9).
   */
  private scrub(gesture: Extract<Gesture, { kind: 'scrub' }>, frame: Frame): void {
    const { ctx, layout } = this.currentView();
    const range = ctx?.clip.range ?? layout;
    const snapped = snapFrame(frame, this.app.session.getState().time.snapToFrames);
    const target = Math.min(Math.max(snapped, range.start), range.end);
    if (target === gesture.lastFrame) return;
    gesture.lastFrame = target;
    void this.app.run(
      'time.setFrame',
      {
        frame: target,
        unit: ctx === null ? 'scene' : 'clip',
        ...(gesture.carry ? { carry: true } : {}),
      },
      { panel: PANEL.timeline },
    );
  }

  /** The ripple scope of a band edit (§5.11): the band's target curves, the band as the region. */
  private rippleScope(ctx: TimelineContext, band: FrameRange): RippleScope {
    const curves: CurveId[] = targetCurves(this.app, ctx, timelineTargets(this.app, ctx))
      .filter((curve) => !curve.locked)
      .map((curve) => curve.id);
    return { curves, region: { start: band.start, end: band.end } };
  }

  /** One update of a band move or copy (§4.11.17, §5.9, §5.11); records the offset the keys really got. */
  private applyMove(gesture: Extract<Gesture, { kind: 'move' }>, tx: Tx, final: boolean): void {
    const { keys, snap, ripple, delta } = gesture;
    const opts: KeyEditOptions = { snap, resolveCollisions: final, ripple: ripple !== null };
    if (gesture.copy) {
      copyKeys(this.app, tx, keys, delta, opts);
      gesture.shift = delta;
      return;
    }
    gesture.shift = rippleMoveShift(this.app, tx, keys, delta, opts, ripple ?? undefined);
    moveKeys(this.app, tx, keys, delta, 0, opts, ripple ?? undefined);
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
    // M-1 (M2A-SPEC §5.21.1): the batch's table set (one scan per batch for every listener); key updates that keep
    // their time, curve and breakdown flag (a Graph Editor value drag of 1,000 keys) leave the ticks alone, so the slider neither
    // rebuilds its tick set nor repaints on every preview batch of such a drag.
    const tables = batchTables(batch);
    if (VIEW_TABLES.some((table) => tables.has(table))) view = ticks = true;
    if (!ticks && TICK_TABLES.some((table) => tables.has(table))) ticks = true;
    if (!ticks && tables.has('keys')) {
      const changes = batch.changes;
      for (let i = 0; i < changes.length; i++) {
        const change = changes[i] as AnyChange;
        if (change.table !== 'keys') continue;
        const { before, after } = change;
        if (
          before === undefined ||
          after === undefined ||
          before.t !== after.t ||
          before.curve !== after.curve ||
          before.breakdown !== after.breakdown
        ) {
          ticks = true;
          break;
        }
      }
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
