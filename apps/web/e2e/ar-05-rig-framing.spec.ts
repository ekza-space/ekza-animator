// AR-D8-4 (Auto-Rig acceptance fix round 1, D8): after *Auto-rig* the ortho panes of ② (back to Markers) and of ③'s
// *Adjust joints* frame the whole body — head top to toes in SIDE, both hands in FRONT — and `F` keeps it so. The
// display model of a model-sourced character loads after Create Skeleton, so the first frame with the character fitted
// the joints alone (the head top and the hands cut); the untouched views frame again once
// the display is there, and Rig & Skin's bounds count the bound meshes mesh-view draws (the display hides them).
import { expect, type Page, test } from '@playwright/test';
import {
  FRONT,
  markerAt,
  type Point,
  polybotMarkers,
  quickRig,
  SIDE,
  sampleAtMarkers,
  wizard,
} from './helpers/ar-markers';
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
});
