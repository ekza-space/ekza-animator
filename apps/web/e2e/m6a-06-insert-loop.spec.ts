import { expect, test } from '@playwright/test';
import { createPrimitive, openModel, setMode } from './helpers/m6a-model';
import { counts, openShiftRmbMenu, releaseOnSlot, runMenuItem } from './helpers/m6a-model-ops-ui';
import { expectTool, inPane, keyOver, verticalIn, visibleEdge } from './helpers/m6a-model-topology-tools';
import { call, runOk } from './helpers/test-api';

// E2E-MOD-06 "Insert Edge Loop: menu, G, tools" (M6A-SPEC §10.1, §5.11, §5.7; owner B12b). With the option box at
// Multiple / 3 loops: Edit Mesh › Insert Edge Loop on the selected vertical edge (`source: 'menu'`); `G` repeats it on
// another band's edge with the same values; the Insert Edge Loop **tool** (Shift+RMB edge N) honours the option box on
// a third band (`source: 'tool'`); `G` after a tool run re-activates the tool (counts unchanged); `G` after a
// Multi-Cut re-activates Multi-Cut. Gates (§10.1): — (green at B12b's merge).

test('E2E-MOD-06 — Insert Edge Loop from the menu, G, the tool, G after tools', async ({ page }) => {
  await openModel(page);
  const cylinder = await createPrimitive(page, 'cylinder');
  expect(await counts(page, cylinder)).toBe('16/24/10');
  await runOk(page, 'select.objects', { ids: [cylinder], mode: 'replace' });
  await setMode(page, 'edge');
  const first = await visibleEdge(page, cylinder, verticalIn(-0.5, 0.5));
  await runOk(page, 'select.components', { mesh: cylinder, kind: 'edge', indices: [first.e], mode: 'replace' });

  // The option box: Multiple, 3 loops (the defaults of the next run from the UI).
  await page.getByTestId('mtk-opt-mesh.insertLoop').click();
  const box = page.getByTestId('optbox-mesh.insertLoop');
  await expect(box).toBeVisible();
  await box.getByTestId('optbox-field-mode-multiple').click();
  await box.getByTestId('optbox-field-divisions').fill('3');
  await box.getByTestId('optbox-field-divisions').press('Enter');
  await box.getByTestId('optbox-close').click();
  await expect(box).toHaveCount(0);

  // Edit Mesh › Insert Edge Loop: three loops on the selected edge's ring.
  await runMenuItem(page, 'edit-mesh', 'builtin.model.edit-mesh.insertLoop');
  await expect.poll(() => counts(page, cylinder)).toBe('40/72/34');
  expect((await call(page, 'lastOp'))?.source).toBe('menu');

  // G on a vertical segment of another band: the same three loops there.
  const second = await visibleEdge(page, cylinder, verticalIn(0.25, 0.5));
  await runOk(page, 'select.components', { mesh: cylinder, kind: 'edge', indices: [second.e], mode: 'replace' });
  await keyOver(page, 'KeyG');
  await expect.poll(() => counts(page, cylinder)).toBe('64/120/58');

  // The tool (Shift+RMB edge N): a click on a third band honours the option box (Multiple, 3).
  const third = await visibleEdge(page, cylinder, verticalIn(-0.5, -0.25));
  expect(await openShiftRmbMenu(page, third.at)).toBe('model.tools.edge');
  await releaseOnSlot(page, 'N');
  await expectTool(page, 'insertLoop');
  const target = await visibleEdge(page, cylinder, verticalIn(-0.5, -0.25));
  await page.mouse.move(target.at.x, target.at.y, { steps: 4 });
  await page.mouse.down();
  await page.mouse.up();
  await expect.poll(() => counts(page, cylinder)).toBe('88/168/82');
  expect((await call(page, 'lastOp'))?.source).toBe('tool');

  // G after a tool run re-activates the tool; nothing else changes.
  await keyOver(page, 'KeyG');
  await expectTool(page, 'insertLoop');
  expect(await counts(page, cylinder)).toBe('88/168/82');

  // K, a two-point cut across one quad, RMB; then G re-activates Multi-Cut and changes no counts.
  await keyOver(page, 'KeyK');
  await expectTool(page, 'multiCut');
  const a = await visibleEdge(page, cylinder, verticalIn(0, 0.25), 0.5);
  const quad = await quadPartner(page, cylinder, a.e);
  await page.mouse.click(a.at.x, a.at.y);
  await page.mouse.click(quad.at.x, quad.at.y);
  await page.mouse.down({ button: 'right' });
  await page.mouse.up({ button: 'right' });
  await expect.poll(() => counts(page, cylinder)).toBe('90/171/83');
  await keyOver(page, 'KeyG');
  await expectTool(page, 'multiCut');
  expect(await counts(page, cylinder)).toBe('90/171/83');
});

/** The visible vertical edge that shares a quad with `e` (the opposite side of one of its faces). */
async function quadPartner(
  page: Parameters<typeof call>[0],
  mesh: string,
  e: number,
): Promise<{ readonly e: number; readonly at: { x: number; y: number } }> {
  const faces = await call(page, 'meshFaces', mesh);
  const edges = await call(page, 'meshEdges', mesh);
  const [a, b] = edges[e]?.v ?? [-1, -1];
  for (const face of faces) {
    if (face.length !== 4 || !face.includes(a) || !face.includes(b)) continue;
    const others = face.filter((v) => v !== a && v !== b);
    const opposite = edges.findIndex(
      (edge) => edge.v.includes(others[0] as number) && edge.v.includes(others[1] as number),
    );
    if (opposite < 0) continue;
    const at = await call(page, 'screenOfEdge', mesh, opposite, 'pane-persp', 0.5);
    if (at !== null && (await inPane(page, at))) return { e: opposite, at };
  }
  throw new Error(`no visible quad partner of edge ${e}`);
}
