// `useLongPress`: the press recogniser (press.ts) wired to an element's pointer events, with its long-press timer.
// A mouse's right-click (`contextmenu`) is the same as a long-press (STUDIO-TOUCH-SPEC §5.2), and the browser's
// own long-press callout is suppressed. The element keeps the pointer (capture) until the press ends.
import { type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent, useEffect, useRef } from 'react';
import { createPressRecognizer, type PressEvent, type PressOptions, type PressRecognizer } from './press';

type Of<K extends PressEvent['kind']> = Extract<PressEvent, { kind: K }>;

export interface LongPressCallbacks {
  readonly onTap?: (event: Of<'tap'>) => void;
  readonly onLongPress?: (event: Of<'longpress'>) => void;
  readonly onDragStart?: (event: Of<'dragstart'>) => void;
  readonly onDrag?: (event: Of<'drag'>) => void;
  readonly onDragEnd?: (event: Of<'dragend'>) => void;
  /** The pointer lifted after a long-press. */
  readonly onRelease?: (event: Of<'release'>) => void;
  readonly onCancel?: () => void;
}

export interface LongPressHandlers {
  onPointerDown(event: ReactPointerEvent<Element>): void;
  onPointerMove(event: ReactPointerEvent<Element>): void;
  onPointerUp(event: ReactPointerEvent<Element>): void;
  onPointerCancel(event: ReactPointerEvent<Element>): void;
  onContextMenu(event: ReactMouseEvent<Element>): void;
}

function dispatch(callbacks: LongPressCallbacks, events: readonly PressEvent[]): void {
  for (const e of events) {
    switch (e.kind) {
      case 'tap':
        callbacks.onTap?.(e);
        break;
      case 'longpress':
        callbacks.onLongPress?.(e);
        break;
      case 'dragstart':
        callbacks.onDragStart?.(e);
        break;
      case 'drag':
        callbacks.onDrag?.(e);
        break;
      case 'dragend':
        callbacks.onDragEnd?.(e);
        break;
      case 'release':
        callbacks.onRelease?.(e);
        break;
      case 'cancel':
        callbacks.onCancel?.();
        break;
      default:
        break;
    }
  }
}

export function useLongPress(callbacks: LongPressCallbacks, options: PressOptions = {}): LongPressHandlers {
  const latest = useRef(callbacks);
  const recognizer = useRef<PressRecognizer | null>(null);
  const pointer = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { longPressMs, slop, doubleTapMs, doubleTapPx } = options;

  useEffect(() => {
    latest.current = callbacks;
  });
  useEffect(() => {
    recognizer.current = createPressRecognizer({
      ...(longPressMs === undefined ? {} : { longPressMs }),
      ...(slop === undefined ? {} : { slop }),
      ...(doubleTapMs === undefined ? {} : { doubleTapMs }),
      ...(doubleTapPx === undefined ? {} : { doubleTapPx }),
    });
    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
      recognizer.current = null;
    };
  }, [longPressMs, slop, doubleTapMs, doubleTapPx]);

  const clearTimer = (): void => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };
  const armTimer = (r: PressRecognizer): void => {
    clearTimer();
    const due = r.deadline;
    if (due === null) return;
    timer.current = setTimeout(
      () => {
        timer.current = null;
        dispatch(latest.current, r.tick(performance.now()));
      },
      Math.max(0, due - performance.now()),
    );
  };

  return {
    onPointerDown(event) {
      const r = recognizer.current;
      if (r === null || event.button !== 0 || pointer.current !== null) return;
      pointer.current = event.pointerId;
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // a synthetic or already-released pointer: the press still works without capture
      }
      dispatch(latest.current, r.down(event.clientX, event.clientY, event.timeStamp, event.pointerType));
      armTimer(r);
    },
    onPointerMove(event) {
      const r = recognizer.current;
      if (r === null || pointer.current !== event.pointerId) return;
      dispatch(latest.current, r.move(event.clientX, event.clientY, event.timeStamp));
      if (r.phase !== 'pressed') clearTimer();
    },
    onPointerUp(event) {
      const r = recognizer.current;
      if (r === null || pointer.current !== event.pointerId) return;
      pointer.current = null;
      clearTimer();
      dispatch(latest.current, r.up(event.clientX, event.clientY, event.timeStamp));
    },
    onPointerCancel(event) {
      const r = recognizer.current;
      if (r === null || pointer.current !== event.pointerId) return;
      pointer.current = null;
      clearTimer();
      dispatch(latest.current, r.cancel());
    },
    onContextMenu(event) {
      event.preventDefault();
      // A touch long-press already fired through the timer; a mouse right-click is a long-press of its own.
      if (pointer.current !== null) return;
      latest.current.onLongPress?.({ kind: 'longpress', x: event.clientX, y: event.clientY });
    },
  };
}
