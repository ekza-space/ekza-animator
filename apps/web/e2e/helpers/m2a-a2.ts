// Helpers of the A2 scenarios (M2A-SPEC §9.1 E2E-M2A-01…07, 18, 19, 25): the A1 gate, world reads, Channel Box
// typing, viewport picks and MMB drags at test-API coordinates (MVP-SPEC §6.1: real input, assertions through the
// test API).
import { expect, type Page } from '@playwright/test';
import { pointOf } from './g1-viewport';
import { call, runOk } from './test-api';

export const DEG = Math.PI / 180;

export type Vec3 = readonly [number, number, number];
export type Quat = readonly [number, number, number, number];
export type World = { readonly t: Vec3; readonly q: Quat };

/**
 * M2A-SPEC §3 rule 4 / §8: the IK scenarios need A1 (limb IK records and the ik2 op). Before A1 merged this was a
 * `test.fixme('A1')` gate; since integration a character loaded with the default preferences and no limbs fails the
 * scenario, naming the piece and its owner (MVP-SPEC INT-55).
 */
export async function expectLimbIk(page: Page, character?: string): Promise<void> {
  const limbs = character === undefined ? await call(page, 'limbs') : await call(page, 'limbs', character);
  expect(limbs.length, 'A1: limb IK (limbIkRecords, the ik2 op) gives the default rig its limbs').toBeGreaterThan(0);
}

/** The ControlId of a template key on a character (the active one by default). */
export async function controlIdOf(page: Page, key: string, character?: string): Promise<string> {
  const controls = character === undefined ? await call(page, 'controls') : await call(page, 'controls', character);
  const found = controls.find((control) => control.key === key);
  if (found === undefined) throw new Error(`no control ${key}`);
  return found.id;
}

export function distance(a: Vec3 | readonly number[], b: Vec3 | readonly number[]): number {
  return Math.hypot((a[0] ?? 0) - (b[0] ?? 0), (a[1] ?? 0) - (b[1] ?? 0), (a[2] ?? 0) - (b[2] ?? 0));
}

/** Angle between two unit quaternions (radians), sign-insensitive. */
export function quatAngle(a: Quat, b: Quat): number {
  const dot = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
  return 2 * Math.acos(Math.min(1, dot));
}

export function expectWorldClose(actual: World, expected: World, tolerance: number, what: string): void {
  expect(distance(actual.t, expected.t), `${what} position`).toBeLessThanOrEqual(tolerance);
  expect(quatAngle(actual.q, expected.q), `${what} rotation`).toBeLessThanOrEqual(tolerance);
}

export function sub(a: Vec3, b: Vec3): [number, number, number] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
export function cross(a: Vec3, b: Vec3): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
export function normalize(a: Vec3): [number, number, number] {
  const length = Math.hypot(a[0], a[1], a[2]);
  return length === 0 ? [0, 0, 0] : [a[0] / length, a[1] / length, a[2] / length];
}
/** Rotates v by q (unit quaternion x, y, z, w). */
export function rotate(q: Quat, v: Vec3): [number, number, number] {
  const [x, y, z, w] = q;
  const u: Vec3 = [x, y, z];
  const t = cross(u, v).map((c) => 2 * c) as [number, number, number];
  const c = cross(u, t);
  return [v[0] + w * t[0] + c[0], v[1] + w * t[1] + c[1], v[2] + w * t[2] + c[2]];
}

/** Types a value into a Channel Box field (display units) and commits it with Enter. */
export async function typeCb(page: Page, testId: string, text: string): Promise<void> {
  const field = page.getByTestId(testId);
  await expect(field).toBeVisible();
  await field.fill(text);
  await field.press('Enter');
  await expect(field).not.toBeFocused();
}

/** Selects controls through the operator (the scenario's selection step when no click is under test). */
export async function selectIds(page: Page, ids: readonly string[]): Promise<void> {
  await runOk(page, 'select.controls', { ids, mode: 'replace' });
}

/** Keys of a control channel curve in the active clip ([] when the curve has none). */
export async function keysOn(page: Page, control: string, channel: string) {
  const clip = (await call(page, 'state')).activeClip ?? '';
  const curve = (await call(page, 'curves', clip, control)).find((candidate) => candidate.channel === channel);
  return curve?.keys ?? [];
}

/** Presses `button` at `from`, moves `dx` CSS px right in `steps` moves, releases (modifiers held throughout). */
export async function horizontalDrag(
  page: Page,
  from: { readonly x: number; readonly y: number },
  dx: number,
  opts: { readonly button?: 'left' | 'middle'; readonly steps?: number; readonly modifiers?: readonly string[] } = {},
): Promise<void> {
  const steps = opts.steps ?? 8;
  for (const key of opts.modifiers ?? []) await page.keyboard.down(key);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down({ button: opts.button ?? 'left' });
  for (let step = 1; step <= steps; step++) await page.mouse.move(from.x + (dx * step) / steps, from.y);
  await page.mouse.up({ button: opts.button ?? 'left' });
  for (const key of [...(opts.modifiers ?? [])].reverse()) await page.keyboard.up(key);
}

/** The centre of an element by test id. */
export async function centreOfTestId(page: Page, testId: string): Promise<{ x: number; y: number }> {
  const box = await page.getByTestId(testId).boundingBox();
  if (box === null) throw new Error(`${testId} is not visible`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Clicks a control in a viewport pane (its best pick point). */
export async function clickControl(page: Page, control: string, pane = 'pane-right'): Promise<void> {
  const at = await pointOf(page, () => call(page, 'screenOfControl', control, pane), `${control} in ${pane}`);
  await page.mouse.click(at.x, at.y);
  await expect.poll(async () => (await call(page, 'state')).selection.controls.at(-1)).toBe(control);
}

/** The editor-history depth through repeated reads is not exposed: undo labels as a proxy of one step. */
export async function undoLabel(page: Page): Promise<string | null> {
  return (await call(page, 'state')).history.undoLabel;
}

/** Bone worlds of several humanoid bones (or node names) of a character at a clip frame (default: current). */
export async function boneWorlds(
  page: Page,
  character: string,
  bones: readonly string[],
  clipFrame?: number,
): Promise<Record<string, World>> {
  return page.evaluate(
    ([id, names, frame]) => {
      const api = window.__EKZA_ANIMATOR_TEST__;
      if (api === undefined) throw new Error('no test API');
      return Object.fromEntries(
        names.map((name) => [name, frame === null ? api.boneWorld(id, name) : api.boneWorld(id, name, frame)] as const),
      );
    },
    [character, bones, clipFrame ?? null] as const,
  );
}

/** Applies the inverse of `parent` to `child` (both worlds): the child's transform in the parent's frame. */
export function relative(parent: World, child: World): World {
  const [x, y, z, w] = parent.q;
  const inv: Quat = [-x, -y, -z, w];
  const t = rotate(inv, sub(child.t, parent.t));
  const [bx, by, bz, bw] = child.q;
  const [ax, ay, az, aw] = inv;
  const q: Quat = [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
  return { t, q };
}

/** Toast texts currently shown. */
export async function toastTexts(page: Page): Promise<string[]> {
  return page.getByTestId('toast').allTextContents();
}

// ---------- VRMA check page (the E2E-17 method, for E2E-M2A-07) ----------

export interface VrmaCheckResult {
  readonly metaVersion: '0' | '1';
  readonly bones: readonly string[];
  readonly samples: readonly { readonly time: number; readonly rotations: Readonly<Record<string, Quat>> }[];
}

declare global {
  interface Window {
    __EKZA_VRMA_CHECK__?: {
      readonly ready: Promise<void>;
      play(vrma: Uint8Array, times: readonly number[]): Promise<Record<string, VrmaCheckResult>>;
    };
  }
}

/** Opens /e2e/vrma-check in a new page of the same browser context options, plays the VRMA at `times`. */
export async function playVrma(
  page: Page,
  bytes: Uint8Array,
  times: readonly number[],
): Promise<Record<string, VrmaCheckResult>> {
  const check = await page.context().newPage();
  try {
    await check.goto('/e2e/vrma-check');
    await check.waitForFunction(() => window.__EKZA_VRMA_CHECK__ !== undefined);
    await check.evaluate(async () => {
      await window.__EKZA_VRMA_CHECK__?.ready;
    });
    await expect(check.getByTestId('vrma-check-status')).toHaveText(/^Ready/);
    const base64 = Buffer.from(bytes).toString('base64');
    return await check.evaluate(
      async ([data, at]) => {
        const binary = atob(data);
        const array = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) array[i] = binary.charCodeAt(i);
        const api = window.__EKZA_VRMA_CHECK__;
        if (api === undefined) throw new Error('no VRMA check API');
        return api.play(array, at);
      },
      [base64, times] as const,
    );
  } finally {
    await check.close();
  }
}
