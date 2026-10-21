// M6b Rig & Skin helpers (M6B-SPEC §3 rule 5; C0, closed after C0): enter Rig & Skin, create the generated-body
// character, screen points of joints and points, the keys hash and `undoUntil(label)`. Content helpers live in
// `helpers/m6b-<package-slug>.ts` of their owners; the Cube Lad in `helpers/m6b-cube-lad.ts`.
import { expect, type Page } from '@playwright/test';
import { createPrimitive, enterModel, type ScreenPoint } from './m6a-model';
import { call, openEditor, run, runOk } from './test-api';

/** Rig & Skin's front pane in the MVP layouts (R-Side `front │ persp`, R-Markers `front │ side │ persp`). */
export const RIG_FRONT_PANE = 'pane-left';
/** Rig & Skin's perspective pane. */
export const RIG_PERSP_PANE = 'pane-right';

/** Switches to Rig & Skin through `workspace.set` (the tab's operator; it loads the rig-workspace chunk first). */
export async function enterRig(page: Page): Promise<void> {
  await runOk(page, 'workspace.set', { workspace: 'rig' });
  await expect.poll(async () => (await call(page, 'state')).workspace).toBe('rig');
}

/** Opens the editor directly in Rig & Skin. */
export async function openRig(page: Page, query = ''): Promise<void> {
  await openEditor(page, query);
  await enterRig(page);
}

/**
 * The generated humanoid body (M6a B13, `mesh.create.template {template: 'humanoidBody'}`) turned into a character
 * with the Standard 33 template (`skel.template.create`, pre-fitted by CR-2). Returns the mesh and the result.
 */
export async function createBodyCharacter(
  page: Page,
  preset: 'lite17' | 'core21' | 'standard33' | 'full52' = 'standard33',
): Promise<{ readonly mesh: string; readonly character: string; readonly skeleton: string }> {
  if ((await call(page, 'state')).workspace !== 'model') await enterModel(page);
  const created = await runOk<{ root: string }>(page, 'mesh.create.template', { template: 'humanoidBody' });
  await runOk(page, 'select.objects', { ids: [created.root], mode: 'replace' });
  await enterRig(page);
  const result = await runOk<{ character: string; skeleton: string }>(page, 'skel.template.create', {
    preset,
    objects: [created.root],
  });
  return { mesh: created.root, ...result };
}

/** A primitive at the origin in Model (a convenience re-export for rig specs). */
export { createPrimitive };

/** The screen point of a joint's sphere in a pane (page CSS px), polled until it is drawn. */
export async function screenOfJoint(page: Page, joint: string, paneId: string = RIG_PERSP_PANE): Promise<ScreenPoint> {
  let point: ScreenPoint | null = null;
  await expect
    .poll(async () => {
      point = await call(page, 'screenOfJoint', joint, paneId);
      return point !== null;
    })
    .toBe(true);
  return point as unknown as ScreenPoint;
}

/** The screen point of a mesh point (a vertex) in a pane, polled until it is drawn. */
export async function screenOfPoint(
  page: Page,
  mesh: string,
  point: number,
  paneId: string = RIG_PERSP_PANE,
): Promise<ScreenPoint> {
  let at: ScreenPoint | null = null;
  await expect
    .poll(async () => {
      at = await call(page, 'screenOfVertex', mesh, point, paneId);
      return at !== null;
    })
    .toBe(true);
  return at as unknown as ScreenPoint;
}

/** sha256 of the curves and keys tables (P-C6: rig edits never key). */
export function keysHash(page: Page): Promise<string> {
  return call(page, 'keysHash');
}

/** Undoes steps until the step labelled `label` has been undone (fails when the history has no such step). */
export async function undoUntil(page: Page, label: string): Promise<void> {
  const history = await call(page, 'history');
  expect(history.undo, `no undo step '${label}'`).toContain(label);
  for (let guard = 0; guard < 1000; guard++) {
    const { undo } = await call(page, 'history');
    const top = undo.at(-1);
    await runOk(page, 'edit.undo');
    if (top === label) return;
  }
  throw new Error(`undoUntil: '${label}' not reached`);
}

/** Runs an operator expected to refuse with `reason` (a stub's poll). */
export async function expectRefused(page: Page, op: string, reason: string, args?: unknown): Promise<void> {
  const result = await run(page, op, args);
  expect(result, op).toMatchObject({ status: 'cancelled', reason });
}
