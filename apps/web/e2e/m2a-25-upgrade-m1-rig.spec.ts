import { expect, test } from '@playwright/test';
import { pressOverPane } from './helpers/g3-input';
import { boneWorlds, controlIdOf, DEG, expectWorldClose, selectIds, toastTexts, type World } from './helpers/m2a-a2';
import { seedSample } from './helpers/seed';
import { call, expectKernelStarted, openEditor, runOk } from './helpers/test-api';

// E2E-M2A-25 (M2A-SPEC §9.1, §5.7): an FK-only Polybot (autoRigIk off, like an M1 rig) says once that Add Limb IK
// exists; Attributes › Add Limb IK adds four limbs in FK (ikFk 0), the animation stays bit for bit; undo removes the
// records, redo restores them.
// Polybot has no toe bones.
const LEG = ['hips', 'leftUpperLeg', 'leftLowerLeg', 'leftFoot'] as const;
const FK_ONLY = 'This rig has FK limbs only';

test('E2E-M2A-25: upgrade an M1 rig', async ({ page }) => {
  await openEditor(page, '&platform=mac');
  await expectKernelStarted(page);
  await runOk(page, 'prefs.set', { patch: { autoRigIk: { legs: false, arms: false } } });
  const { character } = await seedSample(page, 'polybot');
  expect(await call(page, 'limbs')).toEqual([]);
  const upperLeg = await controlIdOf(page, 'fk.upperLeg.L');
  await selectIds(page, [upperLeg]);
  await runOk(page, 'workspace.showPanel', { panel: 'attributes' });
  const add = page.getByTestId('attr-add-limb-ik');
  await expect(add).toBeVisible();
  await expect(add, 'A1: limb IK is available (rig.addLimbIk polls ok)').toBeEnabled();
  await expect.poll(async () => (await toastTexts(page)).filter((text) => text.includes(FK_ONLY)).length).toBe(1);

  for (const [frame, degrees] of [
    [0, 0],
    [10, 30],
  ] as const) {
    await runOk(page, 'time.setFrame', { frame });
    await runOk(page, 'channel.setValues', { edits: [{ control: upperLeg, channel: 'rx', value: degrees * DEG }] });
    await runOk(page, 'key.set', { channels: 'rotate' });
  }
  const worlds = async () => Promise.all([0, 5, 10].map((frame) => boneWorlds(page, character, LEG, frame)));
  const before = await worlds();
  await runOk(page, 'prefs.set', { patch: { autoRigIk: { legs: true, arms: true } } });
  const counts = await call(page, 'counts');

  await add.click();
  await expect.poll(async () => (await call(page, 'limbs')).length).toBe(4);
  expect((await call(page, 'limbs')).every((limb) => limb.ikFk === 0)).toBe(true);
  const after = await worlds();
  after.forEach((frame, i) => {
    for (const bone of LEG)
      expectWorldClose(frame[bone] as World, before[i]?.[bone] as World, 1e-9, `${bone} @${i * 5}`);
  });
  const visible = Object.fromEntries((await call(page, 'controls')).map((control) => [control.key, control.visible]));
  for (const key of ['fk.upperLeg.L', 'fk.lowerLeg.L', 'fk.foot.L', 'fk.upperArm.R'])
    expect([key, visible[key]]).toEqual([key, true]);
  expect((await toastTexts(page)).filter((text) => text.includes(FK_ONLY)).length).toBeLessThanOrEqual(1);

  await pressOverPane(page, 'Meta+KeyZ');
  await expect.poll(async () => (await call(page, 'limbs')).length).toBe(0);
  expect(await call(page, 'counts')).toEqual(counts);
  await pressOverPane(page, 'Shift+KeyZ');
  await expect.poll(async () => (await call(page, 'limbs')).length).toBe(4);
  expect((await call(page, 'counts'))['solvers']).toBe((counts['solvers'] ?? 0) + 4);
});
