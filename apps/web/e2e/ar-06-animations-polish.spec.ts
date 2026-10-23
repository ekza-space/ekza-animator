// AR-D8-9 (Auto-Rig acceptance fix round 1, D8): ④ and ⑤'s small defects. The zero-clip status is a whole sentence;
// a mirrored or in-place clip says so on its row; ↓ from the search goes to the results (past the category chips);
// ⑤ names the GLB of a character without clips "GLB (rigged, no animations)".
import { expect, test } from '@playwright/test';
import { addClip, onStep, primary } from './helpers/ar-as';
import { animationsWithCubeLad, clipNamed, waitForAnimations } from './helpers/ar-animations';
import { chooseFile, fixtureBytes } from './helpers/ar-model';

test('④: the zero-clip status, the mirror and in-place marks, ↓ from the search; ⑤ names a clipless GLB', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const character = await animationsWithCubeLad(page);
  await expect(page.getByTestId('ar-status')).toHaveText(
    'No animations — the VRM still works in OMOBA, which plays its own motion library.',
  );
  // ⑤ with no clips: the GLB is not "with animations"
  await primary(page, /Export|Skip/);
  await onStep(page, 'export');
  await expect(page.getByTestId('ar-export-target-glb')).toContainText('GLB (rigged, no animations)');
  await page.keyboard.press('Alt+Digit4');
  await onStep(page, 'animations');
  // ↓ from the search focuses a card of the results
  await page.getByTestId('ar-anim-search').fill('walk');
  await page.getByTestId('ar-anim-search').press('ArrowDown');
  await expect(page.locator('[data-testid="ar-anim-grid"] [data-clip]:focus')).toHaveCount(1);
  await expect(page.locator(':focus')).toHaveAttribute('data-clip', 'walk');
  // a mirrored, in-place Walk says so on its row
  await addClip(page, { id: 'walk', name: 'Walk', search: 'walk' }, { mirror: true, inPlace: true });
  const walk = await clipNamed(page, character, 'Walk');
  await expect(page.getByTestId(`ar-char-clip-mirror-${walk.id}`)).toHaveText('⇄ mirrored');
  await expect(page.getByTestId(`ar-char-clip-inplace-${walk.id}`)).toHaveText('in place');
  await primary(page, /Export/);
  await onStep(page, 'export');
  await expect(page.getByTestId('ar-export-target-glb')).toContainText('GLB with animations');
});

test('AR-D9-4/5/8/9: the count follows the search, a slotless clip says so, ▶ of an added clip closes the preview, no controls, a new model starts unselected', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const character = await animationsWithCubeLad(page);
  // AR-D9-8: ④ draws the character without the rig's controls (a hidden control has no screen point)
  const neck = await page.evaluate(
    () => window.__EKZA_STUDIO_TEST__?.controls().find((control) => control.key === 'fk.neck')?.id ?? null,
  );
  expect(neck).not.toBeNull();
  await expect
    .poll(() => page.evaluate((id) => window.__EKZA_STUDIO_TEST__?.screenOfControl(id as string, 'pane-persp'), neck))
    .toBeNull();
  // AR-D9-9: the count follows the search; a card without a slot says so before Add
  const count = page.getByTestId('ar-anim-count');
  await expect(count).toContainText(/^14 clips/);
  await page.getByTestId('ar-anim-search').fill('walk');
  await expect(count).toContainText(/^1 of 14 clips/);
  await page.getByTestId('ar-anim-search').fill('punch');
  await expect(page.getByTestId('ar-clip-noslot-punch')).toHaveText('no slot');
  await addClip(page, { id: 'punch', name: 'Punch', search: 'punch' });
  await expect(page.getByTestId('ar-status')).toContainText('Added Punch without a slot');
  // AR-D9-5: ▶ of the added clip plays it and closes the library preview's panel (it named another clip)
  await addClip(page, { id: 'walk', name: 'Walk', search: 'walk' });
  await expect(page.getByTestId('ar-anim-preview')).toHaveAttribute('data-clip', 'walk');
  const punch = await clipNamed(page, character, 'Punch');
  await page.getByTestId(`ar-char-clip-play-${punch.id}`).click();
  await expect(page.getByTestId(`ar-char-clip-play-${punch.id}`)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('ar-anim-preview')).toHaveCount(0);
  // AR-D9-4: preview Dance, then ⋯ › New and another model: ④ opens with no clip selected
  await page.getByTestId('ar-anim-search').fill('');
  await page.getByTestId('ar-clip-card-dance').click();
  await expect(page.getByTestId('ar-anim-preview')).toHaveAttribute('data-clip', 'dance');
  await page.getByTestId('ar-more').click();
  await page.getByRole('menuitem', { name: 'New', exact: true }).click();
  const discard = page.getByRole('button', { name: /Discard|Start new|New/ }).last();
  if (await discard.isVisible().catch(() => false)) await discard.click();
  await onStep(page, 'model');
  await chooseFile(page, 'polybot.vrm', fixtureBytes('polybot.vrm'));
  await onStep(page, 'animations');
  await waitForAnimations(page);
  await expect(page.getByTestId('ar-anim-preview')).toHaveCount(0);
  await expect(page.getByText('Pick an animation to preview it on your character.')).toBeVisible();
  await expect(page.locator('[data-testid^="ar-clip-card-"][aria-pressed="true"]')).toHaveCount(0);
});
