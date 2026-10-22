// Auto-Rig D1 e2e helpers (AUTORIG-SPEC §10 D1, E2E-AR-01): a rigged, animated document built through operators — the
// Cube Lad imported static (`mesh.importStatic`), Quick Rig committed with its truth markers (`skel.quickRig.commit`),
// `skin.bind`, then `library.useClip` Walk — and the shell switch through the host's navigation port
// (`autorig.navigate`, its palette/script wrapper). `autorig.sample` and `autorig.rig` are stubs at D1's merge.
import { readFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';
import { SHELL_MARKERS } from './autorig';
import { cubeLadTruth } from './m6b-cube-lad';
import { call, run, runOk, waitForTestApi } from './test-api';

const DEG = Math.PI / 180;

const fixture = (file: string): Uint8Array =>
  new Uint8Array(readFileSync(new URL(`../../../../fixtures/models/${file}`, import.meta.url)));

/** `mesh.importStatic` of a fixture model through the test API; returns the imported scene meshes. */
export async function importStatic(page: Page, file: string): Promise<string[]> {
  const base64 = Buffer.from(fixture(file)).toString('base64');
  const result = await page.evaluate(
    async ([data, name]) => {
      const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      return await window.__EKZA_STUDIO_TEST__?.run('mesh.importStatic', { bytes, name });
    },
    [base64, file] as const,
  );
  expect(result?.status, `mesh.importStatic: ${result?.reason ?? result?.error?.message ?? ''}`).toBe('finished');
  return (result?.value as { meshes: string[] } | undefined)?.meshes ?? [];
}

/** Enters Rig & Skin through `workspace.set` (any shell: the session's workspace, not a dock layout). */
export async function enterRigWorkspace(page: Page): Promise<void> {
  await runOk(page, 'workspace.set', { workspace: 'rig' });
  await expect.poll(async () => (await call(page, 'state')).workspace).toBe('rig');
}

/** The Cube Lad made a character with Quick Rig's commit (truth markers, Standard 33); returns the character. */
export async function rigCubeLad(page: Page): Promise<{ readonly character: string; readonly meshes: string[] }> {
  await enterRigWorkspace(page);
  const meshes = await importStatic(page, 'cube-lad.glb');
  const { character } = await runOk<{ character: string }>(page, 'skel.quickRig.commit', {
    preset: 'standard33',
    markers: cubeLadTruth().markers,
    meshes,
    flexion: 2 * DEG,
  });
  return { character, meshes };
}

/**
 * The D1 document of AS-AR-3 (§11): the Cube Lad rigged, bound and given the library's Walk, every step an undoable
 * operator run. Returns the character.
 */
export async function buildAnimatedCubeLad(page: Page): Promise<string> {
  const { character } = await rigCubeLad(page);
  await runOk(page, 'skin.bind', {});
  await runOk(page, 'library.useClip', { character, clip: 'walk' });
  await expect.poll(async () => (await call(page, 'history')).undo.at(-1)).toBe('Use Clip Walk');
  return character;
}

/** What a same-page switch must keep (§4.4): the history, the records, the selection, the autosave slot. */
export async function documentState(page: Page) {
  const state = await call(page, 'state');
  return {
    history: await call(page, 'history'),
    counts: await call(page, 'counts'),
    selection: state.selection,
    activeCharacter: state.activeCharacter,
    activeClip: state.activeClip,
    slot: (await call(page, 'autosave')).slot,
  };
}

/** Marks the page so a later read proves no page load happened in between. */
export function markPage(page: Page): Promise<void> {
  return page.evaluate(() => {
    (window as { __arPageMark?: string }).__arPageMark = 'kept';
  });
}

export function pageMark(page: Page): Promise<string | null> {
  return page.evaluate(() => (window as { __arPageMark?: string }).__arPageMark ?? null);
}

/** `/autorig` is shown: the Auto-Rig shell is mounted and Studio's is gone. */
export async function expectAutoRigShown(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/autorig(\?|$)/);
  await expect(page.locator(`[data-shell="${SHELL_MARKERS.autorig}"]`)).toBeVisible();
  await expect(page.getByTestId('editor-shell')).toHaveCount(0);
}

/** `/editor` is shown: Studio's shell is mounted and the Auto-Rig shell is gone. */
export async function expectStudioShown(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/editor(\?|$)/);
  await expect(page.getByTestId('editor-shell')).toBeVisible();
  await expect(page.locator(`[data-shell="${SHELL_MARKERS.studio}"]`)).toHaveCount(1);
  await expect(page.locator(`[data-shell="${SHELL_MARKERS.autorig}"]`)).toHaveCount(0);
}

/** Switches shells through the navigation port's operator wrapper (`autorig.navigate`). */
export async function navigate(
  page: Page,
  request: { to: 'autorig' | 'studio' | 'chooser'; workspace?: string; from?: 'studio' | 'autorig'; newTab?: boolean },
): Promise<void> {
  const result = await run(page, 'autorig.navigate', request);
  expect(result, JSON.stringify(result)).toMatchObject({ status: 'finished' });
}

/** The rows of this page's autosave database (`ns=<namespace>`): slot ids, whether each holds a snapshot. */
export function autosaveRows(page: Page, ns: string): Promise<{ id: string; snapshot: boolean; handoff: boolean }[]> {
  return page.evaluate(
    (name) =>
      new Promise<{ id: string; snapshot: boolean; handoff: boolean }[]>((resolve, reject) => {
        const open = indexedDB.open(name);
        open.onerror = () => reject(open.error ?? new Error('IndexedDB open failed'));
        open.onsuccess = () => {
          const db = open.result;
          const request = db.transaction('slots', 'readonly').objectStore('slots').getAll();
          request.onerror = () => reject(request.error ?? new Error('IndexedDB read failed'));
          request.onsuccess = () => {
            const rows = request.result as { id: string; snapshot: string | null; handoff?: unknown }[];
            db.close();
            resolve(
              rows.map((row) => ({ id: row.id, snapshot: row.snapshot !== null, handoff: row.handoff !== undefined })),
            );
          };
        };
      }),
    `ekza-animator-autosave-v1:${ns}`,
  );
}

/** Waits for a page's test API after it opened or navigated. */
export { waitForTestApi };
