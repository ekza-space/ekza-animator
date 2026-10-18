import { expect, test } from '@playwright/test';
import { hoverPane } from './helpers/g3-input';
import { controlIdOf, gateOnA1, selectIds } from './helpers/m2a-a2';
import { seedSample } from './helpers/seed';
import { call, expectKernelStarted, openEditor } from './helpers/test-api';

// E2E-M2A-18 (M2A-SPEC §9.1, §5.17, §5.19; FR-OUT-05, FR-KEY-10): pick-walk with the arrow keys over the viewport,
// then key by body part from the status-line toggle: S with fk.hand.L selected keys exactly the arm.L controls.

/** Template keys of the controls with a key at `frame` in the active clip. */
async function keyedControls(page: Parameters<typeof call>[0], frame: number): Promise<string[]> {
  const state = await call(page, 'state');
  const controls = await call(page, 'controls');
  const keyOf = new Map(controls.map((control) => [control.id, control.key]));
  const keyed = new Set<string>();
  for (const curve of await call(page, 'curves', state.activeClip ?? '')) {
    if (curve.keys.some((key) => Math.abs(key.t - frame) < 1e-6)) keyed.add(keyOf.get(curve.control) ?? curve.control);
  }
  return [...keyed].sort();
}

const selectedKey = async (page: Parameters<typeof call>[0]): Promise<string[]> => {
  const controls = await call(page, 'controls');
  const keyOf = new Map(controls.map((control) => [control.id, control.key]));
  return (await call(page, 'state')).selection.controls.map((id) => keyOf.get(id) ?? id);
};

test('E2E-M2A-18: pick-walk with the arrows (↑ ↓ →)', async ({ page }) => {
  await openEditor(page, '&platform=mac');
  await expectKernelStarted(page);
  await seedSample(page, 'seed-san');
  await selectIds(page, [await controlIdOf(page, 'fk.lowerArm.L')]);
  await hoverPane(page);
  await page.keyboard.press('ArrowUp');
  await expect.poll(() => selectedKey(page)).toEqual(['fk.upperArm.L']);
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => selectedKey(page)).toEqual(['fk.lowerArm.L']);
  await page.keyboard.press('ArrowRight');
  // No sibling to the right: the visible mirror counterpart.
  await expect.poll(() => selectedKey(page)).toEqual(['fk.lowerArm.R']);
  // Not a history step (selection rule of M1).
  expect((await call(page, 'state')).history.canUndo).toBe(false);
});

test('E2E-M2A-18: S by body part keys the arm.L controls and nothing else', async ({ page }) => {
  await openEditor(page, '&platform=mac');
  await expectKernelStarted(page);
  await seedSample(page, 'seed-san');
  await gateOnA1(page);
  await selectIds(page, [await controlIdOf(page, 'fk.hand.L')]);
  await page.getByTestId('status-keytarget-bodyPart').click();
  await expect.poll(async () => (await call(page, 'state')).keyTarget).toBe('bodyPart');
  await hoverPane(page);
  await page.keyboard.press('KeyS');
  const frame = (await call(page, 'state')).clipFrame ?? 0;
  await expect
    .poll(() => keyedControls(page, frame))
    .toEqual(['fk.hand.L', 'fk.lowerArm.L', 'fk.shoulder.L', 'fk.upperArm.L', 'ik.arm.L', 'pole.arm.L'].sort());
  // keyAll: false attributes (ikFk, soft) are not keyed by body part (§5.1 rule 4).
  const clip = (await call(page, 'state')).activeClip ?? '';
  const ikArm = await controlIdOf(page, 'ik.arm.L');
  const channels = (await call(page, 'curves', clip, ikArm))
    .filter((curve) => curve.keys.length > 0)
    .map((c) => c.channel);
  expect(channels).not.toContain('@ikFk');
  expect(channels).not.toContain('@soft');
  expect(channels).toContain('@twist');
});
