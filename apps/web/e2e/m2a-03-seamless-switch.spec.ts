import { expect, test } from '@playwright/test';
import { pressOverPane } from './helpers/g3-input';
import {
  boneWorlds,
  controlIdOf,
  DEG,
  distance,
  expectWorldClose,
  expectLimbIk,
  keysOn,
  quatAngle,
  selectIds,
  toastTexts,
  type World,
} from './helpers/m2a-a2';
import { seedSample } from './helpers/seed';
import { call, expectKernelStarted, openEditor, run, runOk } from './helpers/test-api';

// E2E-M2A-03 (M2A-SPEC §9.1, §5.6): Seed-san's left leg is keyed in IK at 0 and 10; a seamless IK → FK switch at 10
// from the Attributes Limb section keys @ikFk at 9 (1) and 10 (0), both stepped, and keeps the pose at 9 and 10;
// a keyed FK → IK switch at 15 adds {15: 1} and keeps the pose; one undo per switch restores the curves.
// The second case adds a ball roll and an animated fk.toes (A2 fix round: the switch holds the matched channels at
// f − 1, so every earlier frame keeps its pose; at f the chain and the toes' rotation match, and a toes joint that
// FK cannot keep is reported with its move). The first case also clicks the pressed IK segment: nothing changes.

const CHAIN = ['leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'leftToes'] as const;

test('E2E-M2A-03: seamless IK → FK switch', async ({ page }) => {
  await openEditor(page, '&platform=mac');
  await expectKernelStarted(page);
  const { character } = await seedSample(page, 'seed-san');
  await expectLimbIk(page);
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
  const same = (actual: Record<string, World>, expected: Record<string, World>, what: string) => {
    for (const bone of CHAIN)
      expectWorldClose(actual[bone] as World, expected[bone] as World, 1e-6, `${what}: ${bone}`);
  };

  await runOk(page, 'workspace.showPanel', { panel: 'attributes' });
  await expect(page.getByTestId('attr-limb-leg.L')).toBeVisible();
  await page.getByTestId('attr-limb-key-mode').selectOption('seamless');
  // The leg is IK: the pressed IK segment does nothing (a switch to the current mode would match the IK foot to
  // the rest FK chain and move it), and Rig › IK/FK › Switch L Leg to IK is disabled with the reason.
  const undoBefore = (await call(page, 'state')).history.undoLabel;
  await expect(page.getByTestId('attr-limb-mode-ik-leg.L')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('attr-limb-mode-ik-leg.L').click();
  expect((await call(page, 'state')).history.undoLabel).toBe(undoBefore);
  expect(await call(page, 'curves', clip)).toEqual(curvesBefore);
  same(await boneWorlds(page, character, CHAIN, 10), at10, 'frame 10 after a click on the pressed IK segment');
  expect(await run(page, 'rig.ikFk.switch', { limb: 'leg.L', to: 'ik' })).toEqual({
    status: 'cancelled',
    reason: 'L Leg is IK already',
  });
  await page.getByTestId('menu-rig').click();
  await page.getByTestId('menu-sub-rig.ik-fk').click();
  const toIk = page.getByTestId('menu-item-builtin.rig.ik-fk.leg.L.toIk');
  await expect(toIk).toHaveAttribute('aria-disabled', 'true');
  await expect(toIk).toHaveAttribute('title', 'L Leg is IK already');
  await expect(page.getByTestId('menu-item-builtin.rig.ik-fk.leg.L.toFk')).not.toHaveAttribute('aria-disabled', 'true');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('menu-sub-rig.ik-fk')).toHaveCount(0);
  await page.getByTestId('attr-limb-mode-fk-leg.L').click();
  await expect.poll(async () => (await call(page, 'state')).history.undoLabel).toBe('Switch L Leg to FK');

  const ikFkKeys = async () =>
    (await keysOn(page, ikLeg, '@ikFk')).map((key) => ({ t: key.t, v: key.v, outType: key.outType }));
  expect(await ikFkKeys()).toEqual([
    { t: 9, v: 1, outType: 'step' },
    { t: 10, v: 0, outType: 'step' },
  ]);
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

test('E2E-M2A-03: a seamless switch with a ball roll and animated toes keeps every frame before f', async ({
  page,
}) => {
  await openEditor(page, '&platform=mac');
  await expectKernelStarted(page);
  const { character } = await seedSample(page, 'seed-san');
  await expectLimbIk(page);
  await runOk(page, 'clip.new', { name: 'roll' });
  const ikLeg = await controlIdOf(page, 'ik.leg.L');
  const toes = await controlIdOf(page, 'fk.toes.L');
  // fk.toes.L rx 0° / 30° at 0 / 20: under IK the toes rule reads that curve, so it shapes the IK frames too.
  for (const [frame, degrees] of [
    [0, 0],
    [20, 30],
  ] as const) {
    await runOk(page, 'time.setFrame', { frame });
    await runOk(page, 'channel.setValues', {
      edits: [{ control: toes, channel: 'rx', value: degrees * DEG }],
      key: 'force',
    });
  }
  await selectIds(page, [ikLeg]);
  await runOk(page, 'time.setFrame', { frame: 0 });
  await runOk(page, 'key.set');
  await runOk(page, 'time.setFrame', { frame: 10 });
  await runOk(page, 'channel.setValues', {
    edits: [
      { control: ikLeg, channel: 'ty', value: 0.05 },
      { control: ikLeg, channel: 'tz', value: 0.1 },
      { control: ikLeg, channel: '@roll', value: 20 * DEG },
    ],
  });
  await runOk(page, 'key.set');
  const frames = [0, 5, 9] as const;
  const before = await Promise.all(frames.map((frame) => boneWorlds(page, character, CHAIN, frame)));
  const at10 = await boneWorlds(page, character, CHAIN, 10);

  await runOk(page, 'workspace.showPanel', { panel: 'attributes' });
  await page.getByTestId('attr-limb-key-mode').selectOption('seamless');
  await page.getByTestId('attr-limb-mode-fk-leg.L').click();
  await expect.poll(async () => (await call(page, 'state')).history.undoLabel).toBe('Switch L Leg to FK');

  for (const [i, frame] of frames.entries()) {
    const after = await boneWorlds(page, character, CHAIN, frame);
    for (const bone of CHAIN) {
      expectWorldClose(after[bone] as World, before[i]?.[bone] as World, 1e-6, `frame ${frame}: ${bone}`);
    }
  }
  // At 10 the chain and the toes' rotation match; the toes joint stays on the foot in FK, so it moves by the
  // offset of the ball pivot, which the switch reports.
  const after10 = await boneWorlds(page, character, CHAIN, 10);
  for (const bone of ['leftUpperLeg', 'leftLowerLeg', 'leftFoot'] as const) {
    expectWorldClose(after10[bone] as World, at10[bone] as World, 1e-6, `frame 10: ${bone}`);
  }
  const toesBefore = at10['leftToes'] as World;
  const toesAfter = after10['leftToes'] as World;
  expect(quatAngle(toesAfter.q, toesBefore.q), 'frame 10: leftToes rotation').toBeLessThanOrEqual(1e-6);
  // Whether the toes joint can stay under a ball roll is open (A2 notes, open issue 1: the ball pivot lies off the
  // toes joint on Seed-san, 5.4 mm at 20° with A1's toes rule). Either way the switch reports a move above 0.1 mm
  // with its size and says nothing when the joint stays.
  const moved = distance(toesAfter.t, toesBefore.t);
  const toesWarning = 'L Leg: FK moves the toes by';
  if (moved > 1e-4) {
    await expect
      .poll(async () => (await toastTexts(page)).join('\n'))
      .toContain(`${toesWarning} ${(moved * 1000).toFixed(1)} mm (foot roll)`);
  } else {
    expect((await toastTexts(page)).join('\n')).not.toContain(toesWarning);
  }
});
