import { expect, test } from '@playwright/test';
import { pressOverPane } from './helpers/g3-input';
import {
  boneWorlds,
  controlIdOf,
  DEG,
  expectWorldClose,
  gateOnA1,
  keysOn,
  selectIds,
  type World,
} from './helpers/m2a-a2';
import { seedSample } from './helpers/seed';
import { call, expectKernelStarted, openEditor, runOk } from './helpers/test-api';

// E2E-M2A-03 (M2A-SPEC §9.1, §5.6): Seed-san's left leg is keyed in IK at 0 and 10; a seamless IK → FK switch at 10
// from the Attributes Limb section keys @ikFk at 9 (1) and 10 (0), both stepped, and keeps the pose at 9 and 10;
// a keyed FK → IK switch at 15 adds {15: 1} and keeps the pose; one undo per switch restores the curves.

const CHAIN = ['leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'leftToes'] as const;

test('E2E-M2A-03: seamless IK → FK switch', async ({ page }) => {
  await openEditor(page, '&platform=mac');
  await expectKernelStarted(page);
  const { character } = await seedSample(page, 'seed-san');
  await gateOnA1(page);
  // A fresh clip, so the sample's own clips do not take part.
  await runOk(page, 'clip.new', { name: 'switch' });
  const clip = (await call(page, 'state')).activeClip ?? '';
  const ikLeg = await controlIdOf(page, 'ik.leg.L');
  const upperLeg = await controlIdOf(page, 'fk.upperLeg.L');
  await selectIds(page, [ikLeg]);
  await runOk(page, 'time.setFrame', { frame: 0 });
  await runOk(page, 'key.set');
  await runOk(page, 'time.setFrame', { frame: 10 });
  await runOk(page, 'channel.setValues', {
    edits: [
      { control: ikLeg, channel: 'tx', value: 0.1 },
      { control: ikLeg, channel: 'ty', value: 0.05 },
      { control: ikLeg, channel: 'tz', value: 0.15 },
      { control: ikLeg, channel: 'rx', value: 20 * DEG },
    ],
  });
  await runOk(page, 'key.set');
  // key.set 'all' skips the keyAll: false @ikFk (§5.1 rule 4).
  expect(await keysOn(page, ikLeg, '@ikFk')).toEqual([]);
  const at9 = await boneWorlds(page, character, CHAIN, 9);
  const at10 = await boneWorlds(page, character, CHAIN, 10);
  const curvesBefore = await call(page, 'curves', clip);

  await runOk(page, 'workspace.showPanel', { panel: 'attributes' });
  await expect(page.getByTestId('attr-limb-leg.L')).toBeVisible();
  await page.getByTestId('attr-limb-key-mode').selectOption('seamless');
  await page.getByTestId('attr-limb-mode-fk-leg.L').click();
  await expect.poll(async () => (await call(page, 'state')).history.undoLabel).toBe('Switch L Leg to FK');

  const ikFkKeys = async () =>
    (await keysOn(page, ikLeg, '@ikFk')).map((key) => ({ t: key.t, v: key.v, outType: key.outType }));
  expect(await ikFkKeys()).toEqual([
    { t: 9, v: 1, outType: 'step' },
    { t: 10, v: 0, outType: 'step' },
  ]);
  const same = (actual: Record<string, World>, expected: Record<string, World>, what: string) => {
    for (const bone of CHAIN)
      expectWorldClose(actual[bone] as World, expected[bone] as World, 1e-6, `${what}: ${bone}`);
  };
  same(await boneWorlds(page, character, CHAIN, 9), at9, 'frame 9 after the switch');
  same(await boneWorlds(page, character, CHAIN, 10), at10, 'frame 10 after the switch');
  const visible = async () =>
    Object.fromEntries((await call(page, 'controls')).map((control) => [control.id, control.visible]));
  // At 10 the leg is FK: the FK thigh shows, the (selected) IK foot does not.
  expect((await visible())[upperLeg]).toBe(true);
  expect((await visible())[ikLeg]).toBe(false);
  await runOk(page, 'time.setFrame', { frame: 9 });
  expect((await visible())[upperLeg]).toBe(false);
  expect((await visible())[ikLeg]).toBe(true);

  // Back to IK at 15 with key mode 'key'.
  await runOk(page, 'time.setFrame', { frame: 15 });
  const at15 = await boneWorlds(page, character, CHAIN);
  const curvesMiddle = await call(page, 'curves', clip);
  await page.getByTestId('attr-limb-key-mode').selectOption('key');
  await page.getByTestId('attr-limb-mode-ik-leg.L').click();
  await expect.poll(async () => (await call(page, 'state')).history.undoLabel).toBe('Switch L Leg to IK');
  expect(await ikFkKeys()).toEqual([
    { t: 9, v: 1, outType: 'step' },
    { t: 10, v: 0, outType: 'step' },
    { t: 15, v: 1, outType: 'step' },
  ]);
  same(await boneWorlds(page, character, CHAIN), at15, 'frame 15 after switching back');

  // One undo per switch restores the curves.
  await pressOverPane(page, 'Meta+KeyZ');
  await expect.poll(() => call(page, 'curves', clip)).toEqual(curvesMiddle);
  await pressOverPane(page, 'Meta+KeyZ');
  await expect.poll(() => call(page, 'curves', clip)).toEqual(curvesBefore);
});
