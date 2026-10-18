import { expect, test } from '@playwright/test';
import { type Point, paneRect, settle } from './helpers/g1-viewport';
import { controlId, seedSample } from './helpers/seed';
import { call, fixmeIfKernelUnavailable, openEditor, runOk } from './helpers/test-api';

// E2E-26 (MVP-SPEC §6.2, §4.11.16): with the left hand framed in the free pane, a marquee over the hand selects its
// finger controls (crossing test) and nothing else; two plain clicks at one spot where two controls overlap cycle
// to the next candidate.
const FINGER = /^fk\.(thumb|index|middle|ring|little)[A-Za-z]*\.L$/;
const HAND = (key: string): boolean => key === 'fk.hand.L' || FINGER.test(key);
/** Pick tolerance (§4.11.16: point-to-segment distance ≤ 6 CSS px). */
const PICK_PX = 6;
const PAD_PX = 3;

test('E2E-26: marquee + cycling', async ({ page }) => {
  await openEditor(page, '&platform=mac');
  await fixmeIfKernelUnavailable(page);
  await seedSample(page, 'seed-san');
  const controls = await call(page, 'controls');
  const keyOf = new Map(controls.map((control) => [control.id, control.key]));

  // Frame the left hand in the free pane (view.frame on the selected hand frames its fingers, INT-37).
  await runOk(page, 'select.controls', { ids: [await controlId(page, 'fk.hand.L')], mode: 'replace' });
  await runOk(page, 'view.frame', { what: 'selection', paneId: 'pane-right' });
  await runOk(page, 'select.controls', { ids: [], mode: 'replace' });
  await settle(page);

  // Where the visible controls are drawn in the pane (a point on each shape).
  const pane = await paneRect(page, 'pane-right');
  const inPane = (p: Point) => p.x > pane.x && p.x < pane.x + pane.w && p.y > pane.y && p.y < pane.y + pane.h;
  const drawn: { id: string; key: string; at: Point }[] = [];
  for (const control of controls.filter((candidate) => candidate.visible)) {
    const at = await call(page, 'screenOfControl', control.id, 'pane-right');
    if (at !== null && inPane(at)) drawn.push({ id: control.id, key: control.key, at });
  }
  const fingers = drawn.filter((entry) => FINGER.test(entry.key));
  expect(fingers.length).toBeGreaterThanOrEqual(10);

  // Marquee from empty space around the finger shapes' points.
  const xs = fingers.map((entry) => entry.at.x);
  const ys = fingers.map((entry) => entry.at.y);
  const from = { x: Math.min(...xs) - PAD_PX, y: Math.min(...ys) - PAD_PX };
  const to = { x: Math.max(...xs) + PAD_PX, y: Math.max(...ys) + PAD_PX };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let step = 1; step <= 10; step++) {
    await page.mouse.move(from.x + ((to.x - from.x) * step) / 10, from.y + ((to.y - from.y) * step) / 10);
  }
  await page.mouse.up();
  await expect.poll(async () => (await call(page, 'state')).selection.controls.length).toBeGreaterThan(0);
  const marqueed = (await call(page, 'state')).selection.controls.map((id) => keyOf.get(id) ?? id);
  expect(marqueed.filter((key) => FINGER.test(key)).length).toBeGreaterThanOrEqual(10);
  expect(marqueed.filter((key) => !HAND(key))).toEqual([]);

  // Two controls overlap where both shapes pass within the pick tolerance: halfway between points on two shapes
  // that are less than 2 × 6 px apart (each shape is then ≤ 6 px from the spot).
  let spot: Point | null = null;
  let closest = Number.POSITIVE_INFINITY;
  for (let i = 0; i < drawn.length; i++) {
    for (let j = i + 1; j < drawn.length; j++) {
      const a = drawn[i]?.at;
      const b = drawn[j]?.at;
      if (a === undefined || b === undefined) continue;
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (distance < closest) {
        closest = distance;
        spot = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      }
    }
  }
  expect(closest, 'two controls overlap in the framed view').toBeLessThan(2 * PICK_PX - 1);
  if (spot === null) throw new Error('no overlapping controls');

  await page.mouse.click(spot.x, spot.y);
  await expect.poll(async () => (await call(page, 'state')).selection.controls.length).toBe(1);
  const first = (await call(page, 'state')).selection.controls[0];
  await page.mouse.click(spot.x, spot.y);
  await expect.poll(async () => (await call(page, 'state')).selection.controls).not.toEqual([first]);
  const second = (await call(page, 'state')).selection.controls;
  expect(second).toHaveLength(1);
  expect(second[0]).not.toBe(first);
});
