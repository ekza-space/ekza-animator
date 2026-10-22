// Auto-Rig acceptance scripts (AUTORIG-SPEC §11; D7): the pieces the full AS-AR scripts share — the landing's
// *Start Auto-Rig*, a real file drop on ①, the network log of the privacy rule (§8.5), the ② / ③ / ④ / ⑤ steps of
// AS-AR-1 through the UI (every step a click, a drag or a key, never an operator run), the truth checks in H, the idle
// rule (M6B-INT-5's settling, then 0 frames over 2 s) and the humanoid rest directions of a written VRM. The step
// owners' helpers (`ar-model`, `ar-markers`, `ar-rig`, `ar-animations`, `ar-export`) are reused, not copied.
import { expect, type Page } from '@playwright/test';
import { setAuthorAndLicence, thumbnailRendered } from './ar-export';
import { waitForReport } from './ar-model';
import { dist, MARKERS, type QuickRigView, quickRig, type Vec3, wizard } from './ar-markers';
import { autorig, history } from './autorig';
import { glbJson, humanoidNode, restWorld } from './g1-viewport';
import { renderedFrames, waitForTestApi } from './test-api';
import { charactersSettled } from './m6b-mvp-script';

/** Every request a page makes, from the moment this is called (§8.5: same origin, no POST). */
export function networkLog(page: Page): { readonly requests: { method: string; url: string }[] } {
  const requests: { method: string; url: string }[] = [];
  page.on('request', (request) => requests.push({ method: request.method(), url: request.url() }));
  return { requests };
}

/** The requests that leave the page's origin or post anything (empty when the privacy rule holds). */
export function foreignRequests(page: Page, log: { readonly requests: { method: string; url: string }[] }): string[] {
  const origin = new URL(page.url()).origin;
  return log.requests
    .filter(
      (request) =>
        !(request.url.startsWith(`${origin}/`) || request.url.startsWith('blob:') || request.url.startsWith('data:')) ||
        request.method !== 'GET',
    )
    .map((request) => `${request.method} ${request.url}`);
}

/** AS-AR-1 step 1: `/` → *Start Auto-Rig* (the landing card, a plain link) → `/autorig` with the test API. */
export async function startFromLanding(page: Page): Promise<void> {
  await page.goto('/?e2e=1');
  await expect(page.getByTestId('entry-autorig')).toHaveAttribute('href', '/autorig?e2e=1');
  await page.getByTestId('entry-autorig').click();
  await expect(page).toHaveURL(/\/autorig\?e2e=1$/);
  await waitForTestApi(page);
  await expect.poll(async () => (await autorig(page))?.step).toBe('model');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Model/);
}

/** A real drop of a file on ①'s drop zone (a DataTransfer built in the page from the bytes). */
export async function dropModel(page: Page, name: string, bytes: Uint8Array): Promise<void> {
  const data = Buffer.from(bytes).toString('base64');
  await page.evaluate(
    ([fileName, base64]) => {
      const transfer = new DataTransfer();
      const content = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      transfer.items.add(new File([content], fileName, { type: 'model/gltf-binary' }));
      const zone = document.querySelector('[data-testid="ar-drop-zone"]') ?? document.body;
      zone.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: transfer }));
      zone.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }));
      zone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    },
    [name, data] as const,
  );
  await waitForReport(page, name);
}

/** The markers farther than `tolerance` × H from the truth (names). */
export function markersOff(
  state: QuickRigView,
  truth: { readonly height: number; readonly markers: Readonly<Record<string, Vec3>> },
  tolerance = 0.05,
): string[] {
  return MARKERS.filter(
    (name) => dist(state.markers[name] ?? [], truth.markers[name] ?? []) / truth.height > tolerance,
  ).map((name) => name);
}

/** The humanoid joints farther than `tolerance` × H from the truth's humanoid positions. */
export function jointsOff(
  joints: readonly { readonly humanBone: string | null; readonly restPosition: readonly number[] }[],
  truth: { readonly height: number; readonly humanoid: Readonly<Record<string, Vec3>> },
  tolerance = 0.05,
): string[] {
  return joints
    .filter((joint) => joint.humanBone !== null && truth.humanoid[joint.humanBone] !== undefined)
    .filter((joint) => dist(joint.restPosition, truth.humanoid[joint.humanBone ?? ''] ?? []) / truth.height > tolerance)
    .map((joint) => joint.humanBone ?? '');
}

/** The primary button: waits for its label, then clicks it. */
export async function primary(page: Page, label: RegExp): Promise<void> {
  await expect(page.getByTestId('ar-primary')).toHaveText(label);
  await expect(page.getByTestId('ar-primary')).toBeEnabled();
  await page.getByTestId('ar-primary').click();
}

/** Waits for the wizard to show `step`. */
export async function onStep(page: Page, step: string, timeout = 30_000): Promise<void> {
  await expect.poll(async () => (await wizard(page)).step, { timeout }).toBe(step);
}

/** ② *Next* from ①; waits for the guess and its preview. */
export async function nextToMarkers(page: Page): Promise<QuickRigView> {
  await primary(page, /Next: Markers/);
  await onStep(page, 'markers');
  await expect.poll(async () => (await quickRig(page))?.preview?.length ?? 0, { timeout: 30_000 }).toBeGreaterThan(0);
  return (await quickRig(page)) as QuickRigView;
}

/** ④ through the UI: search, open the card, the parameters, *Add*; returns after the "Use Clip <name>" step. */
export async function addClip(
  page: Page,
  clip: { readonly id: string; readonly name: string; readonly search?: string },
  params: { readonly speedSteps?: number; readonly inPlace?: boolean; readonly mirror?: boolean } = {},
): Promise<void> {
  await page.getByTestId('ar-anim-search').fill(clip.search ?? '');
  await page.getByTestId(`ar-clip-card-${clip.id}`).click();
  await expect.poll(async () => (await libraryPreviewClip(page)) ?? null).toBe(clip.id);
  if (params.speedSteps !== undefined && params.speedSteps !== 0) {
    await page.getByTestId('ar-param-speed').focus();
    const key = params.speedSteps > 0 ? 'ArrowRight' : 'ArrowLeft';
    for (let i = 0; i < Math.abs(params.speedSteps); i++) await page.keyboard.press(key);
  }
  if (params.inPlace === true) await page.getByTestId('ar-param-inplace').check();
  if (params.mirror === true) await page.getByTestId('ar-param-mirror').check();
  const steps = (await history(page)).undo.length;
  await page.getByTestId('ar-clip-add').click();
  await expect.poll(async () => (await history(page)).undo.at(-1)).toBe(`Use Clip ${clip.name}`);
  expect((await history(page)).undo.length).toBe(steps + 1);
}

async function libraryPreviewClip(page: Page): Promise<string | null> {
  return page.evaluate(() => window.__EKZA_STUDIO_TEST__?.library()?.preview?.clip ?? null);
}

/** ⑤'s meta: the thumbnail rendered on entry, author "Tester", licence CC0 (C10's fields; two undo steps). */
export async function exportMeta(page: Page): Promise<void> {
  await thumbnailRendered(page);
  await setAuthorAndLicence(page, 'Tester', 'cc0');
}

/**
 * M6B-INT-5's settling rule, then the gate: the page draws until it settles (≤ 6 rounds of 2.6 s), then 0 WebGL
 * frames over 2 s. Returns the frames drawn in the measured window.
 */
export async function idleFrames(page: Page): Promise<number> {
  await page.mouse.move(2, 2);
  for (let round = 0; round < 6; round++) {
    const frames = await renderedFrames(page);
    await page.waitForTimeout(2_600);
    await charactersSettled(page);
    if ((await renderedFrames(page)) === frames) break;
  }
  const idle = await renderedFrames(page);
  await page.waitForTimeout(2_000);
  return (await renderedFrames(page)) - idle;
}

const DEG = Math.PI / 180;

/** The angle in degrees between two directions. */
export function angleDeg(a: readonly number[], b: readonly number[]): number {
  const la = Math.hypot(a[0] ?? 0, a[1] ?? 0, a[2] ?? 0);
  const lb = Math.hypot(b[0] ?? 0, b[1] ?? 0, b[2] ?? 0);
  const dot = ((a[0] ?? 0) * (b[0] ?? 0) + (a[1] ?? 0) * (b[1] ?? 0) + (a[2] ?? 0) * (b[2] ?? 0)) / (la * lb);
  return Math.acos(Math.min(1, Math.max(-1, dot))) / DEG;
}

/**
 * The written file's humanoid rest directions (AS-AR-2 step 6): upper arm → hand against ±X and lower leg → foot
 * against −Y, in degrees, from the glTF scene graph of the VRM's bytes.
 */
export function restDirections(bytes: Uint8Array): Record<string, number> {
  const json = glbJson(bytes);
  const at = (bone: string): number[] => restWorld(json, humanoidNode(json, bone)).t;
  const between = (from: string, to: string): number[] => {
    const a = at(from);
    const b = at(to);
    return [(b[0] ?? 0) - (a[0] ?? 0), (b[1] ?? 0) - (a[1] ?? 0), (b[2] ?? 0) - (a[2] ?? 0)];
  };
  return {
    leftArm: angleDeg(between('leftUpperArm', 'leftHand'), [1, 0, 0]),
    rightArm: angleDeg(between('rightUpperArm', 'rightHand'), [-1, 0, 0]),
    leftShin: angleDeg(between('leftLowerLeg', 'leftFoot'), [0, -1, 0]),
    rightShin: angleDeg(between('rightLowerLeg', 'rightFoot'), [0, -1, 0]),
  };
}

/** The arm angle below horizontal (degrees, the larger side) of a truth pose's humanoid joints. */
export function truthArmAngle(humanoid: Readonly<Record<string, Vec3>>): number {
  const side = (upper: string, hand: string): number => {
    const a = humanoid[upper] ?? [0, 0, 0];
    const b = humanoid[hand] ?? [0, 0, 0];
    return Math.atan2(a[1] - b[1], Math.abs(b[0] - a[0])) / DEG;
  };
  return Math.max(side('leftUpperArm', 'leftHand'), side('rightUpperArm', 'rightHand'));
}
