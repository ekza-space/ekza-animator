import { expect, type Page, test } from '@playwright/test';
import { centreOf, drag, paneRect, pointOf } from './helpers/g1-viewport';
import { createBodyCharacter, enterRig, expectRefused, keysHash, RIG_PERSP_PANE, undoUntil } from './helpers/m6b-rig';
import { controlId, seedSample } from './helpers/seed';
import { call, expectKernelStarted, openEditor, run, runOk } from './helpers/test-api';

// E2E-RIG-05 (M6B-SPEC §10.1 row; owner C7): Object mode, `E` on two controls writes test poses (never keys, never the
// document): the view switches to Test with the toast once per session; status Bind ↔ Test restores the pose; an
// undo inside Rig & Skin removes the last test value and keeps the first; leaving to Animate drops every test-pose
// step (no empty step left) and the next undo there undoes the last document step. The full row starts from a bound
// body and refuses a joint move in Test (gates c1, c2, c3, c4); the control part runs on the imported Polybot now.

const TOAST = 'Test pose: not keyed; Go to Bind Pose to edit joints';

/** Selects a control and rotates it with the manipulator's Z ring in the perspective pane (a real drag). */
async function rotateControl(page: Page, control: string, key: string, dx: number): Promise<void> {
  await runOk(page, 'select.controls', { ids: [control], mode: 'replace' });
  const ring = await pointOf(page, () => call(page, 'screenOfManipulator', RIG_PERSP_PANE, 'rz'), `${key} rz ring`);
  await drag(page, ring, { dx, dy: 0 });
}

/** Hovers the perspective pane (the keymap's scope chain follows the pointer). */
async function hoverPersp(page: Page): Promise<void> {
  const at = centreOf(await paneRect(page, RIG_PERSP_PANE));
  await page.mouse.move(at.x, at.y);
}

const rz = async (page: Page, control: string): Promise<number> => (await call(page, 'channelValues', control)).rz ?? 0;
const badge = (page: Page) => page.getByTestId(`hud-badge-pose-${RIG_PERSP_PANE}`);

test('E2E-RIG-05 (MVP part): test poses on controls, Bind ↔ Test, undo inside Rig, leaving drops them', async ({
  page,
}) => {
  await openEditor(page);
  await expectKernelStarted(page);
  await seedSample(page, 'polybot');
  const arm = await controlId(page, 'fk.lowerArm.L');
  const head = await controlId(page, 'fk.head');
  // The last document step before Rig & Skin: a key in Animate.
  await runOk(page, 'select.controls', { ids: [arm], mode: 'replace' });
  await runOk(page, 'key.set');
  const keyed = (await call(page, 'history')).undo.at(-1);
  expect(keyed).toBeDefined();
  await enterRig(page);
  await expect(badge(page)).toHaveText('BIND POSE');
  const hash = await keysHash(page);
  const counts = await call(page, 'counts');

  await hoverPersp(page);
  await page.keyboard.press('KeyE');
  await expect.poll(async () => (await call(page, 'state')).tool).toBe('rotate');
  await rotateControl(page, arm, 'fk.lowerArm.L', 60);
  await expect.poll(() => rz(page, arm)).not.toBe(0);
  const armTest = await rz(page, arm);
  await expect.poll(async () => (await call(page, 'rigState')).poseView).toBe('test');
  await expect(badge(page)).toHaveText('TEST POSE');
  await rotateControl(page, head, 'fk.head', -50);
  await expect.poll(() => rz(page, head)).not.toBe(0);
  // One step per drag (selection steps, which Rig & Skin records, sit between them).
  expect((await call(page, 'history')).undo.filter((label) => label === 'Test Pose')).toHaveLength(2);
  // Never keys, never the document; the toast once per session.
  expect(await keysHash(page)).toBe(hash);
  expect(await call(page, 'counts')).toEqual(counts);
  await expect(page.getByTestId('toast').filter({ hasText: TOAST })).toHaveCount(1);

  // Status Bind → the rest; Test → the kept pose.
  await page.getByTestId('status-poseview-bind').click();
  await expect.poll(() => rz(page, arm)).toBe(0);
  await expect(badge(page)).toHaveText('BIND POSE');
  await page.getByTestId('status-poseview-test').click();
  await expect.poll(() => rz(page, arm)).toBe(armTest);

  // Undo inside Rig & Skin removes the head's value and keeps the arm's.
  await undoUntil(page, 'Test Pose');
  await expect.poll(() => rz(page, head)).toBe(0);
  expect(await rz(page, arm)).toBe(armTest);

  // Leaving drops every test-pose step; the next undo in Animate undoes the key.
  await runOk(page, 'workspace.set', { workspace: 'animate' });
  const history = await call(page, 'history');
  expect(history.undo).not.toContain('Test Pose');
  expect(history.redo).toEqual([]);
  expect(history.undo.filter((label) => label !== 'Select').at(-1)).toBe(keyed);
  expect(await keysHash(page)).toBe(hash);
});

test('E2E-RIG-05 (MVP part): a test pose is never keyed: Channel Box Key Selected, the palette, key.set', async ({
  page,
}) => {
  await openEditor(page);
  await expectKernelStarted(page);
  await seedSample(page, 'polybot');
  const arm = await controlId(page, 'fk.lowerArm.L');
  const head = await controlId(page, 'fk.head');
  await enterRig(page);
  await runOk(page, 'select.controls', { ids: [arm], mode: 'replace' });
  await runOk(page, 'channel.setValues', { edits: [{ control: arm, channel: 'rz', value: 1.234 }], key: 'auto' });
  await expect.poll(() => rz(page, arm)).toBeCloseTo(1.234);
  const hash = await keysHash(page);
  const counts = await call(page, 'counts');
  // The Channel Box's right-click "Key Selected" (§5.17: keying is impossible in Rig & Skin).
  await runOk(page, 'workspace.showPanel', { panel: 'channelBox' });
  const row = page.locator('[data-channel="rz"]').first();
  await row.click({ button: 'right' });
  await page.getByTestId('cb-menu-key-selected').click();
  // The palette lists no keying entry; a run of key.set, pose.mirror or a curve edit is refused.
  expect((await run(page, 'ui.commandPalette')).status).toBe('finished');
  await expect(page.getByTestId('cmdk')).toBeVisible();
  const ops = new Set((await call(page, 'commandPalette'))?.items.map((item) => item.op) ?? []);
  for (const op of ['key.set', 'key.deleteAtFrame', 'pose.mirror', 'pose.paste', 'graph.keys.keyCurves']) {
    expect(ops.has(op), op).toBe(false);
  }
  await page.keyboard.press('Escape');
  for (const [op, args] of [
    ['key.set', { channels: 'all' }],
    ['pose.mirror', { mode: 'flip' }],
    ['graph.keys.keyCurves', undefined],
  ] as const) {
    await expectRefused(page, op, 'Keys and poses are set in Animate', args);
  }
  expect(await keysHash(page)).toBe(hash);
  expect(await call(page, 'counts')).toEqual(counts);
  // Selection undo (§5.24): one Select step per gesture; undo restores the selection, no document change.
  await runOk(page, 'select.controls', { ids: [head], mode: 'replace' });
  expect((await call(page, 'history')).undo.at(-1)).toBe('Select');
  await runOk(page, 'edit.undo');
  expect((await call(page, 'state')).selection.controls).toEqual([arm]);
  expect(await call(page, 'counts')).toEqual(counts);
});

test(`E2E-RIG-05: pose view and history on a bound body`, async ({ page }) => {
  await openEditor(page);
  await expectKernelStarted(page);
  const body = await createBodyCharacter(page);
  await runOk(page, 'skin.bind', {});
  await enterRig(page);
  // Skeleton Template leaves Skeleton mode (§0.2 step 5); this scenario starts in Object mode.
  await runOk(page, 'rig.mode', { mode: 'object' });
  const arm = await controlId(page, 'fk.lowerArm.L', body.character);
  const head = await controlId(page, 'fk.head', body.character);
  await hoverPersp(page);
  await page.keyboard.press('KeyE');
  await rotateControl(page, arm, 'fk.lowerArm.L', 60);
  await rotateControl(page, head, 'fk.head', -50);
  await expect.poll(async () => (await call(page, 'rigState')).poseView).toBe('test');
  await expect(page.getByTestId('toast').filter({ hasText: TOAST })).toHaveCount(1);
  // Skeleton mode: a joint move in Test is refused with its message (C3's state table, §5.7).
  await page.keyboard.press('Digit1');
  await page.keyboard.press('KeyW');
  const joint = (await call(page, 'skeleton', body.character))?.joints.find((j) => j.humanBone === 'leftLowerArm');
  const at = await pointOf(page, () => call(page, 'screenOfJoint', joint?.id ?? '', RIG_PERSP_PANE), 'left elbow');
  const rest = joint?.restPosition;
  await drag(page, at, { dx: 30, dy: 0 });
  expect((await call(page, 'skeleton', body.character))?.joints.find((j) => j.id === joint?.id)?.restPosition).toEqual(
    rest,
  );
  await page.getByTestId('status-poseview-bind').click();
  await page.getByTestId('status-poseview-test').click();
  await expect.poll(() => rz(page, arm)).not.toBe(0);
  await undoUntil(page, 'Test Pose');
  await expect.poll(() => rz(page, head)).toBe(0);
  await runOk(page, 'workspace.set', { workspace: 'animate' });
  const history = await call(page, 'history');
  expect(history.undo).not.toContain('Test Pose');
  expect(history.undo.filter((label) => label !== 'Select').at(-1)).toBe('Bind Skin');
});
