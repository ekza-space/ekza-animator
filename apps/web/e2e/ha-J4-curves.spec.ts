import { expect, type Page, type TestInfo, test } from '@playwright/test';
import { animate, centreOf, controlFree, dockedPetal, loadSample, touches } from './helpers/halo-animate';
import {
  curvePetal,
  curves,
  curvesReady,
  fingerInput,
  type Input,
  layerRadio,
  marqueeOverContact,
  penInput,
} from './helpers/halo-curves';
import { openHalo, selectedControls } from './helpers/halo';
import { call, runOk } from './helpers/test-api';
import { cdp, touchEvent } from './helpers/touch';

// ha-J4 / ha-J4f Fix foot sliding and polish a walk with curves (STUDIO-TOUCH-SPEC §9 J4, §10.5, §22 AS-ST-4; T10 exit
// test), `chrome-touch`, from a fresh project with the real defaults (Seed-san with the library's Walk, set up through
// the test API and not counted):
// 1. tap the L foot's control (1) → the layer switch *Curves* (1) → the channel chip *Move Y* alone (1);
// 2. one drag on empty curve space: a marquee over the contact keys (1) → the docked key Halo *Ease ▾ › Flat* (2) → the
//    ⟨Value⟩ chip: numpad 0, Done (1);
// 3. hold *⇆ Before* to compare (1); the curve's Halo *Cycle ▾ › Repeat* for the loop seam (2).
// At most 10 touches. ha-J4 drives it with the Pencil where the Pencil fits (taps and the marquee); ha-J4f with fingers
// only (§5.2.1, the release gate's finger-only variant).

const touchOnly = (info: TestInfo): void => test.skip(info.project.name !== 'chrome-touch', 'chrome-touch only (CDP)');

async function journey(page: Page, kind: Input['kind'], testInfo: TestInfo): Promise<void> {
  touchOnly(testInfo);
  const input = kind === 'pen' ? penInput(page) : fingerInput(page);
  test.setTimeout(150_000);
  await openHalo(page);
  await loadSample(page, 'seed-san');
  // the walk to polish (setup, not counted): the library's Walk on Seed-san, active
  const character = (await call(page, 'characters'))[0]?.id ?? '';
  await runOk(page, 'library.useClip', { character, clip: 'walk' });
  const walk = (await call(page, 'clips')).find((clip) => clip.name === 'Walk');
  if (walk === undefined) throw new Error('no Walk');
  await runOk(page, 'clip.setActive', { clip: walk.id });
  await expect.poll(async () => (await animate(page)).active).toBe('Walk');
  const goal = (await call(page, 'controls')).find((c) => c.name === 'L Leg IK')?.id ?? '';
  const base = await touches(page);

  // 1. the L foot's control › Curves › Move Y alone (3)
  await input.tap(await controlFree(page, 'L Leg IK'));
  await expect.poll(() => selectedControls(page)).toEqual([goal]);
  await input.tap(await layerRadio(page, 'Curves'));
  await curvesReady(page);
  expect((await curves(page)).controls).toEqual(['L Leg IK']);
  // the time axis reads frames by default (ST-T7-UNIT)
  expect((await curves(page)).units).toBe('frames');
  expect((await curves(page)).axisLabels.map((l) => l.text)).toContain('0');
  await input.tap(await centreOf(page, 'halo-curves-chip-Move Y'));
  await expect.poll(async () => (await curves(page)).curves.length).toBe(1);
  const ty = (await call(page, 'curves', walk.id, goal)).find((c) => c.channel === 'ty');
  if (ty === undefined) throw new Error('no Move Y curve');
  expect((await curves(page)).curves).toEqual([ty.id]);

  // 2. a marquee over the contact keys (1) › Ease ▾ › Flat (2) › ⟨Value⟩: numpad 0, Done (1)
  const contact = await marqueeOverContact(page, input);
  expect(contact.length).toBeGreaterThanOrEqual(3);
  await expect.poll(async () => (await curves(page)).fields['count']).toBe(contact.length);
  await expect(page.getByTestId('halo-curves-docked').getByTestId('halo-docked')).toHaveAttribute(
    'data-noun',
    'keyDot',
  );
  await input.tap(await dockedPetal(page, 'Ease'));
  await input.tap(await centreOf(page, 'halo-docked-choice-Flat'));
  await expect.poll(async () => (await call(page, 'history')).undo.at(-1)).toBe('Tangents: flat');
  await input.tap(await centreOf(page, 'halo-curves-value'));
  const numpad = page.getByTestId('halo-curves-value-numpad');
  await expect(numpad).toBeVisible();
  const field = numpad.locator('input');
  await field.fill('0');
  await field.press('Enter');
  await expect.poll(async () => (await curves(page)).fields['value']).toBe(0);
  const keyValues = (await call(page, 'curves', walk.id, goal)).find((c) => c.id === ty.id)?.keys ?? [];
  for (const id of contact) expect(keyValues.find((k) => k.id === id)?.v).toBe(0);

  // 3. hold ⇆ Before (1): the curves as they were when Curves opened, while held
  const before = await centreOf(page, 'halo-curves-before');
  expect((await curves(page)).buffered).toContain(ty.id);
  if (input.kind === 'pen') {
    const s = await cdp(page);
    const mouse = (type: 'mousePressed' | 'mouseReleased') =>
      s.send('Input.dispatchMouseEvent', {
        type,
        x: before.x,
        y: before.y,
        button: 'left',
        buttons: type === 'mousePressed' ? 1 : 0,
        clickCount: 1,
        pointerType: 'pen',
        force: type === 'mousePressed' ? 0.5 : 0,
      });
    await mouse('mousePressed');
    await expect.poll(async () => (await curves(page)).compare).toBe(true);
    await mouse('mouseReleased');
    await s.detach();
  } else {
    const s = await cdp(page);
    await touchEvent(s, 'touchStart', [before]);
    await expect.poll(async () => (await curves(page)).compare).toBe(true);
    await touchEvent(s, 'touchEnd', []);
    await s.detach();
  }
  await expect.poll(async () => (await curves(page)).compare).toBe(false);
  // the curve's Halo: Cycle ▾ › Repeat (2)
  await input.tap(await curvePetal(page, 'Cycle'));
  await input.tap(await centreOf(page, 'halo-curve-choice-Repeat'));
  await expect
    .poll(async () => (await call(page, 'curves', walk.id, goal)).find((c) => c.id === ty.id)?.post)
    .toBe('cycle');

  const used = (await touches(page)) - base;
  testInfo.annotations.push({ type: 'touches', description: `J4 (${input.kind}): ${used} touches` });
  expect(used).toBeLessThanOrEqual(10);
}

test('ha-J4: fix foot sliding and polish a walk with curves in ≤ 10 touches (the Pencil where it fits)', async ({
  page,
}, testInfo) => {
  await journey(page, 'pen', testInfo);
});

test('ha-J4f: the same with fingers only in ≤ 10 touches', async ({ page }, testInfo) => {
  await journey(page, 'finger', testInfo);
});

test('ha-J4 on webkit-ipad: the walk opens in Curves and Move Y shows alone (single taps)', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'webkit-ipad', 'webkit-ipad only');
  await openHalo(page);
  await loadSample(page, 'seed-san');
  const character = (await call(page, 'characters'))[0]?.id ?? '';
  await runOk(page, 'library.useClip', { character, clip: 'walk' });
  const walk = (await call(page, 'clips')).find((clip) => clip.name === 'Walk');
  if (walk === undefined) throw new Error('no Walk');
  await runOk(page, 'clip.setActive', { clip: walk.id });
  const goal = (await call(page, 'controls')).find((c) => c.name === 'L Leg IK')?.id ?? '';
  await runOk(page, 'select.controls', { ids: [goal], mode: 'replace' }, { panel: 'viewport', paneId: 'pane-single' });
  const radio = await layerRadio(page, 'Curves');
  await page.touchscreen.tap(radio.x, radio.y);
  await curvesReady(page);
  const chip = await centreOf(page, 'halo-curves-chip-Move Y');
  await page.touchscreen.tap(chip.x, chip.y);
  await expect.poll(async () => (await curves(page)).curves.length).toBe(1);
  expect((await curves(page)).axisLabels.map((l) => l.text)).toContain('0');
});
