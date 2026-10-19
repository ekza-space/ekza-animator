import { expect, test } from '@playwright/test';
import { modKey, openModel, withModifiers } from './helpers/m6a-model';
import { call, expectKernelStarted, openEditor, run } from './helpers/test-api';

// M6A-SPEC §9 B0a in the production editor: the M6a kernel-level test API, every new operator resolving and
// poll-failing cleanly, the `ws=` deep link, and (B9) the Model tab. No E2E-MOD scenario belongs to B0a; this file
// guards its foundation.

/** §6.1: every kernel op and set-op (stubs until their kernels land through `meshOperator`). */
const MESH_OPS = [
  'mesh.transformComponents',
  'mesh.extrude',
  'mesh.inset',
  'mesh.bevel',
  'mesh.insertLoop',
  'mesh.offsetLoop',
  'mesh.connect',
  'mesh.cut',
  'mesh.slide',
  'mesh.averageVertices',
  'mesh.bridge',
  'mesh.fillHole',
  'mesh.merge',
  'mesh.mergeToCenter',
  'mesh.mergeByDistance',
  'mesh.targetWeld',
  'mesh.collapse',
  'mesh.delete',
  'mesh.deleteEdgeVertex',
  'mesh.spinEdge',
  'mesh.flipTriangleEdge',
  'mesh.triangulate',
  'mesh.quadrangulate',
  'mesh.harden',
  'mesh.soften',
  'mesh.setNormalAngle',
  'mesh.reverse',
  'mesh.conform',
  'mesh.mirror',
  'mesh.symmetrize',
  'mesh.applyTransform',
  'mesh.uv.planar',
  'mesh.uv.box',
  'mesh.uv.cylindrical',
  'mesh.cleanup',
  'mesh.paint',
  'mesh.paint.fillShell',
  'mesh.paint.remap',
  'mesh.combine',
  'mesh.separate',
  'mesh.extract',
  'mesh.duplicateFaces',
];

/** §6.2: the editor operators. */
const EDITOR_OPS = [
  'workspace.set',
  'view.shading',
  'view.display.set',
  'ui.commandPalette',
  'ui.markingMenu',
  'select.mode',
  'model.hilite',
  'select.components',
  'select.mesh.loop',
  'select.mesh.ring',
  'select.mesh.grow',
  'select.mesh.shrink',
  'select.mesh.border',
  'select.mesh.shell',
  'select.mesh.all',
  'select.mesh.invert',
  'select.mesh.none',
  'select.mesh.convert',
  'select.mesh.matching',
  'select.mesh.bySwatch',
  'select.objects',
  'select.mesh.pickWalk',
  'view.hide',
  'view.showAll',
  'view.isolate',
  'model.symmetry.set',
  'model.softSelect.set',
  'model.softSelect.toggle',
  'model.selectionStyle.set',
  'model.cameraBased.set',
  'model.backfaces.toggle',
  'model.constraint.set',
  'model.snap.toggle',
  'model.pivot.editToggle',
  'mesh.pivot.set',
  'mesh.pivot.center',
  'mesh.pivot.bottomCenter',
  'mesh.pivot.reset',
  'mesh.pivot.bake',
  'mesh.resetTransforms',
  'mesh.freezeTransforms',
  'scene.object.transform',
  'edit.adjustLast',
  'edit.repeatLast',
  'model.animateOnly',
  'tool.last',
  'view.lastOpCard',
  'mesh.create.cube',
  'mesh.create.sphere',
  'mesh.create.cylinder',
  'mesh.create.cone',
  'mesh.create.plane',
  'mesh.create.torus',
  'mesh.create.template',
  'mesh.primitive.set',
  'mesh.makeEditable',
  'mesh.setAttributes',
  'palette.ensureDefault',
  'palette.create',
  'palette.duplicate',
  'palette.rename',
  'palette.addSwatch',
  'palette.setSwatch',
  'palette.removeSwatch',
  'palette.assign',
  'palette.replaceSwatch',
  'palette.setActive',
  'imagePlane.import',
  'imagePlane.set',
  'imagePlane.delete',
  'scene.group',
  'scene.parent',
  'scene.unparent',
  'scene.duplicate',
  'scene.delete',
  'scene.rename',
  'file.exportModel',
];

/** Operators their owners have landed (no longer stubs): B7's `mesh.create.*` (M6A-SPEC §6.2). */
const LANDED = new Set(['cube', 'sphere', 'cylinder', 'cone', 'plane', 'torus'].map((kind) => `mesh.create.${kind}`));

test('every M6a operator resolves and poll-fails cleanly; the document stays untouched', async ({ page }) => {
  await openEditor(page);
  await expectKernelStarted(page);
  const before = await call(page, 'counts');
  const refused: string[] = [];
  for (const op of [...MESH_OPS, ...EDITOR_OPS].filter((id) => !LANDED.has(id))) {
    // `run` fails the test for an unregistered operator or a stub that reaches its apply (helpers/test-api.ts).
    const result = await run(page, op);
    if (result.status !== 'cancelled' || (result.reason ?? '') === '') refused.push(`${op}: ${JSON.stringify(result)}`);
  }
  expect(refused).toEqual([]);
  expect(MESH_OPS.length + EDITOR_OPS.length).toBe(42 + 77);
  expect(await call(page, 'counts')).toEqual(before);
  expect(await call(page, 'history')).toEqual({ undo: [], redo: [] });
});

test('the M6a kernel-level test API answers in Animate', async ({ page }) => {
  await openEditor(page);
  await expectKernelStarted(page);
  expect(await call(page, 'state')).toMatchObject({
    workspace: 'animate',
    mode: 'object',
    hilite: [],
    capture: { armed: null, field: null, text: null },
    extrudeSession: false,
  });
  const workspaces = await call(page, 'workspaces');
  expect(workspaces.find((workspace) => workspace.id === 'animate')).toMatchObject({
    label: 'Animate',
    enabled: true,
    active: true,
    glyph: 'todo',
  });
  // Animate's key resolution is unchanged: S keys the selection over a viewport pane, Mod+Z undoes anywhere.
  expect(await call(page, 'resolveKey', { code: 'KeyS' }, { panel: 'viewport', paneId: 'pane-right' })).toMatchObject({
    op: 'key.set',
  });
  expect(await call(page, 'resolveKey', { code: 'KeyZ', mod: true }, { panel: 'graph' })).toMatchObject({
    op: 'edit.undo',
  });
  expect(await call(page, 'meshes')).toEqual([]);
  expect(await call(page, 'meshInfo', 'msh_None')).toBeNull();
  expect(await call(page, 'blobs')).toEqual({ resident: 0, residentBytes: 0, historyBytes: 0, journalBytes: 0 });
  expect(await call(page, 'history')).toEqual({ undo: [], redo: [] });
});

test('ws=<id> opens only registered, enabled workspaces (unknown ids keep Animate)', async ({ page }) => {
  await openEditor(page, '&ws=review');
  await expectKernelStarted(page);
  expect((await call(page, 'state')).workspace).toBe('animate');
  await openEditor(page, '&ws=animate');
  expect((await call(page, 'state')).workspace).toBe('animate');
});

// The shared click helpers (helpers/m6a-model.ts, closed after B0a) press the key the editor reads as `Mod` (§5.6:
// `Mod`-click removes, `Mod`+`Shift`-click adds): with the platform override and with the browser's own platform,
// `Mod`+I through `withModifiers` opens Import (`ui.open`, scope `global`) and the other modifier does not.
for (const platform of ['mac', 'other', null] as const) {
  test(`the model helpers hold the editor's Mod key (${platform === null ? "the browser's platform" : `platform=${platform}`})`, async ({
    page,
  }) => {
    await openEditor(page, platform === null ? '' : `&platform=${platform}`);
    await expectKernelStarted(page);
    const mod = await modKey(page);
    if (platform !== null) expect(mod).toBe(platform === 'mac' ? 'Meta' : 'Control');
    await page.keyboard.down(mod === 'Meta' ? 'Control' : 'Meta');
    await page.keyboard.press('KeyI');
    await page.keyboard.up(mod === 'Meta' ? 'Control' : 'Meta');
    expect((await call(page, 'state')).dialog).toBeNull();
    await withModifiers(page, ['Mod'], () => page.keyboard.press('KeyI'));
    await expect.poll(async () => (await call(page, 'state')).dialog).toBe('import');
  });
}

// Gate (M6A-SPEC §3 rule 4, §10.1): `test.fixme('b9…')` until B9 registers the Model workspace and the workspace tabs.
test.fixme('b9: the Model tab is present and ws=model opens it', async ({ page }) => {
  await openModel(page);
  await expect(page.getByTestId('ws-tab-model')).toBeVisible();
  await expect(page.getByTestId('ws-tab-animate')).toBeVisible();
});
