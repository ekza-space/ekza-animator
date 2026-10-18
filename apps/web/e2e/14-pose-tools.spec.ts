import { expect, test } from '@playwright/test';
import { clickFrame, clickOutlinerRow, DEG, expectChannelsClose, pressOverPane } from './helpers/g3-input';
import { controlId, seedSample } from './helpers/seed';
import { call, expectKernelStarted, openEditor, runOk } from './helpers/test-api';

// E2E-14 (MVP-SPEC §6.2; §4.11.2, §4.11.20): copy the left arm's pose at frame 15, paste it at frame 40, flip it
// with Alt+M (the selection expands to the mirror pairs) and reset the upper arm to rest.

type Channels = Record<string, number>;
type Pose = Readonly<Record<string, readonly [number, number, number]>>;

/** Mirror of a world-aligned humanoid control's channels (§4.11.20): rx, −ry, −rz and −tx, ty, tz. */
function mirror(values: Channels): Channels {
  const out: Channels = {};
  for (const [channel, value] of Object.entries(values)) {
    out[channel] = channel === 'tx' || channel === 'ry' || channel === 'rz' ? 0 - value : value;
  }
  return out;
}

const ARM_KEYS = ['fk.upperArm.L', 'fk.lowerArm.L', 'fk.upperArm.R', 'fk.lowerArm.R'] as const;

// A non-symmetric arm pose at frame 15 and another left-arm pose at frame 40 (rx, ry, rz in degrees).
const POSE_15: Pose = {
  'fk.upperArm.L': [10, 20, 30],
  'fk.lowerArm.L': [5, -25, 40],
  'fk.upperArm.R': [-5, 15, -50],
  'fk.lowerArm.R': [8, 10, -20],
};
const POSE_40: Pose = {
  'fk.upperArm.L': [-20, 5, 60],
  'fk.lowerArm.L': [0, 12, 10],
};

test('E2E-14: pose tools', async ({ page }) => {
  await openEditor(page, '&platform=mac');
  await expectKernelStarted(page);
  await seedSample(page, 'polybot');
  const id: Record<string, string> = {};
  for (const key of ARM_KEYS) id[key] = await controlId(page, key);

  // Seed the pose: rotation keys at 15 on both arms and at 40 on the left arm.
  for (const [frame, pose] of [
    [15, POSE_15],
    [40, POSE_40],
  ] as const) {
    const keys = Object.keys(pose);
    await runOk(page, 'time.setFrame', { frame });
    await runOk(page, 'select.controls', { ids: keys.map((key) => id[key]), mode: 'replace' });
    await runOk(page, 'channel.setValues', {
      edits: keys.flatMap((key) =>
        (['rx', 'ry', 'rz'] as const).map((channel, axis) => ({
          control: id[key],
          channel,
          value: (pose[key]?.[axis] ?? 0) * DEG,
        })),
      ),
    });
    await runOk(page, 'key.set', { channels: 'rotate' });
  }
  const values = async (key: string, frame?: number): Promise<Channels> =>
    frame === undefined
      ? call(page, 'channelValues', id[key] ?? '')
      : call(page, 'channelValues', id[key] ?? '', frame);

  // Select the left upper and lower arm in the Outliner (click, then Shift+click adds).
  const upperL = id['fk.upperArm.L'] ?? '';
  const lowerL = id['fk.lowerArm.L'] ?? '';
  await clickOutlinerRow(page, upperL);
  await clickOutlinerRow(page, lowerL, ['Shift']);
  await expect.poll(async () => (await call(page, 'state')).selection.controls).toEqual([upperL, lowerL]);

  // Mod+C at 15.
  await clickFrame(page, 15);
  const copied = { upper: await values('fk.upperArm.L'), lower: await values('fk.lowerArm.L') };
  expect(copied.upper['rz']).toBeCloseTo(30 * DEG, 12);
  await pressOverPane(page, 'Meta+KeyC');

  // Frame 40: another pose; Mod+V pastes the copied one onto the selected controls.
  await clickFrame(page, 40);
  expect((await values('fk.upperArm.L'))['rz']).toBeCloseTo(60 * DEG, 12);
  await pressOverPane(page, 'Meta+KeyV');
  await expect.poll(async () => (await call(page, 'state')).history.undoLabel).toBe('Paste Pose');
  expectChannelsClose(await values('fk.upperArm.L'), copied.upper, 0, 'pasted upper arm');
  expectChannelsClose(await values('fk.lowerArm.L'), copied.lower, 0, 'pasted lower arm');
  expect((await call(page, 'state')).clipFrame).toBe(40);

  // Alt+M flips the selected controls with their mirror pairs.
  const before: Record<string, Channels> = {};
  for (const key of ARM_KEYS) before[key] = await values(key);
  await pressOverPane(page, 'Alt+KeyM');
  await expect.poll(async () => (await call(page, 'state')).history.undoLabel).toBe('Flip Pose');
  for (const part of ['upperArm', 'lowerArm']) {
    const left = `fk.${part}.L`;
    const right = `fk.${part}.R`;
    expectChannelsClose(await values(right), mirror(before[left] ?? {}), 1e-9, `${right} = mirror(${left} before)`);
    expectChannelsClose(await values(left), mirror(before[right] ?? {}), 1e-9, `${left} = mirror(${right} before)`);
  }
  // The flip changed the pose (the arms were not symmetric).
  expect(
    Math.abs(((await values('fk.upperArm.L'))['rz'] ?? 0) - (before['fk.upperArm.L']?.['rz'] ?? 0)),
  ).toBeGreaterThan(0.1);

  // pose.resetToRest on fk.upperArm.L: back to 0; the lower arm keeps its flipped pose.
  const lowerAfterFlip = await values('fk.lowerArm.L');
  await runOk(page, 'pose.resetToRest', { controls: [upperL] });
  const reset = await values('fk.upperArm.L');
  expect(Object.keys(reset).length).toBeGreaterThan(0);
  for (const [channel, value] of Object.entries(reset)) {
    expect(value, channel).toBe(channel.startsWith('s') ? 1 : 0);
  }
  expectChannelsClose(await values('fk.lowerArm.L'), lowerAfterFlip, 0, 'lower arm after the reset');
});
