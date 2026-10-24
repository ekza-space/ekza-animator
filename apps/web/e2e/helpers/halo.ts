// Halo e2e helpers (STUDIO-TOUCH-SPEC §20.7; T6a): open `/app`, read the test API's `halo()` slice, load a scene, find
// points on the canvas (a control's pick point, a face, empty space) and drive the grammar with real touch (CDP,
// `./touch`) on `chrome-touch`, the mouse on `chrome`, and single taps on `webkit-ipad`.
import type { EkzaStudioTestApi } from '@ekza-studio/editor';
import { expect, type Page } from '@playwright/test';
import { importStatic } from './ar-host';
import { call, expectKernelStarted, runOk, waitForTestApi } from './test-api';
import type { Point } from './touch';

export type HaloTestState = NonNullable<ReturnType<EkzaStudioTestApi['halo']>>;

export const PANE = 'pane-single';
export const HALO_MARKER = 'ekza-halo-shell';

export async function openHalo(page: Page, query = ''): Promise<void> {
  await page.goto(`/app?e2e=1${query}`);
  await waitForTestApi(page);
  await expectKernelStarted(page);
  await expect(page.locator(`[data-shell="${HALO_MARKER}"]`)).toBeVisible();
}

/** The test API's `halo()` (null while no Halo shell is mounted). */
export async function halo(page: Page): Promise<HaloTestState> {
  const state = await call(page, 'halo');
  if (state === null) throw new Error('halo() is null: the Halo shell is not mounted');
  return state;
}

/** The grammar's own slice (`halo().slices.grammar`). */
export async function grammar(page: Page): Promise<Record<string, unknown>> {
  return (await halo(page)).slices['grammar'] as Record<string, unknown>;
}

/** Polybot (rigged, with controls) through `file.loadSample`; Home gives way to the canvas in Animate. */
export async function loadPolybot(page: Page): Promise<void> {
  await runOk(page, 'file.loadSample', { sample: 'polybot' });
  await expect(page.getByTestId('halo-home')).toHaveCount(0);
  await expect.poll(async () => (await halo(page)).stage).toBe('animate');
  await page.waitForTimeout(300);
}

/** The Cube Lad as static scene meshes, then the Make stage. */
export async function loadCubeLadInMake(page: Page): Promise<string[]> {
  const meshes = await importStatic(page, 'cube-lad.glb');
  await expect(page.getByTestId('halo-home')).toHaveCount(0);
  await tapStage(page, 'make');
  await expect.poll(async () => (await halo(page)).stage).toBe('make');
  return meshes;
}

/** Taps a Path stage (a chrome tap, any input). */
export async function tapStage(page: Page, stage: 'make' | 'paint' | 'rig' | 'animate'): Promise<void> {
  const label = { make: 'Make', paint: 'Paint', rig: 'Rig', animate: 'Animate' }[stage];
  await page.getByTestId('halo-path').getByRole('tab', { name: label }).click();
}

/** A control's id by its display name. */
export async function controlId(page: Page, name: string): Promise<string> {
  const control = (await call(page, 'controls')).find((c) => c.name === name);
  if (control === undefined) throw new Error(`no control ${name}`);
  return control.id;
}

/** A point on a control's shape (page px). */
export async function controlPoint(page: Page, name: string): Promise<Point> {
  const point = await call(page, 'screenOfControl', await controlId(page, name), PANE);
  if (point === null) throw new Error(`${name} is not on screen`);
  return point;
}

/** A control's point that no chrome covers (the Halo and the breadcrumb float over the canvas next to a selection). */
export async function canvasPoint(page: Page, name: string): Promise<Point> {
  const point = await controlPoint(page, name);
  const on = await page.evaluate(
    (p) => document.elementFromPoint(p.x, p.y)?.closest('[data-ekza-pane]')?.getAttribute('data-ekza-pane') ?? null,
    point,
  );
  expect(on, `${name} is covered by chrome at ${Math.round(point.x)},${Math.round(point.y)}`).toBe(PANE);
  return point;
}

/**
 * A point on the scene's meshes (page px): everything framed, the pane's centre is the middle of the bounds — the
 * Cube Lad's hips. (`screenOfFace` reads Studio Pro's Model probe, which Halo does not mount.)
 */
export async function meshPoint(page: Page): Promise<Point> {
  await runOk(page, 'view.frame', { what: 'all', paneId: PANE });
  const pane = (await call(page, 'panes')).find((p) => p.id === PANE);
  if (pane === undefined) throw new Error('no single pane');
  return { x: Math.round(pane.rect.x + pane.rect.w / 2), y: Math.round(pane.rect.y + pane.rect.h / 2) };
}

/** Empty space: the upper right of the pane, clear of the character, the Halo arc and the chrome. */
export async function emptyPoint(page: Page): Promise<Point> {
  const viewport = page.viewportSize() ?? { width: 1194, height: 834 };
  return { x: Math.round(viewport.width * 0.82), y: Math.round(viewport.height * 0.3) };
}

/** The selected controls (Animate). */
export async function selectedControls(page: Page): Promise<string[]> {
  return [...(await call(page, 'state')).selection.controls];
}

export async function camera(page: Page): Promise<number[]> {
  const c = await call(page, 'cameraOf', PANE);
  return [...c.position, ...c.quaternion];
}

export const near = (a: readonly number[], b: readonly number[], eps = 1e-3): boolean =>
  a.length === b.length && a.every((v, i) => Math.abs(v - (b[i] ?? 0)) <= eps);

/** The open Halo (the verb ring or bar). */
export const haloMenu = (page: Page) => page.getByTestId('halo-ring');

/** A petal by its plain word. */
export const petal = (page: Page, label: string) =>
  haloMenu(page).getByRole('menuitem', { name: new RegExp(`^${label}\\b`) });

/** T6b's sheets, as the frame hosts them (T6-INT). */
export const HALO_SHEETS = ['more', 'numbers', 'scene', 'view', 'settings', 'health', 'help', 'about'] as const;
export type HaloSheetId = (typeof HALO_SHEETS)[number];

const MENU_LABEL: Partial<Record<HaloSheetId, string>> = {
  scene: 'Scene',
  view: 'View',
  settings: 'Settings',
  health: 'Health',
  help: 'Help',
};

/**
 * Opens a sheet the way a person does in the real shell (T6-INT): More from the tray's ⋯, Numbers from the
 * breadcrumb (a selection is needed), Scene, View, Settings, Health and Help from the project menu, About this
 * character from the character's Halo in Rig (the breadcrumb's root crumb, then its petal). `touch` taps, else clicks.
 */
export async function openSheetFromShell(page: Page, id: HaloSheetId, touch: boolean): Promise<void> {
  const press = (locator: ReturnType<Page['locator']>): Promise<void> => (touch ? locator.tap() : locator.click());
  const label = MENU_LABEL[id];
  if (id === 'more') {
    await press(page.getByTestId('halo-tray-verbs').locator('[data-verb="more"]'));
  } else if (id === 'numbers') {
    await press(page.getByTestId('halo-numbers'));
  } else if (id === 'about') {
    if ((await halo(page)).stage !== 'rig') {
      await press(page.getByTestId('halo-path').getByRole('tab', { name: /^Rig\b/ }));
      await expect.poll(async () => (await halo(page)).stage).toBe('rig');
    }
    await press(page.getByTestId('halo-crumb-character'));
    await expect.poll(async () => (await halo(page)).noun?.kind).toBe('character');
    await press(haloMenu(page).getByRole('menuitem', { name: /^About this character/ }));
  } else if (label !== undefined) {
    await press(page.getByTestId('halo-project'));
    await press(page.getByTestId('halo-project-menu').getByRole('menuitem', { name: label, exact: true }));
  }
  await expect(page.getByTestId(`halo-sheet-${id}`)).toBeVisible();
  await expect.poll(async () => (await halo(page)).sheet).toBe(id);
}
