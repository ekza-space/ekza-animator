import { expect, test } from '@playwright/test';
import { buildCubeLad } from './helpers/m6b-cube-lad';
import { firstPane, hoverViewport, previewClip } from './helpers/m6b-clip-library';
import { enterRig } from './helpers/m6b-rig';
import { call, expectKernelStarted, openEditor, runOk } from './helpers/test-api';

// E2E-LIB-03 (M6B-SPEC §0.7, §0.4.7; C12): the library on a rigged model. The bound Cube Lad in Rig & Skin; the Rig
// Toolkit's Clip Library section previews Idle (badge `PREVIEW Idle`); a test-pose write (`E` on a joint, a drag of its
// rotate ring) stops it; Use Clip Run → the clip "Run" with slot `run` (one undo step).
// Gates (§9.0, §3 rule 4): c1 (model characters), c2 (Quick Rig kernel), c3 (Quick Rig UI), c4 (Bind Skin),
// c7 (Rig Toolkit frame, test pose). INT drops the fixme when they have merged.

test('E2E-LIB-03: library on a rigged model', async ({ page }) => {
  test.fixme(true, 'gates c1, c2, c3, c4, c7: the Cube Lad is rigged and bound in Rig & Skin (C1/C2/C3/C4/C7)');
  await openEditor(page);
  await expectKernelStarted(page);
  await buildCubeLad(page);
  await enterRig(page);
  await runOk(page, 'skel.quickRig.start', {});
  await runOk(page, 'skel.quickRig.commit', {});
  await runOk(page, 'skin.bind', {});
  const character = (await call(page, 'state')).activeCharacter ?? '';
  expect(character).not.toBe('');

  // The Toolkit's Clip Library section (collapsed until opened) previews Idle; the badge shows in Rig & Skin.
  await expect(page.getByTestId('rtk-section-library')).toBeVisible();
  await page.getByTestId('rtk-library-open').click();
  await expect(page.getByTestId('clip-card-idle')).toBeVisible({ timeout: 15_000 });
  const pane = await firstPane(page);
  await page.getByTestId('clip-play-idle').click();
  await expect.poll(() => previewClip(page)).toBe('idle');
  await expect(page.getByTestId(`hud-badge-preview-${pane}`)).toHaveText('PREVIEW Idle');

  // A test pose on a joint (E, then a drag of the ring) stops the preview.
  const joints = (await call(page, 'skeleton', character))?.joints ?? [];
  const elbow = joints.find((joint) => joint.name === 'leftLowerArm' || joint.name.endsWith('LowerArm.L'));
  if (elbow === undefined) throw new Error('no left elbow joint');
  await runOk(page, 'select.joints', { ids: [elbow.id], mode: 'replace' });
  await hoverViewport(page);
  await page.keyboard.press('KeyE');
  const ring = await call(page, 'screenOfManipulator', pane, 'rz');
  if (ring === null) throw new Error('no rotate ring');
  await page.mouse.move(ring.x, ring.y);
  await page.mouse.down();
  await page.mouse.move(ring.x + 40, ring.y, { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => previewClip(page)).toBeNull();

  // Use Clip Run: one step, slot run.
  await page.getByTestId('clip-use-run').click();
  await expect.poll(async () => (await call(page, 'history')).undo.at(-1)).toBe('Use Clip Run');
  const run = (await call(page, 'clips', character)).find((clip) => clip.name === 'Run');
  expect(run?.loop).toBe(true);
});
