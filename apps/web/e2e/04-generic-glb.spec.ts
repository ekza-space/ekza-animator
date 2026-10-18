import { expect, test } from '@playwright/test';
import { glbJson, pointOf, readFixture } from './helpers/g1-viewport';
import { call, expectKernelStarted, loadFile, openEditor, waitForCount } from './helpers/test-api';

// E2E-04 (MVP-SPEC §6.2, §4.11.6): the Quaternius UAL GLB (generic skeleton, 46 embedded clips) through the import
// dialog with only Idle_Loop checked: a 24 fps clip with keys on whole frames, reduced on import (`reduceOnImport`
// 'auto': the source has more than 0.5 keys per frame), animating the rig; the time slider scrubs it.
const CLIP = 'Idle_Loop';
const PATH_CHANNELS: Readonly<Record<string, readonly string[]>> = {
  translation: ['tx', 'ty', 'tz'],
  rotation: ['rx', 'ry', 'rz'],
  scale: ['sx', 'sy', 'sz'],
};

/** Generic rigs name their FK controls `fk.<node name>` with anything outside `[A-Za-z0-9_-]` as `_` (rig naming). */
const controlKeyOf = (nodeName: string): string =>
  `fk.${nodeName.replace(/[^A-Za-z0-9_-]/g, '_') === '' ? 'node' : nodeName.replace(/[^A-Za-z0-9_-]/g, '_')}`;

test('E2E-04: generic GLB + embedded clip', async ({ page }) => {
  await openEditor(page);
  await expectKernelStarted(page);

  const bytes = readFixture('animations/quaternius-ual.glb');
  const source = glbJson(bytes);
  const index = (source.animations ?? []).findIndex((animation) => animation.name === CLIP);
  expect(index).toBeGreaterThanOrEqual(0);

  await loadFile(page, 'quaternius-ual.glb', bytes);
  const dialog = page.getByTestId('import-dialog');
  await expect(dialog).toBeVisible();
  const boxes = page.locator('[data-testid^="import-clip-"]');
  expect(await boxes.count()).toBe(source.animations?.length);
  // Check only Idle_Loop: clear whatever the dialog checked by default, then check it.
  for (const box of await boxes.all()) {
    if (await box.isChecked()) await box.uncheck();
  }
  await page.getByTestId(`import-clip-${index}`).check();
  await expect(page.locator('[data-testid^="import-clip-"]:checked')).toHaveCount(1);
  await page.getByTestId('import-confirm').click();
  await expect(dialog).toBeHidden();
  await waitForCount(page, 'characters', 1);

  // The clip is active, 24 fps.
  const state = await call(page, 'state');
  const clips = await call(page, 'clips');
  expect(clips.map((clip) => clip.name)).toEqual([CLIP]);
  const clip = clips[0];
  if (clip === undefined) throw new Error('no clip');
  expect(state.activeClip).toBe(clip.id);
  expect(clip.fps).toBe(24);

  // Every key on a whole frame.
  const curves = await call(page, 'curves', clip.id);
  expect(curves.length).toBeGreaterThan(0);
  const subFrame = curves.flatMap((curve) => curve.keys.filter((key) => !Number.isInteger(key.t)).map((key) => key.t));
  expect(subFrame).toEqual([]);

  // Reduction: the curves whose source track has ≥ 20 samples keep fewer than a third of those samples in total.
  const controls = await call(page, 'controls');
  const keyOfControl = new Map(controls.map((control) => [control.id, control.key]));
  const animation = source.animations?.[index];
  const sourceCount = new Map<string, number>();
  for (const channel of animation?.channels ?? []) {
    const node = channel.target.node;
    if (node === undefined) continue;
    const sampler = animation?.samplers[channel.sampler];
    const count = sampler === undefined ? 0 : (source.accessors[sampler.input]?.count ?? 0);
    const key = controlKeyOf(source.nodes[node]?.name ?? '');
    for (const ch of PATH_CHANNELS[channel.target.path] ?? []) sourceCount.set(`${key}.${ch}`, count);
  }
  let reducedKeys = 0;
  let sourceSamples = 0;
  let denseCurves = 0;
  const unmatched: string[] = [];
  for (const curve of curves) {
    const id = `${keyOfControl.get(curve.control) ?? curve.control}.${curve.channel}`;
    const count = sourceCount.get(id);
    if (count === undefined) {
      unmatched.push(id);
      continue;
    }
    if (count < 20) continue;
    denseCurves++;
    reducedKeys += curve.keys.length;
    sourceSamples += count;
  }
  expect(unmatched, 'every curve maps to a source track').toEqual([]);
  expect(denseCurves).toBeGreaterThan(0);
  expect(reducedKeys).toBeLessThan(sourceSamples / 3);

  // The clip animates the rig: some control differs from rest at frame 10.
  const restOf = (channel: string): number => (channel.startsWith('s') ? 1 : 0);
  let moved = 0;
  for (const control of controls) {
    const values = await call(page, 'channelValues', control.id, 10);
    if (Object.entries(values).some(([channel, value]) => Math.abs(value - restOf(channel)) > 1e-6)) moved++;
  }
  expect(moved).toBeGreaterThan(0);

  // Scrubbing the time slider to frame 20 sets the clip frame.
  const from = await pointOf(page, () => call(page, 'screenOfFrame', 0), 'frame 0');
  const to = await pointOf(page, () => call(page, 'screenOfFrame', 20), 'frame 20');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let step = 1; step <= 10; step++) {
    await page.mouse.move(from.x + ((to.x - from.x) * step) / 10, from.y + ((to.y - from.y) * step) / 10);
  }
  await page.mouse.up();
  await expect.poll(async () => (await call(page, 'state')).clipFrame).toBe(20);
});
