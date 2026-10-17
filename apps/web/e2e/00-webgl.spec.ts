import { expect, test } from '@playwright/test';
import { openEditor, renderedFrames } from './helpers/test-api';

// E2E-00 (MVP-SPEC §6.2), without the drop-zone check until WP-5 adds the viewport panel.
test('E2E-00: WebGL is available and an idle editor renders no frames', async ({ page }) => {
  await openEditor(page);

  const webgl = await page.evaluate(() => {
    const info = window.__EKZA_ANIMATOR_TEST__?.webgl;
    return info === undefined ? null : { ok: info.ok, renderer: info.renderer };
  });
  test.info().annotations.push({ type: 'webgl renderer', description: webgl?.renderer ?? 'unknown' });
  expect(webgl?.ok, 'WebGL 2 must be available; the e2e run is meaningless without it').toBe(true);

  // The canvas rendered at least once…
  await expect.poll(() => renderedFrames(page)).toBeGreaterThan(0);

  // …and stops rendering within 1 s of idle (render on demand)…
  await expect
    .poll(
      async () => {
        const before = await renderedFrames(page);
        await page.waitForTimeout(100);
        return (await renderedFrames(page)) - before;
      },
      { timeout: 1_000, intervals: [0] },
    )
    .toBe(0);

  // …then renders 0 frames over the next second.
  const idleStart = await renderedFrames(page);
  await page.waitForTimeout(1_000);
  expect(await renderedFrames(page)).toBe(idleStart);
});
