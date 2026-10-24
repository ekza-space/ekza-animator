// ha-15 — Halo T6b, accessibility and layout of the sheets and the Path (STUDIO-TOUCH-SPEC §18, §4.1; AS-ST-14,
// AS-ST-18). Runs on `chrome`, `chrome-touch` and `webkit-ipad`, at 1194 × 834 (landscape: sheets dock right),
// 834 × 1194 (portrait: sheets rise from the bottom) and 390 × 844 (phone, best-effort):
// - every T6b sheet opens as a named dialog; every target in it is at least 44 × 44 px; every input's text is at
//   least 16 px; its close button and footer actions are inside the viewport; nothing overflows sideways;
// - no floating item (the Path, the status corner, the Next chip) covers the selection's on-screen point;
// - axe (WCAG 2.0 / 2.1 / 2.2 A and AA rules) finds no violation in an open sheet when axe-core is available: the
//   repository has no axe dependency (T4's ST-T4-13: the offline store has none), so the spec reads
//   `EKZA_AXE_PATH` (a local `axe.min.js`) or a resolvable `axe-core`, and records a skip annotation without one.
// Until T6a's frame is integrated the sheets run in the T6b harness (`/dev-halo`); at integration the spec opens
// them from `/app`.
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, type Page, type TestInfo, test } from '@playwright/test';
import { call, runOk, waitForTestApi } from './helpers/test-api';

const START = '/dev-halo?e2e=1';
const SHEETS = ['more', 'numbers', 'scene', 'view', 'settings', 'health', 'help', 'about'] as const;
const SIZES = [
  { name: 'landscape', width: 1194, height: 834 },
  { name: 'portrait', width: 834, height: 1194 },
  { name: 'phone', width: 390, height: 844 },
] as const;

/** axe-core's source, from `EKZA_AXE_PATH` or a resolvable package, else null. */
function axeSource(): string | null {
  const forced = process.env['EKZA_AXE_PATH'];
  if (forced !== undefined && forced !== '' && existsSync(forced)) return readFileSync(forced, 'utf8');
  try {
    const require = createRequire(import.meta.url);
    return readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
  } catch {
    return null;
  }
}

interface LayoutProblem {
  readonly what: string;
  readonly detail: string;
}

/** Targets under 44 px, inputs under 16 px, actions outside the viewport and sideways overflow in a sheet. */
function sheetProblems(page: Page, testId: string): Promise<LayoutProblem[]> {
  return page.evaluate((id) => {
    const problems: { what: string; detail: string }[] = [];
    const sheet = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    if (sheet === null) return [{ what: 'missing', detail: id }];
    const name = (el: Element): string =>
      `${el.tagName.toLowerCase()}[${el.getAttribute('data-testid') ?? el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 30) ?? ''}]`;
    for (const el of sheet.querySelectorAll<HTMLElement>(
      'button, a[href], input, select, textarea, [role="tab"], [role="slider"], [role="switch"], [role="radio"]',
    )) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      if (rect.width < 43.5 || rect.height < 43.5) {
        problems.push({
          what: 'target < 44 px',
          detail: `${name(el)} ${rect.width.toFixed(1)}×${rect.height.toFixed(1)}`,
        });
      }
      if (el.matches('input, select, textarea')) {
        const size = Number.parseFloat(getComputedStyle(el).fontSize);
        if (size < 16) problems.push({ what: 'input text < 16 px', detail: `${name(el)} ${size}px` });
      }
    }
    const close = sheet.querySelector<HTMLElement>('button[aria-label="Close"]');
    const actions = [...(close === null ? [] : [close]), ...sheet.querySelectorAll<HTMLElement>('footer button')];
    for (const el of actions) {
      const rect = el.getBoundingClientRect();
      if (rect.left < 0 || rect.top < 0 || rect.right > innerWidth + 0.5 || rect.bottom > innerHeight + 0.5) {
        problems.push({ what: 'action outside the viewport', detail: name(el) });
      }
    }
    const body = sheet.querySelector<HTMLElement>('[data-touch-scroll]');
    if (body !== null && body.scrollWidth > body.clientWidth + 1) {
      problems.push({ what: 'sideways overflow', detail: `${body.scrollWidth} > ${body.clientWidth}` });
    }
    return problems;
  }, testId);
}

async function openSheet(page: Page, id: string, info: TestInfo): Promise<void> {
  const launcher = page.getByTestId(`harness-open-${id}`);
  if (info.project.name === 'chrome') await launcher.click();
  else await launcher.tap();
  await expect(page.getByTestId(`halo-sheet-${id}`)).toBeVisible();
}

async function closeSheet(page: Page, id: string): Promise<void> {
  await page.getByTestId(`halo-sheet-${id}`).getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByTestId(`halo-sheet-${id}`)).toHaveCount(0);
}

for (const size of SIZES) {
  test(`the sheets meet 44 px targets, 16 px inputs and stay on screen (${size.name})`, async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.goto(START);
    await waitForTestApi(page);
    await runOk(page, 'file.loadSample', { sample: 'polybot' });
    const control = (await call(page, 'controls')).find((c) => c.key.startsWith('fk.'));
    if (control !== undefined) await runOk(page, 'select.controls', { ids: [control.id], mode: 'replace' });
    const found: Record<string, LayoutProblem[]> = {};
    for (const id of SHEETS) {
      await openSheet(page, id, testInfo);
      const dialog = page.getByTestId(`halo-sheet-${id}`);
      await expect(dialog).toHaveAttribute('role', 'dialog');
      await expect(dialog).toHaveAccessibleName(/.+/);
      const problems = await sheetProblems(page, `halo-sheet-${id}`);
      if (problems.length > 0) found[id] = problems;
      await closeSheet(page, id);
    }
    expect(found).toEqual({});
  });
}

test('no floating item covers the selection', async ({ page }) => {
  await page.goto(START);
  await waitForTestApi(page);
  await runOk(page, 'file.loadSample', { sample: 'polybot' });
  await runOk(page, 'workspace.set', { workspace: 'animate' });
  const panes = await call(page, 'panes');
  const pane = panes[0]?.id ?? 'pane-single';
  const controls = (await call(page, 'controls')).filter((c) => c.visible);
  for (const control of controls.slice(0, 12)) {
    const point = await call(page, 'screenOfControl', control.id, pane);
    if (point === null) continue;
    for (const testId of ['halo-path', 'halo-status-corner', 'halo-next-chip']) {
      const box = await page.getByTestId(testId).boundingBox();
      if (box === null) continue;
      const inside =
        point.x >= box.x && point.x <= box.x + box.width && point.y >= box.y && point.y <= box.y + box.height;
      expect({ control: control.key, testId, inside }).toEqual({ control: control.key, testId, inside: false });
    }
  }
});

test('axe finds no WCAG 2.2 A/AA violation in the open sheets', async ({ page }, testInfo) => {
  const axe = axeSource();
  if (axe === null) {
    testInfo.annotations.push({
      type: 'skip',
      description: 'axe-core is not installed (offline store): set EKZA_AXE_PATH to a local axe.min.js (ST-T4-13)',
    });
    test.skip(true, 'axe-core not available');
    return;
  }
  test.setTimeout(180_000);
  await page.goto(START);
  await waitForTestApi(page);
  await runOk(page, 'file.loadSample', { sample: 'polybot' });
  await page.addScriptTag({ content: axe });
  const violations: Record<string, string[]> = {};
  for (const id of SHEETS) {
    await openSheet(page, id, testInfo);
    const found = await page.evaluate(async (sheet) => {
      const axe = (window as unknown as { axe: { run(ctx: unknown, opts: unknown): Promise<unknown> } }).axe;
      const result = (await axe.run(
        { include: [`[data-testid="halo-sheet-${sheet}"]`] },
        { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } },
      )) as { violations: { id: string; nodes: { target: string[] }[] }[] };
      return result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
    }, id);
    if (found.length > 0) violations[id] = found;
    await closeSheet(page, id);
  }
  expect(violations).toEqual({});
});
