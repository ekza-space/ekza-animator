import { expect, test } from '@playwright/test';
import { createPrimitive, openModel, setMode } from './helpers/m6a-model';
import { call, renderedFrames, runOk } from './helpers/test-api';

// E2E-MOD-16 "Idle in Model" (M6A-SPEC §10.1, the E2E-00 gate extended; owner INT): a 20,000-triangle sphere in face
// mode with one face selected — its edit view, the selection glyphs, the HUD and the pane overlays — renders on
// demand: once the frames settle, nothing renders for 2 s.

test('E2E-MOD-16 — idle in Model', async ({ page }) => {
  test.setTimeout(60_000);
  await openModel(page);
  const sphere = await createPrimitive(page, 'sphere', { subdivisionsAxis: 100, subdivisionsHeight: 101 });
  expect((await call(page, 'meshInfo', sphere))?.counts.tris).toBe(20_000);
  await runOk(page, 'select.objects', { ids: [sphere], mode: 'replace' });
  await setMode(page, 'face');
  await runOk(page, 'select.components', { mesh: sphere, kind: 'face', indices: [0], mode: 'replace' });
  await expect.poll(async () => (await call(page, 'model')).selected[sphere]?.face).toEqual([0]);

  // The frames settle (lazy chunks, the edit view's first draw, the HUD's recount)…
  await expect
    .poll(
      async () => {
        const before = await renderedFrames(page);
        await page.waitForTimeout(250);
        return (await renderedFrames(page)) - before;
      },
      { timeout: 15_000, intervals: [0] },
    )
    .toBe(0);
  // …and nothing renders over the next 2 s.
  const idle = await renderedFrames(page);
  await page.waitForTimeout(2_000);
  expect(await renderedFrames(page)).toBe(idle);
});
