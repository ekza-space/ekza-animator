import { expect, test } from '@playwright/test';
import { drag } from './helpers/g1-viewport';
import { firstPane, previewClip } from './helpers/m6b-clip-library';
import { RIG_FRONT_PANE } from './helpers/m6b-rig';
import { jointAt, toolKey } from './helpers/m6b-skeleton-ui';
import { boundCubeLad } from './helpers/m6b-skin-ui';
import { call, expectKernelStarted, openEditor, runOk } from './helpers/test-api';

// E2E-LIB-03 (M6B-SPEC §0.7, §0.4.7; C12): the library on a rigged model. The bound Cube Lad in Rig & Skin; the Rig
// Toolkit's Clip Library section previews Idle (badge `PREVIEW Idle`); a test-pose write (`E` on a joint, a drag of its
// joint) stops it; Use Clip Run → the clip "Run" with slot `run` (one undo step).
// Gates (§9.0, §3 rule 4): c1 (model characters), c2 (Quick Rig kernel), c3 (Quick Rig UI), c4 (Bind Skin),
// c7 (Rig Toolkit frame, test pose). Merged; INT runs it ungated.

test('E2E-LIB-03: library on a rigged model', async ({ page }) => {
  await openEditor(page);
  await expectKernelStarted(page);
  // The bound Cube Lad (Create Skeleton with the truth markers, Bind Skin with the defaults; C6's helper).
  const { character, joint } = await boundCubeLad(page);
  expect(character).not.toBe('');

  // The Toolkit's Clip Library section (collapsed until opened) previews Idle; the badge shows in Rig & Skin.
  await expect(page.getByTestId('rtk-section-library')).toBeVisible();
  await page.getByTestId('rtk-library-open').click();
  await expect(page.getByTestId('clip-card-idle')).toBeVisible({ timeout: 15_000 });
  const pane = await firstPane(page);
  await page.getByTestId('clip-play-idle').click();
  await expect.poll(() => previewClip(page)).toBe('idle');
  await expect(page.getByTestId(`hud-badge-preview-${pane}`)).toHaveText('PREVIEW Idle');

  // A test pose on a joint (Skeleton mode, `E`, then a drag of the bound joint: the §5.7 gesture) stops the preview.
  await runOk(page, 'rig.mode', { mode: 'skeleton' });
  const elbow = joint('leftLowerArm');
  await toolKey(page, 'KeyE', RIG_FRONT_PANE);
  await drag(page, await jointAt(page, elbow, RIG_FRONT_PANE), { dx: -2, dy: 20 });
  await expect.poll(async () => (await call(page, 'rigState')).poseView).toBe('test');
  await expect.poll(() => previewClip(page)).toBeNull();

  // Use Clip Run: one step, slot run.
  await page.getByTestId('clip-use-run').click();
  await expect.poll(async () => (await call(page, 'history')).undo.at(-1)).toBe('Use Clip Run');
  const run = (await call(page, 'clips', character)).find((clip) => clip.name === 'Run');
  expect(run?.loop).toBe(true);
});
