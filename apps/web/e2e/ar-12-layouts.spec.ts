// E2E-AR-12 (AUTORIG-SPEC §10 D3, §8.2, §8.3; the frame part of AS-AR-12): the wizard frame on ① and on a step whose
// package has not landed yet, at 1440×900 (desktop), 1024×768 with touch (tablet landscape) and 390×844 with touch
// (phone): the landmarks (header, the Steps nav with the step's h1, main, footer), no horizontal page scroll, the step
// panel beside the panes from 1024 px and a bottom sheet below, the stepper's labels shortened on a phone, and touch
// targets of at least 44 px where the pointer is coarse. (The 390×844 view-only case is D1's E2E-AR-01; the touch run
// of AS-AR-1 is D7's.)
import { expect, type Page, test } from '@playwright/test';
import { openAutoRigReady } from './helpers/ar-host';
import { waitForReport } from './helpers/ar-model';
import { autorig } from './helpers/autorig';

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
  const panes = await page.getByTestId('ar-panes').boundingBox();
  const panel = await page.getByTestId('ar-step-panel').boundingBox();
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

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.use({ viewport: { width: size.width, height: size.height }, hasTouch: size.touch });

    test('the frame on ① and on a step that has not landed yet', async ({ page }) => {
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
      await expect(page.getByTestId('ar-step-placeholder')).toBeVisible();
      await expectFrame(page, size);
    });
  });
}
