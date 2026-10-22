// E2E-AR-05 (AUTORIG-SPEC §10 D4, §5.4, §4.5; AS-AR-7's ③ part): the 80k variant — the Cube Lad's boxes as
// subdivided grids (84,672 triangles, built in memory) — loaded through ①'s picker (it warns; Next asks once), rigged
// from ②. While the bind runs the progress sheet is modal (§4.5 exclusivity): the undo key does nothing (the history
// keeps "Create Skeleton" on top), and neither do the step keys `Alt+1` / `Alt+3` / `Alt+4`, `Mod+Enter`, `Delete`,
// `W` or `Esc` — the step stays ② and the sheet with its *Cancel* stays up; *Cancel* (`autorig.cancel`) stops the
// bind and leaves exactly one undo step, the skeleton; ③ says "Skeleton created; skinning cancelled" and *Bind again*
// binds it (one "Bind Skin" step).
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
  // would otherwise finish the bind first) the undo key is pressed, then the step, primary and tool keys at the
  // focused element (the step and the sheet are read after each, and once more a frame later), then Cancel is clicked.
  const armed = page.evaluate(
    (meta) =>
      new Promise<{
        before: string[];
        after: string[];
        stage: string | null;
        keys: { key: string; step: string | null; prevented: boolean; sheet: boolean }[];
        later: { step: string | null; sheet: boolean; cancel: boolean };
      }>((resolve) => {
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
          const presses: [string, string, KeyboardEventInit][] = [
            ['Alt+1', 'Digit1', { altKey: true, key: '1' }],
            ['Alt+3', 'Digit3', { altKey: true, key: '3' }],
            ['Alt+4', 'Digit4', { altKey: true, key: '4' }],
            ['Mod+Enter', 'Enter', { metaKey: meta, ctrlKey: !meta, key: 'Enter' }],
            ['Delete', 'Delete', { key: 'Delete' }],
            ['W', 'KeyW', { key: 'w' }],
            ['Esc', 'Escape', { key: 'Escape' }],
          ];
          const keys = presses.map(([name, code, init]) => {
            const event = new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true, ...init });
            (document.activeElement ?? document.body).dispatchEvent(event);
            return {
              key: name,
              step: api?.autorig()?.step ?? null,
              prevented: event.defaultPrevented,
              sheet: document.querySelector('[data-testid="ar-rig-sheet"]') !== null,
            };
          });
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              const later = {
                step: api?.autorig()?.step ?? null,
                sheet: document.querySelector('[data-testid="ar-rig-sheet"]') !== null,
                cancel: document.querySelector('[data-testid="ar-rig-cancel"]') !== null,
              };
              button.click();
              resolve({ before, after, stage, keys, later });
            }),
          );
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
  // §4.5 exclusivity: no key leaves ②, closes the sheet or reaches the browser while the bind runs
  for (const key of seen.keys) expect(key).toEqual({ key: key.key, step: 'markers', prevented: true, sheet: true });
  expect(seen.later).toEqual({ step: 'markers', sheet: true, cancel: true });
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
