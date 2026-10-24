// STUDIO-TOUCH-SPEC §20.3 item 1 (T1): Auto-Rig's touch navigation after its move into the viewport, driven through
// the shared CDP helpers (`helpers/touch.ts`) on a 1024×768 touch page. The two-finger handler is now a stage of the
// ViewportManager's pointer path (no document listeners, no synthetic events): one finger on empty space still orbits
// (the Simple override), two fingers pinch towards their midpoint and pan, a resting two-finger tap changes nothing,
// and the Pencil stays a plain left press (it orbits on empty space too); AS-ST-15: Auto-Rig's behaviour is unchanged.
import { expect, type Page, test } from '@playwright/test';
import { openAutoRigReady } from './helpers/ar-host';
import { waitForReport } from './helpers/ar-model';
import { history } from './helpers/autorig';
import { call } from './helpers/test-api';
import { fingerDrag, penStroke, type Point, twoFingers } from './helpers/touch';

type Camera = { position: number[]; quaternion: number[] };

const camera = (page: Page): Promise<Camera> => call(page, 'cameraOf', 'pane-persp');
const sameView = (a: Camera, b: Camera): boolean =>
  a.quaternion.every((v, i) => Math.abs(v - (b.quaternion[i] ?? 0)) < 1e-6);
/** The Cube Lad's middle (it stands on the origin, about 1.8 m tall). */
const BODY = [0, 0.9, 0];
const distance = (c: Camera): number => Math.hypot(...c.position.map((v, i) => v - (BODY[i] ?? 0)));

test.use({ viewport: { width: 1024, height: 768 }, hasTouch: true });

test('Auto-Rig on touch: one finger orbits, two fingers pinch and pan, the Pencil is a left press', async ({
  page,
}) => {
  await openAutoRigReady(page);
  await page.locator('[data-sample="cube-lad"]').tap();
  await waitForReport(page, 'cube-lad.glb');
  const box = await page.getByTestId('pane-pane-persp').boundingBox();
  if (box === null) throw new Error('no persp pane');
  const at = (fx: number, fy: number): Point => ({ x: box.x + box.width * fx, y: box.y + box.height * fy });
  // the two-finger stage is a lazy chunk requested when the shell mounts on a touch device
  await page.waitForLoadState('networkidle');
  const steps = (await history(page)).undo.length;

  const start = await camera(page);
  await fingerDrag(page, at(0.15, 0.2), at(0.35, 0.22));
  const orbited = await camera(page);
  expect(sameView(orbited, start)).toBe(false);

  await twoFingers(page, [at(0.4, 0.3), at(0.6, 0.3)], [at(0.3, 0.3), at(0.7, 0.3)]);
  const zoomed = await camera(page);
  expect(sameView(zoomed, orbited)).toBe(true);
  expect(distance(zoomed)).toBeLessThan(distance(orbited) * 0.8);

  await twoFingers(page, [at(0.3, 0.3), at(0.5, 0.3)], [at(0.4, 0.4), at(0.6, 0.4)]);
  const panned = await camera(page);
  expect(sameView(panned, zoomed)).toBe(true);
  expect(panned.position).not.toEqual(zoomed.position);

  // a two-finger tap: nothing moves and nothing is undone (Auto-Rig has no two-finger tap)
  await twoFingers(page, [at(0.3, 0.3), at(0.5, 0.3)], [at(0.3, 0.3), at(0.5, 0.3)], 0);
  expect(await camera(page)).toEqual(panned);

  // the Pencil on empty space: the Simple override's left press, an orbit
  await penStroke(page, [at(0.15, 0.6), at(0.2, 0.6), at(0.25, 0.61), at(0.3, 0.62)]);
  expect(sameView(await camera(page), panned)).toBe(false);
  expect((await history(page)).undo).toHaveLength(steps);
});
