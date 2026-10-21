// E2E-MOD-14 (M6A-SPEC §10.1, §5.20; owner B7, no gates): autosave and recovery with a mesh. A page creates a cube
// (no kernel op needed) and writes its recovery point; a second page opens on the same storage namespace; the first
// page reloads. Both pages list the slot, recover it (the second, then the first) and see the same revision: the mesh
// blobs live in the autosave store's IndexedDB `blobs` store and load lazily into each page's blob store. Separately,
// File › Save writes the mesh blobs into the `.ekzanim`: saving twice gives byte-identical archives and opening the
// file brings back the identical manifest.
import { expect, type Page, test } from '@playwright/test';
import { createPrimitive, meshRuntime } from './helpers/m6a-model';
import { call, expectKernelStarted, lastExport, loadFile, openEditor, runOk, waitForTestApi } from './helpers/test-api';

const URL_QUERY = '&ws=model&ns=m14';

async function meshRow(page: Page, mesh: string) {
  return (await call(page, 'meshes')).find((row) => row.id === mesh);
}

async function countsOf(page: Page, mesh: string): Promise<string | null> {
  const info = await call(page, 'meshInfo', mesh);
  return info === null ? null : `${info.counts.v}/${info.counts.e}/${info.counts.f}`;
}

test('E2E-MOD-14: autosave and recovery with a mesh', async ({ page, context }) => {
  test.setTimeout(120_000);
  await openEditor(page, URL_QUERY);
  await expectKernelStarted(page);
  const mesh = await createPrimitive(page, 'cube', { subdivisionsWidth: 2 });
  expect(await countsOf(page, mesh)).toBe('12/20/10');
  const manifest = (await meshRow(page, mesh))?.manifest ?? null;
  expect(manifest).toMatch(/^[0-9a-f]{64}$/);
  const slot = (await call(page, 'autosave')).slot ?? '';
  expect(slot).toMatch(/^as_[0-9A-Za-z]{16}$/);
  await page.evaluate(() => window.__EKZA_STUDIO_TEST__?.flushAutosave());
  expect((await call(page, 'autosave')).lastSavedAt).not.toBeNull();

  // A second page on the same namespace, then the first page reloads (its slot becomes an orphan).
  const second = await context.newPage();
  await openEditor(second, URL_QUERY);
  await expectKernelStarted(second);
  await page.reload();
  await waitForTestApi(page);

  // Both pages list the slot (File › Recover… looks again in the second page).
  await expect.poll(async () => (await call(page, 'state')).recovery).toContain(slot);
  await runOk(second, 'ui.open', { dialog: 'recovery' });
  await expect.poll(async () => (await call(second, 'state')).recovery).toContain(slot);

  // Recover in the second page, then in the first: the same revision in both.
  await runOk(second, 'file.recover', { slot });
  await runOk(page, 'file.recover', { slot });
  for (const p of [second, page]) {
    await expect.poll(() => meshRuntime(p, mesh)).toBe('ready');
    expect((await meshRow(p, mesh))?.manifest).toBe(manifest);
    expect((await call(p, 'meshes'))[0]?.manifest).toBe(manifest);
    expect(await countsOf(p, mesh)).toBe('12/20/10');
  }
  await second.close();

  // Separately: File › Save twice (byte-identical archives), then File › Open of the saved file.
  const saved = await runOk<{ fileName: string; bytes: number }>(page, 'file.save');
  const first = await lastExport(page);
  await runOk(page, 'file.save');
  const again = await lastExport(page);
  expect(first?.fileName).toBe(saved.fileName);
  expect(first?.bytes.byteLength).toBe(saved.bytes);
  expect(again?.bytes.equals(first?.bytes ?? Buffer.alloc(0))).toBe(true);
  await page.reload();
  await waitForTestApi(page);
  await loadFile(page, saved.fileName, new Uint8Array(first?.bytes ?? []));
  await expect.poll(() => meshRuntime(page, mesh)).toBe('ready');
  expect((await meshRow(page, mesh))?.manifest).toBe(manifest);
  expect(await countsOf(page, mesh)).toBe('12/20/10');
});
