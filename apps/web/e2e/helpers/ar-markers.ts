// Auto-Rig ② Markers e2e helpers (AUTORIG-SPEC §10 D4, §11; one file per step owner, §10.0): a sample loaded through
// `autorig.sample` and taken to ② through the UI (*Next: Markers*), Quick Rig's state and the marker points in the
// wizard's panes (C3's test API), a mouse drag, the truth markers of the fixtures and distances in H.
import { readFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';
import { openAutoRigReady } from './ar-host';
import { waitForReport } from './ar-model';
import { autorig, type AutoRigTestState } from './autorig';
import { centreOf, paneRect, pointOf } from './g1-viewport';
import { call } from './test-api';

export type Vec3 = readonly [number, number, number];
export type Point = { readonly x: number; readonly y: number };
export type QuickRigView = NonNullable<Awaited<ReturnType<typeof quickRig>>>;

export const FRONT = 'pane-front';
export const SIDE = 'pane-side';
export const PERSP = 'pane-persp';

const fixture = (file: string): string =>
  readFileSync(new URL(`../../../../fixtures/models/${file}`, import.meta.url), 'utf8');

/** The nine Quick Rig markers (character's right side for the side markers). */
export const MARKERS = ['headTop', 'chin', 'pelvis', 'shoulder', 'elbow', 'wrist', 'knee', 'ankle', 'toe'] as const;

/** The Cube Lad's truth markers and height (`cube-lad-truth.json`). */
export function cubeLadMarkers(): { readonly height: number; readonly markers: Record<string, Vec3> } {
  const truth = JSON.parse(fixture('cube-lad-truth.json')) as { height: number; markers: Record<string, Vec3> };
  return { height: truth.height, markers: truth.markers };
}

/** Polybot's truth markers per pose (`polybot-truth.json`). */
export function polybotMarkers(pose: 'apose' | 'tpose'): {
  readonly height: number;
  readonly markers: Record<string, Vec3>;
  readonly humanoid: Record<string, Vec3>;
} {
  const truth = JSON.parse(fixture('polybot-truth.json')) as {
    poses: Record<string, { height: number; markers: Record<string, Vec3>; humanoid: Record<string, Vec3> }>;
  };
  const entry = truth.poses[pose];
  if (entry === undefined) throw new Error(`no ${pose} truth`);
  return entry;
}

/** Quick Rig's state through the test API (null when closed). */
export function quickRig(page: Page) {
  return call(page, 'quickRig');
}

export function dist(a: readonly number[], b: readonly number[]): number {
  return Math.hypot((a[0] ?? 0) - (b[0] ?? 0), (a[1] ?? 0) - (b[1] ?? 0), (a[2] ?? 0) - (b[2] ?? 0));
}

/** The wizard state, asserted present. */
export async function wizard(page: Page): Promise<AutoRigTestState> {
  const state = await autorig(page);
  if (state === null) throw new Error('no Auto-Rig shell');
  return state;
}

/** The sample files of ①'s sample buttons. */
const SAMPLE_FILES: Readonly<Record<StaticSample, string>> = {
  'cube-lad': 'cube-lad.glb',
  'polybot-tpose': 'polybot-unskinned-tpose.glb',
  'polybot-apose': 'polybot-unskinned.glb',
};
export type StaticSample = 'cube-lad' | 'polybot-tpose' | 'polybot-apose';

/** `/autorig` with a static sample loaded at ① through its sample button (`autorig.sample`), its report shown. */
export async function sampleAtModel(page: Page, sample: StaticSample): Promise<AutoRigTestState> {
  await openAutoRigReady(page);
  await page.locator(`[data-sample="${sample}"]`).click();
  await waitForReport(page, SAMPLE_FILES[sample]);
  await expect.poll(async () => (await wizard(page)).done.model).toBe(true);
  await expect(page.getByTestId('ar-primary')).toBeEnabled();
  return wizard(page);
}

/** *Next: Markers* from ①, then waits for Quick Rig's guess and its preview in ② (front │ side │ persp). */
export async function toMarkers(page: Page): Promise<QuickRigView> {
  await page.getByTestId('ar-primary').click();
  await expect.poll(async () => (await wizard(page)).step).toBe('markers');
  await expect.poll(async () => (await quickRig(page))?.preview?.length ?? 0, { timeout: 20_000 }).toBeGreaterThan(0);
  await expect(page.getByTestId('quickrig-panel')).toHaveAttribute('data-open', 'true');
  return (await quickRig(page)) as QuickRigView;
}

/** A sample loaded and taken to ② through the UI. */
export async function sampleAtMarkers(page: Page, sample: StaticSample): Promise<QuickRigView> {
  await sampleAtModel(page, sample);
  return toMarkers(page);
}

/** The page point of a marker (R) or its ghost (L) in a pane, polled until drawn. */
export function markerAt(page: Page, marker: string, side: 'R' | 'L', paneId: string): Promise<Point> {
  return pointOf(page, () => call(page, 'screenOfMarker', marker, side, paneId), `${marker} ${side} in ${paneId}`);
}

/** A mouse drag in small steps (the markers tool's threshold is passed on the first move). */
export async function drag(page: Page, from: Point, to: Point, steps = 8): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
  }
  await page.mouse.up();
}

/** Selects a marker in the compact list (C3's body). */
export async function selectMarker(page: Page, name: string): Promise<void> {
  await page.getByTestId(`quickrig-marker-${name}`).click();
  await expect.poll(async () => (await quickRig(page))?.selected).toBe(name);
}

/** Hovers a pane's centre (the keyboard nudge acts in the pane under the pointer). */
export async function hoverPane(page: Page, paneId: string): Promise<void> {
  const at = centreOf(await paneRect(page, paneId));
  await page.mouse.move(at.x, at.y);
  await expect
    .poll(async () => ((await wizard(page)).slices['markers'] as { pane: string }).pane)
    .toBe(paneId.replace('pane-', ''));
}

/** World metres per screen pixel of an ortho pane (two markers of known distance). */
export async function metresPerPixel(page: Page, paneId: string, a: string, b: string): Promise<number> {
  const state = (await quickRig(page)) as QuickRigView;
  const pa = await markerAt(page, a, 'R', paneId);
  const pb = await markerAt(page, b, 'R', paneId);
  const world = dist(state.markers[a] ?? [], state.markers[b] ?? []);
  return world / Math.hypot(pa.x - pb.x, pa.y - pb.y);
}
