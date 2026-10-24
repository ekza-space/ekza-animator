// The Dope Sheet's touch adapter (STUDIO-TOUCH-SPEC §10.4, §20.3 item 8; T7): React-free glue between a surface's
// pointer events and Studio Pro's own `DopeSheetController`, for a touch shell's Keys layer. Pro's `DopeSheetView` is
// untouched; this is the second way in.
//
// - One finger or the Pencil: a press that travels past the slop goes to the controller as Pro's mouse drag would (a
//   marquee on empty rows, a key drag on keys, a region drag), with the Thumb key's flags merged into every event; a
//   tap is the controller's click (it selects the key, or clears); a double-tap frames the selection (all on empty
//   space).
// - A long-press (450 ms, still): then a drag draws a band over the dragged frames (`onBand`); a release without a drag
//   is the long-press of what is under the finger (`onLongPress`: the key's Halo, docked in the header).
// - Two fingers: the midpoint pans (time and rows), a horizontal pinch zooms time; the controller's own gesture is
//   cancelled first. The view is persisted through `onView` (a callback, not dockview panel params).
// - The mouse keeps Pro's behaviour (press, move, release, wheel).
// - `scale`: the canvas is drawn at its controller size and shown `scale`× larger (rows of 20 CSS px become 36 pt at
//   1.8, §10.4), so every point is divided by it.
import type { Disposer, Frame } from '@ekza-studio/anim-core';
import { PANEL, type ToolPointerEvent } from '@ekza-studio/editor-core';
import type { DopeSheetController } from '../dopesheet/DopeSheetController';
import { clampScale, xToFrame, zoomAt } from '../dopesheet/layout';
import type { DopeSheetHit, DopeSheetViewState } from '../types';

/** The Thumb key's flags (§5.5): `shift` = Select more, `mod` = Unselect / Pick or unpick with shift. */
export interface TouchModifiers {
  readonly shift: boolean;
  readonly mod: boolean;
  readonly alt: boolean;
}

export interface DopeSheetTouchOptions {
  /** Shown size ÷ controller size (1: none). */
  readonly scale?: number;
  readonly modifiers?: () => TouchModifiers;
  /** The view changed (pan, pinch, frame): persist it. */
  readonly onView?: (view: DopeSheetViewState) => void;
  /** A long-press then a drag: the band of the dragged frames; `done` on release (null: cancelled). */
  readonly onBand?: (band: { readonly start: Frame; readonly end: Frame } | null, done: boolean) => void;
  /** A long-press released without a drag, with what was under the finger (surface CSS px). */
  readonly onLongPress?: (hit: DopeSheetHit, at: { readonly x: number; readonly y: number }) => void;
  /** A tap, after the controller's click selected (or cleared). */
  readonly onTap?: (hit: DopeSheetHit) => void;
  /** A double-tap framed the view. */
  readonly onFrame?: () => void;
  /** Overrides (tests): long-press time, slop by pointer type, double-tap window and radius. */
  readonly longPressMs?: number;
  readonly slopPx?: { readonly touch: number; readonly pen: number };
  readonly multiTap?: { readonly ms: number; readonly px: number };
}

interface Press {
  readonly pointerId: number;
  readonly pointerType: 'touch' | 'pen';
  readonly start: { readonly x: number; readonly y: number };
  readonly time: number;
  /** 'wait': before slop or long-press; 'drag': delivered to the controller; 'long': after the long-press. */
  phase: 'wait' | 'drag' | 'long' | 'band';
  bandStart: Frame;
}

interface Pair {
  readonly ids: readonly [number, number];
  readonly points: Map<number, { x: number; y: number }>;
  readonly view: DopeSheetViewState;
  readonly mid: { readonly x: number; readonly y: number };
  readonly spread: number;
}

const LONG_PRESS_MS = 450;
const SLOP = { touch: 10, pen: 4 } as const;
const MULTI_TAP = { ms: 450, px: 24 } as const;

/** Wires a surface to the controller for fingers and the Pencil; the disposer removes every listener. */
export function attachDopeSheetTouch(
  sheet: DopeSheetController,
  surface: HTMLElement,
  options: DopeSheetTouchOptions = {},
): Disposer {
  const scale = options.scale !== undefined && options.scale > 0 ? options.scale : 1;
  const longPressMs = options.longPressMs ?? LONG_PRESS_MS;
  const slop = options.slopPx ?? SLOP;
  const multiTap = options.multiTap ?? MULTI_TAP;
  const fingers = new Map<number, { x: number; y: number }>();
  let press: Press | null = null;
  let pair: Pair | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastTap: { readonly x: number; readonly y: number; readonly time: number } | null = null;

  const local = (e: PointerEvent): { x: number; y: number } => {
    const rect = surface.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / scale, y: (e.clientY - rect.top) / scale };
  };
  const flags = (): TouchModifiers => options.modifiers?.() ?? { shift: false, mod: false, alt: false };
  const toolEvent = (
    at: { readonly x: number; readonly y: number },
    pointerType: 'mouse' | 'pen' | 'touch',
    e: PointerEvent,
    buttons: number,
    detail: number,
  ): ToolPointerEvent => {
    const mods = pointerType === 'mouse' ? { shift: e.shiftKey, mod: e.metaKey || e.ctrlKey, alt: e.altKey } : flags();
    return {
      panel: PANEL.dopeSheet,
      paneId: null,
      x: at.x,
      y: at.y,
      button: pointerType === 'mouse' ? e.button : 0,
      buttons,
      shift: mods.shift,
      alt: mods.alt,
      mod: mods.mod,
      ctrl: e.ctrlKey,
      pointerType,
      timeStamp: e.timeStamp,
      detail,
      pointerId: e.pointerId,
      isPrimary: e.isPrimary,
      ...(pointerType !== 'mouse' && (mods.shift || mods.mod || mods.alt) ? { virtual: true } : {}),
    };
  };
  const clearTimer = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const view = (next: DopeSheetViewState): void => {
    sheet.setView(next);
    options.onView?.(sheet.view);
  };

  const startPair = (): void => {
    const ids = [...fingers.keys()].slice(0, 2) as [number, number];
    const a = fingers.get(ids[0]) as { x: number; y: number };
    const b = fingers.get(ids[1]) as { x: number; y: number };
    // the first finger's own gesture ends: a band is dropped, a key drag cancelled
    if (press?.phase === 'band') options.onBand?.(null, true);
    if (press?.phase === 'drag') sheet.cancel();
    press = null;
    clearTimer();
    pair = {
      ids,
      points: new Map([
        [ids[0], { ...a }],
        [ids[1], { ...b }],
      ]),
      view: sheet.view,
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      spread: Math.max(8, Math.abs(a.x - b.x)),
    };
  };

  const movePair = (current: Pair): void => {
    const [a, b] = current.ids.map((id) => current.points.get(id) as { x: number; y: number }) as [
      { x: number; y: number },
      { x: number; y: number },
    ];
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const spread = Math.max(8, Math.abs(a.x - b.x));
    const zoomed = zoomAt(current.view, current.mid.x, spread / current.spread);
    const panned: DopeSheetViewState = {
      f0: zoomed.f0 - (mid.x - current.mid.x) / zoomed.sx,
      sx: clampScale(zoomed.sx),
      scrollY: zoomed.scrollY - (mid.y - current.mid.y),
    };
    view(panned);
  };

  const onDown = (e: PointerEvent): void => {
    const type = e.pointerType;
    if (type !== 'touch' && type !== 'pen') {
      if (e.button === 1 || e.button === 2) e.preventDefault();
      try {
        surface.setPointerCapture(e.pointerId);
      } catch {
        // a synthetic pointer cannot be captured
      }
      sheet.pointerDown(toolEvent(local(e), 'mouse', e, e.buttons, e.detail));
      return;
    }
    e.preventDefault();
    const at = local(e);
    fingers.set(e.pointerId, at);
    try {
      surface.setPointerCapture(e.pointerId);
    } catch {
      // a synthetic pointer cannot be captured
    }
    if (pair !== null) return; // a third finger is ignored
    if (fingers.size >= 2 && type === 'touch') {
      startPair();
      return;
    }
    press = {
      pointerId: e.pointerId,
      pointerType: type,
      start: at,
      time: e.timeStamp,
      phase: 'wait',
      bandStart: Math.round(xToFrame(sheet.view, at.x)),
    };
    clearTimer();
    const pressed = press;
    timer = setTimeout(() => {
      timer = null;
      if (press === pressed && pressed.phase === 'wait') pressed.phase = 'long';
    }, longPressMs);
  };

  const onMove = (e: PointerEvent): void => {
    const type = e.pointerType;
    if (type !== 'touch' && type !== 'pen') {
      sheet.pointerMove(toolEvent(local(e), 'mouse', e, e.buttons, 0));
      return;
    }
    const at = local(e);
    if (fingers.has(e.pointerId)) fingers.set(e.pointerId, at);
    if (pair !== null) {
      if (!pair.points.has(e.pointerId)) return;
      pair.points.set(e.pointerId, at);
      movePair(pair);
      return;
    }
    const current = press;
    if (current === null || current.pointerId !== e.pointerId) return;
    const travelled = Math.hypot(at.x - current.start.x, at.y - current.start.y) * scale;
    if (current.phase === 'wait') {
      if (travelled < slop[current.pointerType]) return;
      clearTimer();
      current.phase = 'drag';
      sheet.pointerDown(toolEvent(current.start, current.pointerType, e, 1, 1));
      sheet.pointerMove(toolEvent(at, current.pointerType, e, 1, 0));
      return;
    }
    if (current.phase === 'drag') {
      sheet.pointerMove(toolEvent(at, current.pointerType, e, 1, 0));
      return;
    }
    if (current.phase === 'long' && travelled >= slop[current.pointerType]) current.phase = 'band';
    if (current.phase === 'band') {
      const frame = Math.round(xToFrame(sheet.view, at.x));
      const a = Math.min(current.bandStart, frame);
      const b = Math.max(current.bandStart, frame);
      options.onBand?.({ start: a, end: b }, false);
    }
  };

  const onUp = (e: PointerEvent, cancelled: boolean): void => {
    const type = e.pointerType;
    if (type !== 'touch' && type !== 'pen') {
      if (cancelled) sheet.cancel();
      else sheet.pointerUp(toolEvent(local(e), 'mouse', e, e.buttons, e.detail));
      if (surface.hasPointerCapture?.(e.pointerId) === true) surface.releasePointerCapture(e.pointerId);
      return;
    }
    fingers.delete(e.pointerId);
    if (pair !== null) {
      if (pair.points.has(e.pointerId) && fingers.size === 0) {
        pair = null;
        options.onView?.(sheet.view);
      }
      return;
    }
    const current = press;
    if (current === null || current.pointerId !== e.pointerId) return;
    press = null;
    clearTimer();
    const at = local(e);
    if (cancelled) {
      if (current.phase === 'drag') sheet.cancel();
      if (current.phase === 'band') options.onBand?.(null, true);
      return;
    }
    switch (current.phase) {
      case 'drag':
        sheet.pointerUp(toolEvent(at, current.pointerType, e, 0, 1));
        return;
      case 'band': {
        const frame = Math.round(xToFrame(sheet.view, at.x));
        options.onBand?.({ start: Math.min(current.bandStart, frame), end: Math.max(current.bandStart, frame) }, true);
        return;
      }
      case 'long':
        options.onLongPress?.(sheet.hitTest(current.start.x, current.start.y), {
          x: current.start.x * scale,
          y: current.start.y * scale,
        });
        return;
      case 'wait': {
        const double =
          lastTap !== null &&
          e.timeStamp - lastTap.time <= multiTap.ms &&
          Math.hypot(at.x - lastTap.x, at.y - lastTap.y) * scale <= multiTap.px;
        if (double) {
          lastTap = null;
          const hit = sheet.hitTest(current.start.x, current.start.y);
          sheet.frame(hit.kind === 'glyph' ? 'selection' : 'all');
          options.onView?.(sheet.view);
          options.onFrame?.();
          return;
        }
        lastTap = { x: at.x, y: at.y, time: e.timeStamp };
        // the controller's click: a press and a release where the finger touched
        sheet.pointerDown(toolEvent(current.start, current.pointerType, e, 1, 1));
        sheet.pointerUp(toolEvent(current.start, current.pointerType, e, 0, 1));
        options.onTap?.(sheet.hitTest(current.start.x, current.start.y));
        return;
      }
    }
  };

  const onPointerUp = (e: PointerEvent): void => onUp(e, false);
  const onPointerCancel = (e: PointerEvent): void => onUp(e, true);
  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const rect = surface.getBoundingClientRect();
    sheet.wheel({
      panel: PANEL.dopeSheet,
      paneId: null,
      x: (e.clientX - rect.left) / scale,
      y: (e.clientY - rect.top) / scale,
      deltaX: e.deltaX,
      deltaY: e.deltaY,
      shift: e.shiftKey,
      alt: e.altKey,
      mod: e.metaKey || e.ctrlKey,
      ctrl: e.ctrlKey,
    });
    options.onView?.(sheet.view);
  };
  const onContextMenu = (e: Event): void => e.preventDefault();

  surface.addEventListener('pointerdown', onDown);
  surface.addEventListener('pointermove', onMove);
  surface.addEventListener('pointerup', onPointerUp);
  surface.addEventListener('pointercancel', onPointerCancel);
  surface.addEventListener('wheel', onWheel, { passive: false });
  surface.addEventListener('contextmenu', onContextMenu);
  return () => {
    clearTimer();
    surface.removeEventListener('pointerdown', onDown);
    surface.removeEventListener('pointermove', onMove);
    surface.removeEventListener('pointerup', onPointerUp);
    surface.removeEventListener('pointercancel', onPointerCancel);
    surface.removeEventListener('wheel', onWheel);
    surface.removeEventListener('contextmenu', onContextMenu);
    if (press?.phase === 'drag') sheet.cancel();
    press = null;
    pair = null;
    fingers.clear();
  };
}
