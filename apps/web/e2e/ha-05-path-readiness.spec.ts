// ha-05 — Halo T6b, the Path, readiness and the visible-target budget (STUDIO-TOUCH-SPEC §7, §4.8; AS-ST-17's
// counter; ST-36). Runs on `chrome`, `chrome-touch` and `webkit-ipad` (compatibility only on WebKit):
// - the Path is a tab list of the four stages, each tab named with its readiness glyph's meaning; tapping a stage
//   switches the workspace (Make and Paint share Model) and never gates;
// - readiness is one list: an empty project is untouched and quiet (no status pill, no Next chip, never "All good");
//   a mesh suggests *Rig it for me*; for OMOBA the missing skeleton is a row: Rig shows ⚠1, the status pill shows the
//   total and equals the list; tapping the selected stage's ⚠ opens Health; a destination with a triangle budget
//   shows the budget ring;
// - the visible-target budget at rest (≤ 22) holds for what is on screen.
// Until T6a's frame is integrated these parts run in the T6b harness (`/dev-halo`); at integration the spec opens
// `/app` instead.
import { expect, type Locator, type Page, type TestInfo, test } from '@playwright/test';
import { call, runOk, waitForTestApi } from './helpers/test-api';

const START = '/dev-halo?e2e=1';

interface T6bSlice {
  readonly destination: string;
  readonly total: number;
  readonly stages: Record<string, { readonly glyph: string; readonly count: number }>;
  readonly rows: readonly { readonly stage: string; readonly code: string }[];
  readonly budget: { readonly tris: number; readonly limit: number } | null;
  readonly next: string | null;
}

const touch = (info: TestInfo): boolean => info.project.name !== 'chrome';

async function press(locator: Locator, info: TestInfo): Promise<void> {
  if (touch(info)) await locator.tap();
  else await locator.click();
}

async function halo(page: Page) {
  const state = await call(page, 'halo');
  if (state === null) throw new Error('no Halo state');
  return { ...state, t6b: state.slices['t6b'] as T6bSlice };
}

async function open(page: Page): Promise<void> {
  await page.goto(START);
  await waitForTestApi(page);
  await expect(page.getByTestId('halo-path')).toBeVisible();
}

test('the Path switches stages and never gates', async ({ page }, testInfo) => {
  await open(page);
  const tabs = page.getByTestId('halo-path').getByRole('tab');
  await expect(tabs).toHaveCount(4);
  await expect(tabs.nth(0)).toHaveAccessibleName(/^Make, /);
  await expect(tabs.nth(3)).toHaveAccessibleName(/^Animate, /);
  await press(page.getByRole('tab', { name: /^Rig, / }), testInfo);
  await expect.poll(async () => (await halo(page)).stage).toBe('rig');
  await expect.poll(async () => (await call(page, 'state')).workspace).toBe('rig');
  await expect(page.getByRole('tab', { name: /^Rig, / })).toHaveAttribute('aria-selected', 'true');
  await press(page.getByRole('tab', { name: /^Paint, / }), testInfo);
  await expect.poll(async () => (await call(page, 'state')).workspace).toBe('model');
  await press(page.getByRole('tab', { name: /^Animate, / }), testInfo);
  await expect.poll(async () => (await call(page, 'state')).workspace).toBe('animate');
  // An empty project: every stage untouched, nothing to say.
  for (const stage of ['make', 'paint', 'rig', 'animate']) {
    await expect(page.getByTestId(`halo-path-glyph-${stage}`)).toHaveText('○');
  }
  await expect(page.getByTestId('halo-status-pill')).toHaveCount(0);
  await expect(page.getByTestId('halo-next-chip')).toHaveCount(0);
  await expect(page.getByText(/all good/i)).toHaveCount(0);
});

test('readiness is one list: glyphs, the status pill, Health and the budget read it', async ({ page }, testInfo) => {
  await open(page);
  await press(page.getByRole('tab', { name: /^Make, / }), testInfo);
  await expect.poll(async () => (await call(page, 'state')).workspace).toBe('model');
  await runOk(page, 'mesh.create.cube');
  await expect(page.getByTestId('halo-next-chip')).toContainText('Rig it for me');
  await expect(page.getByTestId('halo-path-glyph-make')).toHaveText('◐');

  await press(page.getByTestId('harness-destination-omoba'), testInfo);
  await expect.poll(async () => (await halo(page)).t6b.destination).toBe('omoba');
  const slice = (await halo(page)).t6b;
  expect(slice.rows.map((row) => row.code)).toContain('no-skeleton');
  expect(slice.total).toBe(slice.rows.length);
  await expect(page.getByTestId('halo-path-glyph-rig')).toHaveText(`⚠${slice.stages['rig']?.count ?? 0}`);
  await expect(page.getByTestId('halo-status-pill')).toContainText(`${slice.total} to fix`);
  await expect(page.getByRole('tab', { name: /^Rig, \d+ things? to fix/ })).toBeVisible();

  // The selected stage's ⚠ opens Health at that stage.
  await press(page.getByRole('tab', { name: /^Rig, / }), testInfo);
  await expect.poll(async () => (await halo(page)).stage).toBe('rig');
  await press(page.getByRole('tab', { name: /^Rig, / }), testInfo);
  await expect.poll(async () => (await halo(page)).sheet).toBe('health');
  await expect(page.getByTestId('halo-sheet-health')).toBeVisible();

  // A destination with a triangle budget shows the ring.
  await press(page.getByTestId('harness-destination-prop'), testInfo);
  await expect(page.getByTestId('halo-budget-ring')).toContainText('/ 600');
  const budget = (await halo(page)).t6b.budget;
  expect(budget?.tris).toBeGreaterThan(0);
});

test('the visible-target budget at rest holds (≤ 22)', async ({ page }) => {
  await open(page);
  await runOk(page, 'file.loadSample', { sample: 'polybot' });
  await expect.poll(async () => (await halo(page)).visibleTargets).toBeGreaterThan(3);
  expect((await halo(page)).visibleTargets).toBeLessThanOrEqual(22);
});
