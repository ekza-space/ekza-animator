import { expect, type Page, test } from '@playwright/test';

// The /dev/panels harness of the shared test kit (MVP-SPEC §7 WP-0b): e2e builds serve it; the fake app is exposed
// as window.__EKZA_DEV_PANELS__ for panel specs.

interface DevPanelsWindow {
  __EKZA_DEV_PANELS__?: {
    readonly app: {
      runUntyped(id: string, args?: unknown): Promise<unknown>;
      readonly calls: readonly { readonly id: string; readonly args: unknown }[];
    };
  };
}

const rz = (page: Page) => page.getByTestId('dev-state-value-fk.lowerArm.L-rz');

test('the panel harness lists panels and mounts dev.state with a working fake app', async ({ page }) => {
  await page.goto('/dev/panels');
  await expect(page.getByTestId('dev-panels-index')).toBeVisible();
  await page.getByTestId('dev-panels-link-dev.state').click();
  await expect(page).toHaveURL(/\/dev\/panels\?panel=dev\.state$/);

  await expect(page.getByTestId('dev-panels-title')).toHaveText('Fake app state');
  await expect(page.getByTestId('dev-state-count-controls')).toHaveText('27');
  await expect(page.getByTestId('dev-state-count-keys')).toHaveText('3');
  await expect(rz(page)).toHaveText('30.000');

  for (let i = 0; i < 15; i++) await page.getByTestId('dev-state-next').click();
  await expect(page.getByTestId('dev-state-frame')).toHaveText('15');
  await expect(rz(page)).toHaveText('-30.000');

  await page.getByTestId('dev-state-offset').click();
  await expect(rz(page)).toHaveText('-20.000');
  await expect(page.getByTestId('dev-state-undo-label')).toHaveText('Offset Keys');
  await page.getByTestId('dev-state-undo').click();
  await expect(rz(page)).toHaveText('-30.000');

  const calls = await page.evaluate(async () => {
    const harness = (window as DevPanelsWindow).__EKZA_DEV_PANELS__;
    await harness?.app.runUntyped('time.setFrame', { frame: 3 });
    return harness?.app.calls.map((call) => call.id) ?? null;
  });
  expect(calls).toEqual(['time.setFrame']);
});

test('an unknown panel id shows the index with a notice', async ({ page }) => {
  await page.goto('/dev/panels?panel=acme.nothing');
  await expect(page.getByTestId('dev-panels-unknown')).toContainText("'acme.nothing'");
  await expect(page.getByTestId('dev-panels-link-dev.state')).toBeVisible();
});
