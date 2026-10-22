// AUTORIG-SPEC §11 AS-AR-12 (D7, in full; D1, D3 and D4 own its parts), §8.3: "Tablet and phone". At 1024×768 with
// touch, AS-AR-1 steps 2–7 by touch: the model through *Choose file…* (tapped), *Next*, the Elbow dragged back in
// SIDE with one finger (x bit-equal), *Auto-rig*, the motion test's Sword, *Animations ▸*, Walk with In place, *Add*.
// At 390×844 with touch: Studio first (its Rig & Skin is view-only below 1024 px), then Auto-Rig on the same page — ②
// one pane at a time with the Front │ Side │ 3D switch and the panel as a bottom sheet, `autorig.rig` runs after the
// Studio visit (the view-only rule is Studio's, AR-V1), and *Paint weights* says it needs a larger screen.
import { expect, type Page, test } from '@playwright/test';
import { onStep } from './helpers/ar-as';
import { expectAutoRigShown, navigate, openAutoRigReady } from './helpers/ar-host';
import { fixtureBytes, waitForReport } from './helpers/ar-model';
import { markerAt, type QuickRigView, quickRig, SIDE, wizard } from './helpers/ar-markers';
import { markerOf, stepsSince } from './helpers/ar-rig';
import { history } from './helpers/autorig';
import { call, openEditor, runOk } from './helpers/test-api';

type Point = { x: number; y: number };

/** A one-finger drag through CDP touch events. */
async function touchDrag(page: Page, from: Point, to: Point, steps = 8): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...from, id: 0 }] });
  for (let i = 1; i <= steps; i++) {
    const at = { x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...at, id: 0 }] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

test.describe('tablet 1024×768 touch', () => {
  test.use({ viewport: { width: 1024, height: 768 }, hasTouch: true });

  test('AS-AR-12: AS-AR-1 steps 2–7 by touch', async ({ page }) => {
    test.setTimeout(300_000);
    await openAutoRigReady(page);
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.getByRole('button', { name: 'Choose file…' }).first().tap(),
    ]);
    await chooser.setFiles({
      name: 'polybot-unskinned-tpose.glb',
      mimeType: 'model/gltf-binary',
      buffer: fixtureBytes('polybot-unskinned-tpose.glb'),
    });
    await waitForReport(page, 'polybot-unskinned-tpose.glb');
    await page.getByTestId('ar-primary').tap();
    await onStep(page, 'markers');
    await expect.poll(async () => (await quickRig(page))?.preview?.length ?? 0, { timeout: 30_000 }).toBeGreaterThan(0);
    await expect(page.getByTestId('ar-panes')).toHaveAttribute('data-panes', '3');

    // the Elbow tapped in the list, then dragged 2 cm back in SIDE with one finger: x unchanged, bit for bit
    await page.getByTestId('quickrig-marker-elbow').tap();
    await expect.poll(async () => (await quickRig(page))?.selected).toBe('elbow');
    const stacked = (await quickRig(page)) as QuickRigView;
    const toe = await markerAt(page, 'toe', 'R', SIDE);
    const ankle = await markerAt(page, 'ankle', 'R', SIDE);
    const dz = markerOf(stacked, 'toe')[2]! - markerOf(stacked, 'ankle')[2]!;
    const perPx = Math.abs(dz) / Math.abs(toe.x - ankle.x);
    const zRight = Math.sign(toe.x - ankle.x) * Math.sign(dz);
    const elbow = await markerAt(page, 'elbow', 'R', SIDE);
    await touchDrag(page, elbow, { x: elbow.x + (-0.02 / perPx) * zRight, y: elbow.y });
    await expect.poll(async () => markerOf(await quickRig(page), 'elbow')[2]).not.toBe(markerOf(stacked, 'elbow')[2]);
    const dragged = (await quickRig(page)) as QuickRigView;
    expect(markerOf(dragged, 'elbow')[0]).toBe(markerOf(stacked, 'elbow')[0]);
    expect(markerOf(dragged, 'elbow')[2]).toBeLessThan(markerOf(stacked, 'elbow')[2]! - 0.01);

    // Auto-rig, tapped: two steps, ③ done; the motion test's Sword
    const before = (await history(page)).undo;
    await page.getByTestId('ar-primary').tap();
    await onStep(page, 'rig', 60_000);
    await expect.poll(async () => (await wizard(page)).busy, { timeout: 60_000 }).toBeNull();
    expect(await stepsSince(page, before)).toEqual(['Create Skeleton', 'Bind Skin']);
    await expect.poll(async () => (await wizard(page)).done['rig']).toBe(true);
    await page.locator('[data-testid="ar-rig-motion"] [data-clip="sword-attack"]').tap();
    await expect.poll(async () => (await call(page, 'library'))?.preview?.clip).toBe('sword-attack');

    // Animations ▸, Walk, In place, Add — all tapped
    await page.getByTestId('ar-primary').tap();
    await onStep(page, 'animations');
    await page.getByTestId('ar-clip-card-walk').tap();
    await expect.poll(async () => (await call(page, 'library'))?.preview?.clip).toBe('walk');
    await page.getByTestId('ar-param-inplace').tap();
    await expect(page.getByTestId('ar-param-inplace')).toBeChecked();
    await page.getByTestId('ar-clip-add').tap();
    await expect.poll(async () => (await history(page)).undo.at(-1)).toBe('Use Clip Walk');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});

test.describe('phone 390×844 touch', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('AS-AR-12: after Studio, ② one pane at a time, Auto-rig runs, Paint weights needs a larger screen', async ({
    page,
  }) => {
    test.setTimeout(300_000);
    // Studio first: Rig & Skin is view-only below 1024 px there
    await openEditor(page);
    await runOk(page, 'workspace.set', { workspace: 'rig' });
    await navigate(page, { to: 'autorig', from: 'studio' });
    await expectAutoRigShown(page);
    await page.locator('[data-sample="cube-lad"]').tap();
    await waitForReport(page, 'cube-lad.glb');
    await page.getByTestId('ar-primary').tap();
    await onStep(page, 'markers');
    await expect.poll(async () => (await quickRig(page))?.preview?.length ?? 0, { timeout: 30_000 }).toBeGreaterThan(0);

    // ② one pane, the switch; the panel is a bottom sheet below the pane
    await expect(page.getByTestId('ar-panes')).toHaveAttribute('data-panes', '1');
    const ids = async () => (await call(page, 'panes')).map((pane) => pane.id).sort();
    const switcher = page.getByTestId('ar-markers-pane-switch');
    for (const [kind, id] of [
      ['side', 'pane-side'],
      ['persp', 'pane-persp'],
      ['front', 'pane-front'],
    ] as const) {
      await switcher.locator(`[data-pane="${kind}"]`).tap();
      await expect.poll(ids).toEqual([id]);
    }
    const panes = await page.getByTestId('ar-panes').boundingBox();
    const panel = await page.getByTestId('ar-step-panel').boundingBox();
    expect(panel?.y ?? 0).toBeGreaterThanOrEqual((panes?.y ?? 0) + (panes?.height ?? 0) - 1);
    expect(panel?.width ?? 0).toBeGreaterThanOrEqual(389);

    // Auto-rig runs after the Studio visit (Studio's view-only rule never refuses Auto-Rig's edits)
    const before = (await history(page)).undo;
    await page.getByTestId('ar-primary').tap();
    await onStep(page, 'rig', 60_000);
    await expect.poll(async () => (await wizard(page)).busy, { timeout: 60_000 }).toBeNull();
    expect(await stepsSince(page, before)).toEqual(['Create Skeleton', 'Bind Skin']);

    // Paint weights: the phone notice, no brush controls
    await page.getByTestId('ar-rig-paint').tap();
    await expect(page.getByTestId('ar-rig-paint-phone')).toHaveText('Painting needs a larger screen');
    await expect(page.getByTestId('pw-controls')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
