// Two-finger touch navigation of Simple navigation (AUTORIG-SPEC §8.1, §8.3; D3, AR-D3-5): on a touch screen two
// fingers in a pane pan (the midpoint) and pinch-zoom (the spread, towards the midpoint); one finger stays a left press
// (orbit on empty space, the tool's press elsewhere). A lazy chunk, loaded by `installSimpleNavigation` on devices with
// touch points; no ViewportManager API beyond the D3 hook: the second finger cancels the first one's gesture (a
// `pointercancel`, so a tool drag it began is cancelled, not committed) and the pair then drives the pane's own
// navigation with synthetic presses whose gesture the override forces (`track` for the midpoint, `dolly` for the
// spread: `dolly` multiplies the camera distance by the inverse of the spread's ratio). The fingers' own events stop
// at the document (capture phase), so the pane sees only the synthetic ones while two fingers are down.
import type { Disposer } from '@ekza-studio/anim-core';
import type { NavGesture, ViewportManager } from '@ekza-studio/viewport';

/** A finger: its pointer id and client position. */
export interface Finger {
  readonly id: number;
  readonly x: number;
  readonly y: number;
}

/** The pane's dolly per pixel of a `dolly` drag (`ViewportManager.moveNav`: amount = (dx − dy) × 0.005). */
const DOLLY_PER_PX = 0.005;
/** Below this spread change (px) a move is a pan only. */
const PINCH_EPSILON = 0.5;

/** One step of a two-finger gesture: the midpoint's move (pan) and the spread's dolly amount (ln of its ratio). */
export function twoFingerStep(
  before: readonly [Finger, Finger],
  after: readonly [Finger, Finger],
): { readonly mid: { readonly x: number; readonly y: number }; readonly pan: boolean; readonly dolly: number } {
  const mid = (pair: readonly [Finger, Finger]) => ({ x: (pair[0].x + pair[1].x) / 2, y: (pair[0].y + pair[1].y) / 2 });
  const spread = (pair: readonly [Finger, Finger]) => Math.hypot(pair[1].x - pair[0].x, pair[1].y - pair[0].y);
  const a = mid(before);
  const b = mid(after);
  const s0 = spread(before);
  const s1 = spread(after);
  const dolly = s0 > 0 && s1 > 0 && Math.abs(s1 - s0) >= PINCH_EPSILON ? Math.log(s1 / s0) : 0;
  return { mid: b, pan: a.x !== b.x || a.y !== b.y, dolly };
}

/** The pane gesture the override must return for the next synthetic press (null: the Simple table). */
export interface ForcedGesture {
  gesture: NavGesture | null;
}

type Viewport = Pick<ViewportManager, 'paneAt'>;

interface Pair {
  readonly paneId: string;
  readonly element: HTMLElement;
  fingers: [Finger, Finger];
  /** The pointer id the synthetic presses use (the second finger's: a live pointer, so capture works). */
  readonly driver: number;
}

/** Installs the two-finger handler on the document; the disposer removes it (and ends a gesture in progress). */
export function installTouchNavigation(vm: Viewport, forced: ForcedGesture): Disposer {
  const fingers = new Map<number, Finger & { readonly paneId: string }>();
  const synthetic = new WeakSet<Event>();
  let pair: Pair | null = null;

  const paneElement = (paneId: string): HTMLElement | null =>
    document.querySelector<HTMLElement>(`[data-ekza-pane="${CSS.escape(paneId)}"]`);

  const send = (element: HTMLElement, type: string, id: number, x: number, y: number, gesture?: NavGesture): void => {
    const down = type === 'pointerdown';
    const event = new PointerEvent(type, {
      pointerId: id,
      pointerType: 'touch',
      isPrimary: false,
      clientX: x,
      clientY: y,
      button: down || type === 'pointerup' ? 0 : -1,
      buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1,
      bubbles: true,
      cancelable: true,
    });
    synthetic.add(event);
    forced.gesture = gesture ?? null;
    try {
      element.dispatchEvent(event);
    } finally {
      forced.gesture = null;
    }
  };

  const midOf = (p: Pair) => ({ x: (p.fingers[0].x + p.fingers[1].x) / 2, y: (p.fingers[0].y + p.fingers[1].y) / 2 });

  const end = (): void => {
    if (pair === null) return;
    const mid = midOf(pair);
    send(pair.element, 'pointerup', pair.driver, mid.x, mid.y);
    pair = null;
  };

  const onDown = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch' || synthetic.has(e)) return;
    const paneId = vm.paneAt(e.clientX, e.clientY);
    if (paneId === null) return;
    fingers.set(e.pointerId, { id: e.pointerId, x: e.clientX, y: e.clientY, paneId });
    if (pair !== null) {
      // a third finger: ignored while the pair navigates
      e.stopPropagation();
      return;
    }
    const first = [...fingers.values()].find((f) => f.id !== e.pointerId && f.paneId === paneId);
    const element = paneElement(paneId);
    if (first === undefined || element === null) return;
    e.stopPropagation();
    e.preventDefault();
    // the first finger's gesture (an orbit, a tool drag) is cancelled; the pair navigates from here
    send(element, 'pointercancel', first.id, first.x, first.y);
    pair = {
      paneId,
      element,
      fingers: [
        { id: first.id, x: first.x, y: first.y },
        { id: e.pointerId, x: e.clientX, y: e.clientY },
      ],
      driver: e.pointerId,
    };
    const mid = midOf(pair);
    send(element, 'pointerdown', pair.driver, mid.x, mid.y, 'track');
  };

  const onMove = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch' || synthetic.has(e)) return;
    const finger = fingers.get(e.pointerId);
    if (finger !== undefined) fingers.set(e.pointerId, { ...finger, x: e.clientX, y: e.clientY });
    const p = pair;
    if (p === null) return;
    const index = p.fingers.findIndex((f) => f.id === e.pointerId);
    if (index < 0) {
      e.stopPropagation();
      return;
    }
    e.stopPropagation();
    e.preventDefault();
    const before = p.fingers;
    const after: [Finger, Finger] = [...before];
    after[index] = { id: e.pointerId, x: e.clientX, y: e.clientY };
    p.fingers = after;
    const step = twoFingerStep(before, after);
    if (step.pan) send(p.element, 'pointermove', p.driver, step.mid.x, step.mid.y);
    if (step.dolly !== 0) {
      // the spread: a dolly press at the midpoint (towards it), moved by the amount, then the pan again
      send(p.element, 'pointerup', p.driver, step.mid.x, step.mid.y);
      send(p.element, 'pointerdown', p.driver, step.mid.x, step.mid.y, 'dolly');
      send(p.element, 'pointermove', p.driver, step.mid.x + step.dolly / DOLLY_PER_PX, step.mid.y);
      send(p.element, 'pointerup', p.driver, step.mid.x + step.dolly / DOLLY_PER_PX, step.mid.y);
      send(p.element, 'pointerdown', p.driver, step.mid.x, step.mid.y, 'track');
    }
  };

  const onUp = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch' || synthetic.has(e)) return;
    fingers.delete(e.pointerId);
    const p = pair;
    if (p === null) return;
    // a finger of the pair (or a third one) lifting ends the pair; the other finger stays idle until it lifts
    e.stopPropagation();
    if (p.fingers.some((f) => f.id === e.pointerId)) end();
  };

  const options = { capture: true, passive: false } as const;
  document.addEventListener('pointerdown', onDown, options);
  document.addEventListener('pointermove', onMove, options);
  document.addEventListener('pointerup', onUp, options);
  document.addEventListener('pointercancel', onUp, options);
  return () => {
    end();
    document.removeEventListener('pointerdown', onDown, options);
    document.removeEventListener('pointermove', onMove, options);
    document.removeEventListener('pointerup', onUp, options);
    document.removeEventListener('pointercancel', onUp, options);
  };
}
