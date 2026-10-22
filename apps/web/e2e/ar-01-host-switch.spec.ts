import { expect, test } from '@playwright/test';
import { autorig, hasTestApi, history, loaded, SHELL_MARKERS, scriptsOf } from './helpers/autorig';
import {
  buildAnimatedCubeLad,
  documentState,
  enterRigWorkspace,
  expectAutoRigShown,
  expectStudioShown,
  glKept,
  importStatic,
  markPage,
  navigate,
  openAutoRigReady,
  pageMark,
  tagGl,
} from './helpers/ar-host';
import { hoverViewport } from './helpers/m6b-clip-library';
import { call, expectKernelStarted, openEditor, renderedFrames } from './helpers/test-api';

// E2E-AR-01 (AUTORIG-SPEC §10 D1; the D1 part of AS-AR-3): one EditorApp per page under the `(studio)` layout. The
// test API is the host's on both routes; a document built through operators (`mesh.importStatic`,
// `skel.quickRig.commit`, `skin.bind`, `library.useClip`) survives `/editor` → `/autorig` → `/editor` through the
// navigation port with its undo history, store version, records, selection, autosave slot and its very WebGL canvas
// and context — no page load —
// and `Mod+Z` in Studio afterwards undoes "Use Clip Walk".

test('the host installs the test API on /autorig: history, records, frames and probes answer', async ({ page }) => {
  await openAutoRigReady(page);
  expect(await hasTestApi(page)).toBe(true);
  expect(await history(page)).toEqual({ undo: [], redo: [] });
  expect((await call(page, 'counts'))['characters'] ?? 0).toBe(0);
  expect(await renderedFrames(page)).toBeGreaterThanOrEqual(0);
  expect(await page.evaluate(() => window.__EKZA_STUDIO_TEST__?.webgl.ok)).toBe(true);
  // Auto-Rig never shows Studio's first-run dialog, and the placeholder shell registers no wizard state yet.
  expect((await call(page, 'state')).dialog).toBeNull();
  expect(await autorig(page)).toBeNull();
  await expect(page.locator(`[data-shell="${SHELL_MARKERS.autorig}"]`)).toBeVisible();
});

test('Studio → Auto-Rig → Studio on one page keeps the document, its undo history and the GL context', async ({
  page,
}) => {
  const scripts = scriptsOf(page);
  await openEditor(page, '&platform=mac');
  await expectKernelStarted(page);
  await buildAnimatedCubeLad(page);
  const before = await documentState(page);
  expect(before.history.undo.slice(-3)).toEqual(['Create Skeleton', 'Bind Skin', 'Use Clip Walk']);
  await markPage(page);
  await tagGl(page);
  expect(loaded(scripts, SHELL_MARKERS.autorig)).toBe(false);

  // Studio → Auto-Rig (a client navigation: the layout and its host stay).
  await navigate(page, { to: 'autorig', from: 'studio' });
  await expectAutoRigShown(page);
  await expect(page).toHaveURL(/\/autorig\?e2e=1&platform=mac&from=studio$/);
  expect(await pageMark(page)).toBe('kept');
  expect(await documentState(page)).toEqual(before);
  expect(loaded(scripts, SHELL_MARKERS.autorig)).toBe(true);
  // The same canvas and the same WebGL context (one per page load), still live, and the canvas renders on.
  expect(await glKept(page)).toEqual({ canvas: true, context: true, lost: false });
  const frames = await renderedFrames(page);
  await call(page, 'state');
  expect(await renderedFrames(page)).toBeGreaterThanOrEqual(frames);

  // Auto-Rig → Studio's Animate workspace (Open in Studio from ④).
  await navigate(page, { to: 'studio', workspace: 'animate', from: 'autorig' });
  await expectStudioShown(page);
  await expect(page).toHaveURL(/\/editor\?e2e=1&platform=mac&ws=animate&from=autorig$/);
  expect(await pageMark(page)).toBe('kept');
  expect(await documentState(page)).toEqual(before);
  expect(await glKept(page)).toEqual({ canvas: true, context: true, lost: false });
  await expect.poll(async () => (await call(page, 'state')).workspace).toBe('animate');
  expect((await call(page, 'workspaces')).find((ws) => ws.active)?.id).toBe('animate');

  // Mod+Z undoes "Use Clip Walk": the history crossed both switches.
  await hoverViewport(page);
  await page.keyboard.press('Meta+KeyZ');
  await expect.poll(async () => (await history(page)).redo).toEqual(['Use Clip Walk']);
  expect((await history(page)).undo).toEqual(before.history.undo.slice(0, -1));
});

test("the first-run dialog is Studio's only; Studio's operators come back with its shell after a round trip", async ({
  page,
}) => {
  // A fresh profile opening Auto-Rig sees no first-run dialog (its prefs stay untouched) …
  await openAutoRigReady(page, '&firstRun=1');
  await expect(page.locator(`[data-shell="${SHELL_MARKERS.autorig}"]`)).toBeVisible();
  await page.waitForTimeout(300);
  await expect(page.getByTestId('firstrun-dialog')).toHaveCount(0);
  expect((await call(page, 'state')).dialog).toBeNull();
  // A page that started on /autorig keeps its host too: the document made there reaches Studio.
  await enterRigWorkspace(page);
  await importStatic(page, 'cube-lad.glb');
  const made = await documentState(page);
  expect(made.history.undo).toEqual(['Import Static Model']);
  await markPage(page);
  // … Studio, on the same page, asks once.
  await navigate(page, { to: 'studio', from: 'autorig' });
  await expectStudioShown(page);
  expect(await pageMark(page)).toBe('kept');
  expect(await documentState(page)).toEqual(made);
  // Arriving by a switch without a workspace, Studio keeps the session's (Rig & Skin), not the remembered one.
  expect((await call(page, 'state')).workspace).toBe('rig');
  const dialog = page.getByTestId('firstrun-dialog');
  await expect(dialog).toBeVisible();
  await page.getByTestId('firstrun-done').click();
  await expect(dialog).toBeHidden();

  await navigate(page, { to: 'autorig', from: 'studio' });
  await expectAutoRigShown(page);
  // Studio's own operators left with its shell; the host's stayed (dialogs open on every route).
  expect(await page.evaluate(async () => (await window.__EKZA_STUDIO_TEST__?.run('workspace.reset'))?.status)).toBe(
    'cancelled',
  );
  expect(
    await page.evaluate(async () => (await window.__EKZA_STUDIO_TEST__?.run('ui.open', { dialog: 'about' }))?.status),
  ).toBe('finished');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await navigate(page, { to: 'studio', from: 'autorig' });
  await expectStudioShown(page);
  await page.waitForTimeout(300);
  await expect(page.getByTestId('firstrun-dialog')).toHaveCount(0);
  expect(
    await page.evaluate(
      async () => (await window.__EKZA_STUDIO_TEST__?.run('workspace.showPanel', { panel: 'outliner' }))?.status,
    ),
  ).toBe('finished');
});
