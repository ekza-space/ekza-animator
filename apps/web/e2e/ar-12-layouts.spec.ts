// E2E-AR-12 (AUTORIG-SPEC §10 D3, §8.2, §8.3; the frame part of AS-AR-12): the wizard frame on ① and on ② (D4's
// Markers; a placeholder at D3's merge), at 1440×900 (desktop), 1024×768 with touch (tablet landscape) and 390×844 with touch
// (phone): the landmarks (header, the Steps nav with the step's h1, main, footer), no horizontal page scroll, the step
// panel beside the panes from 1024 px and a bottom sheet below, the stepper's labels shortened on a phone, and touch
// targets of at least 44 px where the pointer is coarse; on the touch sizes two fingers in the persp pane pan (the
// target moves, the view direction stays) and pinch-zoom (the distance to the target scales by the inverse of the
// spread), one finger orbits (§8.1, §8.3). (The 390×844 view-only case is D1's E2E-AR-01; the touch run of AS-AR-1
// is D7's.)
import { expect, type Page, test } from '@playwright/test';
import { openAutoRigReady } from './helpers/ar-host';
import { waitForReport } from './helpers/ar-model';
import { autorig } from './helpers/autorig';
import { call } from './helpers/test-api';

const SIZES = [
  { name: 'desktop 1440×900', width: 1440, height: 900, touch: false, side: true },
  { name: 'tablet 1024×768 touch', width: 1024, height: 768, touch: true, side: true },
  { name: 'phone 390×844 touch', width: 390, height: 844, touch: true, side: false },
] as const;

async function expectFrame(page: Page, size: (typeof SIZES)[number]): Promise<void> {
  await expect(page.getByRole('banner')).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Steps' });
  await expect(nav).toBeVisible();
  await expect(nav.getByRole('heading', { level: 1 })).toHaveCount(1);
  await expect(nav.locator('[aria-current="step"]')).toHaveCount(1);
  await expect(page.getByRole('main')).toBeVisible();
  await expect(page.getByRole('contentinfo')).toBeVisible();
  await expect(page.getByTestId('ar-primary')).toBeVisible();
  await expect(page.getByTestId('ar-open-studio')).toBeVisible();
  // no horizontal page scroll; the frame fills the window
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  // the two boxes are read together once the layout settles (a lazy report grows the sheet a frame later)
  const boxes = async () => ({
    panes: await page.getByTestId('ar-panes').boundingBox(),
    panel: await page.getByTestId('ar-step-panel').boundingBox(),
  });
  if (!size.side) {
    await expect
      .poll(async () => {
        const { panes, panel } = await boxes();
        return panes !== null && panel !== null && panel.y >= panes.y + panes.height - 1;
      })
      .toBe(true);
  }
  const { panes, panel } = await boxes();
  if (panes === null || panel === null) throw new Error('no panes or panel');
  if (size.side) {
    // the step panel beside the panes, at most 320 px wide
    expect(panel.x).toBeGreaterThanOrEqual(panes.x + panes.width - 1);
    expect(panel.width).toBeLessThanOrEqual(320 + 1);
  } else {
    // a bottom sheet below the panes, the full width
    expect(panel.y).toBeGreaterThanOrEqual(panes.y + panes.height - 1);
    expect(panel.width).toBeGreaterThanOrEqual(size.width - 1);
  }
  expect(panes.height).toBeGreaterThan(size.height * 0.3);
  // labels of the other steps are visually hidden on a phone (the glyphs stay, the names stay for screen readers)
  const hiddenLabels = await page.evaluate(
    () =>
      [...document.querySelectorAll('[data-testid="ar-stepper"] button span:last-child')].filter(
        (span) => (span as HTMLElement).getBoundingClientRect().width <= 1,
      ).length,
  );
  expect(hiddenLabels > 0).toBe(size.width < 700);
  if (size.touch) {
    // coarse pointer: every control of the header, the stepper and the footer is at least 44 px tall
    const small = await page.evaluate(() =>
      [
        ...document.querySelectorAll<HTMLElement>(
          'header button, header a, [data-testid="ar-stepper"] button, footer button',
        ),
      ]
        .filter((el) => el.getBoundingClientRect().width > 0)
        .filter((el) => el.getBoundingClientRect().height < 44)
        .map((el) => el.getAttribute('data-testid') ?? el.getAttribute('aria-label') ?? el.textContent),
    );
    expect(small).toEqual([]);
  }
}

type Camera = { position: number[]; quaternion: number[] };
type Point = { x: number; y: number };

/** The Cube Lad's middle (it stands on the origin, about 1.8 m tall). */
const BODY = [0, 0.9, 0];
const distance = (c: Camera): number => Math.hypot(...c.position.map((v, i) => v - (BODY[i] ?? 0)));
const sameView = (a: Camera, b: Camera): boolean =>
  a.quaternion.every((v, i) => Math.abs(v - (b.quaternion[i] ?? 0)) < 1e-6);
const camera = (page: Page): Promise<Camera> => call(page, 'cameraOf', 'pane-persp');

/** The camera's forward direction: (0, 0, −1) rotated by its quaternion. */
function forward(c: Camera): number[] {
  const [x = 0, y = 0, z = 0, w = 1] = c.quaternion;
  return [-(2 * (x * z + w * y)), -(2 * (y * z - w * x)), -(1 - 2 * (x * x + y * y))];
}

/** A two-finger gesture through CDP touch events: both fingers down, moved in `steps` steps, both lifted. */
async function twoFingers(page: Page, from: [Point, Point], to: [Point, Point], steps = 6): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const points = (pair: [Point, Point]) => pair.map((p, id) => ({ x: p.x, y: p.y, id }));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(from).slice(0, 1) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(from) });
  for (let i = 1; i <= steps; i++) {
    const at = (k: 0 | 1): Point => ({
      x: from[k].x + ((to[k].x - from[k].x) * i) / steps,
      y: from[k].y + ((to[k].y - from[k].y) * i) / steps,
    });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points([at(0), at(1)]) });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.use({ viewport: { width: size.width, height: size.height }, hasTouch: size.touch });

    test('the frame on ① and on ②', async ({ page }) => {
      await openAutoRigReady(page);
      await expect(page.getByTestId('ar-drop-zone')).toBeVisible();
      await expectFrame(page, size);
      // the drop zone's choices fit and are reachable
      for (const sample of ['cube-lad', 'polybot-tpose', 'polybot-apose']) {
        await expect(page.locator(`[data-sample="${sample}"]`)).toBeInViewport();
      }
      await page.locator('[data-sample="cube-lad"]').click();
      await waitForReport(page, 'cube-lad.glb');
      await expectFrame(page, size);
      await expect(page.getByTestId('ar-model-report')).toBeInViewport();

      await page.getByTestId('ar-primary').click();
      await expect.poll(async () => (await autorig(page))?.step).toBe('markers');
      // D4 landed ② Markers (it was a placeholder at D3's merge): its panel in the side panel / bottom sheet
      await expect(page.getByTestId('ar-markers-panel')).toBeVisible();
      await expectFrame(page, size);
    });

    if (size.touch) {
      test('two fingers pan and pinch-zoom the persp pane; one finger orbits', async ({ page }) => {
        await openAutoRigReady(page);
        await page.locator('[data-sample="cube-lad"]').click();
        await waitForReport(page, 'cube-lad.glb');
        const box = await page.getByTestId('pane-pane-persp').boundingBox();
        if (box === null) throw new Error('no persp pane');
        const at = (fx: number, fy: number): Point => ({ x: box.x + box.width * fx, y: box.y + box.height * fy });
        // the two-finger handler is a lazy chunk requested when the shell mounts on a touch device
        expect(await page.evaluate(() => navigator.maxTouchPoints > 0)).toBe(true);
        await page.waitForLoadState('networkidle');

        // pinch out (the spread doubles): zoom in towards the midpoint, the view direction unchanged
        const start = await camera(page);
        await twoFingers(page, [at(0.4, 0.3), at(0.6, 0.3)], [at(0.3, 0.3), at(0.7, 0.3)]);
        const zoomed = await camera(page);
        expect(sameView(zoomed, start)).toBe(true);
        expect(distance(zoomed)).toBeLessThan(distance(start) * 0.8);

        // both fingers moved together: a pan (the camera moves across the view, the view direction stays)
        const before = await camera(page);
        await twoFingers(page, [at(0.3, 0.3), at(0.5, 0.3)], [at(0.45, 0.4), at(0.65, 0.4)]);
        const panned = await camera(page);
        expect(sameView(panned, before)).toBe(true);
        const shift = panned.position.map((v, i) => v - (before.position[i] ?? 0));
        expect(Math.hypot(...shift)).toBeGreaterThan(1e-3);
        // a track: the camera moves across the view, not along it
        const along = shift.reduce((sum, v, i) => sum + v * (forward(before)[i] ?? 0), 0);
        expect(Math.abs(along)).toBeLessThan(Math.hypot(...shift) * 0.05);

        // one finger on empty space orbits (the Simple table's left press)
        const cdp = await page.context().newCDPSession(page);
        const p = at(0.15, 0.2);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...p, id: 0 }] });
        for (let i = 1; i <= 5; i++) {
          await cdp.send('Input.dispatchTouchEvent', {
            type: 'touchMove',
            touchPoints: [{ x: p.x + i * 16, y: p.y + i, id: 0 }],
          });
        }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await cdp.detach();
        expect(sameView(await camera(page), panned)).toBe(false);
      });
    }
  });
}
