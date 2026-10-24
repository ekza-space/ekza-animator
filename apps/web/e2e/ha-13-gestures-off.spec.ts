import { expect, type Page, test } from '@playwright/test';
import {
  camera,
  controlId,
  controlPoint,
  emptyPoint,
  grammar,
  halo,
  haloMenu,
  loadPolybot,
  near,
  openHalo,
  petal,
  selectedControls,
} from './helpers/halo';
import { call, runOk } from './helpers/test-api';
import { cdp, fingerTap, touchEvent, twoFingers } from './helpers/touch';

// ha-13 gestures off (STUDIO-TOUCH-SPEC §18, AS-ST-9; T6a exit test), `chrome-touch`: with Settings › Input › *Reduce
// gestures* on there is no two-finger undo, no quick pinch and no flick — and every one has its visible twin: ↶
// undoes (its toast names the step and offers Redo), the View puck's double-tap frames everything, the ring stays open
// on a flick so its petal is tapped. The setting is the device's `halo.input` (localStorage), never Pro's preferences.

const REDUCED = JSON.stringify({ reduceGestures: true });

async function centreOf(page: Page, testId: string): Promise<{ x: number; y: number }> {
  const box = await page.getByTestId(testId).boundingBox();
  if (box === null) throw new Error(`no ${testId}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test('Reduce gestures: no two-finger undo, quick pinch or flicks; every one has its visible twin', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'chrome-touch', 'chrome-touch only (CDP)');
  await page.addInitScript((value) => {
    localStorage.setItem('ekza-studio:halo:input:v1', value);
  }, REDUCED);
  await openHalo(page);
  expect(await grammar(page)).toMatchObject({ reduceGestures: true });
  await loadPolybot(page);
  const upper = await controlId(page, 'L Upper Arm');
  await fingerTap(page, await controlPoint(page, 'L Upper Arm'));
  await expect.poll(() => selectedControls(page)).toEqual([upper]);
  const keyBox = await petal(page, 'Key').boundingBox();
  if (keyBox === null) throw new Error('no Key petal');
  await fingerTap(page, { x: keyBox.x + keyBox.width / 2, y: keyBox.y + keyBox.height / 2 });
  await expect.poll(async () => (await call(page, 'history')).undo.length).toBeGreaterThan(0);
  const history = await call(page, 'history');
  const label = history.undo.at(-1) ?? '';

  // a two-finger tap undoes nothing …
  const p = await emptyPoint(page);
  await twoFingers(page, [p, { x: p.x + 80, y: p.y }], [p, { x: p.x + 80, y: p.y }], 0);
  await page.waitForTimeout(300);
  expect(await call(page, 'history')).toEqual(history);
  // … ↶ does, with the toast naming the step and offering Redo
  await fingerTap(page, await centreOf(page, 'halo-undo'));
  await expect.poll(async () => (await call(page, 'history')).redo).toEqual([label]);
  await expect(page.getByTestId('halo-toasts').getByText(`Undid: ${label}`)).toBeVisible();
  await page.getByTestId('halo-toasts').getByRole('button', { name: 'Redo' }).tap();
  await expect.poll(async () => (await call(page, 'history')).redo).toEqual([]);

  // a quick pinch-in is a dolly, not frame all; the puck's double-tap frames all
  await runOk(page, 'view.frame', { what: 'all', paneId: 'pane-single' });
  const c = { x: 600, y: 420 };
  await twoFingers(
    page,
    [
      { x: c.x - 160, y: c.y },
      { x: c.x + 160, y: c.y },
    ],
    [
      { x: c.x - 40, y: c.y },
      { x: c.x + 40, y: c.y },
    ],
    2,
  );
  await page.waitForTimeout(150);
  const pinched = await camera(page);
  await runOk(page, 'view.frame', { what: 'all', paneId: 'pane-single' });
  const framed = await camera(page);
  expect(near(pinched, framed, 0.02)).toBe(false);
  await runOk(page, 'view.frame', { what: 'selection', paneId: 'pane-single' });
  const puck = await centreOf(page, 'halo-puck');
  const s = await cdp(page);
  await touchEvent(s, 'touchStart', [puck]);
  await touchEvent(s, 'touchEnd', []);
  await page.waitForTimeout(60);
  await touchEvent(s, 'touchStart', [puck]);
  await touchEvent(s, 'touchEnd', []);
  await s.detach();
  await expect.poll(async () => near(await camera(page), framed, 0.02)).toBe(true);

  // a long-press opens the ring; a flick toward a slot leaves it open; tapping the petal runs it
  const at = await emptyPoint(page);
  const before = (await call(page, 'history')).undo.length;
  const t = await cdp(page);
  await touchEvent(t, 'touchStart', [at]);
  await page.waitForTimeout(600);
  await touchEvent(t, 'touchMove', [{ x: at.x + 30, y: at.y }]);
  await touchEvent(t, 'touchMove', [{ x: at.x + 70, y: at.y }]);
  await touchEvent(t, 'touchEnd', []);
  await t.detach();
  await expect(haloMenu(page)).toHaveAttribute('data-mode', 'ring');
  expect((await halo(page)).noun?.kind).toBe('empty');
  expect((await call(page, 'history')).undo.length).toBe(before);
  const keyAll = await petal(page, 'Key all').boundingBox();
  if (keyAll === null) throw new Error('no Key all petal');
  await fingerTap(page, { x: keyAll.x + keyAll.width / 2, y: keyAll.y + keyAll.height / 2 });
  await expect.poll(async () => (await call(page, 'history')).undo.length).toBe(before + 1);
});
