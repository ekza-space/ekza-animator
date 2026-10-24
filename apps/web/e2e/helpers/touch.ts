// Touch and Pencil input for e2e specs (STUDIO-TOUCH-SPEC §20.7; T1, ported from AS-AR-12's and AR-12's CDP helpers
// and the T1a spike). Fingers go through CDP `Input.dispatchTouchEvent` (real touch PointerEvents, several fingers at
// once); the Pencil through CDP `Input.dispatchMouseEvent` with `pointerType: 'pen'` and a force. Chrome only: WebKit
// has no CDP, so a `webkit-ipad` spec taps with `page.touchscreen.tap` and cannot drive two fingers or a pen. Points
// are page CSS px.
import type { CDPSession, Page } from '@playwright/test';

export type Point = { readonly x: number; readonly y: number };

/** A CDP session on the page (detach it when done). */
export function cdp(page: Page): Promise<CDPSession> {
  return page.context().newCDPSession(page);
}

/**
 * One CDP touch event; a finger's id is its index in `points` unless `ids` names them.
 * - `touchStart` / `touchMove`: `points` are the fingers down after the event (a new id presses a finger, a known id
 *   at a new place moves it).
 * - `touchEnd` / `touchCancel`: `points` are the fingers that lift (CDP lifts the points it lists; the others stay
 *   down); an empty list lifts every finger still down (P-T6A-8: two-finger releases one finger at a time).
 */
export async function touchEvent(
  session: CDPSession,
  type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel',
  points: readonly Point[],
  ids?: readonly number[],
): Promise<void> {
  await session.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: points.map((p, index) => ({ x: p.x, y: p.y, id: ids?.[index] ?? index })),
  });
}

const lerp = (from: Point, to: Point, t: number): Point => ({
  x: from.x + (to.x - from.x) * t,
  y: from.y + (to.y - from.y) * t,
});

/** A one-finger tap. */
export async function fingerTap(page: Page, at: Point): Promise<void> {
  const s = await cdp(page);
  await touchEvent(s, 'touchStart', [at]);
  await touchEvent(s, 'touchEnd', []);
  await s.detach();
}

/** A one-finger drag in `steps` moves. */
export async function fingerDrag(page: Page, from: Point, to: Point, steps = 8): Promise<void> {
  const s = await cdp(page);
  await touchEvent(s, 'touchStart', [from]);
  for (let i = 1; i <= steps; i++) await touchEvent(s, 'touchMove', [lerp(from, to, i / steps)]);
  await touchEvent(s, 'touchEnd', []);
  await s.detach();
}

/** A finger held still for `ms` (a 2 px tremble inside any slop), then lifted: a long-press. */
export async function fingerHold(page: Page, at: Point, ms: number): Promise<void> {
  const s = await cdp(page);
  await touchEvent(s, 'touchStart', [at]);
  await page.waitForTimeout(ms);
  await touchEvent(s, 'touchMove', [{ x: at.x + 2, y: at.y + 1 }]);
  await touchEvent(s, 'touchEnd', []);
  await s.detach();
}

/**
 * A two-finger gesture: the first finger down, then the second, both moved together in `steps` steps, both lifted.
 * Equal `from` and `to` with no steps is a two-finger tap.
 */
export async function twoFingers(
  page: Page,
  from: readonly [Point, Point],
  to: readonly [Point, Point],
  steps = 6,
): Promise<void> {
  const s = await cdp(page);
  await touchEvent(s, 'touchStart', [from[0]]);
  await touchEvent(s, 'touchStart', from);
  for (let i = 1; i <= steps; i++) {
    await touchEvent(s, 'touchMove', [lerp(from[0], to[0], i / steps), lerp(from[1], to[1], i / steps)]);
  }
  await touchEvent(s, 'touchEnd', []);
  await s.detach();
}

/** A Pencil stroke along `path` (press at the first point, release at the last), at `force` (0–1). */
export async function penStroke(page: Page, path: readonly Point[], force = 0.6): Promise<void> {
  const first = path[0];
  const last = path.at(-1);
  if (first === undefined || last === undefined) return;
  const s = await cdp(page);
  const send = (type: 'mousePressed' | 'mouseMoved' | 'mouseReleased', p: Point) =>
    s.send('Input.dispatchMouseEvent', {
      type,
      x: p.x,
      y: p.y,
      button: 'left',
      buttons: type === 'mouseReleased' ? 0 : 1,
      clickCount: type === 'mouseMoved' ? 0 : 1,
      pointerType: 'pen',
      force: type === 'mouseReleased' ? 0 : force,
    });
  await send('mousePressed', first);
  for (const p of path.slice(1)) await send('mouseMoved', p);
  await send('mouseReleased', last);
  await s.detach();
}

/** A Pencil tap. */
export async function penTap(page: Page, at: Point): Promise<void> {
  await penStroke(page, [at]);
}
