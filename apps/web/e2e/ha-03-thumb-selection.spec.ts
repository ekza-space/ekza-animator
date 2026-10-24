import { expect, type Page, type TestInfo, test } from '@playwright/test';
import {
  controlId,
  canvasPoint,
  controlPoint,
  emptyPoint,
  meshPoint,
  halo,
  haloMenu,
  loadCubeLadInMake,
  loadPolybot,
  openHalo,
  selectedControls,
} from './helpers/halo';
import { call } from './helpers/test-api';
import { cdp, fingerTap, touchEvent, twoFingers } from './helpers/touch';

// ha-03 Thumb key and selection (STUDIO-TOUCH-SPEC §5.5, §5.3 C8–C9, ST-9; T6a exit test), `chrome-touch`: the Thumb key
// is hidden until it means something; a tap latches its meaning for the next tap only (Select more: a second control
// joins), a double-tap locks it (the lock chip and the canvas tint show, taps keep adding), a hold lasts while the
// thumb stays down (with the key held, tapping a second control selects two); the Halo updates in place meanwhile.
// Selection undo per workspace: in Make a cleared selection is an undo step a two-finger tap takes back (the toast
// names it); in Animate it is not, and the Reselect chip restores it.

const touchOnly = (info: TestInfo): void => test.skip(info.project.name !== 'chrome-touch', 'chrome-touch only (CDP)');

async function thumbCentre(page: Page): Promise<{ x: number; y: number }> {
  const box = await page.getByTestId('halo-thumb').boundingBox();
  if (box === null) throw new Error('no Thumb key');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test.describe('ha-03: the Thumb key', () => {
  test('hidden until something is selected; tap = next tap only; double-tap = lock', async ({ page }, testInfo) => {
    touchOnly(testInfo);
    await openHalo(page);
    await loadPolybot(page);
    expect((await halo(page)).thumb.mode).toBe('hidden');
    await expect(page.getByTestId('halo-thumb')).toHaveCount(0);

    // controls far enough apart that the Halo and the breadcrumb beside one never cover the next
    const upper = await controlId(page, 'L Upper Arm');
    const head = await controlId(page, 'L Leg IK');
    const hips = await controlId(page, 'R Leg IK');
    await fingerTap(page, await controlPoint(page, 'L Upper Arm'));
    await expect.poll(() => selectedControls(page)).toEqual([upper]);
    await expect(page.getByTestId('halo-thumb')).toBeVisible();
    expect((await halo(page)).thumb).toEqual({ mode: 'off', tap: 'selectMore', drag: 'fine' });

    // tap: Select more for the next tap only
    await fingerTap(page, await thumbCentre(page));
    await expect.poll(async () => (await halo(page)).thumb.mode).toBe('once');
    await expect(page.getByTestId('halo-thumb')).toHaveAttribute('aria-pressed', 'true');
    await fingerTap(page, await canvasPoint(page, 'L Leg IK'));
    await expect.poll(() => selectedControls(page)).toEqual([upper, head]);
    await expect.poll(async () => (await halo(page)).thumb.mode).toBe('off');
    // C8: the Halo stayed open and now speaks for both
    await expect(haloMenu(page)).toBeVisible();
    await expect(haloMenu(page)).toHaveAttribute('aria-label', '2 parts');
    // the next plain tap replaces the selection
    await fingerTap(page, await canvasPoint(page, 'R Leg IK'));
    await expect.poll(() => selectedControls(page)).toEqual([hips]);

    // double-tap: locked until tapped again — the chip and the tint show it, taps keep adding
    const thumb = await thumbCentre(page);
    const s = await cdp(page);
    await touchEvent(s, 'touchStart', [thumb]);
    await touchEvent(s, 'touchEnd', []);
    await page.waitForTimeout(80);
    await touchEvent(s, 'touchStart', [thumb]);
    await touchEvent(s, 'touchEnd', []);
    await s.detach();
    await expect.poll(async () => (await halo(page)).thumb.mode).toBe('locked');
    await expect(page.getByTestId('halo-thumb-lock')).toBeVisible();
    await expect(page.getByTestId('halo-lock-tint')).toBeVisible();
    await fingerTap(page, await canvasPoint(page, 'L Upper Arm'));
    await expect.poll(() => selectedControls(page)).toEqual([hips, upper]);
    await fingerTap(page, await canvasPoint(page, 'L Leg IK'));
    await expect.poll(() => selectedControls(page)).toEqual([hips, upper, head]);
    expect((await halo(page)).thumb.mode).toBe('locked');
    await page.getByTestId('halo-thumb-lock').tap();
    await expect.poll(async () => (await halo(page)).thumb.mode).toBe('off');
    await expect(page.getByTestId('halo-lock-tint')).toHaveCount(0);
  });

  test('with the key held, tapping a second control selects two (§5.5 hold)', async ({ page }, testInfo) => {
    touchOnly(testInfo);
    await openHalo(page);
    await loadPolybot(page);
    const upper = await controlId(page, 'L Upper Arm');
    const head = await controlId(page, 'L Leg IK');
    await fingerTap(page, await controlPoint(page, 'L Upper Arm'));
    await expect.poll(() => selectedControls(page)).toEqual([upper]);
    const thumb = await thumbCentre(page);
    const target = await canvasPoint(page, 'L Leg IK');
    // the thumb stays on the key while another finger taps the canvas (C6: the key never joins a canvas gesture)
    const s = await cdp(page);
    await touchEvent(s, 'touchStart', [thumb]);
    await page.waitForTimeout(80);
    await touchEvent(s, 'touchStart', [thumb, target]);
    // CDP's touchEnd lists the points that lift: the canvas finger (id 1) first, the thumb stays down
    await touchEvent(s, 'touchEnd', [target], [1]);
    await page.waitForTimeout(80);
    await expect.poll(() => selectedControls(page)).toEqual([upper, head]);
    expect((await halo(page)).thumb.mode).toBe('held');
    await touchEvent(s, 'touchEnd', []);
    await s.detach();
    // used while held: off on release
    await expect.poll(async () => (await halo(page)).thumb.mode).toBe('off');
  });
});

test.describe('ha-03: selection undo per workspace (C9)', () => {
  test('Make: clearing the selection is an undo step; two fingers take it back, the toast names it', async ({
    page,
  }, testInfo) => {
    touchOnly(testInfo);
    await openHalo(page);
    await loadCubeLadInMake(page);
    await page.getByTestId('halo-pick').getByRole('radio', { name: 'Faces' }).click();
    await fingerTap(page, await meshPoint(page));
    await expect.poll(async () => (await halo(page)).noun?.kind).toBe('faces');
    const steps = (await call(page, 'history')).undo.length;
    await fingerTap(page, await emptyPoint(page));
    await expect.poll(async () => (await halo(page)).noun?.kind).not.toBe('faces');
    expect((await call(page, 'history')).undo.length).toBe(steps + 1);
    expect(await page.getByTestId('halo-reselect').count()).toBe(0);
    const p = await emptyPoint(page);
    await twoFingers(page, [p, { x: p.x + 80, y: p.y }], [p, { x: p.x + 80, y: p.y }], 0);
    await expect.poll(async () => (await halo(page)).noun?.kind).toBe('faces');
    await expect(page.getByTestId('halo-toasts').getByText('Undid: Select')).toBeVisible();
  });

  test('Animate: clearing is not an undo step; Reselect restores it', async ({ page }, testInfo) => {
    touchOnly(testInfo);
    await openHalo(page);
    await loadPolybot(page);
    const upper = await controlId(page, 'L Upper Arm');
    await fingerTap(page, await controlPoint(page, 'L Upper Arm'));
    await expect.poll(() => selectedControls(page)).toEqual([upper]);
    const history = await call(page, 'history');
    await fingerTap(page, await emptyPoint(page));
    await expect.poll(() => selectedControls(page)).toEqual([]);
    expect(await call(page, 'history')).toEqual(history);
    await page.getByTestId('halo-reselect').tap();
    await expect.poll(() => selectedControls(page)).toEqual([upper]);
  });
});
