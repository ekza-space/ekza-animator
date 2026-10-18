import { expect, test } from '@playwright/test';
import { clickFrame, DEG, keysOf, pressOverPane, typeChannel } from './helpers/g3-input';
import { controlId, seedSample } from './helpers/seed';
import { call, fixmeIfKernelUnavailable, openEditor, runOk, type TestApi } from './helpers/test-api';

// E2E-15 (MVP-SPEC §6.2; §4.9 `clip.*`): a new clip `wave` with keys of its own, back to `clip1`, rename `wave` to
// `wave_01` and duplicate it in the Clips panel. Keys belong to one clip: `clip1` has none, the copy has its own.

test('E2E-15: clips', async ({ page }) => {
  await openEditor(page, '&platform=mac');
  await fixmeIfKernelUnavailable(page);
  const { character } = await seedSample(page, 'polybot');
  const clip1 = (await call(page, 'clips')).find((clip) => clip.name === 'clip1')?.id ?? '';
  expect(clip1).not.toBe('');

  const { clip: wave } = await runOk<{ clip: string }>(page, 'clip.new', { name: 'wave' });
  expect((await call(page, 'state')).activeClip).toBe(wave);

  // Key something in `wave`: fk.lowerArm.L rz 30° at 0 and −30° at 15 (Channel Box + S).
  const lowerArm = await controlId(page, 'fk.lowerArm.L');
  await runOk(page, 'select.controls', { ids: [lowerArm], mode: 'replace' });
  for (const [frame, degrees] of [
    [0, 30],
    [15, -30],
  ] as const) {
    await clickFrame(page, frame);
    await typeChannel(page, 'rz', degrees);
    await expect.poll(async () => (await call(page, 'channelValues', lowerArm)).rz ?? 0).toBeCloseTo(degrees * DEG, 9);
    await pressOverPane(page, 'KeyS');
  }
  await expect.poll(async () => (await keysOf(page, lowerArm, 'rz', wave)).map((key) => key.t)).toEqual([0, 15]);
  const waveCurves = await call(page, 'curves', wave);
  expect(waveCurves.length).toBeGreaterThan(0);

  // Switch to clip1 in the Clips panel: its curves are untouched.
  await runOk(page, 'workspace.showPanel', { panel: 'clips' });
  await page.getByTestId(`clips-row-${clip1}`).click();
  await expect.poll(async () => (await call(page, 'state')).activeClip).toBe(clip1);
  expect(await call(page, 'curves', clip1)).toEqual([]);
  expect((await call(page, 'channelValues', lowerArm)).rz).toBe(0);

  // Rename wave → wave_01 from its row menu (a double-click would also make it active), type, Enter.
  await page.getByTestId(`clips-row-${wave}`).click({ button: 'right' });
  await page.getByTestId('clips-menu-rename').click();
  const rename = page.getByTestId('clips-rename-input');
  await expect(rename).toBeFocused();
  await rename.fill('wave_01');
  await rename.press('Enter');
  await expect(page.getByTestId(`clips-name-${wave}`)).toHaveText('wave_01');
  expect((await call(page, 'state')).history.undoLabel).toBe('Rename Clip');
  // A rename is not a switch: clip1 stays active.
  expect((await call(page, 'state')).activeClip).toBe(clip1);

  // Duplicate wave_01 from its row menu; the panel opens the copy's name for editing, Esc keeps it.
  await page.getByTestId(`clips-row-${wave}`).click({ button: 'right' });
  await page.getByTestId('clips-menu-duplicate').click();
  await expect.poll(async () => (await call(page, 'clips')).length).toBe(3);
  const copy = (await call(page, 'clips')).find((clip) => clip.id !== clip1 && clip.id !== wave)?.id ?? '';
  await expect(page.getByTestId('clips-rename-input')).toBeFocused();
  await page.getByTestId('clips-rename-input').press('Escape');
  await expect(page.getByTestId(`clips-name-${copy}`)).toHaveText('wave_01 copy');

  // Names updated; 3 clips.
  expect((await call(page, 'clips', character)).map((clip) => clip.name)).toEqual(['clip1', 'wave_01', 'wave_01 copy']);
  expect((await call(page, 'counts'))['clips']).toBe(3);

  // Per-clip keys: the copy holds equal keys under new IDs; clip1 still has none.
  // Curves list in CurveId order: compare them by control and channel, without their IDs.
  const strip = (curves: ReturnType<TestApi['curves']>) =>
    curves
      .map(({ id: _curve, keys, ...curve }) => ({ ...curve, keys: keys.map(({ id: _key, ...key }) => key) }))
      .sort((a, b) => `${a.control} ${a.channel}`.localeCompare(`${b.control} ${b.channel}`));
  const copyCurves = await call(page, 'curves', copy);
  expect(strip(copyCurves)).toEqual(strip(waveCurves));
  const waveIds = new Set(waveCurves.flatMap((curve) => [curve.id, ...curve.keys.map((key) => key.id)]));
  expect(
    copyCurves.flatMap((curve) => [curve.id, ...curve.keys.map((key) => key.id)]).filter((x) => waveIds.has(x)),
  ).toEqual([]);
  expect(await call(page, 'curves', clip1)).toEqual([]);

  // Editing the copy leaves wave_01 alone: key rz −60° at 15 in the copy.
  await page.getByTestId(`clips-row-${copy}`).click();
  await expect.poll(async () => (await call(page, 'state')).activeClip).toBe(copy);
  await runOk(page, 'select.controls', { ids: [lowerArm], mode: 'replace' });
  await clickFrame(page, 15);
  await typeChannel(page, 'rz', -60);
  await expect.poll(async () => (await call(page, 'channelValues', lowerArm)).rz ?? 0).toBeCloseTo(-60 * DEG, 9);
  await pressOverPane(page, 'KeyS');
  await expect.poll(async () => (await keysOf(page, lowerArm, 'rz', copy))[1]?.v ?? 0).toBeCloseTo(-60 * DEG, 9);
  expect(await call(page, 'curves', wave)).toEqual(waveCurves);
  expect(await call(page, 'curves', clip1)).toEqual([]);
});
