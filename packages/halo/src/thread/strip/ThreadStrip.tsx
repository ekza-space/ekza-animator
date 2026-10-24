// The Thread's ruler (STUDIO-TOUCH-SPEC §10.3, §5.2.1; T7): Halo's own small Canvas2D strip over the active
// animation — beat ticks, the selection's key dots (a faint summary when nothing is selected, hollow in-betweens), the
// band and the playhead — and its gestures, each one operator run:
// - tap the ruler: jump (`time.setFrame`); drag it or the playhead: scrub (with the Thumb key's *Carry pose*, the pose
//   comes along);
// - tap a key dot: its keys are selected and its Halo docks above the Thread; drag it: retime (`graph.keys.move`, one
//   step);
// - long-press the ruler then drag (or a Pencil drag): a band (`time.selectBand`); drag the band's body to move its keys
//   (Thumb *Copy*: copy them), its ends to stretch them (`graph.keys.scale`); tap it for its Halo;
// - long-press the playhead (or the ruler): the playhead's Halo;
// - two fingers: pinch zooms time, a drag pans it; a double-tap shows the whole animation again.
// Chrome, not the canvas pane: its pointers never join a canvas gesture (C6).
import { thumbReduce } from '@ekza-studio/ui/touch';
import { type JSX, useEffect, useRef } from 'react';
import { animateWords } from '../../i18n/animate';
import type { HaloController } from '../../shell/controller';
import type { AnimateUiStore } from '../../stages/animate/ui';
import {
  beatTicks,
  currentFrame,
  dotAt,
  frameToX,
  type KeyDot,
  keyDots,
  snapFrame,
  type StripLayout,
  stripLayout,
  type ThreadContext,
  threadContext,
  tickLabel,
  timeText,
  xToFrame,
} from './model';

const w = animateWords.thread;

/** Hit radius on the strip by pointer type (§5.4: 22 / 9 / 6 px). */
const RADIUS = { touch: 22, pen: 9, mouse: 6 } as const;
const SLOP = { touch: 10, pen: 4, mouse: 3 } as const;
const LONG_PRESS_MS = 450;
const DOUBLE_TAP_MS = 450;

type PointerKind = keyof typeof RADIUS;
const kindOf = (e: PointerEvent): PointerKind =>
  e.pointerType === 'touch' || e.pointerType === 'pen' ? e.pointerType : 'mouse';

type Grab =
  | { readonly kind: 'ruler' }
  | { readonly kind: 'playhead' }
  | { readonly kind: 'dot'; readonly dot: KeyDot }
  | { readonly kind: 'bandBody' }
  | { readonly kind: 'bandEnd'; readonly side: 'start' | 'end' };

interface Press {
  readonly id: number;
  readonly type: PointerKind;
  readonly x: number;
  readonly frame: number;
  readonly grab: Grab;
  phase: 'wait' | 'scrub' | 'retime' | 'band' | 'moveBand' | 'stretch' | 'long';
  /** The frame the drag is at (retime, band, move, stretch). */
  at: number;
  lastScrub: number;
  readonly carry: boolean;
  readonly copy: boolean;
}

/** What the strip shows now (re-read at every draw). */
interface Scene {
  readonly ctx: ThreadContext | null;
  readonly layout: StripLayout;
  readonly frame: number;
  readonly dots: readonly KeyDot[];
  readonly faint: boolean;
  readonly band: { readonly start: number; readonly end: number } | null;
}

/** The strip's geometry for the test API (page px) — set by the mounted strip. */
export interface StripProbe {
  readonly rect: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  readonly x0: number;
  readonly x1: number;
  readonly start: number;
  readonly end: number;
}

const probes = new WeakMap<object, () => StripProbe | null>();

/** The mounted strip's geometry (the `thread` slice of `halo()`), or null. */
export function stripProbe(owner: object): StripProbe | null {
  return probes.get(owner)?.() ?? null;
}

function cssVar(el: Element, name: string, fallback: string): string {
  const value = getComputedStyle(el).getPropertyValue(name).trim();
  return value === '' ? fallback : value;
}

export function ThreadStrip({
  controller,
  ui,
  row = false,
}: {
  readonly controller: HaloController;
  readonly ui: AnimateUiStore;
  /** A row of its own under the controls (phones: the ruler keeps a usable length). */
  readonly row?: boolean;
}): JSX.Element {
  const { ctx } = controller;
  const { app, store } = ctx;
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return undefined;
    const g = canvas.getContext('2d');
    if (g === null) return undefined;
    let width = 0;
    let height = 0;
    let dpr = 1;
    let view: { start: number; end: number } | null = null;
    let viewClip: string | null = null;
    let press: Press | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastTap = 0;
    let raf = 0;
    const fingers = new Map<number, number>();
    let pinch: { readonly a: number; readonly b: number; readonly span: { start: number; end: number } } | null = null;

    const scene = (): Scene => {
      const thread = threadContext(app);
      if (thread !== null && viewClip !== thread.clip.id) {
        view = null;
        viewClip = thread.clip.id;
      }
      const span = view ?? thread?.range ?? { start: 0, end: 60 };
      const layout = stripLayout(width, span);
      const { dots, faint } = thread === null ? { dots: [], faint: true } : keyDots(app, thread);
      return {
        ctx: thread,
        layout,
        frame: currentFrame(app, thread),
        dots,
        faint,
        band: thread === null ? null : app.session.getState().time.band,
      };
    };

    const draw = (): void => {
      raf = 0;
      if (width <= 0 || height <= 0) return;
      const s = scene();
      const text = cssVar(canvas, '--text', '#e8e8ea');
      const text3 = cssVar(canvas, '--text-3', '#8a8c94');
      const border = cssVar(canvas, '--border', '#3a3c44');
      const accent = cssVar(canvas, '--accent', '#7c5cff');
      const playhead = cssVar(canvas, '--playhead', accent);
      const keyColour = cssVar(canvas, '--key-default', text);
      const keySelected = cssVar(canvas, '--key-selected', '#ffcc33');
      const range = cssVar(canvas, '--range-select', 'rgba(124,92,255,0.25)');
      const rangeEdge = cssVar(canvas, '--range-select-edge', accent);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, width, height);
      const mid = Math.round(height * 0.58);
      const { layout } = s;
      // the track
      g.strokeStyle = border;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(layout.x0, mid);
      g.lineTo(layout.x1, mid);
      g.stroke();
      // beat ticks every 0.25 s, labels on the majors
      if (s.ctx !== null) {
        const ticks = beatTicks({ start: layout.start, end: layout.end }, s.ctx.fps);
        const room = (layout.x1 - layout.x0) / Math.max(1, ticks.length);
        g.font = `500 11px ${cssVar(canvas, '--font-ui', 'system-ui')}`;
        g.textAlign = 'center';
        g.fillStyle = text3;
        g.strokeStyle = text3;
        g.lineWidth = 1;
        ticks.forEach((tick, index) => {
          const x = Math.round(frameToX(layout, tick.frame)) + 0.5;
          g.beginPath();
          g.moveTo(x, mid - (tick.major ? 7 : 4));
          g.lineTo(x, mid + (tick.major ? 7 : 4));
          g.stroke();
          const label = tick.major && (room > 9 || Number.isInteger(tick.seconds));
          if (label) g.fillText(tickLabel(tick.seconds, index === ticks.length - 1), x, mid - 11);
        });
      }
      // the band
      if (s.band !== null) {
        const a = frameToX(layout, s.band.start - 0.5);
        const b = frameToX(layout, s.band.end + 0.5);
        g.fillStyle = range;
        g.fillRect(a, mid - 12, Math.max(2, b - a), 24);
        g.fillStyle = rangeEdge;
        g.fillRect(a - 1.5, mid - 14, 3, 28);
        g.fillRect(b - 1.5, mid - 14, 3, 28);
      }
      // key dots (diamonds): faint without a selection, hollow for in-betweens
      const dragging = press !== null && press.phase === 'retime' && press.grab.kind === 'dot' ? press : null;
      for (const dot of s.dots) {
        const frame =
          dragging !== null && dragging.grab.kind === 'dot' && dragging.grab.dot === dot ? dragging.at : dot.frame;
        const x = frameToX(layout, frame);
        const r = 6;
        g.globalAlpha = s.faint ? 0.45 : 1;
        g.beginPath();
        g.moveTo(x, mid - r);
        g.lineTo(x + r, mid);
        g.lineTo(x, mid + r);
        g.lineTo(x - r, mid);
        g.closePath();
        const colour = dot.selected ? keySelected : keyColour;
        if (dot.inBetween) {
          g.strokeStyle = colour;
          g.lineWidth = 2;
          g.stroke();
        } else {
          g.fillStyle = colour;
          g.fill();
        }
        g.globalAlpha = 1;
      }
      // the playhead
      const px = Math.round(frameToX(layout, s.frame)) + 0.5;
      g.strokeStyle = playhead;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(px, 4);
      g.lineTo(px, height - 4);
      g.stroke();
      g.fillStyle = playhead;
      g.beginPath();
      g.arc(px, 6, 5, 0, Math.PI * 2);
      g.fill();
      canvas.setAttribute('aria-valuetext', s.ctx === null ? w.noClip : timeText(s.frame, s.ctx.fps));
      canvas.setAttribute('aria-valuenow', String(Math.round(s.frame)));
      canvas.setAttribute('aria-valuemin', String(s.ctx?.range.start ?? 0));
      canvas.setAttribute('aria-valuemax', String(s.ctx?.range.end ?? 60));
    };

    const invalidate = (): void => {
      if (raf === 0) raf = requestAnimationFrame(draw);
    };

    const resize = (): void => {
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      draw();
    };
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize);
    observer?.observe(canvas);
    resize();

    const local = (e: PointerEvent): number => e.clientX - canvas.getBoundingClientRect().left;
    const count = (): void => store.set((s) => ({ touches: s.touches + 1 }));
    const thumbOn = (): boolean => store.get().thumb.latch !== 'off';
    const consumeThumb = (): void => {
      const thumb = store.get().thumb;
      if (thumb.latch === 'once') store.set({ thumb: thumbReduce(thumb, { type: 'consume' }) });
    };
    const run = (op: string, args?: unknown) => ctx.run(op, args);

    const setFrame = (frame: number, carry = false): void => {
      void run('time.setFrame', { frame, unit: 'clip', ...(carry ? { carry: true } : {}) });
    };

    const grabAt = (x: number, type: PointerKind, s: Scene): Grab => {
      const radius = RADIUS[type];
      if (s.band !== null) {
        const a = frameToX(s.layout, s.band.start - 0.5);
        const b = frameToX(s.layout, s.band.end + 0.5);
        const reach = Math.min(radius, Math.max(6, (b - a) / 4));
        if (s.band.end > s.band.start && Math.abs(x - a) <= reach) return { kind: 'bandEnd', side: 'start' };
        if (s.band.end > s.band.start && Math.abs(x - b) <= reach) return { kind: 'bandEnd', side: 'end' };
        if (x > a && x < b) return { kind: 'bandBody' };
      }
      const index = dotAt(s.layout, s.dots, x, radius);
      const dot = index < 0 ? undefined : s.dots[index];
      const playheadX = frameToX(s.layout, s.frame);
      if (dot !== undefined && !s.faint) {
        // the playhead wins over a dot only when it is nearer
        if (Math.abs(playheadX - x) < Math.abs(frameToX(s.layout, dot.frame) - x) - 2) return { kind: 'playhead' };
        return { kind: 'dot', dot };
      }
      if (Math.abs(playheadX - x) <= radius) return { kind: 'playhead' };
      return { kind: 'ruler' };
    };

    const clearTimer = (): void => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    };

    const openDot = async (dot: KeyDot): Promise<void> => {
      await run('select.keys', { items: dot.keys.map((key) => ({ key })), mode: 'replace' });
      setFrame(dot.frame);
      ui.set({ docked: { kind: 'keyDot', frame: dot.frame }, menu: null, more: null, newCard: false });
    };

    const bandOf = (a: number, b: number): { start: number; end: number } =>
      a <= b ? { start: a, end: b } : { start: b, end: a };

    const onDown = (e: PointerEvent): void => {
      const type = kindOf(e);
      if (type === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        // a synthetic pointer cannot be captured
      }
      if (type === 'touch') {
        fingers.set(e.pointerId, local(e));
        if (fingers.size === 2) {
          // two fingers: zoom and pan time; the first finger's gesture ends
          clearTimer();
          press = null;
          const [a, b] = [...fingers.values()] as [number, number];
          const s = scene();
          pinch = { a, b, span: { start: s.layout.start, end: s.layout.end } };
          return;
        }
        if (fingers.size > 2) return;
      }
      const s = scene();
      if (s.ctx === null) return;
      const x = local(e);
      const frame = xToFrame(s.layout, x);
      const shift = type === 'mouse' && e.shiftKey;
      const grab: Grab = shift ? { kind: 'ruler' } : grabAt(x, type, s);
      press = {
        id: e.pointerId,
        type,
        x,
        frame,
        grab,
        phase: 'wait',
        at: frame,
        lastScrub: Number.NaN,
        carry: grab.kind === 'playhead' && thumbOn(),
        copy: grab.kind === 'bandBody' && (thumbOn() || (type === 'mouse' && (e.metaKey || e.ctrlKey))),
      };
      if (shift || (type === 'pen' && grab.kind === 'ruler')) {
        // Pro's Shift+drag, and a Pencil drag along the ruler, draw a band
        press.phase = 'band';
        press.at = snapFrame(frame, s.ctx.range);
        return;
      }
      clearTimer();
      if (type !== 'mouse') {
        const pressed = press;
        timer = setTimeout(() => {
          timer = null;
          if (press === pressed && pressed.phase === 'wait') pressed.phase = 'long';
        }, LONG_PRESS_MS);
      }
    };

    const onMove = (e: PointerEvent): void => {
      if (pinch !== null && fingers.has(e.pointerId)) {
        fingers.set(e.pointerId, local(e));
        const [a, b] = [...fingers.values()] as [number, number];
        const s = scene();
        if (s.ctx === null) return;
        const before = Math.max(8, Math.abs(pinch.b - pinch.a));
        const after = Math.max(8, Math.abs(b - a));
        const span = pinch.span.end - pinch.span.start;
        const nextSpan = Math.min(s.ctx.range.end - s.ctx.range.start, Math.max(4, (span * before) / after));
        const centre = xToFrame(stripLayout(width, pinch.span), (pinch.a + pinch.b) / 2);
        const shift = ((a + b) / 2 - (pinch.a + pinch.b) / 2) * (nextSpan / Math.max(1, s.layout.x1 - s.layout.x0));
        const start = centre - nextSpan / 2 - shift;
        view = { start, end: start + nextSpan };
        invalidate();
        return;
      }
      const current = press;
      if (current === null || current.id !== e.pointerId) return;
      const s = scene();
      if (s.ctx === null) return;
      const x = local(e);
      const frame = xToFrame(s.layout, x);
      const travelled = Math.abs(x - current.x);
      if (current.phase === 'wait' || current.phase === 'long') {
        if (travelled < SLOP[current.type]) return;
        clearTimer();
        if (current.phase === 'long') {
          current.phase = 'band';
          current.at = snapFrame(current.frame, s.ctx.range);
        } else if (current.grab.kind === 'dot') current.phase = 'retime';
        else if (current.grab.kind === 'bandBody') current.phase = 'moveBand';
        else if (current.grab.kind === 'bandEnd') current.phase = 'stretch';
        else current.phase = 'scrub';
        store.set({ halo: null });
      }
      switch (current.phase) {
        case 'scrub': {
          const target = snapFrame(frame, s.ctx.range);
          if (target !== current.lastScrub) {
            current.lastScrub = target;
            setFrame(target, current.carry);
          }
          return;
        }
        case 'band': {
          const end = snapFrame(frame, s.ctx.range);
          const band = bandOf(snapFrame(current.frame, s.ctx.range), end);
          void run('time.selectBand', { band, mode: 'replace' });
          return;
        }
        case 'retime':
        case 'moveBand':
        case 'stretch':
          current.at = snapFrame(frame, { start: -1e9, end: 1e9 });
          invalidate();
          return;
        default:
          return;
      }
    };

    const onUp = (e: PointerEvent, cancelled: boolean): void => {
      if (fingers.has(e.pointerId)) {
        fingers.delete(e.pointerId);
        if (pinch !== null) {
          if (fingers.size === 0) pinch = null;
          return;
        }
      }
      const current = press;
      if (current === null || current.id !== e.pointerId) return;
      press = null;
      clearTimer();
      const s = scene();
      if (cancelled || s.ctx === null) {
        invalidate();
        return;
      }
      const thread = s.ctx;
      const delta = Math.round(current.at - snapFrame(current.frame, { start: -1e9, end: 1e9 }));
      switch (current.phase) {
        case 'wait': {
          count();
          const now = e.timeStamp;
          if (now - lastTap <= DOUBLE_TAP_MS && current.grab.kind === 'ruler' && view !== null) {
            // a double-tap shows the whole animation again
            view = null;
            lastTap = 0;
            invalidate();
            return;
          }
          lastTap = now;
          if (current.grab.kind === 'dot') {
            void openDot(current.grab.dot);
            return;
          }
          if (current.grab.kind === 'bandBody' || current.grab.kind === 'bandEnd') {
            ui.set({ docked: { kind: 'band' }, menu: null, more: null, newCard: false });
            return;
          }
          // a tap outside the band clears it, then jumps
          if (s.band !== null) void run('time.selectBand', { band: null, mode: 'replace' });
          const docked = ui.get().docked;
          if (docked !== null && docked.kind !== 'clip') ui.set({ docked: null, menu: null, more: null });
          setFrame(snapFrame(current.frame, thread.range));
          return;
        }
        case 'long': {
          count();
          if (current.grab.kind === 'dot') {
            void openDot(current.grab.dot);
            return;
          }
          if (current.grab.kind === 'bandBody' || current.grab.kind === 'bandEnd') {
            ui.set({ docked: { kind: 'band' }, menu: null, more: null, newCard: false });
            return;
          }
          if (current.grab.kind === 'ruler') setFrame(snapFrame(current.frame, thread.range));
          ui.set({ docked: { kind: 'playhead' }, menu: null, more: null, newCard: false });
          return;
        }
        case 'scrub':
          count();
          consumeThumb();
          return;
        case 'band':
          count();
          if (app.session.getState().time.band !== null)
            ui.set({ docked: { kind: 'band' }, menu: null, more: null, newCard: false });
          return;
        case 'retime': {
          count();
          if (current.grab.kind !== 'dot' || delta === 0) {
            invalidate();
            return;
          }
          const dot = current.grab.dot;
          void (async () => {
            await run('select.keys', { items: dot.keys.map((key) => ({ key })), mode: 'replace' });
            await run('graph.keys.move', { dFrames: delta, dValue: 0 });
            ui.set({ docked: { kind: 'keyDot', frame: dot.frame + delta }, menu: null, more: null });
          })();
          return;
        }
        case 'moveBand': {
          count();
          const band = s.band;
          if (band === null || delta === 0) return;
          consumeThumb();
          void (async () => {
            const result = current.copy
              ? await run('graph.keys.copyTo', { dFrames: delta })
              : await run('graph.keys.move', { dFrames: delta, dValue: 0 });
            if (result.status === 'finished') {
              await run('time.selectBand', {
                band: { start: band.start + delta, end: band.end + delta },
                mode: 'replace',
              });
            }
          })();
          return;
        }
        case 'stretch': {
          count();
          const band = s.band;
          if (band === null || current.grab.kind !== 'bandEnd') return;
          const pivot = current.grab.side === 'end' ? band.start : band.end;
          const from = current.grab.side === 'end' ? band.end : band.start;
          const to = current.grab.side === 'end' ? band.end + delta : band.start + delta;
          const span = from - pivot;
          if (span === 0 || to === from || Math.sign(to - pivot) !== Math.sign(span)) {
            invalidate();
            return;
          }
          const factor = (to - pivot) / span;
          void (async () => {
            const result = await run('graph.keys.scale', { pivot, factor });
            if (result.status === 'finished')
              await run('time.selectBand', { band: bandOf(pivot, to), mode: 'replace' });
          })();
          return;
        }
      }
    };

    const onPointerUp = (e: PointerEvent): void => onUp(e, false);
    const onPointerCancel = (e: PointerEvent): void => onUp(e, true);
    const onContextMenu = (e: Event): void => e.preventDefault();
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerCancel);
    canvas.addEventListener('contextmenu', onContextMenu);

    // the focused band source (§20.3 item 18): `time.selectBand` runs here as in Pro; a lazy chunk, so the curve
    // editor loads with the Thread, never with `/app`'s first scripts (§20.6)
    let band: { dispose(): void } | null = null;
    let unmounted = false;
    void import('../band/source').then(
      ({ provideThreadBandSource }) => {
        if (!unmounted) band = provideThreadBandSource(app);
      },
      () => undefined,
    );

    const offSession = app.session.subscribe((next, previous) => {
      if (
        next.time !== previous.time ||
        next.selection !== previous.selection ||
        next.activeClip !== previous.activeClip ||
        next.activeCharacter !== previous.activeCharacter
      )
        invalidate();
    });
    const offStore = app.store.subscribe(() => invalidate());
    const offPose = app.evaluation.subscribe(() => invalidate());
    probes.set(controller, () => {
      const rect = canvas.getBoundingClientRect();
      const s = scene();
      return {
        rect: { x: rect.left, y: rect.top, w: rect.width, h: rect.height },
        x0: s.layout.x0,
        x1: s.layout.x1,
        start: s.layout.start,
        end: s.layout.end,
      };
    });

    return () => {
      unmounted = true;
      band?.dispose();
      clearTimer();
      if (raf !== 0) cancelAnimationFrame(raf);
      observer?.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerCancel);
      canvas.removeEventListener('contextmenu', onContextMenu);
      offSession();
      offStore();
      offPose();
      probes.delete(controller);
    };
  }, [app, ctx, store, ui, controller]);

  return (
    <canvas
      ref={canvasRef}
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a range input cannot draw keys or take a band
      role="slider"
      aria-label={w.ruler}
      aria-valuemin={0}
      aria-valuemax={60}
      aria-valuenow={0}
      tabIndex={0}
      data-testid="halo-thread-ruler"
      data-halo-chrome=""
      className={`block h-11 min-w-0 flex-1 cursor-pointer touch-none select-none ${row ? 'order-last basis-full' : ''}`}
    />
  );
}
