// C3 content helpers (M6B-SPEC §0.7 E2E-QR-01/02, E2E-JNT-01): open Quick Rig on the Cube Lad, marker and joint
// screen points, Quick Rig's state, the side pane's screen direction of +Z, distances in H.
import { expect, type Page } from '@playwright/test';
import { centreOf, paneRect, pointOf } from './g1-viewport';
import { createPrimitive, enterModel } from './m6a-model';
import { buildCubeLad, cubeLadTruth, type Vec3 } from './m6b-cube-lad';
import { enterRig, RIG_FRONT_PANE, RIG_SIDE_PANE } from './m6b-rig';
import { call, expectKernelStarted, openEditor, runOk } from './test-api';

export type Point = { readonly x: number; readonly y: number };
export type QuickRigView = NonNullable<Awaited<ReturnType<typeof quickRig>>>;

/** Quick Rig's state through the test API (null when closed). */
export function quickRig(page: Page) {
  return call(page, 'quickRig');
}

/** Euclidean distance. */
export function dist(a: readonly number[], b: readonly number[]): number {
  return Math.hypot((a[0] ?? 0) - (b[0] ?? 0), (a[1] ?? 0) - (b[1] ?? 0), (a[2] ?? 0) - (b[2] ?? 0));
}

/** The Cube Lad built in Model, selected, in Rig & Skin; returns its mesh id. */
export async function cubeLadInRig(page: Page): Promise<string> {
  await openEditor(page);
  await expectKernelStarted(page);
  const mesh = await buildCubeLad(page);
  await runOk(page, 'select.objects', { ids: [mesh], mode: 'replace' });
  await enterRig(page);
  return mesh;
}

/** ① Place markers (the checklist button) and waits for the guessed markers and their preview. */
export async function startQuickRig(page: Page): Promise<QuickRigView> {
  await page.getByTestId('rtk-step-1-btn').click();
  await expect.poll(async () => (await quickRig(page))?.preview?.length ?? 0, { timeout: 15_000 }).toBeGreaterThan(0);
  await expect(page.getByTestId('quickrig-panel')).toHaveAttribute('data-open', 'true');
  return (await quickRig(page)) as QuickRigView;
}

/** The page point of a marker (R) or its ghost (L) in a pane, polled until drawn. */
export function markerAt(page: Page, marker: string, side: 'R' | 'L', paneId: string): Promise<Point> {
  return pointOf(page, () => call(page, 'screenOfMarker', marker, side, paneId), `${marker} ${side} in ${paneId}`);
}

/** The page point of a joint in a pane, polled until drawn. */
export function jointAt(page: Page, joint: string, paneId: string): Promise<Point> {
  return pointOf(page, () => call(page, 'screenOfJoint', joint, paneId), `${joint} in ${paneId}`);
}

/** +1 when +Z points to the right of the side pane, −1 when to the left (from two markers of different depth). */
export async function sideZSign(page: Page): Promise<1 | -1> {
  const state = (await quickRig(page)) as QuickRigView;
  const toe = await markerAt(page, 'toe', 'R', RIG_SIDE_PANE);
  const ankle = await markerAt(page, 'ankle', 'R', RIG_SIDE_PANE);
  const dz = (state.markers['toe']?.[2] ?? 0) - (state.markers['ankle']?.[2] ?? 0);
  return Math.sign(toe.x - ankle.x) * Math.sign(dz) >= 0 ? 1 : -1;
}

/** The marker points of every marker (R) in the front pane, in list order. */
export async function frontMarkerPoints(page: Page, names: readonly string[]): Promise<Point[]> {
  const out: Point[] = [];
  for (const name of names) out.push(await markerAt(page, name, 'R', RIG_FRONT_PANE));
  return out;
}

/** A preview joint's position. */
export function previewOf(state: QuickRigView, key: string): number[] | undefined {
  return state.preview?.find((joint) => joint.key === key)?.position;
}

/**
 * An A-posed Cube Lad (E2E-QR-02): the Cube Lad's boxes with both arms (upper arm, forearm, hand) turned `degrees`
 * down about the shoulder (z axis), combined into one scene mesh in Model; returns its id.
 */
export async function buildAPosedCubeLad(page: Page, degrees = 35): Promise<string> {
  if ((await call(page, 'state')).workspace !== 'model') await enterModel(page);
  const truth = cubeLadTruth();
  const meshes: string[] = [];
  for (const box of truth.boxes) {
    const mesh = await createPrimitive(page, 'cube', { width: box.size[0], height: box.size[1], depth: box.size[2] });
    const arm = /^(upperArm|forearm|hand)\./.test(box.name);
    const side = box.center[0] < 0 ? -1 : 1;
    let t: number[] = [...box.center];
    let q = [0, 0, 0, 1];
    if (arm) {
      const a = ((side < 0 ? 1 : -1) * degrees * Math.PI) / 180;
      const pivot = [side * 0.18, 1.33, 0];
      const dx = box.center[0] - (pivot[0] as number);
      const dy = box.center[1] - (pivot[1] as number);
      t = [
        (pivot[0] as number) + dx * Math.cos(a) - dy * Math.sin(a),
        (pivot[1] as number) + dx * Math.sin(a) + dy * Math.cos(a),
        box.center[2],
      ];
      q = [0, 0, Math.sin(a / 2), Math.cos(a / 2)];
    }
    await runOk(page, 'scene.object.transform', { ids: [mesh], placements: [{ t, q, s: [1, 1, 1] }] });
    meshes.push(mesh);
  }
  await runOk(page, 'select.objects', { ids: meshes, mode: 'replace' });
  await runOk(page, 'mesh.combine', { pivot: 'origin' });
  const rows = (await call(page, 'meshes')).filter((row) => row.owner === 'scene');
  return rows.at(-1)?.id ?? '';
}

/** The joints of a character's skeleton by key (C1's `skeleton()`). */
export async function jointsByKey(page: Page, character: string) {
  const skeleton = await call(page, 'skeleton', character);
  return new Map((skeleton?.joints ?? []).map((joint) => [joint.key, joint]));
}

/** Clicks Create Skeleton and waits for the step (`Create Skeleton` or `Refit Skeleton`). */
export async function createSkeleton(page: Page, label = 'Create Skeleton'): Promise<string> {
  await page.getByTestId('quickrig-commit').click();
  await expect.poll(async () => (await call(page, 'history')).undo.at(-1), { timeout: 15_000 }).toBe(label);
  await expect.poll(() => quickRig(page)).toBeNull();
  return (await call(page, 'rigState')).character ?? '';
}

/** Presses a tool key (`KeyW`, `KeyE`, …) with the pointer over a pane (tool keys belong to the viewport scope). */
export async function toolKey(page: Page, code: string, paneId: string = RIG_FRONT_PANE): Promise<void> {
  const centre = centreOf(await paneRect(page, paneId as never));
  await page.mouse.move(centre.x, centre.y);
  await page.keyboard.press(code);
  const tool = code === 'KeyW' ? 'move' : code === 'KeyE' ? 'rotate' : code === 'KeyR' ? 'scale' : 'select';
  await expect.poll(async () => (await call(page, 'state')).tool).toBe(tool);
}

export type { Vec3 };
