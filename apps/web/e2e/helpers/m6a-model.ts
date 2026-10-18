// M6a model helpers (M6A-SPEC §9.1; B0a, then closed): enter the Model workspace, create primitives and find screen
// points of components. Thin wrappers over `run()` and the §4.8 test API, so every M6a spec builds its starting
// state the same way. Content helpers (`buildSword`, …) live in `helpers/m6a-model-content.ts` (B13).
import { expect, type Page } from '@playwright/test';
import { call, openEditor, runOk } from './test-api';

export type PrimitiveKind = 'cube' | 'sphere' | 'cylinder' | 'cone' | 'plane' | 'torus';
export type ComponentKind = 'vertex' | 'edge' | 'face';
export type ScreenPoint = { readonly x: number; readonly y: number };

/** The Model workspace's perspective pane (§8.2 layout). */
export const MODEL_PANE = 'pane-persp';

/** Opens the editor directly in the Model workspace (`ws=model`, §4.8) and waits until it is active. */
export async function openModel(page: Page, query = ''): Promise<void> {
  await openEditor(page, `&ws=model${query}`);
  await expect.poll(async () => (await call(page, 'state')).workspace).toBe('model');
}

/** Switches the open editor to the Model workspace through `workspace.set` (the tab's operator). */
export async function enterModel(page: Page): Promise<void> {
  await runOk(page, 'workspace.set', { workspace: 'model' });
  await expect.poll(async () => (await call(page, 'state')).workspace).toBe('model');
}

/** Creates a primitive at the origin (§6.3 params; omitted ones take the low-poly defaults) and waits for its runtime. */
export async function createPrimitive(
  page: Page,
  kind: PrimitiveKind,
  params?: Readonly<Record<string, number | boolean | string>>,
): Promise<string> {
  const { mesh } = await runOk<{ mesh: string }>(page, `mesh.create.${kind}`, params);
  await expect.poll(() => meshRuntime(page, mesh)).toBe('ready');
  return mesh;
}

/** The runtime state of a mesh ('loading' | 'ready' | 'error' | 'asset' | 'none'). */
export async function meshRuntime(page: Page, mesh: string): Promise<string> {
  return (await call(page, 'meshes')).find((row) => row.id === mesh)?.runtime ?? 'none';
}

/** Selects the component mode (`select.mode`, the `F9`–`F11`/`1`–`3` path) and waits for it. */
export async function setMode(page: Page, mode: 'object' | ComponentKind): Promise<void> {
  await runOk(page, 'select.mode', { mode });
  await expect.poll(async () => (await call(page, 'state')).mode).toBe(mode);
}

/** A visible screen point of a component (page CSS px), polled until the pane has rendered it. */
export async function screenOf(
  page: Page,
  mesh: string,
  kind: ComponentKind,
  index: number,
  paneId: string = MODEL_PANE,
): Promise<ScreenPoint> {
  const read = (): Promise<ScreenPoint | null> =>
    kind === 'vertex'
      ? call(page, 'screenOfVertex', mesh, index, paneId)
      : kind === 'edge'
        ? call(page, 'screenOfEdge', mesh, index, paneId)
        : call(page, 'screenOfFace', mesh, index, paneId);
  await expect.poll(read, { message: `${kind} ${index} of ${mesh} is visible in ${paneId}` }).not.toBeNull();
  return (await read()) as ScreenPoint;
}

/** Clicks a component in a pane (Shift adds, Ctrl removes, as in Maya). */
export async function clickComponent(
  page: Page,
  mesh: string,
  kind: ComponentKind,
  index: number,
  opts: { readonly paneId?: string; readonly modifiers?: readonly ('Shift' | 'Control')[] } = {},
): Promise<void> {
  const point = await screenOf(page, mesh, kind, index, opts.paneId ?? MODEL_PANE);
  const modifiers = opts.modifiers ?? [];
  for (const key of modifiers) await page.keyboard.down(key);
  try {
    await page.mouse.click(point.x, point.y);
  } finally {
    for (const key of [...modifiers].reverse()) await page.keyboard.up(key);
  }
}

/** The stored component selection of a mesh in the current mode's kind. */
export async function selectedComponents(page: Page, mesh: string, kind: ComponentKind): Promise<number[]> {
  return (await call(page, 'model')).selected[mesh]?.[kind] ?? [];
}
