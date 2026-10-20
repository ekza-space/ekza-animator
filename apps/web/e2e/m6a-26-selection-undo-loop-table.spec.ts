import { expect, type Page, test } from '@playwright/test';
import {
  createPrimitive,
  MODEL_PANE,
  modKey,
  openModel,
  type ScreenPoint,
  screenOf,
  selectedComponents,
} from './helpers/m6a-model';
import {
  edgeLoop,
  edgeRing,
  type Topology,
  pressOver,
  paneRect,
  reachable,
  shorterArc,
  sorted,
  topology,
  undoLabels,
  undoOver,
  vertexLoop,
} from './helpers/m6a-model-select-ui';
import { seedSample } from './helpers/seed';
import { call, expectKernelStarted, openEditor, runOk } from './helpers/test-api';

// E2E-MOD-26 "Selection undo and the loop table" (M6A-SPEC §10.1, §5.6; owner B10). Gates (§3 rule 4): b2 (the
// kernel's loop walkers) and b7 (`mesh.create.torus`, mesh runtimes). Real clicks at the test API's screen points;
// expectations come from the torus topology (`meshEdges`/`meshFaces`), walked independently of the kernel.

type Kind = 'vertex' | 'edge' | 'face';

/** The visible screen point of a component in `pane-persp` that the pane receives presses at, or null. */
async function visible(page: Page, mesh: string, kind: Kind, index: number): Promise<ScreenPoint | null> {
  const point =
    kind === 'vertex'
      ? await call(page, 'screenOfVertex', mesh, index, MODEL_PANE)
      : kind === 'edge'
        ? await call(page, 'screenOfEdge', mesh, index, MODEL_PANE)
        : await call(page, 'screenOfFace', mesh, index, MODEL_PANE);
  // Only points the pane receives presses at (no card or panel drawn over them).
  return point !== null && (await reachable(page, point)) ? point : null;
}

/** A click (with Shift or Mod held) on a component. */
async function clickOn(page: Page, at: ScreenPoint, modifier?: 'Shift' | 'Mod', double = false): Promise<void> {
  const key = modifier === 'Mod' ? await modKey(page) : modifier;
  if (key !== undefined) await page.keyboard.down(key);
  if (double) await page.mouse.dblclick(at.x, at.y);
  else await page.mouse.click(at.x, at.y);
  if (key !== undefined) await page.keyboard.up(key);
}

/** The faces of the strip across edge `across`, in order from `from` (a quad grid). */
function faceStrip(topo: Topology, from: number, across: number): number[] {
  const out = [from];
  let face = from;
  let entry = across;
  for (let guard = 0; guard < topo.faces.length; guard++) {
    const next = topo.facesOf(entry).find((f) => f !== face);
    if (next === undefined || next === from) break;
    out.push(next);
    const edges = topo.faceEdges(next);
    if (edges.length !== 4) break;
    entry = edges[(edges.indexOf(entry) + 2) % 4] as number;
    face = next;
  }
  return out;
}

interface Plan {
  readonly loop: number[];
  readonly ring: number[];
  /** v0, v1, v2 along the loop's first two edges (v1 shared): the vertex mode's partial arc from v0 to v2. */
  readonly arc: readonly [number, number, number];
  readonly points: Map<string, ScreenPoint>;
}

/** Finds an edge whose loop neighbours, ring neighbour, vertices and faces are all visible in the pane. */
async function plan(page: Page, torus: string, topo: Topology): Promise<Plan> {
  for (let e0 = 0; e0 < topo.edges.length; e0++) {
    const loop = edgeLoop(topo, e0);
    if (loop.length < 6) continue;
    const ring = edgeRing(topo, loop[2] as number);
    const [a, b] = topo.edges[e0] as readonly [number, number];
    const third = topo.edges[loop[1] as number] as readonly [number, number];
    // v1 is the vertex the loop's first two edges share; v0 and v2 their other ends.
    const v1 = third[0] === a || third[0] === b ? third[0] : third[1];
    const v0 = v1 === a ? b : a;
    const v2 = third[0] === v1 ? third[1] : third[0];
    const faces = topo.facesOf(e0);
    const strip = faces.length === 2 ? faceStrip(topo, faces[0] as number, e0) : [];
    const wanted: [string, Kind, number][] = [
      ['e0', 'edge', e0],
      ['e1', 'edge', loop[1] as number],
      ['e2', 'edge', loop[2] as number],
      ['p', 'edge', ring[1] as number],
      ['v0', 'vertex', v0],
      ['v1', 'vertex', v1],
      ['v2', 'vertex', v2],
      ['f0', 'face', strip[0] ?? -1],
      ['f1', 'face', strip[1] ?? -1],
      ['f2', 'face', strip[2] ?? -1],
    ];
    const points = new Map<string, ScreenPoint>();
    for (const [name, kind, index] of wanted) {
      if (index < 0) break;
      const point = await visible(page, torus, kind, index);
      if (point === null) break;
      points.set(name, point);
    }
    if (points.size === wanted.length) return { loop, ring, arc: [v0, v1, v2], points };
  }
  throw new Error('no edge of the torus with every needed neighbour visible');
}

/** Switches the component mode with its digit over the pane (no F-key, §7). */
async function digit(page: Page, n: 1 | 2 | 3, expected: Kind): Promise<void> {
  await pressOver(page, `Digit${n}`);
  await expect.poll(async () => (await call(page, 'state')).mode).toBe(expected);
}

test('E2E-MOD-26 — selection undo steps and the loop table (edges, vertices, faces)', async ({ page }) => {
  await openModel(page);
  const torus = await createPrimitive(page, 'torus');
  await expect.poll(async () => (await call(page, 'meshInfo', torus))?.counts).toMatchObject({ v: 72, e: 144, f: 72 });
  await pressOver(page, 'KeyA'); // frame the torus
  await digit(page, 2, 'edge');
  const topo = await topology(page, torus);
  // Visible from the frame: wait until the pane has drawn the hilited torus.
  await screenOf(page, torus, 'edge', 0).catch(() => null);
  const { loop, ring, arc: vertexArc, points } = await plan(page, torus, topo);
  const at = (name: string): ScreenPoint => points.get(name) as ScreenPoint;
  const edges = (): Promise<number[]> => selectedComponents(page, torus, 'edge');

  // Double-click → the edge loop; a click on empty space clears it; one undo restores it (edge indices deep-equal).
  await clickOn(page, at('e0'), undefined, true);
  await expect.poll(edges).toEqual(sorted(loop));
  const rect = await paneRect(page, MODEL_PANE);
  const empty = { x: rect.x + rect.w - 24, y: rect.y + rect.h - 40 };
  expect(await reachable(page, empty)).toBe(true);
  await page.mouse.click(empty.x, empty.y);
  await expect.poll(edges).toEqual([]);
  await undoOver(page);
  await expect.poll(edges).toEqual(sorted(loop));

  // Three quick Shift-clicks are three "Select" steps; one undo removes only the third.
  const before = (await undoLabels(page)).length;
  const toggled = await visibleEdges(page, torus, topo, 3, loop);
  for (const edge of toggled) await clickOn(page, edge.point, 'Shift');
  await expect.poll(async () => (await undoLabels(page)).slice(before)).toEqual(['Select', 'Select', 'Select']);
  await expect.poll(edges).toEqual(sorted([...loop, ...toggled.map((edge) => edge.edge)]));
  await undoOver(page);
  await expect.poll(edges).toEqual(sorted([...loop, ...toggled.slice(0, 2).map((edge) => edge.edge)]));

  // The loop table in edge mode: adjacent on the loop → the full loop.
  await clickOn(page, at('e0'));
  await clickOn(page, at('e1'), 'Shift', true);
  await expect.poll(edges).toEqual(sorted(loop));
  // Fresh: non-adjacent on the loop → the partial loop (the shorter arc).
  await clickOn(page, at('e0'));
  await clickOn(page, at('e2'), 'Shift', true);
  const arc = shorterArc(loop, 0, 2);
  await expect.poll(edges).toEqual(sorted(arc));
  // A parallel edge of the reference (same ring) → the full ring is added.
  await clickOn(page, at('p'), 'Shift', true);
  await expect.poll(edges).toEqual(sorted(new Set([...arc, ...ring])));
  // Mod+double-click on the arc removes its contiguous selected run along the loop.
  await clickOn(page, at('e0'), 'Mod', true);
  await expect.poll(edges).toEqual(sorted(ring.filter((e) => !arc.includes(e))));

  // Vertex mode: adjacent → full vertex loop, non-adjacent → partial.
  await digit(page, 1, 'vertex');
  const verts = (): Promise<number[]> => selectedComponents(page, torus, 'vertex');
  await clickOn(page, at('v0'));
  await clickOn(page, at('v1'), 'Shift', true);
  await expect.poll(verts).toEqual(sorted(vertexLoop(topo, loop[0] as number)));
  await clickOn(page, at('v0'));
  await clickOn(page, at('v2'), 'Shift', true);
  // The shorter arc from v0 to v2: v0, v1, v2 (2 of the loop's edges).
  await expect.poll(verts).toEqual(sorted(vertexArc));

  // Face mode: adjacent across the shared edge → full face loop, non-adjacent → partial.
  await digit(page, 3, 'face');
  const faces = (): Promise<number[]> => selectedComponents(page, torus, 'face');
  const strip = faceStrip(topo, topo.facesOf(loop[0] as number)[0] as number, loop[0] as number);
  await clickOn(page, at('f0'));
  await clickOn(page, at('f1'), 'Shift', true);
  await expect.poll(faces).toEqual(sorted(strip));
  await clickOn(page, at('f0'));
  await clickOn(page, at('f2'), 'Shift', true);
  await expect.poll(faces).toEqual(sorted(shorterArc(strip, 0, 2)));
});

/** `count` visible edges outside `except`, at least 16 px apart on screen (each click picks its own edge). */
async function visibleEdges(
  page: Page,
  mesh: string,
  topo: Topology,
  count: number,
  except: readonly number[],
): Promise<{ edge: number; point: ScreenPoint }[]> {
  const out: { edge: number; point: ScreenPoint }[] = [];
  for (let e = 0; e < topo.edges.length && out.length < count; e++) {
    if (except.includes(e)) continue;
    const point = await visible(page, mesh, 'edge', e);
    if (point === null || out.some((other) => Math.hypot(other.point.x - point.x, other.point.y - point.y) < 16))
      continue;
    out.push({ edge: e, point });
  }
  if (out.length < count) throw new Error(`only ${out.length} visible edges`);
  return out;
}

test('E2E-MOD-26 (Animate) — a control selection records no "Select" step', async ({ page }) => {
  await openEditor(page, '&ws=animate');
  await expectKernelStarted(page);
  await seedSample(page, 'polybot');
  // A document step to undo: without one the undo below would pass whatever the selection recorded.
  await runOk(page, 'clip.new', { name: 'b10' });
  const before = await undoLabels(page);
  expect(before.length).toBeGreaterThan(0);
  const panes = await call(page, 'panes');
  const pane = panes[0]?.id ?? 'pane-right';
  for (const control of ['fk.upperArm.L', 'fk.upperArm.R']) {
    const point = await call(page, 'screenOfControl', control, pane);
    if (point === null) throw new Error(`${control} not visible in ${pane}`);
    await page.keyboard.down('Shift');
    await page.mouse.click(point.x, point.y);
    await page.keyboard.up('Shift');
  }
  await expect.poll(async () => (await call(page, 'state')).selection.controls.length).toBe(2);
  // No "Select" step: the undo that follows undoes the document's last step, never a control selection.
  expect(await undoLabels(page)).toEqual(before);
  await undoOver(page, pane);
  // The undo took the document's last step (the new clip), not a control selection.
  await expect.poll(async () => (await call(page, 'history')).redo[0]).toBe(before.at(-1));
  expect((await call(page, 'history')).redo[0]).not.toBe('Select');
});
