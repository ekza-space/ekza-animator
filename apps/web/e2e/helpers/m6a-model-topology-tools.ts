// B12b e2e helpers (M6A-SPEC §3 rule 5, §10.1): edges and vertices found by their positions, clicks on component
// points with modifiers, tool activation and history reads shared by the B12b scenarios (E2E-MOD-04, -05, -06, -08,
// -17, -18, -20, -21, -22, -24, -28).
import { expect, type Page } from '@playwright/test';
import { MODEL_PANE, type ScreenPoint } from './m6a-model';
import { call, runOk } from './test-api';

export type Vec3 = readonly [number, number, number];

/** Every edge of a mesh with its two end positions (mesh-local). */
export async function edgeEnds(
  page: Page,
  mesh: string,
): Promise<{ e: number; v: [number, number]; a: Vec3; b: Vec3 }[]> {
  const edges = await call(page, 'meshEdges', mesh);
  const positions = (await call(page, 'meshPositions', mesh)) as Vec3[];
  return edges.map((edge, e) => ({
    e,
    v: edge.v,
    a: positions[edge.v[0]] as Vec3,
    b: positions[edge.v[1]] as Vec3,
  }));
}

/** The first edge whose ends satisfy `test` (in either order); throws when none does. */
export async function findEdge(page: Page, mesh: string, test: (a: Vec3, b: Vec3) => boolean): Promise<number> {
  for (const edge of await edgeEnds(page, mesh)) {
    if (test(edge.a, edge.b) || test(edge.b, edge.a)) return edge.e;
  }
  throw new Error(`no edge of ${mesh} matches`);
}

/** The first vertex whose position satisfies `test`. */
export async function findVertex(page: Page, mesh: string, test: (p: Vec3) => boolean): Promise<number> {
  const positions = (await call(page, 'meshPositions', mesh)) as Vec3[];
  const v = positions.findIndex(test);
  if (v < 0) throw new Error(`no vertex of ${mesh} matches`);
  return v;
}

export const near = (a: number, b: number, eps = 1e-6): boolean => Math.abs(a - b) <= eps;

/** A visible screen point of an edge at `t` (from `edgeVert(e, 0)`), polled until the pane shows it. */
export async function edgePoint(
  page: Page,
  mesh: string,
  e: number,
  t = 0.5,
  paneId = MODEL_PANE,
): Promise<ScreenPoint> {
  const read = (): Promise<ScreenPoint | null> => call(page, 'screenOfEdge', mesh, e, paneId, t);
  await expect.poll(read, { message: `edge ${e} of ${mesh} is visible in ${paneId}` }).not.toBeNull();
  return (await read()) as ScreenPoint;
}

/** A visible screen point of a vertex. */
export async function vertexPoint(page: Page, mesh: string, v: number, paneId = MODEL_PANE): Promise<ScreenPoint> {
  const read = (): Promise<ScreenPoint | null> => call(page, 'screenOfVertex', mesh, v, paneId);
  await expect.poll(read, { message: `vertex ${v} of ${mesh} is visible in ${paneId}` }).not.toBeNull();
  return (await read()) as ScreenPoint;
}

/** Presses a key with the pointer over a pane (keys resolve in the pane's scope). */
export async function keyOver(page: Page, key: string, at?: ScreenPoint, paneId = MODEL_PANE): Promise<void> {
  if (at === undefined) {
    const pane = (await call(page, 'panes')).find((entry) => entry.id === paneId);
    if (pane === undefined) throw new Error(`no pane ${paneId}`);
    await page.mouse.move(pane.rect.x + 40, pane.rect.y + 40);
  } else await page.mouse.move(at.x, at.y);
  await page.keyboard.press(key);
}

/** The active viewport tool, polled until it is `tool`. */
export async function expectTool(page: Page, tool: string): Promise<void> {
  await expect.poll(async () => (await call(page, 'state')).tool).toBe(tool);
}

/** Activates a viewport tool through `view.tool` (the menu items' and the Toolkit buttons' operator). */
export async function useTool(page: Page, tool: string): Promise<void> {
  await runOk(page, 'view.tool', { panel: 'viewport', tool });
  await expectTool(page, tool);
}

/** Undo labels, oldest first. */
export async function undoLabels(page: Page): Promise<string[]> {
  return (await call(page, 'history')).undo;
}

/** A press-drag-release with the mouse from `from` to `to` in `steps` moves, with an optional button. */
export async function dragFrom(
  page: Page,
  from: ScreenPoint,
  to: ScreenPoint,
  opts: { readonly button?: 'left' | 'middle'; readonly steps?: number; readonly hold?: readonly string[] } = {},
): Promise<void> {
  for (const key of opts.hold ?? []) await page.keyboard.down(key);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down({ button: opts.button ?? 'left' });
  await page.mouse.move(to.x, to.y, { steps: opts.steps ?? 8 });
  await page.mouse.up({ button: opts.button ?? 'left' });
  for (const key of [...(opts.hold ?? [])].reverse()) await page.keyboard.up(key);
}

/** World position of a vertex. */
export async function worldOf(page: Page, mesh: string, v: number): Promise<Vec3> {
  return ((await call(page, 'meshPositions', mesh, [v], 'world')) as Vec3[])[0] as Vec3;
}

/** The first edge matching `test` that the pane shows (not occluded, on screen), with its screen point at `t`. */
export async function visibleEdge(
  page: Page,
  mesh: string,
  test: (a: Vec3, b: Vec3) => boolean,
  t = 0.5,
  paneId = MODEL_PANE,
): Promise<{ readonly e: number; readonly at: ScreenPoint }> {
  let found: { e: number; at: ScreenPoint } | null = null;
  await expect
    .poll(
      async () => {
        for (const edge of await edgeEnds(page, mesh)) {
          if (!(test(edge.a, edge.b) || test(edge.b, edge.a))) continue;
          const at = await call(page, 'screenOfEdge', mesh, edge.e, paneId, t);
          if (at !== null) {
            found = { e: edge.e, at };
            return true;
          }
        }
        return false;
      },
      { message: `a visible edge of ${mesh} matches` },
    )
    .toBe(true);
  return found as unknown as { e: number; at: ScreenPoint };
}

/** A vertical edge (along Y) whose ends lie within [y0, y1]. */
export const verticalIn =
  (y0: number, y1: number) =>
  (a: Vec3, b: Vec3): boolean =>
    near(a[0], b[0], 1e-5) &&
    near(a[2], b[2], 1e-5) &&
    Math.min(a[1], b[1]) >= y0 - 1e-6 &&
    Math.max(a[1], b[1]) <= y1 + 1e-6 &&
    Math.abs(a[1] - b[1]) > 1e-4;
