import { expect, type Page, test } from '@playwright/test';
import { enterModel, setMode } from './helpers/m6a-model';
import { controlId, seedSample } from './helpers/seed';
import { call, expectKernelStarted, openEditor, runOk } from './helpers/test-api';

// E2E-MOD-30 "Seed-san face edit keeps MToon and expressions" (M6A-SPEC §10.1, §5.23; owner INT). Seed-san's head mesh
// is made editable in Model and gets an edge loop on the cheek; back in Animate the display rebuild (B8) reloads the
// character from the rebuilt container. The rebuilt model still draws its MToon outlines (the count of outline pixels
// in the framed head differs by < 10 % from before the edit), the `blink` expression still moves the eyelids (pixels
// differ between blink 0 and 1), and the VRM spring bones still simulate (a hair joint lags its kinematic pose while
// the chest turns). The rebuild time is reported (≤ 300 ms, §5.27 report row).
//
// Seed-san's outlines: the hair's MToon outline colour is black and the skin's a dark brown, so "outline pixels" are
// the near-black ones (max channel < 40); a rebuild that lost MToon would draw no outline and lose most of them.

const PANE = 'pane-right';
const DEG = Math.PI / 180;
const HAIR_JOINT = 'hair_tail_4'; // the end of the TailHair spring chain

interface Look {
  readonly outline: number;
  readonly pixels: readonly number[];
}

/** The framed head as drawn: the outline pixel count and the raw RGBA (for the blink comparison). */
async function look(page: Page): Promise<Look> {
  const pane = (await call(page, 'panes')).find((candidate) => candidate.id === PANE);
  if (pane === undefined) throw new Error(`no ${PANE}`);
  const read = await call(page, 'pixels', PANE, pane.rect.x, pane.rect.y, pane.rect.w, pane.rect.h);
  if (read === null) throw new Error('no pixels');
  let outline = 0;
  for (let i = 0; i < read.data.length; i += 4) {
    if (Math.max(read.data[i] ?? 0, read.data[i + 1] ?? 0, read.data[i + 2] ?? 0) < 40) outline++;
  }
  return { outline, pixels: read.data };
}

function changedPixels(a: readonly number[], b: readonly number[]): number {
  let changed = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) changed++;
  }
  return changed;
}

/** Frames the head in the perspective pane without controls drawn and with nothing selected. */
async function frameHead(page: Page, head: string): Promise<void> {
  await runOk(page, 'view.display.set', { patch: { controls: false }, paneId: PANE });
  await runOk(page, 'select.controls', { ids: [head], mode: 'replace' });
  await runOk(page, 'view.frame', { paneId: PANE });
  await runOk(page, 'select.controls', { ids: [], mode: 'replace' });
}

/** Blink 0 and 1 on the drawn model: the outline count at rest and how many pixels the blink changes. */
async function expressionLooks(page: Page, character: string): Promise<{ rest: Look; blinkChanged: number }> {
  await call(page, 'setExpression', character, 'blink', 0);
  const rest = await look(page);
  await call(page, 'setExpression', character, 'blink', 1);
  const blink = await look(page);
  await call(page, 'setExpression', character, 'blink', 0);
  return { rest, blinkChanged: changedPixels(rest.pixels, blink.pixels) };
}

/** Plays the chest turn with spring bones on: the largest gap between the drawn hair joint and its kinematic pose. */
async function springLag(page: Page, character: string): Promise<{ lag: number; moved: number }> {
  await runOk(page, 'time.setFrame', { frame: 0 });
  await runOk(page, 'view.display.set', { patch: { springBones: true }, paneId: PANE });
  await runOk(page, 'time.play');
  let lag = 0;
  const seen: (readonly number[])[] = [];
  for (let i = 0; i < 12; i++) {
    await page.waitForTimeout(50);
    const drawn = await call(page, 'displayNodeWorld', character, HAIR_JOINT);
    const kinematic = (await call(page, 'boneWorld', character, HAIR_JOINT)).t;
    if (drawn === null) throw new Error(`no drawn ${HAIR_JOINT}`);
    seen.push(drawn);
    lag = Math.max(lag, Math.hypot(drawn[0] - kinematic[0], drawn[1] - kinematic[1], drawn[2] - kinematic[2]));
  }
  await runOk(page, 'time.stop');
  await runOk(page, 'view.display.set', { patch: { springBones: false }, paneId: PANE });
  const first = seen[0] ?? [0, 0, 0];
  const moved = Math.max(
    ...seen.map((p) =>
      Math.hypot((p[0] ?? 0) - (first[0] ?? 0), (p[1] ?? 0) - (first[1] ?? 0), (p[2] ?? 0) - (first[2] ?? 0)),
    ),
  );
  return { lag, moved };
}

test('E2E-MOD-30 — a Seed-san face edit keeps MToon outlines, expressions and spring bones', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  await expectKernelStarted(page);
  const { character } = await seedSample(page, 'seed-san');
  // A chest turn for the spring check: ry 25° / −25° / 25° at frames 0 / 6 / 12.
  await runOk(page, 'clip.new', { name: 'turn' });
  const chest = await controlId(page, 'fk.chest', character);
  await runOk(page, 'select.controls', { ids: [chest], mode: 'replace' });
  for (const [frame, degrees] of [
    [0, 25],
    [6, -25],
    [12, 25],
  ] as const) {
    await runOk(page, 'time.setFrame', { frame });
    await runOk(page, 'channel.setValues', { edits: [{ control: chest, channel: 'ry', value: degrees * DEG }] });
    await runOk(page, 'key.set', { channels: 'rotate' });
  }
  await runOk(page, 'time.setFrame', { frame: 0 });
  const head = await controlId(page, 'fk.head', character);
  await expect.poll(async () => await call(page, 'displayModel', character), { timeout: 30_000 }).not.toBeNull();

  // Before the edit.
  await frameHead(page, head);
  const before = await expressionLooks(page, character);
  const springsBefore = await springLag(page, character);
  const displayBefore = await call(page, 'displayModel', character);
  expect(before.rest.outline).toBeGreaterThan(500);
  expect(before.blinkChanged).toBeGreaterThan(20);
  expect(springsBefore.lag).toBeGreaterThan(2e-3);

  // The edit: Make editable on the head mesh, a loop on a cheek edge (a vertical edge right of the nose, in front).
  await enterModel(page);
  const rows = (await call(page, 'meshes')).filter((row) => row.owner === `char:${character}`);
  const meshIndex = rows.findIndex((row) => row.name === 'head');
  expect(meshIndex).toBeGreaterThanOrEqual(0);
  const { mesh } = await runOk<{ mesh: string }>(page, 'mesh.makeEditable', { character, meshIndex });
  await expect
    .poll(async () => (await call(page, 'meshes')).find((row) => row.id === mesh)?.runtime, { timeout: 30_000 })
    .toBe('ready');
  const positions = (await call(page, 'meshPositions', mesh)) as unknown as (readonly number[])[];
  const edges = (await call(page, 'meshEdges', mesh)).map((edge) => edge.v);
  const inCheek = (p: readonly number[] | undefined): boolean =>
    p !== undefined &&
    (p[0] ?? 0) > 0.06 &&
    (p[0] ?? 0) < 0.075 &&
    (p[1] ?? 0) > 1.44 &&
    (p[1] ?? 0) < 1.46 &&
    (p[2] ?? 0) > 0.08;
  const cheek = edges.findIndex(([a, b]) => inCheek(positions[a]) && inCheek(positions[b]));
  expect(cheek, 'a cheek edge').toBeGreaterThanOrEqual(0);
  const countsBefore = (await call(page, 'meshInfo', mesh))?.counts;
  await runOk(page, 'select.objects', { ids: [mesh], mode: 'replace' });
  await setMode(page, 'edge');
  await runOk(page, 'select.components', { mesh, kind: 'edge', indices: [cheek], mode: 'replace' });
  await runOk(page, 'mesh.insertLoop', { meshes: [mesh], kind: 'edge', seedEdge: cheek, weight: 0.5 });
  const countsAfter = (await call(page, 'meshInfo', mesh))?.counts;
  expect(countsAfter?.v).toBeGreaterThan(countsBefore?.v ?? Number.POSITIVE_INFINITY);
  await setMode(page, 'object');

  // Back to Animate: leaving Model rebuilds the display at once (§5.23); wait until the drawn model is the new one.
  const started = Date.now();
  await runOk(page, 'workspace.set', { workspace: 'animate' });
  await expect
    .poll(async () => (await call(page, 'displayModel', character))?.vertices, { timeout: 15_000 })
    .not.toBe(displayBefore?.vertices);
  const rebuildMs = Date.now() - started;
  test.info().annotations.push({ type: 'display rebuild (report, ≤ 300 ms)', description: `${rebuildMs} ms` });
  expect((await call(page, 'displayModel', character))?.meshes).toBe(displayBefore?.meshes);

  // After the edit: outlines, the blink and the springs as before.
  await frameHead(page, head);
  const after = await expressionLooks(page, character);
  const springsAfter = await springLag(page, character);
  expect(Math.abs(after.rest.outline - before.rest.outline) / before.rest.outline).toBeLessThan(0.1);
  expect(after.blinkChanged).toBeGreaterThan(20);
  expect(springsAfter.lag).toBeGreaterThan(2e-3);
  expect(springsAfter.moved).toBeGreaterThan(1e-3);
});
