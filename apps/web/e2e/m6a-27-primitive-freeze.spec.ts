import { expect, type Page, test } from '@playwright/test';
import { setAttributeField } from './helpers/m6a-model-content';
import { createPrimitive, MODEL_PANE, openModel, screenOf } from './helpers/m6a-model';
import { call, expectKernelStarted, run } from './helpers/test-api';

// E2E-MOD-27 (M6A-SPEC §10.1, §5.16; owner B13, gates b10, b11, b12a): a cylinder's live parameters edited from the
// Channel Box INPUTS primitive entry (B11) and Attributes › Primitive (B13), then frozen by the first component edit
// (a 10 px drag of the Move tool's `ty` handle on vertex 0).

const FROZEN = 'Primitive parameters were frozen by a component edit';

async function counts(page: Page, mesh: string): Promise<string> {
  const info = await call(page, 'meshInfo', mesh);
  return info === null ? 'none' : `${info.counts.v}/${info.counts.e}/${info.counts.f}`;
}

async function row(page: Page, mesh: string) {
  return (await call(page, 'meshes')).find((entry) => entry.id === mesh);
}

async function hoverPersp(page: Page): Promise<void> {
  const pane = (await call(page, 'panes')).find((entry) => entry.id === MODEL_PANE);
  if (pane === undefined) throw new Error('no persp pane');
  await page.mouse.move(pane.rect.x + pane.rect.w / 2, pane.rect.y + pane.rect.h / 2);
}

test.fixme('b10, b11, b12a: E2E-MOD-27 — primitive parameters and freeze', async ({ page }) => {
  await openModel(page);
  await expectKernelStarted(page);
  const cylinder = await createPrimitive(page, 'cylinder');

  // Channel Box › INPUTS, the primitive entry: 10 around.
  await page
    .locator('.dv-tab', { hasText: /^Channel Box$/ })
    .first()
    .click();
  await expect(page.getByTestId('cb-inputs')).toContainText('cylinder (primitive)');
  const axis = page.getByTestId('cb-prim-field-subdivisionsAxis');
  await axis.click();
  await axis.fill('10');
  await axis.press('Enter');
  await expect.poll(() => counts(page, cylinder)).toBe('20/30/12');
  expect(await row(page, cylinder)).toMatchObject({ id: cylinder, badge: 'prim', generator: 'cylinder' });

  // Attributes › Primitive: two height segments.
  await page
    .locator('.dv-tab', { hasText: /^Attributes$/ })
    .first()
    .click();
  await setAttributeField(page, 'attr-prim-subdivisionsHeight', '2');
  await expect.poll(() => counts(page, cylinder)).toBe('30/50/22');

  // The first component edit freezes the parameters: vertex mode, vertex 0, Move, drag ty by 10 px.
  await hoverPersp(page);
  await page.keyboard.press('Digit1');
  await expect.poll(async () => (await call(page, 'state')).mode).toBe('vertex');
  const vertex = await screenOf(page, cylinder, 'vertex', 0);
  await page.mouse.click(vertex.x, vertex.y);
  await page.keyboard.press('KeyW');
  await expect.poll(() => call(page, 'screenOfManipulator', MODEL_PANE, 'ty')).not.toBeNull();
  const handle = await call(page, 'screenOfManipulator', MODEL_PANE, 'ty');
  if (handle === null) throw new Error('no ty handle');
  await page.mouse.move(handle.x, handle.y);
  await page.mouse.down();
  await page.mouse.move(handle.x, handle.y - 5, { steps: 2 });
  await page.mouse.move(handle.x, handle.y - 10, { steps: 2 });
  await page.mouse.up();

  await expect.poll(async () => (await row(page, cylinder))?.badge).toBe('edit');
  expect((await row(page, cylinder))?.generator).toBeNull();
  await expect(page.locator('[data-testid^="attr-prim-"]')).toHaveCount(0);
  await expect(page.locator('[data-testid^="cb-prim-"]')).toHaveCount(0);
  const refused = await run(page, 'mesh.primitive.set', { mesh: cylinder, params: { subdivisionsAxis: 12 } });
  expect(refused).toMatchObject({ status: 'cancelled', reason: FROZEN });
});
