import type { EkzaAnimatorTestApi } from '@ekza-animator/editor';
import type { Page } from '@playwright/test';

declare global {
  interface Window {
    __EKZA_ANIMATOR_TEST__?: EkzaAnimatorTestApi;
  }
}

/** Opens the editor in e2e mode and waits for `__EKZA_ANIMATOR_TEST__.ready` (MVP-SPEC §6.1). */
export async function openEditor(page: Page, query = ''): Promise<void> {
  await page.goto(`/editor?e2e=1${query}`);
  await page.waitForFunction(() => window.__EKZA_ANIMATOR_TEST__ !== undefined);
  await page.evaluate(async () => {
    await window.__EKZA_ANIMATOR_TEST__?.ready;
  });
}

export function renderedFrames(page: Page): Promise<number> {
  return page.evaluate(() => window.__EKZA_ANIMATOR_TEST__?.renderedFrames() ?? Number.NaN);
}
