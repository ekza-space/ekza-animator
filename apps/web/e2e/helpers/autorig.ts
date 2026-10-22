// Auto-Rig e2e helpers (AUTORIG-SPEC §10.0; D0): open `/autorig` in e2e mode, load a sample through
// `autorig.sample`, read the wizard state (`autorig()`) and the history. Every step package adds its own
// `helpers/ar-<step>.ts` (D3 model, D4 markers + rig, D5 animations, D6 export) next to this file instead of editing it.
import type { EkzaStudioTestApi } from '@ekza-studio/editor';
import type { Page } from '@playwright/test';
import { run, waitForTestApi } from './test-api';

export type AutoRigTestState = NonNullable<ReturnType<EkzaStudioTestApi['autorig']>>;
export type AutoRigSampleId = 'cube-lad' | 'polybot-tpose' | 'polybot-apose' | 'polybot' | 'seed-san';

/** The `check-size` markers of the two shells and the host (AUTORIG-SPEC §7.2). */
export const SHELL_MARKERS = {
  autorig: 'ekza-autorig-shell',
  studio: 'ekza-studio-shell',
  host: 'ekza-studio-host',
} as const;

/**
 * Opens `/autorig?e2e=1<query>` and waits for the page: the host's test API once the route mounts it (D1), else
 * D0's placeholder shell.
 */
export async function openAutoRig(page: Page, query = ''): Promise<void> {
  await page.goto(`/autorig?e2e=1${query}`);
  await page.waitForFunction(
    () =>
      window.__EKZA_STUDIO_TEST__ !== undefined || document.querySelector('[data-shell="ekza-autorig-shell"]') !== null,
  );
  if (await page.evaluate(() => window.__EKZA_STUDIO_TEST__ !== undefined)) await waitForTestApi(page);
}

/** Whether the page has the e2e test API (D1 installs it on `/autorig` from the host). */
export function hasTestApi(page: Page): Promise<boolean> {
  return page.evaluate(() => window.__EKZA_STUDIO_TEST__ !== undefined);
}

/** The wizard's state through the test API; null without a mounted Auto-Rig shell (e.g. on `/editor`). */
export function autorig(page: Page): Promise<AutoRigTestState | null> {
  return page.evaluate(() => window.__EKZA_STUDIO_TEST__?.autorig() ?? null);
}

/** Undo and redo labels, oldest first. */
export function history(page: Page): Promise<{ undo: string[]; redo: string[] }> {
  return page.evaluate(() => window.__EKZA_STUDIO_TEST__?.history() ?? { undo: [], redo: [] });
}

/** Loads a sample at the Model step (`autorig.sample`, D3); returns the run result. */
export function loadSample(page: Page, sample: AutoRigSampleId): ReturnType<typeof run> {
  return run(page, 'autorig.sample', { sample });
}

/** Every JavaScript response's text, so a spec can tell which chunk markers a page has loaded. */
export function scriptsOf(page: Page): { readonly texts: string[] } {
  const texts: string[] = [];
  page.on('response', (response) => {
    if (!response.url().split('?')[0]?.endsWith('.js')) return;
    void response
      .text()
      .then((text) => texts.push(text))
      .catch(() => {});
  });
  return { texts };
}

export const loaded = (scripts: { readonly texts: string[] }, marker: string): boolean =>
  scripts.texts.some((text) => text.includes(marker));
