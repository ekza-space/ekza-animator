import { expect, test } from '@playwright/test';
import { openEditor } from './helpers/test-api';

// MVP-SPEC §3 convention 11: a Tailwind class used only inside packages/editor must reach the CSS that apps/web
// builds (packages/ui/styles.css declares `@source "../editor/src"`).
const EDITOR_ONLY_CLASS = '[--ekza-tailwind-smoke:editor]';

test('a Tailwind class used only in packages/editor is in the built CSS', async ({ page }) => {
  await openEditor(page);

  const root = page.getByTestId('editor-root');
  await expect(root).toHaveClass(new RegExp(EDITOR_ONLY_CLASS.replace(/[[\]]/g, '\\$&')));
  const value = await root.evaluate((element) => getComputedStyle(element).getPropertyValue('--ekza-tailwind-smoke'));
  expect(value.trim()).toBe('editor');

  const cssHasRule = await page.evaluate(async () => {
    const hrefs = [...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')].map((link) => link.href);
    const sheets = await Promise.all(hrefs.map(async (href) => (await fetch(href)).text()));
    return sheets.some((css) => /--ekza-tailwind-smoke:\s*editor/.test(css));
  });
  expect(cssHasRule).toBe(true);
});
