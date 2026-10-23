// AR-D8-4 (Auto-Rig acceptance fix round 1, D8): after *Auto-rig* the ortho panes of ② (back to Markers) and of ③'s
// *Adjust joints* frame the whole body — head top to toes in SIDE, both hands in FRONT — and `F` keeps it so. The
// display model of a model-sourced character loads after Create Skeleton, so the first frame with the character fitted
// the joints alone (the head top and the hands cut); the untouched views frame again once
// the display is there, and Rig & Skin's bounds count the bound meshes mesh-view draws (the display hides them).
import { expect, type Page, test } from '@playwright/test';
import { openAutoRigReady } from './helpers/ar-host';
import { chooseFile, rootTransformed } from './helpers/ar-model';
import {
  FRONT,
  markerAt,
  type Point,
  polybotMarkers,
  quickRig,
  SIDE,
  sampleAtMarkers,
  toMarkers,
  wizard,
} from './helpers/ar-markers';
import { expectStudioShown } from './helpers/ar-host';
import { autoRig, subjectCharacter } from './helpers/ar-rig';
import { paneRect } from './helpers/g1-viewport';
import { call } from './helpers/test-api';

/** Whether a point lies inside a pane with `margin` px to spare. */
async function inside(page: Page, paneId: string, point: Point | null, margin: number): Promise<boolean> {
  if (point === null) return false;
  const r = await paneRect(page, paneId);
  return (
    point.x >= r.x + margin && point.x <= r.x + r.w - margin && point.y >= r.y + margin && point.y <= r.y + r.h - margin
  );
}

/** The body fits FRONT and SIDE: head top and toe in SIDE, head top and both hands (wrist + hand length) in FRONT. */
async function expectWholeBody(page: Page, at: (name: string, side: 'R' | 'L', pane: string) => Promise<Point | null>) {
  const truth = polybotMarkers('tpose');
  const head = truth.markers['headTop'] as readonly number[];
  const toe = truth.markers['toe'] as readonly number[];
  const wrist = truth.markers['wrist'] as readonly number[];
  // hands reach ~0.11 m past the wrist (the mesh's x bounds ±0.566 m)
  const hand = 0.566 - Math.abs(wrist[0] as number);
  for (const pane of [FRONT, SIDE]) {
    const top = await at('headTop', 'R', pane);
    const bottom = await at('toe', 'R', pane);
    expect(await inside(page, pane, top, 4), `head top in ${pane}`).toBe(true);
    expect(await inside(page, pane, bottom, 4), `toe in ${pane}`).toBe(true);
    const pxPerM =
      Math.abs((bottom as Point).y - (top as Point).y) / Math.abs((head[1] as number) - (toe[1] as number));
    if (pane === FRONT) {
      for (const side of ['R', 'L'] as const) {
        const w = await at('wrist', side, pane);
        expect(await inside(page, pane, w, hand * pxPerM), `${side} hand in FRONT`).toBe(true);
      }
    }
  }
}

test('AR-D8-4: back on ② after Auto-rig and in ③ Adjust joints the panes frame the whole body; F keeps it', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await sampleAtMarkers(page, 'polybot-tpose');
  await autoRig(page);
  const { character } = await subjectCharacter(page);
  // ② again: Quick Rig re-runs on the character
  await page.keyboard.press('Alt+Digit2');
  await expect.poll(async () => (await wizard(page)).step).toBe('markers');
  await expect.poll(async () => (await quickRig(page))?.markers['headTop'] ?? null).not.toBeNull();
  const marker = (name: string, side: 'R' | 'L', pane: string) => markerAt(page, name, side, pane);
  await expect
    .poll(async () => inside(page, SIDE, await marker('headTop', 'R', SIDE), 4), { timeout: 10_000 })
    .toBe(true);
  await expectWholeBody(page, marker);
  // the rig's controls (the yellow IK rings) are hidden in ②'s panes
  expect(await yellowPixels(page, FRONT)).toBeLessThan(40);
  // F over SIDE frames the same whole body
  const side = await paneRect(page, SIDE);
  await page.mouse.move(side.x + side.w / 2, side.y + side.h / 2);
  await page.keyboard.press('KeyF');
  await expectWholeBody(page, marker);

  // ③ Adjust joints: the same panes, joints instead of markers (head tail = the head top, hands at the wrists)
  await page.keyboard.press('Alt+Digit3');
  await expect.poll(async () => (await wizard(page)).step).toBe('rig');
  await page.getByTestId('ar-rig-adjust').click();
  await expect(page.locator('[data-pane-label]').first()).toBeVisible();
  const joints = (await call(page, 'skeleton', character))?.joints ?? [];
  const byBone = (bone: string) => joints.find((joint) => joint.humanBone === bone)?.id as string;
  const jointMap: Record<string, string> = {
    headTop: byBone('head'),
    toe: byBone('rightToes') ?? byBone('rightFoot'),
  };
  const joint = async (name: string, side: 'R' | 'L', pane: string): Promise<Point | null> => {
    const id = name === 'wrist' ? byBone(side === 'R' ? 'rightHand' : 'leftHand') : jointMap[name];
    return id === undefined ? null : call(page, 'screenOfJoint', id, pane);
  };
  for (const pane of [FRONT, SIDE]) {
    await expect.poll(async () => inside(page, pane, await joint('headTop', 'R', pane), 4)).toBe(true);
    await expect.poll(async () => inside(page, pane, await joint('toe', 'R', pane), 4)).toBe(true);
  }
  for (const side of ['R', 'L'] as const) {
    await expect.poll(async () => inside(page, FRONT, await joint('wrist', side, FRONT), 20)).toBe(true);
  }
  // no control rings over the joints either; back in review they stay hidden too (AR-D9-8: the character is judged
  // clean; Studio draws them again, below)
  expect(await yellowPixels(page, FRONT)).toBeLessThan(40);
  await page.getByTestId('ar-rig-done').click();
  await expect.poll(async () => (await wizard(page)).slices['rig']).toMatchObject({ sub: 'review' });
  // AR-D8-9: the review pane frames the character (it kept ②'s narrow-pane camera: the body stood small)
  const persp = await paneRect(page, 'pane-persp');
  const span = async (): Promise<number> => {
    const head = await call(page, 'screenOfJoint', byBone('head'), 'pane-persp');
    const toe = await joint('toe', 'R', 'pane-persp');
    return head === null || toe === null ? 0 : Math.abs(toe.y - head.y) / persp.h;
  };
  // frame all on the T-posed Polybot: the head joint to the toes ≈ 0.34 of the pane (0.2 with ②'s narrow camera)
  await expect.poll(span, { timeout: 10_000 }).toBeGreaterThan(0.28);
  await page.waitForTimeout(300);
  expect(await yellowPixels(page, 'pane-persp')).toBeLessThan(40);
  // Studio gets the panes' controls back (Auto-Rig hid them only while its steps were shown)
  await page.getByTestId('ar-open-studio').click();
  await expectStudioShown(page);
  await expect.poll(async () => yellowPixels(page, 'pane-persp'), { timeout: 30_000 }).toBeGreaterThan(40);
});

/** The mean colour of a square of a pane around a page point. */
async function meanColour(page: Page, paneId: string, at: Point, half = 10): Promise<[number, number, number]> {
  const read = await call(page, 'pixels', paneId, Math.round(at.x - half), Math.round(at.y - half), 2 * half, 2 * half);
  if (read === null) return [0, 0, 0];
  let [r, g, b] = [0, 0, 0];
  for (let i = 0; i < read.data.length; i += 4) {
    r += read.data[i] as number;
    g += read.data[i + 1] as number;
    b += read.data[i + 2] as number;
  }
  const n = read.data.length / 4;
  return [r / n, g / n, b / n];
}

test('AR-D9-3: a re-rig from ② leaves the mesh opaque in ③ (no x-ray left over from the joint fitting)', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await sampleAtMarkers(page, 'polybot-tpose');
  await autoRig(page);
  const { character } = await subjectCharacter(page);
  const toggle = page.getByTestId('ar-rig-motion-toggle');
  if (/on/.test(await toggle.innerText())) await toggle.click();
  const joints = (await call(page, 'skeleton', character))?.joints ?? [];
  const bone = (name: string) => joints.find((joint) => joint.humanBone === name)?.id as string;
  const chest = async (): Promise<Point> => {
    const p = await call(page, 'screenOfBone', bone('spine'), bone('chest'), 'pane-persp', 0.5);
    return p === null ? { x: -100, y: -100 } : { x: p.x + 12, y: p.y };
  };
  await page.waitForTimeout(500);
  const before = await meanColour(page, 'pane-persp', await chest());
  expect(before[1]).toBeGreaterThan(120);
  // ◂ Back to ②, then Auto-rig again with the markers unchanged
  await page.keyboard.press('Alt+Digit2');
  await expect.poll(async () => (await wizard(page)).step).toBe('markers');
  await expect.poll(async () => (await quickRig(page))?.markers['headTop'] ?? null).not.toBeNull();
  await autoRig(page);
  if (/on/.test(await toggle.innerText())) await toggle.click();
  await page.waitForTimeout(500);
  // the chest is as bright as after the first rig (x-ray drew it dark and see-through)
  await expect
    .poll(async () => (await meanColour(page, 'pane-persp', await chest()))[1], { timeout: 10_000 })
    .toBeGreaterThan(0.85 * before[1]);
});

/** Pixels of a pane in the controls' yellow (the IK and FK rings). */
async function yellowPixels(page: Page, paneId: string): Promise<number> {
  const r = await paneRect(page, paneId);
  const read = await call(page, 'pixels', paneId, r.x, r.y, r.w, r.h);
  if (read === null) return 0;
  let n = 0;
  for (let i = 0; i < read.data.length; i += 4) {
    const [red, green, blue] = [read.data[i] as number, read.data[i + 1] as number, read.data[i + 2] as number];
    if (red > 200 && green > 170 && blue < 110) n++;
  }
  return n;
}

test('AR-D9-11: ② frames a tall T-posed body whole, hands included, in FRONT, SIDE and 3D', async ({ page }) => {
  test.setTimeout(120_000);
  // Polybot ×1.6: 1.8 m tall with a 1.8 m arm span, like a full-size mannequin (the narrow FRONT cut the hands)
  await openAutoRigReady(page);
  await chooseFile(
    page,
    'polybot-tall.glb',
    rootTransformed('polybot-unskinned-tpose.glb', { scale: [1.6, 1.6, 1.6] }),
  );
  await expect.poll(async () => (await wizard(page)).done.model, { timeout: 30_000 }).toBe(true);
  await toMarkers(page);
  const marker = (name: string, side: 'R' | 'L', pane: string) => markerAt(page, name, side, pane);
  // the frame follows the layout (two frames after Quick Rig starts)
  await expect
    .poll(async () => inside(page, FRONT, await marker('wrist', 'L', FRONT), 20), { timeout: 10_000 })
    .toBe(true);
  // uniform scale: the truth's metres cancel out of expectWholeBody's px-per-metre
  await expectWholeBody(page, marker);
  for (const side of ['R', 'L'] as const) {
    expect(await inside(page, 'pane-persp', await marker('wrist', side, 'pane-persp'), 10), `${side} wrist in 3D`).toBe(
      true,
    );
  }
});
