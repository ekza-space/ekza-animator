// B11 e2e helpers (M6A-SPEC §3 rule 5, §10.1): the Last-op card (expand, type into a field), the pane under the
// pointer, mesh counts and geometry reads used by E2E-MOD-07, -09, -19 and -32, and Shift+RMB marking menus.
import { expect, type Page } from '@playwright/test';
import { MODEL_PANE } from './m6a-model';
import { call } from './test-api';

export type Vec3 = readonly [number, number, number];

/** Moves the pointer to the middle of a viewport pane (keys resolve in the pane's scope; RMB opens its menus). */
export async function hoverPane(
  page: Page,
  paneId: string = MODEL_PANE,
  dx = 0,
  dy = 0,
): Promise<{ x: number; y: number }> {
  const pane = (await call(page, 'panes')).find((entry) => entry.id === paneId);
  if (pane === undefined) throw new Error(`no pane ${paneId}`);
  const point = { x: pane.rect.x + pane.rect.w / 2 + dx, y: pane.rect.y + pane.rect.h / 2 + dy };
  await page.mouse.move(point.x, point.y);
  return point;
}

/** Empty space in a pane: left of the centre, where the Model empty-state card does not take the press (B9). */
export async function emptySpot(page: Page, paneId: string = MODEL_PANE): Promise<{ x: number; y: number }> {
  const pane = (await call(page, 'panes')).find((entry) => entry.id === paneId);
  if (pane === undefined) throw new Error(`no pane ${paneId}`);
  return { x: pane.rect.x + 160, y: pane.rect.y + pane.rect.h / 2 };
}

/** `V/E/F` of a mesh (B7's `meshInfo`). */
export async function counts(page: Page, mesh: string): Promise<string> {
  const info = await call(page, 'meshInfo', mesh);
  return info === null ? 'none' : `${info.counts.v}/${info.counts.e}/${info.counts.f}`;
}

/** Expands the Last-op card when it is a pill (§8.6: collapsed until a click or `T`). */
export async function expandCard(page: Page, paneId: string = MODEL_PANE): Promise<void> {
  const card = page.getByTestId(`lastop-card-${paneId}`);
  await expect(card).toBeVisible();
  if ((await card.getAttribute('data-state')) !== 'expanded') await page.getByTestId('lastop-pill').click();
  await expect(card).toHaveAttribute('data-state', 'expanded');
}

/** `lastop-field-<param>` = text, then Enter (expands the card first). */
export async function setCardField(
  page: Page,
  param: string,
  text: string,
  paneId: string = MODEL_PANE,
): Promise<void> {
  await expandCard(page, paneId);
  const field = page.getByTestId(`lastop-field-${param}`);
  await field.fill(text);
  await field.press('Enter');
}

/** Types characters with the keyboard (the capture window or a focused field), then Enter. */
export async function typeAndEnter(page: Page, text: string): Promise<void> {
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
}

/** Positions (local) of a mesh's vertices. */
export async function positions(page: Page, mesh: string): Promise<Vec3[]> {
  return (await call(page, 'meshPositions', mesh)) as unknown as Vec3[];
}

/** Centroid of a face (mean of its corners' positions). */
export async function faceCentroid(page: Page, mesh: string, face: number): Promise<Vec3> {
  const faces = await call(page, 'meshFaces', mesh);
  const points = await positions(page, mesh);
  const corners = faces[face] ?? [];
  const sum = [0, 0, 0];
  for (const v of corners) {
    const p = points[v] ?? [0, 0, 0];
    for (let k = 0; k < 3; k++) sum[k] = (sum[k] ?? 0) + (p[k] ?? 0);
  }
  return [sum[0]! / corners.length, sum[1]! / corners.length, sum[2]! / corners.length];
}

/** The face whose centroid is highest (the cube's top: its Newell normal is +Y). */
export async function topFace(page: Page, mesh: string): Promise<number> {
  const faces = await call(page, 'meshFaces', mesh);
  let best = -1;
  let bestY = -Infinity;
  for (let f = 0; f < faces.length; f++) {
    const y = (await faceCentroid(page, mesh, f))[1];
    if (y > bestY + 1e-9) {
      bestY = y;
      best = f;
    }
  }
  return best;
}

/** A top edge of the unit cube running along `axis` (both ends at y = 0.5), with its endpoints. */
export async function topEdge(
  page: Page,
  mesh: string,
  axis: 'x' | 'z' = 'x',
): Promise<{ readonly edge: number; readonly ends: readonly [Vec3, Vec3] }> {
  const edges = await call(page, 'meshEdges', mesh);
  const points = await positions(page, mesh);
  const k = axis === 'x' ? 0 : 2;
  for (let e = 0; e < edges.length; e++) {
    const [a, b] = edges[e]?.v ?? [0, 0];
    const pa = points[a];
    const pb = points[b];
    if (pa === undefined || pb === undefined) continue;
    if (pa[1] > 0.49 && pb[1] > 0.49 && Math.abs(pa[k] - pb[k]) > 0.5) return { edge: e, ends: [pa, pb] };
  }
  throw new Error(`no top edge along ${axis}`);
}

/** Opens a Shift+RMB marking menu at a point and returns its id (the controller loads lazily: retried). */
export async function openShiftRmbMenu(page: Page, point: { x: number; y: number }): Promise<string | null> {
  await page.mouse.move(point.x, point.y);
  let id: string | null = null;
  await expect
    .poll(async () => {
      await page.keyboard.down('Shift');
      await page.mouse.down({ button: 'right' });
      const open = await call(page, 'markingMenu');
      id = open?.id ?? null;
      if (open === null) {
        await page.mouse.up({ button: 'right' });
        await page.keyboard.up('Shift');
      }
      return id;
    })
    .not.toBeNull();
  return id;
}

/**
 * Taps a marking-menu key over the hovered pane (`M`: the merge menu) until a menu opens; returns its id. B11's menus
 * arrive with the first Model entry's chunk, so a tap right after the page opened may find none yet (the help line
 * says so and nothing else happens): it is tapped again.
 */
export async function openKeyMenu(page: Page, key: string): Promise<string | null> {
  let id: string | null = null;
  await expect
    .poll(async () => {
      await page.keyboard.press(key);
      id = (await call(page, 'markingMenu'))?.id ?? null;
      return id;
    })
    .not.toBeNull();
  return id;
}

/** Releases a held Shift+RMB menu on a slot (press-drag-release). */
export async function releaseOnSlot(page: Page, slot: string): Promise<void> {
  const open = await call(page, 'markingMenu');
  const at = open?.screenOfSlot[slot];
  if (at === undefined) throw new Error(`no slot ${slot} in ${open?.id ?? 'no menu'}`);
  await page.mouse.move(at.x, at.y, { steps: 4 });
  await page.mouse.up({ button: 'right' });
  await page.keyboard.up('Shift');
}

/** Runs a menu-bar item (`menu-<menu>` then `menu-item-<id>`). */
export async function runMenuItem(page: Page, menu: string, itemId: string): Promise<void> {
  await page.getByTestId(`menu-${menu}`).click();
  await page.getByTestId(`menu-item-${itemId}`).click();
}

/**
 * No edge is soft (§5.3) and every corner normal is its face's normal (1e-6; E2E-MOD-32). The test API lists corner
 * normals by corner index without their faces (corners are linked lists, `faceCorner`/`cornerNext`, which it does not
 * expose; contract-PR suggestion for INT in the B11 notes: a `cornerFace` list in `meshNormals`), so the check is by
 * counts: every corner normal equals a face normal, and for each distinct face normal exactly as many corners carry it
 * as the faces with that normal have corners. A corner that took a neighbouring face's normal, or a smoothed one,
 * fails; only a swap between two faces' corners would pass, which no normal computation produces.
 */
export async function expectAllHard(page: Page, mesh: string): Promise<void> {
  expect((await call(page, 'shading', mesh)).softEdges).toBe(0);
  const normals = await call(page, 'meshNormals', mesh);
  if (normals === null) throw new Error(`no normals for ${mesh}`);
  const faces = await call(page, 'meshFaces', mesh);
  const same = (a: readonly number[], b: readonly number[]): boolean =>
    [0, 1, 2].every((c) => Math.abs((a[c] ?? 0) - (b[c] ?? 0)) <= 1e-6);
  const groups: { readonly normal: readonly number[]; expected: number; actual: number }[] = [];
  faces.forEach((loop, f) => {
    const normal = normals.face[f] ?? [];
    let group = groups.find((g) => same(g.normal, normal));
    if (group === undefined) {
      group = { normal, expected: 0, actual: 0 };
      groups.push(group);
    }
    group.expected += loop.length;
  });
  const off: number[] = [];
  normals.corner.forEach((normal, c) => {
    const group = groups.find((g) => same(g.normal, normal));
    if (group === undefined) off.push(c);
    else group.actual++;
  });
  expect(off).toEqual([]);
  expect(normals.corner).toHaveLength(faces.reduce((sum, loop) => sum + loop.length, 0));
  expect(groups.map((g) => g.actual)).toEqual(groups.map((g) => g.expected));
}
