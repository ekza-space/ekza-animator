// M2a acceptance fix round 2 (DECISIONS-OPEN §F, M2A-INT-34): the defects the final acceptance found, in the real
// build in real Chrome (the panels' Tailwind layout and the dock exist only here).
import { expect, type Page, test } from '@playwright/test';
import { seedSample } from './helpers/seed';
import { call, expectKernelStarted, openEditor, runOk } from './helpers/test-api';

interface Box {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** The Viewport panel's box and each pane surface's box (page CSS px). */
async function viewportBoxes(page: Page): Promise<{ panel: Box; panes: Record<string, Box> }> {
  return page.evaluate(() => {
    const box = (element: Element): Box => {
      const r = element.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    };
    const panel = document.querySelector('[data-testid="viewport-panel"]');
    if (panel === null) throw new Error('no viewport panel');
    const panes: Record<string, Box> = {};
    for (const surface of document.querySelectorAll('[data-ekza-pane]')) {
      panes[surface.getAttribute('data-ekza-pane') ?? ''] = box(surface);
    }
    return { panel: box(panel), panes };
  });
}

const HEADER = 22; // pane header
const SPLITTER = 4; // `w-1` / `h-1` separators

function near(actual: number, expected: number, what: string): void {
  expect(Math.abs(actual - expected), `${what}: ${actual} vs ${expected}`).toBeLessThanOrEqual(1);
}

/** Only `pane` is shown, and its surface (where the 3D view draws and takes input) covers the panel below its header. */
async function expectFillsPanel(page: Page, pane: string): Promise<void> {
  const { panel, panes } = await viewportBoxes(page);
  expect(Object.keys(panes)).toEqual([pane]);
  const surface = panes[pane] as Box;
  near(surface.left, panel.left, `${pane} left`);
  near(surface.right, panel.right, `${pane} right`);
  near(surface.top, panel.top + HEADER, `${pane} top`);
  near(surface.bottom, panel.bottom, `${pane} bottom`);
  // The manager's pane rectangle (the GL viewport) is that surface.
  const [drawn] = await call(page, 'panes');
  expect(drawn?.id).toBe(pane);
  near(drawn?.rect.w ?? 0, panel.right - panel.left, `${pane} drawn width`);
  near(drawn?.rect.h ?? 0, panel.bottom - panel.top - HEADER, `${pane} drawn height`);
}

/** Panes `rows` (each a row of pane ids) tile the panel edge to edge with one splitter between neighbours. */
async function expectTiles(page: Page, rows: readonly (readonly string[])[]): Promise<void> {
  const { panel, panes } = await viewportBoxes(page);
  expect(Object.keys(panes).sort()).toEqual(rows.flat().sort());
  const at = (id: string): Box => panes[id] as Box;
  rows.forEach((row, r) => {
    near(at(row[0] as string).left, panel.left, `${row[0]} left`);
    near(at(row.at(-1) as string).right, panel.right, `${row.at(-1)} right`);
    for (let i = 1; i < row.length; i++) {
      near(at(row[i] as string).left, at(row[i - 1] as string).right + SPLITTER, `${row[i]} after ${row[i - 1]}`);
    }
    for (const id of row) {
      const above = r === 0 ? panel.top : at((rows[r - 1] as readonly string[])[0] as string).bottom + SPLITTER;
      near(at(id).top, above + HEADER, `${id} top`);
      if (r === rows.length - 1) near(at(id).bottom, panel.bottom, `${id} bottom`);
    }
  });
}

/** Space over the centre of a pane: maximizes it, or restores the layout when it is maximized. */
async function spaceOver(page: Page, pane: string): Promise<void> {
  const { panes } = await viewportBoxes(page);
  const box = panes[pane] as Box;
  await page.mouse.move((box.left + box.right) / 2, (box.top + box.bottom) / 2);
  await page.keyboard.press('Space');
}

test('fix round 2: a single or Space-maximized pane fills the Viewport panel', async ({ page }) => {
  await openEditor(page, '&platform=mac');
  await expectKernelStarted(page);
  await seedSample(page, 'polybot');

  // Split (the default layout): two panes side by side.
  await expectTiles(page, [['pane-left', 'pane-right']]);
  // Space maximizes the hovered pane: before the fix it kept its header's width, ~40 % of the panel.
  await spaceOver(page, 'pane-right');
  await expect.poll(async () => (await call(page, 'state')).maximizedPane).toBe('pane-right');
  await expectFillsPanel(page, 'pane-right');
  await spaceOver(page, 'pane-right');
  await expect.poll(async () => (await call(page, 'state')).maximizedPane).toBeNull();
  await expectTiles(page, [['pane-left', 'pane-right']]);

  // Quad: two rows of two; a maximized quad pane fills the panel too.
  await runOk(page, 'view.layout', { layout: 'quad' });
  await expect.poll(async () => (await call(page, 'panes')).length).toBe(4);
  await expectTiles(page, [
    ['pane-top', 'pane-persp'],
    ['pane-front', 'pane-side'],
  ]);
  await spaceOver(page, 'pane-front');
  await expect.poll(async () => (await call(page, 'state')).maximizedPane).toBe('pane-front');
  await expectFillsPanel(page, 'pane-front');
  await spaceOver(page, 'pane-front');
  await expect.poll(async () => (await call(page, 'state')).maximizedPane).toBeNull();

  // The Single layout.
  await runOk(page, 'view.layout', { layout: 'single' });
  await expect.poll(async () => (await call(page, 'panes')).length).toBe(1);
  await expectFillsPanel(page, 'pane-single');
});
