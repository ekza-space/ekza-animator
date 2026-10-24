import { expect, type Page, test } from '@playwright/test';
import { call, expectKernelStarted, openEditor, runOk, waitForTestApi } from './helpers/test-api';

// Layout presets for focused work (docs/LAYOUT-PRESETS.md), real input in Chrome: hide the tool strip from the Windows
// menu, the focus-mode round trip (Alt+0 and Ctrl+Space), the built-in presets on Alt+1…4, a user preset saved from
// Windows › Presets that survives a reload and applies, and Shift+F full screen.

/** The dock's tab titles (inactive tabs included), sorted. */
async function dockTabs(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('.dv-tab')].map((tab) => tab.textContent?.trim() ?? '').sort(),
  );
}

const ANIMATE_TABS = ['Attributes', 'Channels', 'Clips', 'Dope Sheet', 'Graph Editor', 'Outliner', 'Viewport'];

async function hoverViewport(page: Page): Promise<void> {
  const pane = (await call(page, 'panes'))[0];
  if (pane === undefined) throw new Error('no viewport pane');
  await page.mouse.move(pane.rect.x + pane.rect.w / 2, pane.rect.y + pane.rect.h / 2);
}

async function windowsMenu(page: Page): Promise<void> {
  await page.getByTestId('menu-windows').click();
}

test('hide the tool strip, focus mode round trip, built-in presets, a saved preset after a reload', async ({
  page,
}) => {
  const ns = `presets-${Date.now()}`;
  await openEditor(page, `&ns=${ns}`);
  await expectKernelStarted(page);
  await expect.poll(() => dockTabs(page)).toEqual(ANIMATE_TABS);
  await expect(page.getByTestId('statusline')).toBeVisible();

  // Windows › Tool Strip is a ticked check-box item; choosing it hides the tool strip.
  await windowsMenu(page);
  const toolStrip = page.getByTestId('menu-item-shell.windows.toolbar');
  await expect(toolStrip).toHaveAttribute('aria-checked', 'true');
  await toolStrip.click();
  await expect(page.getByTestId('statusline')).toHaveCount(0);
  await windowsMenu(page);
  await expect(page.getByTestId('menu-item-shell.windows.toolbar')).toHaveAttribute('aria-checked', 'false');
  await page.keyboard.press('Escape');

  // Focus mode: Alt+0 keeps only the viewport and hides the help line; Ctrl+Space (a tap) brings everything back.
  await hoverViewport(page);
  await page.keyboard.press('Alt+Digit0');
  await expect.poll(() => dockTabs(page)).toEqual(['Viewport']);
  await expect(page.getByTestId('helpline')).toHaveCount(0);
  await page.keyboard.press('Control+Space');
  await expect.poll(() => dockTabs(page)).toEqual(ANIMATE_TABS);
  await expect(page.getByTestId('helpline')).toBeVisible();
  // The tool strip was hidden before focus mode: it stays hidden.
  await expect(page.getByTestId('statusline')).toHaveCount(0);

  // Built-in presets on Alt+1…4.
  await page.keyboard.press('Alt+Digit2'); // Blocking
  await expect.poll(() => dockTabs(page)).toEqual(['Viewport']);
  await expect(page.getByTestId('viewport-panel')).toHaveAttribute('data-layout', 'single');
  await expect(page.getByTestId('statusline')).toBeVisible();
  await expect(page.getByTestId('timeline-region')).toBeVisible();
  await page.keyboard.press('Alt+Digit3'); // Polish
  await expect.poll(() => dockTabs(page)).toEqual(['Dope Sheet', 'Graph Editor', 'Viewport']);
  const heights = await page.evaluate(() => {
    const groupOf = (title: string): number =>
      [...document.querySelectorAll('.dv-tab')]
        .find((tab) => tab.textContent?.trim() === title)
        ?.closest('.dv-groupview')
        ?.getBoundingClientRect().height ?? 0;
    return { viewport: groupOf('Viewport'), graph: groupOf('Graph Editor') };
  });
  expect(heights.graph).toBeGreaterThan(heights.viewport);
  await page.keyboard.press('Alt+Digit4'); // Review
  await expect.poll(() => dockTabs(page)).toEqual(['Viewport']);
  await expect(page.getByTestId('statusline')).toHaveCount(0);
  await expect(page.getByTestId('helpline')).toHaveCount(0);
  await expect(page.getByTestId('timeline-region')).toBeVisible();

  // Save Blocking (with the quad panes) as a user preset from Windows › Presets.
  await page.keyboard.press('Alt+Digit2');
  await expect.poll(() => dockTabs(page)).toEqual(['Viewport']);
  await runOk(page, 'view.layout', { layout: 'quad' });
  await expect(page.getByTestId('viewport-panel')).toHaveAttribute('data-layout', 'quad');
  await windowsMenu(page);
  await page.getByTestId('menu-sub-windows.presets').click();
  await page.getByTestId('menu-item-shell.windows.presets.save').click();
  await expect(page.getByTestId('layout-presets-dialog')).toBeVisible();
  await page.getByTestId('layout-preset-name').fill('Quad blocking');
  await page.getByTestId('layout-preset-save').click();
  await expect(page.getByTestId('layout-presets-dialog')).toHaveCount(0);

  // Reload: back to the default, then the saved preset from the menu.
  await page.reload();
  await waitForTestApi(page);
  await expectKernelStarted(page);
  await hoverViewport(page);
  await page.keyboard.press('Alt+Digit1');
  await expect.poll(() => dockTabs(page)).toEqual(ANIMATE_TABS);
  await expect(page.getByTestId('viewport-panel')).toHaveAttribute('data-layout', 'split');
  await windowsMenu(page);
  await page.getByTestId('menu-sub-windows.presets').click();
  await page.getByRole('menuitem', { name: 'Quad blocking' }).click();
  await expect.poll(() => dockTabs(page)).toEqual(['Viewport']);
  await expect(page.getByTestId('viewport-panel')).toHaveAttribute('data-layout', 'quad');
  await expect(page.getByTestId('statusline')).toBeVisible();

  // Rename and delete it in the dialog.
  await windowsMenu(page);
  await page.getByTestId('menu-sub-windows.presets').click();
  await page.getByTestId('menu-item-shell.windows.presets.manage').click();
  await page.getByTestId('layout-preset-Quad blocking-rename').click();
  await page.getByTestId('layout-preset-Quad blocking-rename-input').fill('Four up');
  await page.getByTestId('layout-preset-Quad blocking-rename-input').press('Enter');
  await expect(page.getByTestId('layout-preset-Four up')).toBeVisible();
  await page.getByTestId('layout-preset-Four up-delete').click();
  await expect(page.getByTestId('layout-presets-empty')).toBeVisible();
});

test('Shift+F and Windows › Full Screen toggle browser full screen', async ({ page }) => {
  await openEditor(page);
  await expectKernelStarted(page);
  await hoverViewport(page);
  await page.keyboard.press('Shift+KeyF');
  await expect.poll(() => page.evaluate(() => document.fullscreenElement !== null)).toBe(true);
  await windowsMenu(page);
  await expect(page.getByTestId('menu-item-shell.windows.fullscreen')).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('menu-item-shell.windows.fullscreen').click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement !== null)).toBe(false);
});
