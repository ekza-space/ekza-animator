import { expect, test } from '@playwright/test';
import { modKey, openModel } from './helpers/m6a-model';
import { counts, hoverPane } from './helpers/m6a-model-ops-ui';
import { createBody, faceTable, inPane, partners, quadLayout, type Vec3 } from './helpers/m6a-model-topology-tools';
import { call } from './helpers/test-api';

// E2E-MOD-04 "Symmetry: extrude both arms" (M6A-SPEC §10.1, §5.8, §5.14; owner B12b). The humanoid body with
// Object X symmetry; a click on the left hand's end cap in `pane-side` selects it (its partner is in the expanded
// set; the HUD reads "1 (+1 sym)"); `Mod+E`, `0.1`, `Enter` extrudes both caps in mirror-consistent frames: two
// single-face extrudes of an n-gon (+2n/+4n/+2n), the caps' centroids mirror images, every vertex partnered, one step.
//
// Gates (§10.1): b12a (`model.symmetry.set`, `symmetry()`), b13 (the humanoid body template).

const SIDE = 'pane-side';

test.fixme('b12a, b13: E2E-MOD-04 — symmetry: extrude both arms', async ({ page }) => {
  await openModel(page);
  await quadLayout(page);
  const body = await createBody(page);
  await hoverPane(page, SIDE);
  await page.keyboard.press('Digit3');
  await expect.poll(async () => (await call(page, 'state')).mode).toBe('face');
  const table = await faceTable(page, body);
  // The left hand's end cap: the largest centroid x, its normal ≈ +X.
  const cap = table.reduce((best, face) => (face.centroid[0] > best.centroid[0] ? face : best));
  expect(cap.normal[0]).toBeGreaterThan(0.9);
  const vp = await partners(page, body);
  const mirrorVerts = new Set(cap.verts.map((v) => vp[v]));
  const partnerFace = table.find(
    (face) => face.verts.length === cap.verts.length && face.verts.every((v) => mirrorVerts.has(v)),
  );
  expect(partnerFace).toBeDefined();
  const at = await call(page, 'screenOfFace', body, cap.f, SIDE);
  if (at === null || !(await inPane(page, at, SIDE))) throw new Error('the hand cap is not visible inside pane-side');
  await page.mouse.click(at.x, at.y);
  await expect.poll(async () => (await call(page, 'model')).selected[body]?.face).toEqual([cap.f]);
  const expanded = (await call(page, 'model')).expanded[body]?.face ?? [];
  expect([...expanded].sort((a, b) => a - b)).toEqual([cap.f, partnerFace?.f ?? -1].sort((a, b) => a - b));
  const hud = await call(page, 'hud', SIDE);
  expect(hud?.selected['face']).toBe(1);
  expect(hud?.selectedSym['face']).toBe(1);

  const before = await call(page, 'meshInfo', body);
  const steps = (await call(page, 'history')).undo.length;
  await hoverPane(page, SIDE);
  await page.keyboard.press(`${await modKey(page)}+KeyE`);
  await page.keyboard.type('0.1');
  await page.keyboard.press('Enter');
  const n = cap.verts.length;
  const v0 = before?.counts.v ?? 0;
  const e0 = before?.counts.e ?? 0;
  const f0 = before?.counts.f ?? 0;
  await expect.poll(() => counts(page, body)).toBe(`${v0 + 2 * n}/${e0 + 4 * n}/${f0 + 2 * n}`);
  await expect.poll(async () => (await call(page, 'lastOp'))?.args['localTranslateZ']).toBe(0.1);
  // The two caps (they keep their face indices) are mirror images: x negated, y and z equal.
  const after = await faceTable(page, body);
  const left = after[cap.f]?.centroid as Vec3;
  const right = after[partnerFace?.f ?? -1]?.centroid as Vec3;
  expect(Math.abs(left[0] + right[0])).toBeLessThanOrEqual(1e-6);
  expect(Math.abs(left[1] - right[1])).toBeLessThanOrEqual(1e-6);
  expect(Math.abs(left[2] - right[2])).toBeLessThanOrEqual(1e-6);
  expect(left[0]).toBeGreaterThan(cap.centroid[0] + 0.09);
  expect((await call(page, 'symmetry', body))?.unmatched).toBe(0);
  expect((await call(page, 'history')).undo).toHaveLength(steps + 1);
});
