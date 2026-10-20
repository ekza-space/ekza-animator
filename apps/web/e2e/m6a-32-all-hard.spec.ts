import { expect, type Page, test } from '@playwright/test';
import {
  counts,
  emptySpot,
  expectAllHard,
  hoverPane,
  openKeyMenu,
  openShiftRmbMenu,
  releaseOnSlot,
  runMenuItem,
  topEdge,
  topFace,
} from './helpers/m6a-model-ops-ui';
import { type ComponentKind, createPrimitive, MODEL_PANE, modKey, openModel, setMode } from './helpers/m6a-model';
import { call, expectKernelStarted, runOk } from './helpers/test-api';

// E2E-MOD-32 "All-hard through the UI" (M6A-SPEC §10.1, §5.3; owner B11): new meshes are faceted (every edge hard),
// and every base tool keeps them so — run once through its menu, marking-menu or key path on a fresh faceted cube,
// afterwards no edge is soft and every corner normal is its face's normal (1e-6).
//
// Gates (§10.1): b3, b4, b5 (the kernel ops), b10 (component modes and selections). The B11 check below runs today:
// the Shift+RMB primitives menu over empty space in object mode (B11's data in B9's marking menu) with its §8.4 slots
// and reasons.

/** Selects components of the cube through `select.components` (B10's picker path) in their mode. */
async function selectIn(page: Page, mesh: string, kind: ComponentKind, indices: readonly number[]): Promise<void> {
  await setMode(page, kind);
  await runOk(page, 'select.components', { mesh, kind, indices, mode: 'replace' });
}

/** The two opposite edges of the top face (its corners a b c d: edges a–b and c–d). */
async function oppositeTopEdges(page: Page, mesh: string): Promise<[number, number]> {
  const top = await topFace(page, mesh);
  const corners = (await call(page, 'meshFaces', mesh))[top] ?? [];
  const edges = await call(page, 'meshEdges', mesh);
  const find = (a: number, b: number): number =>
    edges.findIndex((e) => (e.v[0] === a && e.v[1] === b) || (e.v[0] === b && e.v[1] === a));
  return [find(corners[0] ?? -1, corners[1] ?? -1), find(corners[2] ?? -1, corners[3] ?? -1)];
}

/** Border edges (one face). */
async function borderEdges(page: Page, mesh: string): Promise<number[]> {
  return (await call(page, 'meshEdges', mesh)).flatMap((edge, index) => (edge.faces === 1 ? [index] : []));
}

const mod = async (page: Page, key: string): Promise<void> => page.keyboard.press(`${await modKey(page)}+${key}`);

type Case = { readonly name: string; readonly run: (page: Page, cube: string) => Promise<void> };

const CASES: readonly Case[] = [
  {
    name: 'Extrude (Mod+E)',
    async run(page, cube) {
      await selectIn(page, cube, 'face', [await topFace(page, cube)]);
      await hoverPane(page);
      await mod(page, 'KeyE');
    },
  },
  {
    name: 'Inset (Shift+RMB face menu, N)',
    async run(page, cube) {
      await selectIn(page, cube, 'face', [await topFace(page, cube)]);
      expect(await openShiftRmbMenu(page, await emptySpot(page))).toBe('model.tools.face');
      await releaseOnSlot(page, 'N');
    },
  },
  {
    name: 'Bevel (Mod+B)',
    async run(page, cube) {
      await selectIn(page, cube, 'edge', [(await topEdge(page, cube)).edge]);
      await hoverPane(page);
      await mod(page, 'KeyB');
    },
  },
  {
    name: 'Insert Edge Loop (Edit Mesh menu)',
    async run(page, cube) {
      await selectIn(page, cube, 'edge', [(await topEdge(page, cube)).edge]);
      await runMenuItem(page, 'edit-mesh', 'builtin.model.edit-mesh.insertLoop');
    },
  },
  {
    name: 'Multi-Cut (mesh.cut)',
    async run(page, cube) {
      const [a, b] = await oppositeTopEdges(page, cube);
      await setMode(page, 'edge');
      await runOk(page, 'mesh.cut', {
        meshes: [cube],
        kind: 'edge',
        points: [
          { kind: 'edge', edge: a, t: 0.5 },
          { kind: 'edge', edge: b, t: 0.5 },
        ],
      });
    },
  },
  {
    name: 'Connect (Edit Mesh menu)',
    async run(page, cube) {
      await selectIn(page, cube, 'edge', await oppositeTopEdges(page, cube));
      await runMenuItem(page, 'edit-mesh', 'builtin.model.edit-mesh.connect');
    },
  },
  {
    name: 'Bridge (Edit Mesh menu, after deleting two opposite faces)',
    async run(page, cube) {
      const faces = await call(page, 'meshFaces', cube);
      const top = await topFace(page, cube);
      const corners = new Set(faces[top]);
      const bottom = faces.findIndex((face, f) => f !== top && face.every((v) => !corners.has(v)));
      await selectIn(page, cube, 'face', [top, bottom]);
      await hoverPane(page);
      await page.keyboard.press('Delete');
      await expect.poll(() => counts(page, cube)).toBe('8/12/4');
      await selectIn(page, cube, 'edge', await borderEdges(page, cube));
      await runMenuItem(page, 'edit-mesh', 'builtin.model.edit-mesh.bridge');
    },
  },
  {
    name: 'Fill Hole (Mesh menu)',
    async run(page, cube) {
      await selectIn(page, cube, 'face', [await topFace(page, cube)]);
      await hoverPane(page);
      await page.keyboard.press('Delete');
      await expect.poll(() => counts(page, cube)).toBe('8/12/5');
      await selectIn(page, cube, 'edge', await borderEdges(page, cube));
      await runMenuItem(page, 'mesh', 'builtin.model.mesh.fillHole');
    },
  },
  {
    name: 'Merge to Center (M, N)',
    async run(page, cube) {
      await selectIn(page, cube, 'face', [await topFace(page, cube)]);
      await hoverPane(page, MODEL_PANE, -200, 0);
      expect(await openKeyMenu(page, 'KeyM')).toBe('model.merge');
      await page.getByTestId('mm-model.merge').getByTestId('mm-slot-N').click();
    },
  },
  {
    name: 'Collapse (Shift+RMB edge menu, SE)',
    async run(page, cube) {
      await selectIn(page, cube, 'edge', [(await topEdge(page, cube)).edge]);
      expect(await openShiftRmbMenu(page, await emptySpot(page))).toBe('model.tools.edge');
      await releaseOnSlot(page, 'SE');
    },
  },
  {
    name: 'Delete Edge/Vertex (Mod+Delete)',
    async run(page, cube) {
      await selectIn(page, cube, 'edge', [(await topEdge(page, cube)).edge]);
      await hoverPane(page);
      await mod(page, 'Delete');
    },
  },
  {
    name: 'Mirror (Mesh menu)',
    async run(page) {
      await setMode(page, 'object');
      await runMenuItem(page, 'mesh', 'builtin.model.mesh.mirror');
    },
  },
  {
    name: 'Triangulate (Mesh menu)',
    async run(page) {
      await setMode(page, 'object');
      await runMenuItem(page, 'mesh', 'builtin.model.mesh.triangulate');
    },
  },
  {
    name: 'Spin Edge (Ctrl+Alt+→)',
    async run(page, cube) {
      await selectIn(page, cube, 'edge', [(await topEdge(page, cube)).edge]);
      await hoverPane(page);
      await page.keyboard.press('Control+Alt+ArrowRight');
    },
  },
];

for (const { name, run } of CASES) {
  test(`E2E-MOD-32 — ${name} keeps a faceted cube all-hard`, async ({ page }) => {
    await openModel(page);
    const cube = await createPrimitive(page, 'cube');
    expect((await call(page, 'meshes')).find((row) => row.id === cube)?.faceted).toBe(true);
    await expectAllHard(page, cube);
    const before = (await call(page, 'meshInfo', cube))?.manifest;
    await run(page, cube);
    await expect.poll(async () => (await call(page, 'meshInfo', cube))?.manifest).not.toBe(before);
    await expectAllHard(page, cube);
  });
}

test('B11 — Shift+RMB over empty space in object mode: the primitives menu (§8.4)', async ({ page }) => {
  await openModel(page);
  await expectKernelStarted(page);
  const point = await emptySpot(page);
  expect(await openShiftRmbMenu(page, point)).toBe('model.primitives');
  const primitives = await call(page, 'markingMenu');
  expect(Object.fromEntries(Object.entries(primitives?.slots ?? {}).map(([slot, item]) => [slot, item.label]))).toEqual(
    {
      N: 'Cube',
      NE: 'Cylinder',
      E: 'Sphere',
      SE: 'Plane',
      S: 'Cone',
      SW: 'Torus',
      W: 'Humanoid Body…',
      NW: 'Primitive Options…',
    },
  );
  expect(primitives?.slots['NW']?.enabled).toBe(false);
  await releaseOnSlot(page, 'NE');
  await expect.poll(async () => (await call(page, 'lastOp'))?.id).toBe('mesh.create.cylinder');
  expect((await call(page, 'lastOp'))?.source).toBe('marking-menu');
  const cylinder = (await call(page, 'lastOp'))?.targets[0] ?? '';
  await expect.poll(() => counts(page, cylinder)).toBe('16/24/10');

  // The released menu is closed. (The object tools over a mesh need the mesh's display and picking, B6 and B10.)
  expect(await call(page, 'markingMenu')).toBeNull();
});
