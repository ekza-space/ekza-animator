import { expect, type Page, test } from '@playwright/test';
import { renderedFrames, waitForTestApi } from './helpers/test-api';

// NFR-12 (storage blocked) and NFR-13 (WebGL context loss) against the shell in the production build (/dev/shell over
// the fake app). The M1 requirement is manual QA (MVP-SPEC §1.2 stretch); these specs automate it for the shell.

interface DevShellWindow {
  __EKZA_DEV_SHELL__?: {
    readonly app: { requestFrame(): void };
    readonly shell: {
      readonly workspace: { kinds(): readonly string[]; readonly dockview: { getPanel(id: string): unknown } | null };
    };
  };
}

const kinds = (page: Page): Promise<string[]> =>
  page.evaluate(() => [...((window as DevShellWindow).__EKZA_DEV_SHELL__?.shell.workspace.kinds() ?? [])]);

test('NFR-12: the shell runs with localStorage blocked and falls back to the default layout', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
    });
  });
  await page.goto('/dev/shell');
  await page.waitForFunction(() => (window as DevShellWindow).__EKZA_DEV_SHELL__ !== undefined);
  await expect(page.getByTestId('panel-viewport')).toBeVisible();
  expect(new Set(await kinds(page))).toEqual(
    new Set(['viewport', 'outliner', 'clips', 'channelBox', 'attributes', 'graph']),
  );
  // A layout change has nowhere to be saved; nothing breaks.
  await page.evaluate(() => {
    const dockview = (window as DevShellWindow).__EKZA_DEV_SHELL__?.shell.workspace.dockview;
    (dockview?.getPanel('graph') as { api: { close(): void } } | undefined)?.api.close();
  });
  await expect.poll(() => kinds(page)).not.toContain('graph');
  await page.waitForTimeout(400); // the debounced layout save runs
  await page.reload();
  await page.waitForFunction(() => (window as DevShellWindow).__EKZA_DEV_SHELL__ !== undefined);
  await expect.poll(() => kinds(page)).toContain('graph');
  expect(errors).toEqual([]);
});

test('NFR-13: a lost WebGL context is reported and the canvas recovers', async ({ page }) => {
  await page.goto('/dev/shell?e2e=1');
  await waitForTestApi(page);
  await expect.poll(() => renderedFrames(page)).toBeGreaterThan(0);
  // The extension is looked up once: a lost context returns null for every getExtension call.
  const lose = (method: 'loseContext' | 'restoreContext') =>
    page.evaluate((call) => {
      const holder = window as unknown as { __ekzaLoseContext?: WEBGL_lose_context | null };
      if (holder.__ekzaLoseContext === undefined) {
        const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="gl-host"] canvas');
        holder.__ekzaLoseContext = canvas?.getContext('webgl2')?.getExtension('WEBGL_lose_context') ?? null;
      }
      if (holder.__ekzaLoseContext === null) throw new Error('WEBGL_lose_context is not available');
      holder.__ekzaLoseContext[call]();
    }, method);

  await lose('loseContext');
  await expect(page.getByTestId('helpline')).toContainText('Graphics context lost');
  await expect(page.locator('[data-testid="toast"][data-kind="warning"]')).toContainText('graphics context was lost');
  await lose('restoreContext');
  await expect(page.getByTestId('helpline')).not.toContainText('Graphics context lost');
  expect(await page.evaluate(() => window.__EKZA_ANIMATOR_TEST__?.webgl.ok)).toBe(true);
  const before = await renderedFrames(page);
  await page.evaluate(() => (window as DevShellWindow).__EKZA_DEV_SHELL__?.app.requestFrame());
  await expect.poll(() => renderedFrames(page)).toBeGreaterThan(before);
});
