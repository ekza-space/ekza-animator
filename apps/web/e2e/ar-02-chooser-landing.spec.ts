import { type Browser, expect, type Page, test } from '@playwright/test';
import { SHELL_MARKERS } from './helpers/autorig';
import { waitForTestApi } from './helpers/test-api';

// E2E-AR-02 (AUTORIG-SPEC §3.2–§3.3, §11 AS-AR-8; D2): the landing page `/` is the chooser — two plain links, Auto-Rig
// first, that work without JavaScript; *Remember my choice* makes the next `/` land on the chosen mode; `/?chooser=1`
// shows the chooser again and unticking forgets the choice; `/editor` and `/autorig` never redirect; blocked storage
// shows the chooser (Ask); a back/forward visit of `/` never redirects; below 720 px the cards stack.

const ENTRY_KEY = 'ekza-studio:entry:v1';

const remembered = (page: Page): Promise<unknown> =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null') as unknown, ENTRY_KEY);

async function remember(page: Page, choice: 'autorig' | 'studio'): Promise<void> {
  await page.goto('/?chooser=1');
  await page.evaluate(([key, value]) => localStorage.setItem(key, value), [
    ENTRY_KEY,
    JSON.stringify({ choice, at: Date.now() }),
  ] as const);
}

test('the chooser: two link cards, Auto-Rig first, credits and the privacy line', async ({ page }) => {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') problems.push(message.text());
  });
  page.on('pageerror', (error) => problems.push(error.message));
  const requests: string[] = [];
  page.on('request', (request) => requests.push(`${request.method()} ${request.url()}`));
  await page.goto('/');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: 'What do you want to do?' })).toBeVisible();
  const cards = page.getByTestId('entry-chooser').getByRole('link');
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0)).toHaveAttribute('data-entry', 'autorig');
  await expect(cards.nth(0)).toHaveAttribute('href', '/autorig');
  await expect(cards.nth(0)).toContainText('Start Auto-Rig');
  await expect(cards.nth(1)).toHaveAttribute('data-entry', 'studio');
  await expect(cards.nth(1)).toHaveAttribute('href', '/editor');
  await expect(cards.nth(1)).toContainText('Open Studio');
  await expect(page.getByText('Everything runs in your browser. Your files are never uploaded.')).toBeVisible();
  await expect(page.locator('#credits')).toContainText('"Cube Lad" model by Ekza Studio contributors, MIT.');
  await expect(page.getByRole('link', { name: 'THIRD_PARTY_NOTICES.txt' })).toBeVisible();
  // Nothing remembered: the box is unticked once hydrated, and following a card remembers nothing.
  const box = page.getByTestId('entry-remember');
  await expect(box).toBeEnabled();
  await expect(box).not.toBeChecked();
  // Keyboard: the cards are reachable by Tab, Auto-Rig first.
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('entry-autorig')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('entry-studio')).toBeFocused();
  // No hydration or script warnings; same-origin GETs only (§8.5).
  expect(problems).toEqual([]);
  const origin = new URL(page.url()).origin;
  expect(requests.filter((request) => !request.startsWith(`GET ${origin}/`))).toEqual([]);
});

test('Remember + Auto-Rig: the next / lands on /autorig; ?chooser=1 shows the chooser; unticking forgets', async ({
  page,
}) => {
  await page.goto('/?e2e=1');
  await page.getByTestId('entry-remember').check();
  // The card carries the page's switches (e2e), so the arriving page has the test API.
  await expect(page.getByTestId('entry-autorig')).toHaveAttribute('href', '/autorig?e2e=1');
  await page.getByTestId('entry-autorig').click();
  await expect(page).toHaveURL(/\/autorig\?e2e=1$/);
  await waitForTestApi(page);
  await expect(page.locator(`[data-shell="${SHELL_MARKERS.autorig}"]`)).toBeVisible();
  expect(await remembered(page)).toMatchObject({ choice: 'autorig' });

  await page.goto('/?e2e=1');
  await expect(page).toHaveURL(/\/autorig\?e2e=1$/);

  await page.goto('/?chooser=1');
  await expect(page).toHaveURL(/\/\?chooser=1$/);
  await expect(page.getByTestId('entry-chooser')).toBeVisible();
  await expect(page.getByTestId('entry-remember')).toBeChecked();
  await page.getByTestId('entry-remember').uncheck();
  expect(await remembered(page)).toBeNull();

  await page.goto('/');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId('entry-chooser')).toBeVisible();
});

test('Remember + Studio lands on /editor; without Remember nothing is stored', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('entry-studio').click();
  await expect(page).toHaveURL(/\/editor$/);
  expect(await remembered(page)).toBeNull();

  await page.goto('/');
  await expect(page).toHaveURL(/\/$/);
  await page.getByTestId('entry-remember').check();
  await page.getByTestId('entry-studio').click();
  await expect(page).toHaveURL(/\/editor$/);
  expect(await remembered(page)).toMatchObject({ choice: 'studio' });
  await page.goto('/');
  await expect(page).toHaveURL(/\/editor$/);
});

test('deep links never redirect', async ({ page }) => {
  await remember(page, 'autorig');
  await page.goto('/editor?e2e=1');
  await waitForTestApi(page);
  await expect(page).toHaveURL(/\/editor\?e2e=1$/);
  await expect(page.getByTestId('editor-shell')).toBeVisible();

  await remember(page, 'studio');
  await page.goto('/autorig?e2e=1');
  await waitForTestApi(page);
  await expect(page).toHaveURL(/\/autorig\?e2e=1$/);
  await expect(page.locator(`[data-shell="${SHELL_MARKERS.autorig}"]`)).toBeVisible();
});

test('a back/forward visit of / shows the chooser (no history trap)', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('entry-remember').check();
  await page.getByTestId('entry-autorig').click();
  await expect(page).toHaveURL(/\/autorig$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId('entry-chooser')).toBeVisible();
  // a fresh visit still applies the choice
  await page.goto('/');
  await expect(page).toHaveURL(/\/autorig$/);
});

test('blocked storage shows the chooser (Ask) and the cards still work, without a page error', async ({ page }) => {
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
  await page.goto('/');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId('entry-chooser')).toBeVisible();
  const box = page.getByTestId('entry-remember');
  await expect(box).toBeEnabled();
  await expect(box).not.toBeChecked();
  await box.check();
  expect(errors).toEqual([]);
  await page.getByTestId('entry-studio').click();
  await expect(page).toHaveURL(/\/editor$/);
});

async function noScriptPage(browser: Browser, baseURL: string, stored: string | null): Promise<Page> {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    baseURL,
    storageState: {
      cookies: [],
      origins: stored === null ? [] : [{ origin: baseURL, localStorage: [{ name: ENTRY_KEY, value: stored }] }],
    },
  });
  return context.newPage();
}

test('without JavaScript the chooser shows (even with a remembered choice) and its cards are links', async ({
  browser,
  baseURL,
}) => {
  if (baseURL === undefined) throw new Error('no baseURL');
  const page = await noScriptPage(browser, baseURL, JSON.stringify({ choice: 'autorig', at: 1 }));
  await page.goto('/');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId('entry-chooser')).toBeVisible();
  // the box could remember nothing without JavaScript: shown disabled
  await expect(page.getByTestId('entry-remember')).toBeDisabled();
  await page.getByTestId('entry-studio').click();
  await expect(page).toHaveURL(/\/editor$/);
  await page.goto('/');
  await page.getByTestId('entry-autorig').click();
  await expect(page).toHaveURL(/\/autorig$/);
  await page.context().close();
});

test('the cards sit side by side on a desktop and stack below 720 px, Auto-Rig on top', async ({ page }) => {
  await page.goto('/');
  const top = async (id: string): Promise<{ x: number; y: number; w: number }> => {
    const box = await page.getByTestId(id).boundingBox();
    if (box === null) throw new Error(`${id} not laid out`);
    return { x: box.x, y: box.y, w: box.width };
  };
  let auto = await top('entry-autorig');
  let studio = await top('entry-studio');
  expect(Math.abs(auto.y - studio.y)).toBeLessThan(1);
  expect(auto.x).toBeLessThan(studio.x);

  await page.setViewportSize({ width: 390, height: 844 });
  auto = await top('entry-autorig');
  studio = await top('entry-studio');
  expect(auto.y).toBeLessThan(studio.y);
  expect(Math.abs(auto.x - studio.x)).toBeLessThan(1);
  // 16 px side gutter, no horizontal scroll
  expect(auto.x).toBeGreaterThanOrEqual(16);
  expect(auto.x + auto.w).toBeLessThanOrEqual(390 - 16 + 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
