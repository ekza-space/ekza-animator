import { expect, test } from '@playwright/test';
import { counts, expandCard, hoverPane, positions, setCardField, topEdge, type Vec3 } from './helpers/m6a-model-ops-ui';
import { clickComponent, createPrimitive, MODEL_PANE, modKey, openModel } from './helpers/m6a-model';
import { call, expectKernelStarted } from './helpers/test-api';

// E2E-MOD-07 "Bevel and adjust" (M6A-SPEC §10.1, §5.9, §5.7, §5.10; owner B11): Mod+B from the keyboard arms the
// capture window on Bevel's primary field (Fraction, Maya's ×½ of the shortest adjacent edge); the card's Segments
// adjusts without a new history entry; `T` and `30%` keep the same fraction; one undo removes the bevel.
//
// Gates (§10.1): b5 (Bevel), b10 (edge mode, the edge pick). The B11 check below runs today: the Modeling Toolkit
// (poll reasons, ⋯ option boxes that keep the next run's defaults) and the Last-op card of a primitive (typed field,
// Reset, ✕ and `T`).

const near = (a: Vec3, b: Vec3): boolean => a.every((v, k) => Math.abs(v - (b[k] ?? Number.NaN)) <= 1e-6);

test.fixme('b5, b10: E2E-MOD-07 — Bevel and adjust', async ({ page }) => {
  await openModel(page);
  const cube = await createPrimitive(page, 'cube');
  await hoverPane(page);
  await page.keyboard.press('Digit2');
  await expect.poll(async () => (await call(page, 'state')).mode).toBe('edge');
  const { edge, ends } = await topEdge(page, cube, 'x');
  await clickComponent(page, cube, 'edge', edge);
  await hoverPane(page);
  await page.keyboard.press(`${await modKey(page)}+KeyB`);
  await expect
    .poll(async () => (await call(page, 'state')).capture)
    .toMatchObject({
      armed: 'keyboard-op',
      field: 'fraction',
    });
  await page.keyboard.type('0.3');
  await page.keyboard.press('Enter');
  await expect.poll(() => counts(page, cube)).toBe('10/15/7');
  await expandCard(page);
  await expect(page.getByTestId('lastop-field-fraction')).toHaveValue('0.300');
  // The new vertices lie 0.15 m (0.3 × ½ × the 1 m adjacent edges) along the adjacent edges: down the side face and
  // in across the top face, from each end of the bevelled edge.
  const side = Math.sign(ends[0][2]);
  const expected: Vec3[] = ends.flatMap((p): Vec3[] => [
    [p[0], p[1] - 0.15, p[2]],
    [p[0], p[1], p[2] - side * 0.15],
  ]);
  const points = await positions(page, cube);
  for (const want of expected)
    expect(
      points.some((p) => near(p, want)),
      JSON.stringify(want),
    ).toBe(true);

  // Segments 2 through the card: adjusted in place, no new history entry.
  const steps = (await call(page, 'history')).undo.length;
  await setCardField(page, 'segments', '2');
  await expect.poll(() => counts(page, cube)).toBe('12/18/8');
  expect((await call(page, 'history')).undo).toHaveLength(steps);

  // `T`, `30%`, Enter: the same fraction.
  await hoverPane(page);
  await page.keyboard.press('KeyT');
  await expect.poll(async () => (await call(page, 'lastOpCard', MODEL_PANE))?.focused).toBe('fraction');
  await page.keyboard.type('30%');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await call(page, 'lastOp'))?.args['fraction']).toBeCloseTo(0.3, 12);
  await page.keyboard.press('Escape');

  // One undo: the cube again.
  await hoverPane(page);
  await page.keyboard.press(`${await modKey(page)}+KeyZ`);
  await expect.poll(() => counts(page, cube)).toBe('8/12/6');
});

test('B11 — the Modeling Toolkit, its option boxes and the Last-op card of a primitive', async ({ page }) => {
  await openModel(page);
  await expectKernelStarted(page);
  const toolkit = page.getByTestId('mtk-panel');
  await expect(toolkit).toBeVisible();
  // Empty scene: the empty state offers primitives; a click creates one from the Toolkit.
  await page.getByTestId('mtk-btn-mesh.create.cube').click();
  await expect.poll(async () => (await call(page, 'lastOp'))?.id).toBe('mesh.create.cube');
  const created = await call(page, 'lastOp');
  expect(created?.source).toBe('toolkit');
  const cube = created?.targets[0] ?? '';
  await expect.poll(() => counts(page, cube)).toBe('8/12/6');
  // In object mode Extrude needs faces or border edges: disabled with its poll reason (§7).
  const extrude = page.getByTestId('mtk-btn-mesh.extrude');
  await expect(extrude).toHaveAttribute('aria-disabled', 'true');
  await expect(extrude).toHaveAttribute('title', 'Select faces or border edges');

  // ⋯ opens the option box; its fields are the next run's defaults and stay set.
  await page.getByTestId('mtk-opt-mesh.insertLoop').click();
  const box = page.getByTestId('optbox-mesh.insertLoop');
  await expect(box).toBeVisible();
  await box.getByTestId('optbox-field-mode-multiple').click();
  await box.getByTestId('optbox-field-divisions').fill('3');
  await box.getByTestId('optbox-field-divisions').press('Enter');
  await box.getByTestId('optbox-close').click();
  await expect(box).toHaveCount(0);
  await page.getByTestId('mtk-opt-mesh.insertLoop').click();
  await expect(page.getByTestId('optbox-field-mode')).toHaveAttribute('data-value', 'multiple');
  await expect(page.getByTestId('optbox-field-divisions')).toHaveValue('3');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('optbox-mesh.insertLoop')).toHaveCount(0);

  // The card: Subdivisions Width 3 adjusts the creation in place; Reset restores the defaults.
  const steps = (await call(page, 'history')).undo.length;
  await setCardField(page, 'subdivisionsWidth', '3');
  await expect.poll(() => counts(page, cube)).toBe('16/28/14');
  expect((await call(page, 'history')).undo).toHaveLength(steps);
  expect((await call(page, 'lastOp'))?.targets).toEqual([cube]);
  await page.getByTestId('lastop-reset').click();
  await expect.poll(() => counts(page, cube)).toBe('8/12/6');
  // ✕ hides the card; `G` still repeats; `T` brings the card back.
  await page.getByTestId('lastop-close').click();
  await expect(page.getByTestId(`lastop-card-${MODEL_PANE}`)).toHaveCount(0);
  expect((await call(page, 'lastOp'))?.closed).toBeNull();
  await hoverPane(page);
  await page.keyboard.press('KeyT');
  await expect(page.getByTestId(`lastop-card-${MODEL_PANE}`)).toHaveAttribute('data-state', 'expanded');
});
