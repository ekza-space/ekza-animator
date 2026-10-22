// E2E-AR-05 (AUTORIG-SPEC §10 D4, §5.4, §4.5; AS-AR-7's ③ part): the 80k variant — the Cube Lad's boxes as
// subdivided grids (84,672 triangles, built in memory) — loaded through ①'s picker (it warns; Next asks once), rigged
// from ②. While the bind runs the progress sheet is modal: the undo key does nothing (the history keeps "Create
// Skeleton" on top); *Cancel* (`autorig.cancel`) stops the bind and leaves exactly one undo step, the skeleton; ③
// says "Skeleton created; skinning cancelled" and *Bind again* binds it (one "Bind Skin" step).
import { expect, test } from '@playwright/test';
import { chooseFile, waitForReport } from './helpers/ar-model';
import { openAutoRigReady } from './helpers/ar-host';
import { toMarkers, wizard } from './helpers/ar-markers';
import { stepsSince, subdividedCubeLad } from './helpers/ar-rig';
import { history } from './helpers/autorig';
import { modKey } from './helpers/m6a-model';
import { call } from './helpers/test-api';

test('AS-AR-7 (③ part): Cancel mid-bind on the 80k variant leaves the skeleton step; Bind again binds', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await openAutoRigReady(page);
  await chooseFile(page, 'cube-lad-detailed.glb', subdividedCubeLad(21));
  const state = await waitForReport(page, 'cube-lad-detailed.glb');
  expect(state.intake).toMatchObject({ weight: 'heavy', triangles: 84_672 });
  await toMarkers(page);
  const before = (await history(page)).undo;
  const mac = (await modKey(page)) === 'Meta';
  // While the bind runs the sheet offers Cancel: the moment it appears (a DOM observer in the page — a fast machine
  // would otherwise finish the bind first) the undo key is pressed, then Cancel is clicked.
  const armed = page.evaluate(
    (meta) =>
      new Promise<{ before: string[]; after: string[]; stage: string | null }>((resolve) => {
        const observer = new MutationObserver(() => {
          const button = document.querySelector<HTMLButtonElement>('[data-testid="ar-rig-cancel"]');
          if (button === null) return;
          observer.disconnect();
          const api = window.__EKZA_STUDIO_TEST__;
          const before = api?.history().undo ?? [];
          window.dispatchEvent(
            new KeyboardEvent('keydown', {
              code: 'KeyZ',
              key: 'z',
              metaKey: meta,
              ctrlKey: !meta,
              bubbles: true,
              cancelable: true,
            }),
          );
          const after = api?.history().undo ?? [];
          const stage = document.querySelector('[data-testid="ar-rig-sheet"]')?.getAttribute('data-stage') ?? null;
          button.click();
          resolve({ before, after, stage });
        });
        observer.observe(document.body, { subtree: true, childList: true });
      }),
    mac,
  );
  await page.getByTestId('ar-primary').click();
  const seen = await armed;
  expect(seen.stage).toBe('skin');
  expect(seen.before.at(-1)).toBe('Create Skeleton');
  expect(seen.after).toEqual(seen.before);
  await expect.poll(async () => (await wizard(page)).busy, { timeout: 30_000 }).toBeNull();
  await expect(page.getByTestId('ar-rig-sheet')).toHaveCount(0);
  expect(await stepsSince(page, before)).toEqual(['Create Skeleton']);
  await expect.poll(async () => (await wizard(page)).step).toBe('rig');
  await expect(page.getByTestId('ar-rig-unbound-text')).toHaveText('Skeleton created; skinning cancelled');
  expect((await wizard(page)).done.rig).toBe(false);
  await expect(page.getByTestId('ar-primary')).toBeDisabled();

  // Bind again: one "Bind Skin" step (the sheet shows the bind), ③ done
  await page.getByTestId('ar-rig-bind-again').click();
  await expect.poll(async () => (await history(page)).undo.at(-1), { timeout: 120_000 }).toBe('Bind Skin');
  await expect.poll(async () => (await wizard(page)).busy, { timeout: 30_000 }).toBeNull();
  expect(await stepsSince(page, before)).toEqual(['Create Skeleton', 'Bind Skin']);
  const character = (await wizard(page)).subject.character ?? '';
  const mesh = (await call(page, 'characters')).find((row) => row.id === character)?.meshes[0] ?? '';
  expect((await call(page, 'skin', mesh))?.skeleton).not.toBeNull();
  await expect(page.getByTestId('ar-rig-unbound')).toHaveCount(0);
});
