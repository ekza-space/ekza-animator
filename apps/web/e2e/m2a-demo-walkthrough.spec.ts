// M2A-SPEC §10.3 owner demo script, run once in sequence on one page (integration, M2A-INT-15). The scenarios
// E2E-M2A-01…23 cover every step on a fresh page each; this walkthrough plays the ten steps one after the other on
// Polybot, through the input a user would use, and checks what each step should show — including that the panels
// agree with each other (the Graph Editor shows an angle attribute in the Channel Box's degrees). It keeps the state
// between steps; where a step would leave the walk broken for the next one, it undoes its edit, as a presenter would.
import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { pointOf } from './helpers/g1-viewport';
import { hoverGraph, typeField } from './helpers/g2-graph';
import { clickFrame, clickOutlinerRow, hoverPane, keysOf, pressOverPane } from './helpers/g3-input';
import {
  boneWorlds,
  centreOfTestId,
  clickControl,
  controlIdOf,
  DEG,
  distance,
  expectLimbIk,
  expectWorldClose,
  horizontalDrag,
  type World,
  typeCb,
} from './helpers/m2a-a2';
import { dragTo, dragTween } from './helpers/m2a-a4';
import { dopeKey, dopeX, drag, shiftClickTick, showDopeSheet, sliderPoint } from './helpers/m2a-timing';
import { seedSample } from './helpers/seed';
import { call, expectKernelStarted, openEditor, runOk, waitForTestApi } from './helpers/test-api';

const LEG = ['leftUpperLeg', 'leftLowerLeg', 'leftFoot'] as const;

async function expectSelected(page: Page, ids: readonly string[]): Promise<void> {
  await expect.poll(async () => (await call(page, 'state')).selection.controls).toEqual([...ids]);
}

async function undoLabel(page: Page): Promise<string | null> {
  return (await call(page, 'state')).history.undoLabel;
}

/** A manipulator arrow of the selected control in the right pane, dragged by (dx, dy) CSS px. */
async function dragArrow(page: Page, axis: 'tx' | 'ty' | 'tz', dx: number, dy: number): Promise<void> {
  const arrow = await pointOf(page, () => call(page, 'screenOfManipulator', 'pane-right', axis), `${axis} arrow`);
  await dragTo(page, arrow, { x: arrow.x + dx, y: arrow.y + dy }, 10);
}

/** Keys the selected control at `frame` by Channel Box typing and `S` over the viewport (E2E-M2A-23's method). */
async function keyWithChannelBox(
  page: Page,
  control: string,
  frame: number,
  fields: Readonly<Record<string, string>>,
): Promise<void> {
  await clickFrame(page, frame);
  for (const [channel, text] of Object.entries(fields)) await typeCb(page, `cb-field-${channel}`, text);
  await pressOverPane(page, 'KeyS');
  const channel = Object.keys(fields)[0] ?? 'rx';
  await expect
    .poll(async () => (await keysOf(page, control, channel)).some((key) => Math.abs(key.t - frame) < 1e-9))
    .toBe(true);
}

function sameWorlds(a: Record<string, World>, b: Record<string, World>, bones: readonly string[], what: string) {
  for (const bone of bones) expectWorldClose(a[bone] as World, b[bone] as World, 1e-6, `${what}: ${bone}`);
}

test('M2a owner demo script (§10.3), the ten steps in sequence', async ({ page }) => {
  test.setTimeout(420_000);
  const ns = `demo-${test.info().workerIndex}-${Date.now().toString(36)}`;
  await openEditor(page, `&platform=mac&pointerLock=off&ns=${ns}`);
  await expectKernelStarted(page);

  let character = '';
  const ids: Record<string, string> = {};
  const id = (key: string): string => {
    const value = ids[key];
    if (value === undefined) throw new Error(`no control ${key}`);
    return value;
  };

  await test.step('1. Load Polybot: IK feet and knee poles shown, FK leg circles hidden', async () => {
    ({ character } = await seedSample(page, 'polybot'));
    await expectLimbIk(page);
    for (const key of [
      'cog',
      'ik.leg.L',
      'ik.leg.R',
      'pole.leg.L',
      'fk.upperLeg.L',
      'fk.hand.L',
      'fk.lowerArm.L',
      'fk.upperArm.L',
    ]) {
      ids[key] = await controlIdOf(page, key);
    }
    const limbs = Object.fromEntries((await call(page, 'limbs')).map((limb) => [limb.id, limb.ikFk]));
    expect(limbs).toEqual({ 'leg.L': 1, 'leg.R': 1, 'arm.L': 0, 'arm.R': 0 });
    const visible = Object.fromEntries((await call(page, 'controls')).map((c) => [c.key, c.visible]));
    expect([visible['ik.leg.L'], visible['pole.leg.L'], visible['fk.upperLeg.L']]).toEqual([true, true, false]);
  });

  await test.step('2. Lower cog with W (feet stay); drag the IK foot; move the pole; roll 20° and −15°', async () => {
    const rest = await boneWorlds(page, character, [...LEG, 'hips']);
    await clickOutlinerRow(page, id('cog'));
    await expectSelected(page, [id('cog')]);
    await pressOverPane(page, 'KeyW');
    await expect.poll(async () => (await call(page, 'state')).tool).toBe('move');
    await dragArrow(page, 'ty', 0, 25);
    const lowered = await boneWorlds(page, character, [...LEG, 'hips']);
    expect((lowered.hips?.t[1] ?? 0) - (rest.hips?.t[1] ?? 0), 'hips lowered').toBeLessThan(-5e-3);
    expectWorldClose(lowered.leftFoot as World, rest.leftFoot as World, 1e-6, 'the left foot stays');

    await clickControl(page, id('ik.leg.L'));
    await expectSelected(page, [id('ik.leg.L')]);
    await dragArrow(page, 'ty', 0, -25);
    const lifted = await boneWorlds(page, character, [...LEG]);
    expect((lifted.leftFoot?.t[1] ?? 0) - (lowered.leftFoot?.t[1] ?? 0), 'foot lifted').toBeGreaterThan(5e-3);

    await clickControl(page, id('pole.leg.L'));
    await expectSelected(page, [id('pole.leg.L')]);
    await dragArrow(page, 'tx', 30, 0);
    const poled = await boneWorlds(page, character, [...LEG]);
    expect(distance(poled.leftLowerLeg?.t ?? [], lifted.leftLowerLeg?.t ?? []), 'the knee follows').toBeGreaterThan(
      1e-3,
    );
    expectWorldClose(poled.leftFoot as World, lifted.leftFoot as World, 1e-6, 'the pole leaves the foot');

    // Roll typed in degrees; keyed, the Graph Editor shows the key in the Channel Box's degrees (§5.1 rule 5). The IK
    // foot is picked in the Outliner: in the viewport the selected pole's move manipulator wins the click (§4.11.16).
    await clickOutlinerRow(page, id('ik.leg.L'));
    await expectSelected(page, [id('ik.leg.L')]);
    await typeCb(page, 'cb-field-@roll', '20');
    expect((await call(page, 'attrs', id('ik.leg.L')))['roll']).toBeCloseTo(20 * DEG, 9);
    await pressOverPane(page, 'KeyS');
    await expect.poll(async () => (await keysOf(page, id('ik.leg.L'), '@roll')).length).toBe(1);
    const rollKey = (await keysOf(page, id('ik.leg.L'), '@roll'))[0];
    await runOk(page, 'workspace.showPanel', { panel: 'graph' });
    await runOk(page, 'select.keys', { items: [{ key: rollKey?.id }], mode: 'replace' });
    await expect(page.getByTestId('ge-field-value')).toHaveValue('20.000');
    await expect(page.getByTestId('cb-field-@roll')).toHaveValue('20.000');
    await typeCb(page, 'cb-field-@roll', '-15');
    expect((await call(page, 'attrs', id('ik.leg.L')))['roll']).toBeCloseTo(-15 * DEG, 9);
  });

  await test.step('3. Seamless switch of the left leg to FK at 10 and back; left arm to IK, lower cog: the hand stays', async () => {
    await runOk(page, 'workspace.showPanel', { panel: 'attributes' });
    await clickFrame(page, 10);
    const at9 = await boneWorlds(page, character, LEG, 9);
    const at10 = await boneWorlds(page, character, LEG, 10);
    await page.getByTestId('attr-limb-key-mode').selectOption('seamless');
    await page.getByTestId('attr-limb-mode-fk-leg.L').click();
    await expect.poll(() => undoLabel(page)).toBe('Switch L Leg to FK');
    sameWorlds(await boneWorlds(page, character, LEG, 9), at9, LEG, 'frame 9 after the switch to FK');
    sameWorlds(await boneWorlds(page, character, LEG, 10), at10, LEG, 'frame 10 after the switch to FK');
    await clickFrame(page, 15);
    const at15 = await boneWorlds(page, character, LEG, 15);
    await page.getByTestId('attr-limb-mode-ik-leg.L').click();
    await expect.poll(() => undoLabel(page)).toBe('Switch L Leg to IK');
    sameWorlds(await boneWorlds(page, character, LEG, 15), at15, LEG, 'frame 15 after the switch back');

    await clickOutlinerRow(page, id('fk.hand.L'));
    await expectSelected(page, [id('fk.hand.L')]);
    const hand = await boneWorlds(page, character, ['leftHand']);
    await page.getByTestId('attr-limb-mode-ik-arm.L').click();
    await expect.poll(() => undoLabel(page)).toBe('Switch L Arm to IK');
    sameWorlds(await boneWorlds(page, character, ['leftHand']), hand, ['leftHand'], 'hand after the arm switch');
    await clickOutlinerRow(page, id('cog'));
    await runOk(page, 'workspace.showPanel', { panel: 'channelBox' });
    await typeCb(page, 'cb-field-ty', '-=0.02');
    sameWorlds(await boneWorlds(page, character, ['leftHand']), hand, ['leftHand'], 'hand after lowering cog');
  });

  let clip = '';
  await test.step('4. Block a 24-frame walk with the IK feet and cog; mirror left → right half a cycle; play', async () => {
    ({ clip } = await runOk<{ clip: string }>(page, 'clip.new', { name: 'walk' }));
    await runOk(page, 'clip.setSettings', { clip, range: { start: 0, end: 24 }, loop: true, slot: 'walk' });
    await clickControl(page, id('ik.leg.L'));
    await expectSelected(page, [id('ik.leg.L')]);
    for (const [frame, tz, ty] of [
      [0, '0.15', '0'],
      [12, '-0.15', '0'],
      [18, '0', '0.06'],
      [24, '0.15', '0'],
    ] as const) {
      await keyWithChannelBox(page, id('ik.leg.L'), frame, { tz, ty });
    }
    await page.keyboard.down('Shift');
    await drag(page, await sliderPoint(page, 0), await sliderPoint(page, 12));
    await page.keyboard.up('Shift');
    await page.keyboard.press('Digit4');
    await clickOutlinerRow(page, id('cog'));
    await expectSelected(page, [id('cog')]);
    for (const [frame, ty, tx] of [
      [0, '-0.05', '0'],
      [6, '-0.02', '0.02'],
      [12, '-0.05', '0'],
      [18, '-0.02', '-0.02'],
      [24, '-0.05', '0'],
    ] as const) {
      await keyWithChannelBox(page, id('cog'), frame, { ty, tx });
    }
    await clickOutlinerRow(page, id('ik.leg.L'));
    await expectSelected(page, [id('ik.leg.L')]);
    await page.getByTestId('menu-pose').click();
    await page.getByTestId('menu-sub-pose.mirror-animation').click();
    await page.getByTestId('menu-item-builtin.pose.mirror-animation.leftToRight-half').click();
    await expect.poll(() => undoLabel(page)).toBe('Mirror Animation');
    for (const t of [0, 6, 12, 18]) {
      const l = await call(page, 'channelValues', id('ik.leg.L'), t);
      const r = await call(page, 'channelValues', id('ik.leg.R'), (t + 12) % 24);
      expect([t, r['tx'], r['tz']]).toEqual([t, expect.closeTo(-(l['tx'] ?? 0), 9), expect.closeTo(l['tz'] ?? 0, 9)]);
    }
    // The left foot is planted over 0…12: world x and y hold.
    const planted = await Promise.all([0, 4, 8, 12].map((f) => boneWorlds(page, character, ['leftFoot'], f)));
    for (const world of planted) {
      expect(Math.abs((world.leftFoot?.t[1] ?? 0) - (planted[0]?.leftFoot?.t[1] ?? 0))).toBeLessThanOrEqual(1e-6);
    }
    const frames = await call(page, 'renderedFrames');
    await page.getByTestId('timeline-play').click();
    await expect.poll(async () => (await call(page, 'state')).playing).toBe(true);
    await expect.poll(() => call(page, 'renderedFrames')).toBeGreaterThan(frames + 10);
    await page.getByTestId('timeline-play').click();
    await expect.poll(async () => (await call(page, 'state')).playing).toBe(false);
  });

  await test.step('5. Dope Sheet: retime the passing pose with ripple, undo; scale a block with the region bar', async () => {
    const controls = [id('cog'), id('ik.leg.L'), id('ik.leg.R')];
    for (const [index, control] of controls.entries()) {
      await clickOutlinerRow(page, control, index === 0 ? [] : ['Shift']);
    }
    await expectSelected(page, controls);
    await showDopeSheet(page);
    await page.getByTestId('ds-ripple').click();
    await expect.poll(async () => (await call(page, 'state')).ripple).toBe(true);
    const before = await call(page, 'curves', clip);
    const glyph = await dopeKey(page, 'summary', 6);
    await page.mouse.click(glyph.x, glyph.y);
    await drag(page, glyph, { x: await dopeX(page, 7), y: glyph.y });
    await expect
      .poll(async () => (await keysOf(page, id('cog'), 'ty')).map((key) => key.t))
      .toEqual([0, 7, 13, 19, 25]);
    await pressOverPane(page, 'Meta+KeyZ');
    await expect.poll(() => call(page, 'curves', clip)).toEqual(before);

    // Region bar: the glyphs at 0 and 6 selected, the region's end dragged from 6 to 8 (ripple: later keys +2).
    await page.mouse.click((await dopeKey(page, 'summary', 0)).x, glyph.y);
    await page.keyboard.down('Shift');
    await page.mouse.click(glyph.x, glyph.y);
    await page.keyboard.up('Shift');
    const end = await pointOf(page, () => call(page, 'screenOfDopeRegion', 'end'), 'region end');
    await drag(page, end, { x: await dopeX(page, 8), y: end.y });
    await expect
      .poll(async () => (await keysOf(page, id('cog'), 'ty')).map((key) => key.t))
      .toEqual([0, 8, 14, 20, 26]);
    expect(await undoLabel(page)).toBe('Scale Keys');
    // Undone, so the loop stays 24 frames for the next steps.
    await pressOverPane(page, 'Meta+KeyZ');
    await expect.poll(() => call(page, 'curves', clip)).toEqual(before);
    await page.getByTestId('ds-ripple').click();
    await expect.poll(async () => (await call(page, 'state')).ripple).toBe(false);
  });

  await test.step('6. Tween a breakdown at 3; Alt+S at 9; move a neighbour: the breakdown keeps its ratio', async () => {
    await clickOutlinerRow(page, id('cog'));
    await expectSelected(page, [id('cog')]);
    const sheet = await call(page, 'dopeSheet');
    if (sheet === null) throw new Error('the Dope Sheet is hidden');
    await page.mouse.click(await dopeX(page, 9), sheet.canvasRect.y + sheet.canvasRect.h - 8);
    await expect.poll(async () => (await call(page, 'state')).selection.keys).toEqual([]);
    await clickFrame(page, 3);
    await expect.poll(() => call(page, 'tweenTarget', 'status')).toEqual({ kind: 'frame', label: 'Pose @ f3' });
    await dragTween(page, 'status', 0, 50);
    await expect.poll(() => undoLabel(page)).toBe('Tween');
    const at3 = (await keysOf(page, id('cog'), 'ty')).find((key) => key.t === 3);
    // ty −0.05 at 0, −0.02 at 6: the pose at 3 is the curve's value, 50 % towards the next key.
    expect(at3?.breakdown).toBe(true);
    expect(at3?.v ?? Number.NaN).toBeGreaterThan(-0.05);
    expect(at3?.v ?? Number.NaN).toBeLessThan(-0.02);

    await clickFrame(page, 9);
    await pressOverPane(page, 'Alt+KeyS');
    await expect
      .poll(async () => (await keysOf(page, id('cog'), 'ty')).find((key) => key.t === 9)?.breakdown)
      .toBe(true);
    const before = await call(page, 'curves', clip);
    // The cog's key at 12 dragged to 14 in its own Dope Sheet row: the breakdown at 9 (half-way 6…12) lands at 10.
    const glyph12 = await dopeKey(page, id('cog'), 12);
    await page.mouse.click(glyph12.x, glyph12.y);
    await drag(page, glyph12, { x: await dopeX(page, 14), y: glyph12.y });
    await expect
      .poll(async () => (await keysOf(page, id('cog'), 'ty')).map((key) => key.t))
      .toEqual([0, 3, 6, 10, 14, 18, 24]);
    await pressOverPane(page, 'Meta+KeyZ');
    await expect.poll(() => call(page, 'curves', clip)).toEqual(before);
  });

  await test.step('7. Graph Editor: buffer snapshot, edit, swap back; normalized and stacked views; R scale', async () => {
    await runOk(page, 'workspace.showPanel', { panel: 'graph' });
    await page.getByTestId(`ge-row-${id('cog')}/ty`).click();
    const tyCurve = (await call(page, 'curves', clip, id('cog'))).find((curve) => curve.channel === 'ty');
    if (tyCurve === undefined) throw new Error('no cog ty curve');
    await expect.poll(async () => (await call(page, 'graph'))?.visibleCurves).toEqual([tyCurve.id]);
    const snapshot = (await keysOf(page, id('cog'), 'ty')).map((key) => [key.t, key.v]);
    await page.getByTestId('ge-buffer-snapshot').click();
    await expect.poll(async () => (await call(page, 'graph'))?.buffers ?? []).toContain(tyCurve.id);
    const key6 = (await keysOf(page, id('cog'), 'ty')).find((key) => key.t === 6);
    await runOk(page, 'select.keys', { items: [{ key: key6?.id }], mode: 'replace' });
    await typeField(page, 'ge-field-value', '-0.08');
    await expect
      .poll(async () => (await keysOf(page, id('cog'), 'ty')).find((key) => key.t === 6)?.v)
      .toBeCloseTo(-0.08, 9);
    await page.getByTestId('ge-buffer-swap').click();
    await expect.poll(async () => (await keysOf(page, id('cog'), 'ty')).map((key) => [key.t, key.v])).toEqual(snapshot);

    const curves = await call(page, 'curves', clip);
    for (const mode of ['normalized', 'stacked', 'absolute'] as const) {
      await page.getByTestId(`ge-view-${mode}`).click();
      await expect.poll(async () => (await call(page, 'graph'))?.viewMode).toBe(mode);
      expect(await call(page, 'curves', clip)).toEqual(curves);
    }

    // R: the region box over the curve's keys; the top edge down by half its height scales the values ×0.5.
    const on = await pointOf(page, () => call(page, 'screenOfCurve', tyCurve.id, 4.5), 'the ty curve at 4.5');
    await page.mouse.dblclick(on.x, on.y);
    await expect
      .poll(async () => (await call(page, 'state')).selection.keys.length)
      .toBe((await keysOf(page, id('cog'), 'ty')).length);
    await hoverGraph(page);
    await page.keyboard.press('KeyR');
    const top = await pointOf(page, () => call(page, 'screenOfRegionHandle', 'top'), 'the region top');
    const bottom = await pointOf(page, () => call(page, 'screenOfRegionHandle', 'bottom'), 'the region bottom');
    await dragTo(page, top, { x: top.x, y: top.y + (bottom.y - top.y) / 2 });
    await expect.poll(() => undoLabel(page)).toBe('Scale Keys');
    const scaled = await keysOf(page, id('cog'), 'ty');
    const low = Math.min(...snapshot.map(([, v]) => v as number));
    for (const [i, key] of scaled.entries()) {
      expect(key.v).toBeCloseTo(low + (((snapshot[i]?.[1] as number) ?? 0) - low) * 0.5, 3);
    }
    await hoverGraph(page);
    await page.keyboard.press('Meta+KeyZ');
    await expect.poll(async () => (await keysOf(page, id('cog'), 'ty')).map((key) => [key.t, key.v])).toEqual(snapshot);
    await page.keyboard.press('KeyQ');
  });

  await test.step('8. MMB-drag the time slider to carry a pose and S; Shift-drag a band and Mod-drag it to copy', async () => {
    await clickOutlinerRow(page, id('cog'));
    await expectSelected(page, [id('cog')]);
    await clickFrame(page, 12);
    const pose12 = await call(page, 'channelValues', id('cog'));
    await drag(page, await sliderPoint(page, 12), await sliderPoint(page, 15), { button: 'middle' });
    await expect.poll(async () => (await call(page, 'state')).clipFrame).toBe(15);
    expect((await call(page, 'channelValues', id('cog')))['ty']).toBeCloseTo(pose12['ty'] ?? Number.NaN, 9);
    await pressOverPane(page, 'KeyS');
    await expect
      .poll(async () => (await keysOf(page, id('cog'), 'ty')).find((key) => key.t === 15)?.v)
      .toBeCloseTo(pose12['ty'] ?? Number.NaN, 9);

    await shiftClickTick(page, 15);
    await page.keyboard.down('Meta');
    await drag(page, await sliderPoint(page, 15), await sliderPoint(page, 21));
    await page.keyboard.up('Meta');
    await expect.poll(() => undoLabel(page)).toBe('Copy Keys');
    const ty = await keysOf(page, id('cog'), 'ty');
    expect(ty.find((key) => key.t === 21)?.v).toBe(ty.find((key) => key.t === 15)?.v);
  });

  await test.step('9. Pick-walk with the arrows; key a hand by body part; MMB scrub in the Channel Box', async () => {
    await clickOutlinerRow(page, id('fk.lowerArm.L'));
    await expectSelected(page, [id('fk.lowerArm.L')]);
    await hoverPane(page);
    await page.keyboard.press('ArrowUp');
    await expectSelected(page, [id('fk.upperArm.L')]);
    await page.keyboard.press('ArrowDown');
    await expectSelected(page, [id('fk.lowerArm.L')]);

    await clickOutlinerRow(page, id('fk.hand.L'));
    await expectSelected(page, [id('fk.hand.L')]);
    await clickFrame(page, 8);
    await page.getByTestId('status-keytarget-bodyPart').click();
    await expect.poll(async () => (await call(page, 'state')).keyTarget).toBe('bodyPart');
    await pressOverPane(page, 'KeyS');
    for (const key of ['fk.upperArm.L', 'fk.lowerArm.L', 'fk.hand.L']) {
      await expect.poll(async () => (await keysOf(page, id(key), 'rz')).map((k) => k.t)).toContain(8);
    }
    expect((await keysOf(page, id('cog'), 'ty')).map((k) => k.t)).not.toContain(8);
    await page.getByTestId('status-keytarget-selected').click();

    await clickOutlinerRow(page, id('fk.lowerArm.L'));
    const rz = (await call(page, 'channelValues', id('fk.lowerArm.L')))['rz'] ?? Number.NaN;
    await horizontalDrag(page, await centreOfTestId(page, 'cb-name-rz'), 40, { button: 'middle' });
    await expect
      .poll(async () => ((await call(page, 'channelValues', id('fk.lowerArm.L')))['rz'] ?? 0) - rz)
      .toBeCloseTo(20 * DEG, 9);
    expect(await undoLabel(page)).toBe('Drag Rotate Z');
  });

  await test.step('10. Export VRMA with key reduction (sizes shown); reload with unsaved work and recover', async () => {
    await runOk(page, 'ui.open', { dialog: 'export' });
    await expect(page.getByTestId('export-dialog')).toBeVisible();
    await page.getByTestId('export-kind-vrma').click();
    await expect(page.getByTestId('export-reduce')).toBeChecked();
    const download = page.waitForEvent('download', { timeout: 60_000 });
    await page.getByTestId('export-confirm').click();
    const bytes = new Uint8Array(readFileSync(await (await download).path()));
    expect(bytes.length).toBeGreaterThan(1000);
    await expect(page.getByTestId('export-stats')).toContainText(/\d+ → \d+ samples/);
    await expect(page.locator('[data-testid="toast"][data-kind="success"]').last()).toContainText(/\d+ → \d+ samples/);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('export-dialog')).toHaveCount(0);

    expect((await call(page, 'state')).dirty).toBe(true);
    await page.evaluate(() => window.__EKZA_STUDIO_TEST__?.flushAutosave());
    const slot = (await call(page, 'autosave')).slot ?? '';
    const counts = await call(page, 'counts');
    const curves = await call(page, 'curves', clip);
    await page.reload();
    await waitForTestApi(page);
    await expect(page.getByTestId('recovery-dialog')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId(`recovery-recover-${slot}`).click();
    await expect(page.getByTestId('recovery-dialog')).toHaveCount(0);
    await expect.poll(() => call(page, 'counts')).toEqual(counts);
    expect(await call(page, 'curves', clip)).toEqual(curves);
    expect((await call(page, 'state')).dirty).toBe(true);
    // Back in the clip being edited, not the character's first clip (acceptance fix round 1, bug 5).
    expect((await call(page, 'state')).activeClip).toBe(clip);
  });
});
