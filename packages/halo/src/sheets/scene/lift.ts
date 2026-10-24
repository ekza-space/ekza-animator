// The Scene sheet's lift-and-drop recognizer (STUDIO-TOUCH-SPEC §6.5, §5.2, P5; T6b): reparenting by touch without
// HTML5 drag-and-drop. A press on a row is the touch kit's press recogniser (`createPressRecognizer`: 450 ms still is a
// long-press, a move past the slop first is a scroll, a quick lift is a tap). After the long-press the row is lifted:
// moving past the slop drags it over the other rows (`hover` names the row under the finger), and lifting the finger
// drops it there; a long-press lifted without moving opens the row's menu (the long-press twin of ⋯). A press that
// moved first stays a scroll (the list keeps `touch-action: pan-y`). No DOM and no timers: the sheet feeds pointer
// events and the row under the pointer, and calls `tick` when `deadline` passes.
import { createPressRecognizer, type PressOptions } from '@ekza-studio/ui/touch';

export type LiftEvent =
  /** A quick press and lift: select the row. */
  | { readonly kind: 'tap'; readonly key: string }
  /** The row is lifted (the long-press fired): show it raised. */
  | { readonly kind: 'lift'; readonly key: string }
  /** The lifted row moved over `over` (null: no row under the finger). */
  | { readonly kind: 'hover'; readonly key: string; readonly over: string | null }
  /** The lifted row was dropped on `over` (another row). */
  | { readonly kind: 'drop'; readonly key: string; readonly over: string }
  /** A long-press lifted without dragging: the row menu. */
  | { readonly kind: 'menu'; readonly key: string }
  /** The press ended without anything happening (a scroll, a drop on nothing or on itself, a cancel). */
  | { readonly kind: 'cancel'; readonly key: string };

export type LiftPhase = 'idle' | 'pressed' | 'scrolling' | 'lifted' | 'dragging';

export interface LiftRecognizer {
  readonly phase: LiftPhase;
  /** The row being pressed or lifted. */
  readonly key: string | null;
  /** When `tick` should be called (the caller's clock, ms), or null. */
  readonly deadline: number | null;
  down(key: string, x: number, y: number, time: number, pointerType?: string): LiftEvent[];
  move(x: number, y: number, time: number, over: string | null): LiftEvent[];
  up(x: number, y: number, time: number, over: string | null): LiftEvent[];
  tick(time: number): LiftEvent[];
  cancel(): LiftEvent[];
}

/** Drag distance (CSS px) after the lift before it counts as a drag rather than a long-press for the menu. */
const LIFT_SLOP = 8;

export function createLiftRecognizer(options: PressOptions = {}): LiftRecognizer {
  const press = createPressRecognizer({ ...options, doubleTapMs: 0 });
  let phase: LiftPhase = 'idle';
  let key: string | null = null;
  let liftX = 0;
  let liftY = 0;
  let over: string | null = null;

  const reset = (): void => {
    phase = 'idle';
    key = null;
    over = null;
  };

  /** Turns the press recogniser's events into lift events. */
  const fromPress = (
    events: readonly { readonly kind: string; readonly x?: number; readonly y?: number }[],
  ): LiftEvent[] => {
    const out: LiftEvent[] = [];
    for (const event of events) {
      const current = key;
      if (current === null) break;
      if (event.kind === 'longpress') {
        phase = 'lifted';
        liftX = event.x ?? 0;
        liftY = event.y ?? 0;
        out.push({ kind: 'lift', key: current });
      } else if (event.kind === 'dragstart') {
        phase = 'scrolling';
      } else if (event.kind === 'tap') {
        reset();
        out.push({ kind: 'tap', key: current });
      } else if (event.kind === 'dragend') {
        reset();
        out.push({ kind: 'cancel', key: current });
      }
    }
    return out;
  };

  const cancel = (): LiftEvent[] => {
    const current = key;
    press.cancel();
    reset();
    return current === null ? [] : [{ kind: 'cancel', key: current }];
  };

  return {
    get phase() {
      return phase;
    },
    get key() {
      return key;
    },
    get deadline() {
      return phase === 'pressed' ? press.deadline : null;
    },
    down(row, x, y, time, pointerType) {
      const out: LiftEvent[] = [];
      if (phase !== 'idle' && key !== null) out.push(...cancel());
      key = row;
      phase = 'pressed';
      over = null;
      press.down(x, y, time, pointerType);
      return out;
    },
    move(x, y, time, target) {
      if (key === null) return [];
      if (phase === 'pressed' || phase === 'scrolling') return fromPress(press.move(x, y, time));
      if (phase === 'lifted' && Math.hypot(x - liftX, y - liftY) <= LIFT_SLOP) return [];
      phase = 'dragging';
      if (target === over) return [];
      over = target;
      return [{ kind: 'hover', key, over: target }];
    },
    up(x, y, time, target) {
      const current = key;
      if (current === null) return [];
      if (phase === 'pressed' || phase === 'scrolling') {
        const events = press.up(x, y, time);
        // The clock passed the long-press without a tick (a busy main thread): a long-press, so the menu.
        if (events.some((event) => event.kind === 'longpress')) {
          reset();
          return [{ kind: 'menu', key: current }];
        }
        const out = fromPress(events);
        if (key !== null) {
          reset();
          out.push({ kind: 'cancel', key: current });
        }
        return out;
      }
      const was = phase;
      press.up(x, y, time);
      reset();
      if (was === 'lifted') return [{ kind: 'menu', key: current }];
      if (target !== null && target !== current) return [{ kind: 'drop', key: current, over: target }];
      return [{ kind: 'cancel', key: current }];
    },
    tick(time) {
      if (phase !== 'pressed') return [];
      return fromPress(press.tick(time));
    },
    cancel,
  };
}
