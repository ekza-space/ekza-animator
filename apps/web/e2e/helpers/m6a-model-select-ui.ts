// B10 e2e helpers (M6A-SPEC §3 rule 5): pointer and key gestures over Model panes (marking-menu slots, marquees,
// double-clicks, undo with the pointer over a pane) and a small reading of a mesh's topology through the test API
// (`meshEdges`, `meshFaces`) with the loop and ring walks Maya's loop table expects on quad grids (research 10 §4.1):
// the scenarios compute what a gesture must select independently of the kernel's walkers.
import { expect, type Page } from '@playwright/test';
import { MODEL_PANE, modKey, type ScreenPoint } from './m6a-model';
import { call } from './test-api';

/** A pane's page rectangle. */
export async function paneRect(page: Page, paneId: string): Promise<{ x: number; y: number; w: number; h: number }> {
  const pane = (await call(page, 'panes')).find((entry) => entry.id === paneId);
  if (pane === undefined) throw new Error(`no pane ${paneId}`);
  return pane.rect;
}

/** Moves the pointer over a pane (its centre, or `at` relative to its top-left corner). */
export async function hoverPane(page: Page, paneId: string = MODEL_PANE, at?: { x: number; y: number }): Promise<void> {
  const rect = await paneRect(page, paneId);
  await page.mouse.move(rect.x + (at?.x ?? rect.w / 2), rect.y + (at?.y ?? rect.h / 2));
}

/** Presses a key with the pointer over a pane (the Model key scopes follow the pointer, §5.17). */
export async function pressOver(page: Page, key: string, paneId: string = MODEL_PANE): Promise<void> {
  await hoverPane(page, paneId, { x: 12, y: 40 });
  await page.keyboard.press(key);
}

/** One undo: `Mod+Z` with the pointer over a pane. */
export async function undoOver(page: Page, paneId: string = MODEL_PANE): Promise<void> {
  await pressOver(page, `${await modKey(page)}+KeyZ`, paneId);
}

/**
 * Whether a page point reaches the pane (the topmost element there is inside it): a card or panel drawn over the pane
 * (the "Drop a .glb" empty state while the scene has no character) would take the press instead.
 */
export async function reachable(page: Page, point: ScreenPoint, paneId: string = MODEL_PANE): Promise<boolean> {
  return page.evaluate(
    ({ x, y, pane }) => document.elementFromPoint(x, y)?.closest(`[data-ekza-pane="${pane}"]`) instanceof Element,
    { x: point.x, y: point.y, pane: paneId },
  );
}

/** The current component mode (`state().mode`). */
export async function mode(page: Page): Promise<string> {
  return (await call(page, 'state')).mode;
}

/** The undo labels (oldest first). */
export async function undoLabels(page: Page): Promise<string[]> {
  return (await call(page, 'history')).undo;
}

/** An LMB marquee between two page points, with optional modifiers held. */
export async function marquee(page: Page, from: ScreenPoint, to: ScreenPoint): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 3 });
  await page.mouse.move(to.x, to.y, { steps: 3 });
  await page.mouse.up();
}

/**
 * Opens a marking menu with a right-button press at `at` (retried until its lazy controller has loaded) and runs
 * `slot` by press-drag-release onto it.
 */
export async function markingMenuSlot(page: Page, at: ScreenPoint, menu: string, slot: string): Promise<void> {
  await page.mouse.move(at.x, at.y);
  await expect
    .poll(async () => {
      await page.mouse.down({ button: 'right' });
      const open = await call(page, 'markingMenu');
      if (open === null) await page.mouse.up({ button: 'right' });
      return open?.id ?? null;
    })
    .toBe(menu);
  const open = await call(page, 'markingMenu');
  const target = open?.screenOfSlot[slot];
  if (target === undefined) throw new Error(`${menu} has no slot ${slot}`);
  await page.mouse.move(target.x, target.y, { steps: 4 });
  await page.mouse.up({ button: 'right' });
  await expect.poll(() => call(page, 'markingMenu')).toBeNull();
}

/**
 * Expands the Last-op card when it is the collapsed pill (§8.6: a pill until a click or `T`), then sets a field: fill,
 * Enter, and Escape so the keyboard focus leaves the field (the next key, e.g. an undo, reaches the app).
 */
export async function setLastOpField(
  page: Page,
  param: string,
  text: string,
  paneId: string = MODEL_PANE,
): Promise<void> {
  const card = page.getByTestId(`lastop-card-${paneId}`);
  await expect(card).toBeVisible();
  if ((await card.getAttribute('data-state')) !== 'expanded') await page.getByTestId('lastop-pill').click();
  await expect(card).toHaveAttribute('data-state', 'expanded');
  const field = page.getByTestId(`lastop-field-${param}`);
  await field.fill(text);
  await field.press('Enter');
  await field.press('Escape');
  await expect(field).not.toBeFocused();
}

/** A face's corner positions (local). */
export async function faceCorners(page: Page, mesh: string, face: number): Promise<[number, number, number][]> {
  const faces = await call(page, 'meshFaces', mesh);
  const points = await call(page, 'meshPositions', mesh);
  return (faces[face] ?? []).map((v) => {
    const p = points[v];
    return [p?.[0] ?? Number.NaN, p?.[1] ?? Number.NaN, p?.[2] ?? Number.NaN];
  });
}

/** The mean of points. */
export function centroidOf(points: readonly (readonly [number, number, number])[]): [number, number, number] {
  const sum: [number, number, number] = [0, 0, 0];
  for (const [x, y, z] of points) {
    sum[0] += x;
    sum[1] += y;
    sum[2] += z;
  }
  return [sum[0] / points.length, sum[1] / points.length, sum[2] / points.length];
}

/** A polygon's area (Newell: half the length of the summed corner cross products). */
export function areaOf(points: readonly (readonly [number, number, number])[]): number {
  const n: [number, number, number] = [0, 0, 0];
  points.forEach((a, i) => {
    const b = points[(i + 1) % points.length] as readonly [number, number, number];
    n[0] += (a[1] - b[1]) * (a[2] + b[2]);
    n[1] += (a[2] - b[2]) * (a[0] + b[0]);
    n[2] += (a[0] - b[0]) * (a[1] + b[1]);
  });
  return Math.hypot(n[0], n[1], n[2]) / 2;
}

// ---------- topology ----------

export interface Topology {
  readonly edges: readonly (readonly [number, number])[];
  readonly faces: readonly (readonly number[])[];
  /** Edge index of a vertex pair. */
  edgeOf(a: number, b: number): number;
  /** Faces around an edge. */
  facesOf(e: number): readonly number[];
  /** Edges at a vertex. */
  edgesAt(v: number): readonly number[];
  /** Edges of a face, in winding order. */
  faceEdges(f: number): readonly number[];
}

/** Reads a mesh's edges and faces through the test API. */
export async function topology(page: Page, mesh: string): Promise<Topology> {
  const edges = (await call(page, 'meshEdges', mesh)).map((edge) => edge.v);
  const faces = await call(page, 'meshFaces', mesh);
  const key = (a: number, b: number): string => (a < b ? `${a}:${b}` : `${b}:${a}`);
  const byPair = new Map<string, number>();
  edges.forEach(([a, b], e) => byPair.set(key(a, b), e));
  const around = new Map<number, number[]>();
  const at = new Map<number, number[]>();
  edges.forEach(([a, b], e) => {
    for (const v of [a, b]) at.set(v, [...(at.get(v) ?? []), e]);
  });
  const faceEdges = faces.map((verts) =>
    verts.map((v, i) => byPair.get(key(v, verts[(i + 1) % verts.length] as number)) as number),
  );
  faceEdges.forEach((list, f) => {
    for (const e of list) around.set(e, [...(around.get(e) ?? []), f]);
  });
  return {
    edges,
    faces,
    edgeOf: (a, b) => byPair.get(key(a, b)) ?? -1,
    facesOf: (e) => around.get(e) ?? [],
    edgesAt: (v) => at.get(v) ?? [],
    faceEdges: (f) => faceEdges[f] ?? [],
  };
}

/** The edge loop through `e` on a quad grid: at each valence-4 vertex, the edge sharing no face with the last one. */
export function edgeLoop(topo: Topology, e: number): number[] {
  const loop = [e];
  const [start, first] = topo.edges[e] as readonly [number, number];
  let previous = e;
  let v = first;
  for (let guard = 0; guard < topo.edges.length; guard++) {
    const candidates = topo.edgesAt(v).filter((x) => x !== previous);
    if (candidates.length !== 3) break;
    const faces = new Set(topo.facesOf(previous));
    const next = candidates.find((x) => topo.facesOf(x).every((f) => !faces.has(f)));
    if (next === undefined || next === e) break;
    loop.push(next);
    const [a, b] = topo.edges[next] as readonly [number, number];
    v = a === v ? b : a;
    previous = next;
    if (v === start && topo.edgesAt(v).includes(e)) break;
  }
  return loop;
}

/** The edge ring through `e`: across each quad to the opposite edge. */
export function edgeRing(topo: Topology, e: number): number[] {
  const ring = [e];
  const seen = new Set([e]);
  let frontier = [e];
  while (frontier.length > 0) {
    const next: number[] = [];
    for (const edge of frontier) {
      for (const f of topo.facesOf(edge)) {
        const list = topo.faceEdges(f);
        if (list.length !== 4) continue;
        const opposite = list[(list.indexOf(edge) + 2) % 4] as number;
        if (seen.has(opposite)) continue;
        seen.add(opposite);
        ring.push(opposite);
        next.push(opposite);
      }
    }
    frontier = next;
  }
  return ring;
}

/** The vertices of the edge loop through edge `along` (a vertex loop, §5.6). */
export function vertexLoop(topo: Topology, along: number): number[] {
  const out = new Set<number>();
  for (const e of edgeLoop(topo, along)) for (const v of topo.edges[e] as readonly [number, number]) out.add(v);
  return [...out];
}

/** The face loop across edge `across`: the faces of the ring through it. */
export function faceLoop(topo: Topology, across: number): number[] {
  const out = new Set<number>();
  for (const e of edgeRing(topo, across)) for (const f of topo.facesOf(e)) out.add(f);
  return [...out];
}

/** The shorter arc of a closed loop between positions i and j (inclusive). */
export function shorterArc<T>(loop: readonly T[], i: number, j: number): T[] {
  const n = loop.length;
  const forward = (j - i + n) % n;
  const backward = (i - j + n) % n;
  const out: T[] = [];
  if (forward <= backward) for (let k = 0; k <= forward; k++) out.push(loop[(i + k) % n] as T);
  else for (let k = 0; k <= backward; k++) out.push(loop[(i - k + n) % n] as T);
  return out;
}

export const sorted = (values: Iterable<number>): number[] => [...values].sort((a, b) => a - b);
