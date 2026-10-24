// LongPress (STUDIO-TOUCH-SPEC §5.2, §5.3 C3, §20.3 item 14): a press recogniser for chrome — chips, rows, petals,
// keys — with no DOM and no timers of its own, so the same state machine runs in a hook and in unit tests.
// A press held still for 450 ms is a long-press; one that moves further than the slop first is a drag; a lift
// before either is a tap, counted as a double tap when it follows a tap closely enough (§5.4). The canvas has its own
// arbiter in the viewport (T1); this one is for the touch kit's controls.
import { slopFor, TOUCH } from './constants';

export type PressEvent =
  | { readonly kind: 'tap'; readonly x: number; readonly y: number; readonly count: number }
  | { readonly kind: 'longpress'; readonly x: number; readonly y: number }
  | { readonly kind: 'dragstart'; readonly x: number; readonly y: number; readonly dx: number; readonly dy: number }
  | { readonly kind: 'drag'; readonly x: number; readonly y: number; readonly dx: number; readonly dy: number }
  | { readonly kind: 'dragend'; readonly x: number; readonly y: number; readonly dx: number; readonly dy: number }
  | { readonly kind: 'release'; readonly x: number; readonly y: number }
  | { readonly kind: 'cancel' };

export type PressPhase = 'idle' | 'pressed' | 'dragging' | 'longpressed';

export interface PressOptions {
  /** Long-press time (ms); default 450. `Infinity` turns long-press off. */
  readonly longPressMs?: number;
  /** Drag slop (CSS px); default by pointer type (touch 10, pen 4, mouse 3). */
  readonly slop?: number;
  /** Double-tap window (ms) and radius (CSS px); default 450 / 24. */
  readonly doubleTapMs?: number;
  readonly doubleTapPx?: number;
}

export interface PressRecognizer {
  readonly phase: PressPhase;
  /** When `tick` should next be called (ms, the caller's clock), or null. */
  readonly deadline: number | null;
  down(x: number, y: number, time: number, pointerType?: string): PressEvent[];
  move(x: number, y: number, time: number): PressEvent[];
  up(x: number, y: number, time: number): PressEvent[];
  /** The clock reached `deadline`: emits the long-press when the press is still held. */
  tick(time: number): PressEvent[];
  /** The press was cancelled (pointercancel, the element went away): no tap; a drag or long-press ends with `cancel`. */
  cancel(): PressEvent[];
}

export function createPressRecognizer(options: PressOptions = {}): PressRecognizer {
  const longPressMs = options.longPressMs ?? TOUCH.longPressMs;
  const doubleTapMs = options.doubleTapMs ?? TOUCH.doubleTapMs;
  const doubleTapPx = options.doubleTapPx ?? TOUCH.doubleTapPx;
  let phase: PressPhase = 'idle';
  let slop: number = TOUCH.touchSlop;
  let startX = 0;
  let startY = 0;
  let startTime = 0;
  let lastTap: { x: number; y: number; time: number; count: number } | null = null;

  const deadline = (): number | null =>
    phase === 'pressed' && Number.isFinite(longPressMs) ? startTime + longPressMs : null;

  return {
    get phase() {
      return phase;
    },
    get deadline() {
      return deadline();
    },
    down(x, y, time, pointerType = 'touch') {
      phase = 'pressed';
      slop = options.slop ?? slopFor(pointerType);
      startX = x;
      startY = y;
      startTime = time;
      return [];
    },
    move(x, y, time) {
      const dx = x - startX;
      const dy = y - startY;
      if (phase === 'pressed') {
        const due = deadline();
        if (due !== null && time >= due) {
          phase = 'longpressed';
          return [{ kind: 'longpress', x: startX, y: startY }];
        }
        if (Math.hypot(dx, dy) > slop) {
          phase = 'dragging';
          lastTap = null;
          return [{ kind: 'dragstart', x, y, dx, dy }];
        }
        return [];
      }
      if (phase === 'dragging') return [{ kind: 'drag', x, y, dx, dy }];
      return [];
    },
    up(x, y, time) {
      const dx = x - startX;
      const dy = y - startY;
      const was = phase;
      phase = 'idle';
      if (was === 'dragging') return [{ kind: 'dragend', x, y, dx, dy }];
      if (was === 'longpressed') return [{ kind: 'release', x, y }];
      if (was !== 'pressed') return [];
      const due = startTime + longPressMs;
      if (Number.isFinite(longPressMs) && time >= due) {
        // The clock passed the deadline without a tick (a busy main thread): still a long-press, never a tap.
        lastTap = null;
        return [
          { kind: 'longpress', x: startX, y: startY },
          { kind: 'release', x, y },
        ];
      }
      const follows =
        lastTap !== null &&
        time - lastTap.time <= doubleTapMs &&
        Math.hypot(x - lastTap.x, y - lastTap.y) <= doubleTapPx;
      const count = follows && lastTap !== null ? lastTap.count + 1 : 1;
      lastTap = { x, y, time, count };
      return [{ kind: 'tap', x, y, count }];
    },
    tick(time) {
      const due = deadline();
      if (due === null || time < due) return [];
      phase = 'longpressed';
      lastTap = null;
      return [{ kind: 'longpress', x: startX, y: startY }];
    },
    cancel() {
      const was = phase;
      phase = 'idle';
      return was === 'dragging' || was === 'longpressed' ? [{ kind: 'cancel' }] : [];
    },
  };
}
