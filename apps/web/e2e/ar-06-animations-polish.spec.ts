// AR-D8-9 (Auto-Rig acceptance fix round 1, D8): ④ and ⑤'s small defects. The zero-clip status is a whole sentence;
// a mirrored or in-place clip says so on its row; ↓ from the search goes to the results (past the category chips);
// ⑤ names the GLB of a character without clips "GLB (rigged, no animations)".
import { expect, test } from '@playwright/test';
import { addClip, onStep, primary } from './helpers/ar-as';
import { animationsWithCubeLad, clipNamed } from './helpers/ar-animations';

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
