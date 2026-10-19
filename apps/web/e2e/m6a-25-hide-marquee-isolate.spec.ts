import { expect, type Page, test } from '@playwright/test';
import { createPrimitive, modKey, openModel, type ScreenPoint, screenOf } from './helpers/m6a-model';
import { marquee, mode, paneRect, pressOver } from './helpers/m6a-model-select-ui';
import { call, runOk } from './helpers/test-api';

// E2E-MOD-25 "Hide, marquee, isolate" (M6A-SPEC §10.1, §5.6; owner B10). Gates (§3 rule 4): b3 (extrude), b11 (⌘E/
// Ctrl+E with the numeric capture), b13 (the humanoid body template). Real key presses with the pointer over the
// pane; marquees in `pane-front`.

const FRONT = 'pane-front';

type Positions = number[][];

const byId = (a: string, b: string): number => a.localeCompare(b);

function centroid(face: readonly number[], positions: Positions): number[] {
  const out = [0, 0, 0];
  for (const v of face) for (let k = 0; k < 3; k++) (out[k] as number) += (positions[v]?.[k] ?? 0) / face.length;
  return out;
}

async function model(page: Page): Promise<Awaited<ReturnType<typeof call<'model'>>>> {
  return call(page, 'model');
}

/** A page rectangle around points, padded. */
function around(points: readonly ScreenPoint[], pad: number): { from: ScreenPoint; to: ScreenPoint } {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return {
    from: { x: Math.min(...xs) - pad, y: Math.min(...ys) - pad },
    to: { x: Math.max(...xs) + pad, y: Math.max(...ys) + pad },
  };
}

test('E2E-MOD-25 — hidden faces stay out of marquees and ops; edge marquee; per-pane isolate', async ({ page }) => {
  await openModel(page);
  // pane-front is one of the M-Quad panes: leave the maximized persp pane.
  await runOk(page, 'view.layout', { layout: 'quad' });
  if ((await call(page, 'state')).maximizedPane !== null) await runOk(page, 'view.toggleMaximize');
  const before = new Set((await call(page, 'meshes')).map((row) => row.id));
  await runOk(page, 'mesh.create.template', { template: 'humanoidBody', style: 'smooth', height: 1.6 });
  await expect.poll(async () => (await call(page, 'meshes')).filter((row) => !before.has(row.id)).length).toBe(1);
  const body = (await call(page, 'meshes')).find((row) => !before.has(row.id))?.id as string;
  await runOk(page, 'select.objects', { ids: [body], mode: 'replace' });
  await pressOver(page, 'KeyA', FRONT);
  await pressOver(page, 'Digit3', FRONT);
  await expect.poll(() => mode(page)).toBe('face');

  // The arm faces (centroid |x| > 0.4) selected by script, then H.
  const faces = await call(page, 'meshFaces', body);
  const positions = await call(page, 'meshPositions', body);
  const arms = faces
    .map((face, f) => [f, centroid(face, positions)] as const)
    .filter(([, c]) => Math.abs(c[0] ?? 0) > 0.4);
  const armFaces = arms.map(([f]) => f);
  expect(armFaces.length).toBeGreaterThan(0);
  await runOk(page, 'select.components', { mesh: body, kind: 'face', indices: armFaces, mode: 'replace' });
  await pressOver(page, 'KeyH', FRONT);
  await expect.poll(async () => (await model(page)).hidden[body]?.face).toEqual(armFaces);
  const armVerts = [...new Set(armFaces.flatMap((f) => faces[f] ?? []))].sort((a, b) => a - b);
  const armPositions = await call(page, 'meshPositions', body, armVerts);

  // A marquee over the whole body in pane-front selects no hidden face.
  const rect = await paneRect(page, FRONT);
  await marquee(page, { x: rect.x + 4, y: rect.y + 24 }, { x: rect.x + rect.w - 4, y: rect.y + rect.h - 4 });
  const marqueed = (await model(page)).selected[body]?.face ?? [];
  expect(marqueed.length).toBeGreaterThan(0);
  expect(marqueed.filter((f) => armFaces.includes(f))).toEqual([]);

  // One torso face (front, near the centre line), then ⌘E/Ctrl+E 0.05 Enter.
  const torso = faces
    .map((face, f) => [f, centroid(face, positions)] as const)
    .filter(([, c]) => Math.abs(c[0] ?? 0) < 0.12 && (c[1] ?? 0) > 1.0 && (c[1] ?? 0) < 1.3 && (c[2] ?? 0) > 0)
    .map(([f]) => f);
  let picked: number | null = null;
  for (const f of torso) {
    if ((await call(page, 'screenOfFace', body, f, FRONT)) !== null) {
      picked = f;
      break;
    }
  }
  if (picked === null) throw new Error('no visible front torso face');
  const point = await screenOf(page, body, 'face', picked, FRONT);
  await page.mouse.click(point.x, point.y);
  await expect.poll(async () => (await model(page)).selected[body]?.face).toEqual([picked]);
  await pressOver(page, `${await modKey(page)}+KeyE`, FRONT);
  await page.keyboard.type('0.05');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await call(page, 'meshInfo', body))?.counts.f).toBeGreaterThan(faces.length);
  // Hidden faces: vertices bit-equal and still hidden.
  expect(await call(page, 'meshPositions', body, armVerts)).toEqual(armPositions);
  expect((await model(page)).hidden[body]?.face).toEqual(armFaces);

  // Shift+H clears every hidden component.
  await pressOver(page, 'Shift+KeyH', FRONT);
  await expect.poll(async () => (await model(page)).hidden[body]?.face ?? []).toEqual([]);

  // Edge mode: a marquee with one endpoint of a torso edge inside does not select it; with both it does.
  await pressOver(page, 'Digit2', FRONT);
  await expect.poll(() => mode(page)).toBe('edge');
  const edges = await call(page, 'meshEdges', body);
  const after = await call(page, 'meshPositions', body);
  // The longest visible front torso edge on screen (the 1.6 m body spans about 230 px of a quad pane, its torso edges
  // 15–25 px): a 6 px pad around one endpoint must leave the other endpoint outside.
  const PAD = 6;
  let known: { e: number; a: ScreenPoint; b: ScreenPoint; length: number } | null = null;
  for (let e = 0; e < edges.length; e++) {
    const [va, vb] = edges[e]?.v ?? [0, 0];
    const pa = after[va] ?? [0, 0, 0];
    const pb = after[vb] ?? [0, 0, 0];
    if (Math.abs(pa[0] ?? 1) > 0.15 || (pa[1] ?? 0) < 1.0 || (pa[2] ?? 0) <= 0 || (pb[2] ?? 0) <= 0) continue;
    const a = await call(page, 'screenOfVertex', body, va, FRONT);
    const b = await call(page, 'screenOfVertex', body, vb, FRONT);
    const edge = await call(page, 'screenOfEdge', body, e, FRONT);
    if (a === null || b === null || edge === null) continue;
    const length = Math.hypot(a.x - b.x, a.y - b.y);
    if (length > (known?.length ?? 0)) known = { e, a, b, length };
  }
  if (known === null) throw new Error('no visible torso edge');
  expect(Math.max(Math.abs(known.a.x - known.b.x), Math.abs(known.a.y - known.b.y))).toBeGreaterThan(2 * PAD);
  const one = around([known.a], PAD);
  await marquee(page, one.from, one.to);
  expect((await model(page)).selected[body]?.edge ?? []).not.toContain(known.e);
  const both = around([known.a, known.b], PAD);
  await marquee(page, both.from, both.to);
  expect((await model(page)).selected[body]?.edge ?? []).toContain(known.e);

  // Object mode, a cube beside the body, isolate in pane-persp only.
  await pressOver(page, 'F8', FRONT);
  await expect.poll(() => mode(page)).toBe('object');
  await runOk(page, 'view.layout', { layout: 'quad' });
  const cube = await createPrimitive(page, 'cube');
  // Beside the body (its arms reach about 0.8 m from its axis): the cube's vertices move 1.6 m along +X.
  await runOk(page, 'select.objects', { ids: [cube], mode: 'replace' });
  await runOk(page, 'select.mode', { mode: 'vertex' });
  await runOk(page, 'select.mesh.all');
  await runOk(page, 'mesh.transformComponents', { meshes: [cube], translateX: 1.6 });
  await runOk(page, 'select.mode', { mode: 'object' });
  const moved = await call(page, 'meshPositions', cube);
  expect(moved.every((p) => (p[0] ?? 0) > 1)).toBe(true);
  await runOk(page, 'select.objects', { ids: [cube], mode: 'replace' });
  await pressOver(page, 'Shift+KeyL', 'pane-persp');
  await expect.poll(() => call(page, 'paneObjects', 'pane-persp')).toEqual([cube]);
  for (const pane of ['pane-top', 'pane-front', 'pane-side']) {
    expect([...(await call(page, 'paneObjects', pane))].sort(byId)).toEqual([body, cube].sort(byId));
  }
});
