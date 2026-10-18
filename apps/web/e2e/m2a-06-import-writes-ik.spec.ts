import { expect, test } from '@playwright/test';
import { exportOne } from './helpers/g4-export';
import {
  boneWorlds,
  controlIdOf,
  DEG,
  distance,
  gateOnA1,
  quatAngle,
  sub,
  toastTexts,
  type World,
} from './helpers/m2a-a2';
import { seedSample } from './helpers/seed';
import { call, expectKernelStarted, loadFile, openEditor, runOk } from './helpers/test-api';

// E2E-M2A-06 (M2A-SPEC §9.1, §5.8): a VRMA of FK leg animation imports onto Polybot as IK keys for the left leg
// (a clean hinge) while the right leg — a 5° hyperextended knee — stays FK for the clip with one @ikFk key 0 and a
// warning; the same file on an FK-only Polybot gives FK curves; both characters' legs agree.
const FRAMES = [0, 5, 10, 15, 20] as const;
const BONES = ['hips', 'leftLowerLeg', 'leftFoot', 'rightUpperLeg', 'rightLowerLeg', 'rightFoot'] as const;

test('E2E-M2A-06: import writes IK', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page, '&platform=mac');
  await expectKernelStarted(page);
  const seed = await seedSample(page, 'seed-san');
  await gateOnA1(page);
  await runOk(page, 'clip.new', { name: 'steps' });
  const steps = (await call(page, 'state')).activeClip ?? '';
  for (const limb of ['leg.L', 'leg.R']) await runOk(page, 'rig.ikFk.switch', { limb, to: 'fk', key: 'none' });
  const key = async (control: string, frames: readonly (readonly [number, number])[]) => {
    for (const [frame, degrees] of frames) {
      await runOk(page, 'time.setFrame', { frame });
      await runOk(page, 'channel.setValues', {
        edits: [{ control, channel: 'rx', value: degrees * DEG }],
        key: 'force',
      });
    }
  };
  await key(await controlIdOf(page, 'fk.upperLeg.L'), [
    [0, 30],
    [10, -20],
    [20, 30],
  ]);
  await key(await controlIdOf(page, 'fk.lowerLeg.L'), [
    [0, 0],
    [10, 40],
    [20, 0],
  ]);
  await key(await controlIdOf(page, 'fk.upperLeg.R'), [[0, 10]]);
  await key(await controlIdOf(page, 'fk.lowerLeg.R'), [[0, -5]]);
  const vrma = await exportOne(page, { kind: 'vrma', character: seed.character, clips: [steps] });

  // Polybot with the default rig (legs IK).
  const bot = await seedSample(page, 'polybot');
  await loadFile(page, 'steps.vrma', vrma.bytes, { auto: true, importOptions: { reduce: null } });
  await expect.poll(async () => (await call(page, 'clips', bot.character)).some((c) => c.name === 'steps')).toBe(true);
  await expect.poll(async () => (await toastTexts(page)).some((text) => text.includes('R Leg kept FK'))).toBe(true);
  const botClip = (await call(page, 'state')).activeClip ?? '';
  const curves = async (key: string, character: string, clip: string) => {
    const id = await controlIdOf(page, key, character);
    return (await call(page, 'curves', clip, id)).filter((curve) => curve.keys.length > 0);
  };
  const channels = async (key: string, character: string, clip: string) =>
    (await curves(key, character, clip)).map((curve) => curve.channel).sort();
  expect(await channels('ik.leg.L', bot.character, botClip)).toEqual(
    expect.arrayContaining(['rx', 'ry', 'rz', 'tx', 'ty', 'tz']),
  );
  expect(await channels('pole.leg.L', bot.character, botClip)).toEqual(['tx', 'ty', 'tz']);
  for (const fk of ['fk.upperLeg.L', 'fk.lowerLeg.L', 'fk.foot.L']) {
    expect([fk, await channels(fk, bot.character, botClip)]).toEqual([fk, []]);
  }
  expect(await channels('fk.upperLeg.R', bot.character, botClip)).toEqual(expect.arrayContaining(['rx']));
  expect(await channels('fk.lowerLeg.R', bot.character, botClip)).toEqual(expect.arrayContaining(['rx']));
  const rightIkFk = (await curves('ik.leg.R', bot.character, botClip)).find((curve) => curve.channel === '@ikFk');
  expect(rightIkFk?.keys.map((k) => k.v)).toEqual([0]);

  // Polybot 2 with FK limbs only.
  await runOk(page, 'prefs.set', { patch: { autoRigIk: { legs: false, arms: false } } });
  const bot2 = await seedSample(page, 'polybot');
  await loadFile(page, 'steps.vrma', vrma.bytes, { auto: true, importOptions: { reduce: null } });
  await expect.poll(async () => (await call(page, 'clips', bot2.character)).some((c) => c.name === 'steps')).toBe(true);
  const bot2Clip = (await call(page, 'state')).activeClip ?? '';
  expect(await call(page, 'limbs', bot2.character)).toEqual([]);
  expect(await channels('fk.upperLeg.L', bot2.character, bot2Clip)).toEqual(expect.arrayContaining(['rx']));

  // Hips-relative foot and knee positions agree (1e-4 m), foot rotations (1e-3 rad), and no right-leg bone twists.
  for (const frame of FRAMES) {
    const a = await boneWorlds(page, bot.character, BONES, frame);
    const b = await boneWorlds(page, bot2.character, BONES, frame);
    const fromHips = (w: Record<string, World>, bone: string) =>
      sub(w[bone]?.t ?? [0, 0, 0], w['hips']?.t ?? [0, 0, 0]);
    for (const bone of ['leftLowerLeg', 'leftFoot', 'rightLowerLeg', 'rightFoot']) {
      expect(distance(fromHips(a, bone), fromHips(b, bone)), `${bone} @${frame}`).toBeLessThanOrEqual(1e-4);
    }
    for (const bone of ['leftFoot', 'rightFoot']) {
      expect(
        quatAngle(a[bone]?.q ?? [0, 0, 0, 1], b[bone]?.q ?? [0, 0, 0, 1]),
        `${bone} rotation @${frame}`,
      ).toBeLessThanOrEqual(1e-3);
    }
    for (const bone of ['rightUpperLeg', 'rightLowerLeg', 'rightFoot']) {
      expect(
        quatAngle(a[bone]?.q ?? [0, 0, 0, 1], b[bone]?.q ?? [0, 0, 0, 1]),
        `${bone} twist @${frame}`,
      ).toBeLessThanOrEqual(1e-3);
    }
  }
});
