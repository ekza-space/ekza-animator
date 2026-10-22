// E2E-AR-11 (AUTORIG-SPEC §11 AS-AR-11, §8.1, §8.5; D7): "Private and keyboard-only". AS-AR-1 without the pointer:
// the file through *Choose file…* (Enter), `Mod+Enter` for every primary button, ② by the marker list (↑ / ↓) and
// the arrow nudges, ④ by `/`, the grid's roving focus and `A`, ⑤ by the licence radio (arrows / Space), the target
// radio and `Mod+Enter` for *Download*. Every control used is reachable by Tab (in the tab order, enabled). Every
// request of the run stays on the page's origin and none is a POST (§8.5: no telemetry).
import { expect, type Locator, type Page, test } from '@playwright/test';
import { foreignRequests, networkLog, onStep } from './helpers/ar-as';
import { checkOf, thumbnailRendered } from './helpers/ar-export';
import { openAutoRigReady } from './helpers/ar-host';
import { fixtureBytes, waitForReport } from './helpers/ar-model';
import { quickRig, wizard } from './helpers/ar-markers';
import { history } from './helpers/autorig';
import { modKey } from './helpers/m6a-model';
import { call } from './helpers/test-api';

/** Moves the keyboard focus to a control a Tab press can reach (in the tab order and enabled), as Tab would. */
async function tabTo(control: Locator): Promise<void> {
  await expect(control).toBeEnabled();
  expect(await control.evaluate((el) => (el as HTMLElement).tabIndex >= 0)).toBe(true);
  await control.focus();
  await expect(control).toBeFocused();
}

/** Presses Tab until the focus is on an element whose test id starts with `prefix` (a roving group's one tab stop). */
async function tabInto(page: Page, prefix: string): Promise<void> {
  for (let i = 0; i < 16; i++) {
    const at = await page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? '');
    if (at.startsWith(prefix)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error(`Tab never reached ${prefix}`);
}

/** `Mod+Enter` with the focus on no text field (the step heading, which the frame focuses on every step change). */
async function primaryKey(page: Page): Promise<void> {
  await page.getByRole('heading', { level: 1 }).focus();
  await page.keyboard.press(`${await modKey(page)}+Enter`);
}

test('AS-AR-11: AS-AR-1 by keyboard only; every request same-origin, no POST', async ({ page }) => {
  test.setTimeout(300_000);
  const net = networkLog(page);
  let pointer = 0;
  await page.exposeFunction('__arPointer', () => {
    pointer += 1;
  });
  await page.addInitScript(() => {
    for (const type of ['pointerdown', 'mousedown', 'touchstart']) {
      window.addEventListener(
        type,
        (e) => (e.isTrusted ? (window as { __arPointer?: () => void }).__arPointer?.() : 0),
        {
          capture: true,
        },
      );
    }
  });
  await openAutoRigReady(page);

  // ① Choose file… by Enter → the browser's file chooser
  await tabTo(page.getByRole('button', { name: 'Choose file…' }).first());
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press('Enter')]);
  await chooser.setFiles({
    name: 'polybot-unskinned-tpose.glb',
    mimeType: 'model/gltf-binary',
    buffer: fixtureBytes('polybot-unskinned-tpose.glb'),
  });
  await waitForReport(page, 'polybot-unskinned-tpose.glb');

  // ② Mod+Enter; the list: ↓ / ↑ select; the arrows nudge in the last ortho pane (FRONT)
  await primaryKey(page);
  await onStep(page, 'markers');
  await expect.poll(async () => (await quickRig(page))?.preview?.length ?? 0, { timeout: 30_000 }).toBeGreaterThan(0);
  await tabTo(page.getByTestId('quickrig-marker-elbow'));
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await quickRig(page))?.selected).toBe('elbow');
  await page.keyboard.press('ArrowDown');
  await expect.poll(async () => (await quickRig(page))?.selected).toBe('wrist');
  await page.keyboard.press('ArrowDown');
  await expect.poll(async () => (await quickRig(page))?.selected).toBe('knee');
  const knee = (await quickRig(page))?.markers['knee'] ?? [];
  await page.getByRole('heading', { level: 1 }).focus();
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Shift+ArrowDown');
  await expect.poll(async () => (await quickRig(page))?.markers['knee']?.[1]).toBeCloseTo((knee[1] ?? 0) - 0.002, 9);
  expect((await quickRig(page))?.markers['knee']?.[2]).toBe(knee[2]);

  // ③ Mod+Enter = Auto-rig: two steps; Space stops and restarts the motion test
  const before = (await history(page)).undo.length;
  await primaryKey(page);
  await onStep(page, 'rig', 60_000);
  await expect.poll(async () => (await wizard(page)).busy, { timeout: 60_000 }).toBeNull();
  expect((await history(page)).undo.slice(before)).toEqual(['Create Skeleton', 'Bind Skin']);
  await expect(page.getByTestId('ar-rig-sheet')).toHaveCount(0);
  await expect.poll(async () => (await wizard(page)).done['rig']).toBe(true);
  await expect(page.getByTestId('ar-primary')).toBeEnabled();

  // ④ Mod+Enter; `/` focuses the search; the grid's roving focus; A adds the focused card
  await primaryKey(page);
  await onStep(page, 'animations');
  await expect(page.getByTestId('ar-anim-grid')).toBeVisible();
  await page.getByRole('heading', { level: 1 }).focus();
  await page.keyboard.press('Slash');
  await expect(page.getByTestId('ar-anim-search')).toBeFocused();
  await page.keyboard.type('walk');
  await expect(page.getByTestId('ar-anim-grid').locator('button')).toHaveCount(1);
  // Tab from the search into the grid (its roving focus holds one tab stop): the one card left, Walk
  await tabInto(page, 'ar-clip-card-');
  await expect(page.getByTestId('ar-clip-card-walk')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await call(page, 'library'))?.preview?.clip).toBe('walk');
  await page.keyboard.press('KeyA');
  await expect.poll(async () => (await history(page)).undo.at(-1)).toBe('Use Clip Walk');

  // ⑤ Mod+Enter; the author by typing, the licence radio by Space, the target radio, Download by Mod+Enter
  await primaryKey(page);
  await onStep(page, 'export');
  await thumbnailRendered(page);
  await tabTo(page.getByTestId('vrm-meta-authors'));
  await page.keyboard.type('Tester');
  await page.keyboard.press('Enter');
  // Tab into the licence radio group (one tab stop), then the arrows move to CC0 and Space checks it
  await tabInto(page, 'vrm-licence-');
  for (let i = 0; i < 8; i++) {
    const at = await page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? '');
    if (at === 'vrm-licence-cc0') break;
    await page.keyboard.press('ArrowDown');
  }
  await expect(page.getByTestId('vrm-licence-cc0')).toBeFocused();
  await page.keyboard.press('Space');
  await expect(checkOf(page, 'licence')).toHaveAttribute('data-state', 'ok');
  await expect(checkOf(page, 'meta')).toHaveAttribute('data-state', 'ok');
  const target = page.getByTestId('ar-export-target-ekza-vrm');
  await page.getByRole('heading', { level: 1 }).focus();
  await tabInto(page, 'ar-export-target-');
  await expect(target).toBeFocused();
  await page.keyboard.press('Space');
  await expect(target).toHaveAttribute('data-state', 'checked');
  const saved = page.waitForEvent('download', { timeout: 120_000 });
  await primaryKey(page);
  const file = await saved;
  expect(file.suggestedFilename()).toBe('polybot.vrm');
  await expect(page.getByTestId('ar-export-result')).toHaveAttribute('data-saved', 'true');

  // no pointer was used; nothing left the origin, nothing was posted
  expect(pointer).toBe(0);
  expect(foreignRequests(page, net)).toEqual([]);
  expect(net.requests.filter((request) => request.method !== 'GET')).toEqual([]);
});
