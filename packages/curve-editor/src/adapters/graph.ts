// The Graph Editor's touch adapter (STUDIO-TOUCH-SPEC §10.5, §5.2.1, §20.3 item 8; T10): React-free glue between a
// surface's pointer events and Studio Pro's own `GraphEditorController`, for a touch shell's Curves layer. Pro's
// `GraphCanvas` is untouched; this is the second way in, built like the Dope Sheet's (`./dopesheet.ts`).
//
// - One finger or the Pencil: a press that travels past the slop goes to the controller as Pro's mouse drag would — a
//   marquee on empty space, a key or tangent handle moved where one is pressed — with the Thumb key's flags merged into
//   every event. A drag of keys or handles keeps one axis (§10.5): `auto` picks the dominant one after a few points
//   of travel (Pro's Shift), `time` and `value` lock it, `free` moves both. A tap is the controller's click (it
//   selects a key or handle, or clears); a double-tap frames the selection (on a key) or everything (elsewhere).
// - A long-press (450 ms, still) released without a drag is the long-press of what is under the finger (`onLongPress`:
//   the key's menu, docked in the layer's header).
// - Two fingers: the midpoint pans, the spread pinches time (across) and values (up and down); the first finger's
//   own gesture is cancelled first. The view is persisted through `onView` (a callback, not dockview panel params).
// - The mouse keeps Pro's behaviour (press, move, release, double-click, wheel).
// - `scale`: the canvases are drawn at the controller's size and shown `scale`× larger (the Keys layer's 1.8), so
//   every point is divided by it, and the hit radii of §5.4 are the finger's, the pen's or the mouse's in shown px.
import type { Disposer } from '@ekza-studio/anim-core';
import { PANEL, type ToolPointerEvent } from '@ekza-studio/editor-core';
import type { GraphEditorController } from '../graph/GraphEditorController';
import { CURVE_POINTER_TOLERANCE } from '../painters/pointer';
import { GRAPH_METRICS } from '../painters/theme';
import type { GraphHit, GraphViewState } from '../types';
import { panView, zoomView } from '../view/transform';
import type { TouchModifiers } from './dopesheet';

/** The axis a drag of keys or handles keeps (§10.5 ⟨Axis⟩, the Thumb key's *Axis*). */
export type GraphAxis = 'auto' | 'time' | 'value' | 'free';

export interface GraphEditorTouchOptions {
  /** Shown size ÷ controller size (1: none). */
  readonly scale?: number;
  readonly modifiers?: () => TouchModifiers;
  /** The axis a drag of keys or handles keeps (default `auto`). */
  readonly axis?: () => GraphAxis;
  /** The view changed (pan, pinch, frame, wheel): persist it. */
  readonly onView?: (view: GraphViewState) => void;
  /** A tap, after the controller's click selected (or cleared), with what was under the finger (surface CSS px). */
  readonly onTap?: (hit: GraphHit, at: { readonly x: number; readonly y: number }) => void;
  /** A long-press released without a drag, with what was under the finger (surface CSS px). */
  readonly onLongPress?: (hit: GraphHit, at: { readonly x: number; readonly y: number }) => void;
  /** A one-finger drag ended (a marquee, a key or handle move); `hit` is what the press started on. */
  readonly onDrag?: (hit: GraphHit) => void;
  /** A double-tap frames: `what` the shell runs (`graph.frame {what}`); without it the controller frames itself. */
  readonly frame?: (what: 'selection' | 'all') => void;
  /** A double-tap framed the view. */
  readonly onFrame?: () => void;
  /** Any press on the surface (the shell focuses this editor in the registry). */
  readonly onPress?: () => void;
  /** Overrides (tests): long-press time, slop by pointer type, double-tap window and radius. */
  readonly longPressMs?: number;
  readonly slopPx?: { readonly touch: number; readonly pen: number };
  readonly multiTap?: { readonly ms: number; readonly px: number };
}

interface Press {
  readonly pointerId: number;
  readonly pointerType: 'touch' | 'pen';
  readonly start: { readonly x: number; readonly y: number };
  readonly hit: GraphHit;
  /** 'wait': before slop or long-press; 'drag': delivered to the controller; 'long': after the long-press. */
  phase: 'wait' | 'drag' | 'long' | 'dead';
}

interface Pair {
  readonly ids: readonly [number, number];
  readonly points: Map<number, { x: number; y: number }>;
  readonly view: GraphViewState;
  readonly mid: { readonly x: number; readonly y: number };
  readonly spread: { readonly x: number; readonly y: number };
}

const LONG_PRESS_MS = 450;
const SLOP = { touch: 10, pen: 4 } as const;
const MULTI_TAP = { ms: 450, px: 24 } as const;
/** Below this spread on an axis (shown px) two fingers pan only along it (no pinch on that axis). */
const MIN_PINCH_SPREAD = 32;
const MOUSE_MULTI_CLICK = { ms: 400, px: 4 } as const;

/** Wires a surface to the controller for fingers, the Pencil and the mouse; the disposer removes every listener. */
export function attachGraphEditorTouch(
  graph: GraphEditorController,
  surface: HTMLElement,
  options: GraphEditorTouchOptions = {},
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
  const clicks = { time: Number.NEGATIVE_INFINITY, x: 0, y: 0, count: 0 };

  /** §5.4: the hit radii of the pointer at hand, in the controller's px (it is shown `scale`× larger). */
  const tolerance = (pointerType: string): void => {
    const row = CURVE_POINTER_TOLERANCE[pointerType === 'touch' || pointerType === 'pen' ? pointerType : 'mouse'];
    GRAPH_METRICS.hitKey = row.hitKey / scale;
    GRAPH_METRICS.hitHandle = row.hitHandle / scale;
    GRAPH_METRICS.hitCurve = row.hitCurve / scale;
  };
  const local = (e: PointerEvent | WheelEvent): { x: number; y: number } => {
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
    mods: TouchModifiers,
  ): ToolPointerEvent => ({
    panel: PANEL.graph,
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
  });
  const mouseMods = (e: PointerEvent): TouchModifiers => ({
    shift: e.shiftKey,
    mod: e.metaKey || e.ctrlKey,
    alt: e.altKey,
  });
  const clearTimer = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const view = (next: GraphViewState): void => {
    graph.navigate(next);
    options.onView?.(graph.view);
  };

  /** A drag's point with the axis kept (§10.5): keys and handles only, never a marquee. */
  const onAxis = (current: Press, at: { readonly x: number; readonly y: number }): { x: number; y: number } => {
    if (current.hit.kind !== 'key' && current.hit.kind !== 'handle') return { ...at };
    const axis = options.axis?.() ?? 'auto';
    if (axis === 'time') return { x: at.x, y: current.start.y };
    if (axis === 'value') return { x: current.start.x, y: at.y };
    return { ...at };
  };
  /** The flags of a drag's moves: `auto` adds Pro's Shift (the dominant axis), `free` takes it away. */
  const dragMods = (current: Press): TouchModifiers => {
    const base = flags();
    if (current.hit.kind !== 'key' && current.hit.kind !== 'handle') return base;
    const axis = options.axis?.() ?? 'auto';
    return { ...base, shift: axis === 'auto' ? true : axis === 'free' ? false : base.shift };
  };

  const startPair = (): void => {
    const ids = [...fingers.keys()].slice(0, 2) as [number, number];
    const a = fingers.get(ids[0]) as { x: number; y: number };
    const b = fingers.get(ids[1]) as { x: number; y: number };
    // the first finger's own gesture ends: a drag is cancelled (its preview rolls back)
    if (press?.phase === 'drag') graph.cancel();
    press = null;
    clearTimer();
    pair = {
      ids,
      points: new Map([
        [ids[0], { ...a }],
        [ids[1], { ...b }],
      ]),
      view: graph.view,
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      spread: { x: Math.abs(a.x - b.x), y: Math.abs(a.y - b.y) },
    };
  };

  const movePair = (current: Pair): void => {
    const [a, b] = current.ids.map((id) => current.points.get(id) as { x: number; y: number }) as [
      { x: number; y: number },
      { x: number; y: number },
    ];
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const minSpread = MIN_PINCH_SPREAD / scale;
    const fx = current.spread.x >= minSpread ? Math.max(minSpread, Math.abs(a.x - b.x)) / current.spread.x : 1;
    const fy = current.spread.y >= minSpread ? Math.max(minSpread, Math.abs(a.y - b.y)) / current.spread.y : 1;
    const zoomed = zoomView(current.view, graph.size.height, current.mid.x, current.mid.y, fx, fy);
    view(panView(zoomed, mid.x - current.mid.x, mid.y - current.mid.y));
  };

  const onDown = (e: PointerEvent): void => {
    options.onPress?.();
    const type = e.pointerType;
    if (type !== 'touch' && type !== 'pen') {
      if (e.button === 1 || e.button === 2) e.preventDefault();
      try {
        surface.setPointerCapture(e.pointerId);
      } catch {
        // a synthetic pointer cannot be captured
      }
      const at = local(e);
      const near = Math.hypot(e.clientX - clicks.x, e.clientY - clicks.y) <= MOUSE_MULTI_CLICK.px;
      clicks.count = near && e.timeStamp - clicks.time <= MOUSE_MULTI_CLICK.ms ? clicks.count + 1 : 1;
      clicks.time = e.timeStamp;
      clicks.x = e.clientX;
      clicks.y = e.clientY;
      tolerance('mouse');
      graph.pointerDown(toolEvent(at, 'mouse', e, e.buttons, clicks.count, mouseMods(e)));
      surface.style.cursor = graph.cursor();
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
    tolerance(type);
    press = { pointerId: e.pointerId, pointerType: type, start: at, hit: graph.hitTest(at.x, at.y), phase: 'wait' };
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
      graph.pointerMove(toolEvent(local(e), 'mouse', e, e.buttons, 0, mouseMods(e)));
      surface.style.cursor = graph.cursor();
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
      tolerance(current.pointerType);
      // the press with the Thumb key's selection flags; the moves with the axis kept
      graph.pointerDown(toolEvent(current.start, current.pointerType, e, 1, 1, flags()));
      graph.pointerMove(toolEvent(onAxis(current, at), current.pointerType, e, 1, 0, dragMods(current)));
      return;
    }
    if (current.phase === 'drag') {
      graph.pointerMove(toolEvent(onAxis(current, at), current.pointerType, e, 1, 0, dragMods(current)));
      return;
    }
    // a long-press that travels is neither a menu nor a drag (§5.2.1: Curves' long-press opens the key's menu)
    if (current.phase === 'long' && travelled >= slop[current.pointerType]) current.phase = 'dead';
  };

  const onUp = (e: PointerEvent, cancelled: boolean): void => {
    const type = e.pointerType;
    if (type !== 'touch' && type !== 'pen') {
      if (cancelled) graph.cancel();
      else graph.pointerUp(toolEvent(local(e), 'mouse', e, e.buttons, clicks.count, mouseMods(e)));
      if (surface.hasPointerCapture?.(e.pointerId) === true) surface.releasePointerCapture(e.pointerId);
      surface.style.cursor = graph.cursor();
      return;
    }
    fingers.delete(e.pointerId);
    if (pair !== null) {
      if (pair.points.has(e.pointerId) && fingers.size === 0) {
        pair = null;
        options.onView?.(graph.view);
      }
      return;
    }
    const current = press;
    if (current === null || current.pointerId !== e.pointerId) return;
    press = null;
    clearTimer();
    const at = local(e);
    if (cancelled) {
      if (current.phase === 'drag') graph.cancel();
      return;
    }
    const shown = { x: current.start.x * scale, y: current.start.y * scale };
    switch (current.phase) {
      case 'drag':
        graph.pointerUp(toolEvent(onAxis(current, at), current.pointerType, e, 0, 1, dragMods(current)));
        options.onDrag?.(current.hit);
        return;
      case 'long':
        options.onLongPress?.(current.hit, shown);
        return;
      case 'dead':
        return;
      case 'wait': {
        const double =
          lastTap !== null &&
          e.timeStamp - lastTap.time <= multiTap.ms &&
          Math.hypot(at.x - lastTap.x, at.y - lastTap.y) * scale <= multiTap.px;
        if (double) {
          lastTap = null;
          const what = current.hit.kind === 'key' || current.hit.kind === 'handle' ? 'selection' : 'all';
          if (options.frame === undefined) graph.frame(what);
          else options.frame(what);
          options.onView?.(graph.view);
          options.onFrame?.();
          return;
        }
        lastTap = { x: at.x, y: at.y, time: e.timeStamp };
        // the controller's click: a press and a release where the finger touched
        tolerance(current.pointerType);
        graph.pointerDown(toolEvent(current.start, current.pointerType, e, 1, 1, flags()));
        graph.pointerUp(toolEvent(current.start, current.pointerType, e, 0, 1, flags()));
        options.onTap?.(current.hit, shown);
        return;
      }
    }
  };

  const onPointerUp = (e: PointerEvent): void => onUp(e, false);
  const onPointerCancel = (e: PointerEvent): void => onUp(e, true);
  const onLeave = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse') graph.pointerLeave();
  };
  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const at = local(e);
    graph.wheel({
      panel: PANEL.graph,
      paneId: null,
      x: at.x,
      y: at.y,
      deltaX: e.deltaX,
      deltaY: e.deltaY,
      shift: e.shiftKey,
      alt: e.altKey,
      mod: e.metaKey || e.ctrlKey,
      ctrl: e.ctrlKey,
    });
    options.onView?.(graph.view);
  };
  const onContextMenu = (e: Event): void => e.preventDefault();

  surface.addEventListener('pointerdown', onDown);
  surface.addEventListener('pointermove', onMove);
  surface.addEventListener('pointerup', onPointerUp);
  surface.addEventListener('pointercancel', onPointerCancel);
  surface.addEventListener('pointerleave', onLeave);
  surface.addEventListener('wheel', onWheel, { passive: false });
  surface.addEventListener('contextmenu', onContextMenu);
  return () => {
    clearTimer();
    surface.removeEventListener('pointerdown', onDown);
    surface.removeEventListener('pointermove', onMove);
    surface.removeEventListener('pointerup', onPointerUp);
    surface.removeEventListener('pointercancel', onPointerCancel);
    surface.removeEventListener('pointerleave', onLeave);
    surface.removeEventListener('wheel', onWheel);
    surface.removeEventListener('contextmenu', onContextMenu);
    if (press?.phase === 'drag') graph.cancel();
    press = null;
    pair = null;
    fingers.clear();
    // the radii are module state that Studio Pro's Graph Editor reads too: back to the mouse's, unscaled
    const row = CURVE_POINTER_TOLERANCE.mouse;
    GRAPH_METRICS.hitKey = row.hitKey;
    GRAPH_METRICS.hitHandle = row.hitHandle;
    GRAPH_METRICS.hitCurve = row.hitCurve;
  };
}
