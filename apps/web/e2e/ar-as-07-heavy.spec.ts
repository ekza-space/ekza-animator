// AUTORIG-SPEC §11 AS-AR-7 (D7, in full; D3 and D4 own its parts): "Heavy mesh". The Cube Lad's boxes subdivided to
// 262,848 triangles are refused on ① with the decimation hint (nothing imported); the 84,672-triangle variant warns,
// *Next* asks once, and *Auto-rig* runs with *Cancel* working mid-bind: one undo step left ("Create Skeleton"), ③ says
// so, and *Bind again* finishes the rig.
import { expect, test } from '@playwright/test';
import { onStep } from './helpers/ar-as';
import { openAutoRigReady } from './helpers/ar-host';
import { chooseFile, waitForReport } from './helpers/ar-model';
import { quickRig, wizard } from './helpers/ar-markers';
import { stepsSince, subdividedCubeLad } from './helpers/ar-rig';
import { history } from './helpers/autorig';
import { call } from './helpers/test-api';

test('AS-AR-7: 250k triangles are refused; 80k warns, rigs, and Cancel mid-bind leaves one step', async ({ page }) => {
  test.setTimeout(300_000);
  await openAutoRigReady(page);
  await chooseFile(page, 'cube-lad-262k.glb', subdividedCubeLad(37));
  await expect(page.getByTestId('ar-status')).toContainText(
    "Reduce it to under 200,000 triangles (your 3D tool's decimate or reduce-polygons command) and try again.",
    { timeout: 60_000 },
  );
  expect(await history(page)).toEqual({ undo: [], redo: [] });
  expect((await call(page, 'counts'))['meshes'] ?? 0).toBe(0);

  await chooseFile(page, 'cube-lad-detailed.glb', subdividedCubeLad(21));
  const state = await waitForReport(page, 'cube-lad-detailed.glb');
  expect(state.intake).toMatchObject({ weight: 'heavy', triangles: 84_672 });
  await expect(page.getByTestId('ar-heavy')).toContainText('Very detailed model');
  await page.getByTestId('ar-primary').click(); // e2e mode answers the one confirm at once
  await onStep(page, 'markers');
  expect((await wizard(page)).slices['model']).toMatchObject({ heavyConfirmed: true });
  await expect.poll(async () => (await quickRig(page))?.preview?.length ?? 0, { timeout: 60_000 }).toBeGreaterThan(0);

  const before = (await history(page)).undo;
  const cancelled = page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const observer = new MutationObserver(() => {
          const button = document.querySelector<HTMLButtonElement>('[data-testid="ar-rig-cancel"]');
          if (button === null) return;
          observer.disconnect();
          button.click();
          resolve();
        });
        observer.observe(document.body, { subtree: true, childList: true });
      }),
  );
  await page.getByTestId('ar-primary').click();
  await cancelled;
  await expect.poll(async () => (await wizard(page)).busy, { timeout: 60_000 }).toBeNull();
  await onStep(page, 'rig');
  expect(await stepsSince(page, before)).toEqual(['Create Skeleton']);
  await expect(page.getByTestId('ar-rig-unbound-text')).toHaveText('Skeleton created; skinning cancelled');
  await page.getByTestId('ar-rig-bind-again').click();
  await expect.poll(async () => (await history(page)).undo.at(-1), { timeout: 120_000 }).toBe('Bind Skin');
  await expect.poll(async () => (await wizard(page)).done['rig'], { timeout: 60_000 }).toBe(true);
});
