import { expect, type Page, test } from '@playwright/test';
import { drag, paneRect } from './helpers/g1-viewport';
import { enterModel } from './helpers/m6a-model';
import { cubeLadTruth } from './helpers/m6b-cube-lad';
import { enterRig, RIG_FRONT_PANE, RIG_SIDE_PANE } from './helpers/m6b-rig';
import {
  buildAPosedCubeLad,
  createSkeleton,
  cubeLadInRig,
  dist,
  jointAt,
  jointsByKey,
  markerAt,
  type QuickRigView,
  quickRig,
  sideZSign,
  startQuickRig,
} from './helpers/m6b-skeleton-ui';
import { call, expectKernelStarted, openEditor, runOk } from './helpers/test-api';

// E2E-QR-02 (M6B-SPEC §0.7 "Create Skeleton"; owner C3, gates c1 — Create Skeleton commits a character through C1's
// `char.fromModel` — and c4 — the bound re-run): the Cube Lad and the generated humanoid body: guess, Create Skeleton
// → one step, every humanoid joint within 0.03 H of the truth, the committed joints equal the last preview,
// `rigState().mode === 'skeleton'`; Full 52 adds upperChest and fingers; an A-posed variant shows the A-pose notice and
// `skel.tpose`; the re-run: Quick Rig again on the character seeds the markers from the joints, a knee drag and Create
// Skeleton → one step "Refit Skeleton", the same joint ids, still one character; after `skin.bind` the re-run asks
// "Rebind replaces painted weights".

const truth = cubeLadTruth();

async function characters(page: Page): Promise<string[]> {
  return (await call(page, 'characters')).map((character) => character.id);
}

/** The committed joints equal the last preview bit for bit; every truth joint within `tolerance` H. */
async function expectCommitted(
  page: Page,
  character: string,
  preview: QuickRigView['preview'],
  truthJoints: ReadonlyMap<string, readonly number[]>,
  H: number,
  tolerance = 0.03,
): Promise<void> {
  const joints = await jointsByKey(page, character);
  expect(preview?.map((joint) => [joint.key, joint.position])).toEqual(
    preview?.map((joint) => [joint.key, joints.get(joint.key)?.restPosition]),
  );
  const off = [...truthJoints]
    .filter(([key]) => key !== 'root' && joints.has(key))
    .map(([key, position]) => [key, dist(joints.get(key)?.restPosition ?? [], position) / H] as const)
    .filter(([, error]) => error > tolerance);
  expect(off).toEqual([]);
  expect((await call(page, 'rigState')).mode).toBe('skeleton');
}

test(`E2E-QR-02: Create Skeleton on the Cube Lad, Full 52, the re-run in place`, async ({ page }) => {
  await cubeLadInRig(page);
  const steps = (await call(page, 'history')).undo.length;
  const state = await startQuickRig(page);
  const character = await createSkeleton(page);
  expect((await call(page, 'history')).undo.length).toBe(steps + 1);
  expect(await characters(page)).toEqual([character]);
  const joints = await jointsByKey(page, character);
  expect(joints.size).toBe(34);
  expect(joints.get('root')?.role).toBe('helper');
  await expectCommitted(
    page,
    character,
    state.preview,
    new Map(Object.entries(truth.joints).map(([key, joint]) => [key, joint.position])),
    truth.height,
  );
  // Frame All over the front and side panes fills them with the character for joint fitting (acceptance fix: the
  // bounding-sphere fit left it at about a third of the side pane's height).
  for (const [pane, least] of [
    [RIG_FRONT_PANE, 0.45],
    [RIG_SIDE_PANE, 0.6],
  ] as const) {
    await runOk(page, 'view.frame', { paneId: pane, what: 'all' });
    const head = await jointAt(page, joints.get('head')?.id ?? '', pane);
    const foot = await jointAt(page, joints.get('leftFoot')?.id ?? '', pane);
    expect(Math.abs(foot.y - head.y) / (await paneRect(page, pane)).h, pane).toBeGreaterThan(least);
  }

  // Full 52: undo, Quick Rig again on the scene mesh, the template select, Create Skeleton.
  await runOk(page, 'edit.undo');
  await runOk(page, 'rig.mode', { mode: 'object' });
  const mesh = (await call(page, 'meshes')).find((row) => row.owner === 'scene')?.id ?? '';
  await runOk(page, 'select.objects', { ids: [mesh], mode: 'replace' });
  await startQuickRig(page);
  await page.getByTestId('quickrig-preset').selectOption('full52');
  await expect
    .poll(async () => (await quickRig(page))?.preview?.map((joint) => joint.key) ?? [])
    .toContain('upperChest');
  expect((await quickRig(page))?.preview?.map((joint) => joint.key)).toContain('leftIndexProximal');
  const full = await createSkeleton(page);
  expect((await jointsByKey(page, full)).has('upperChest')).toBe(true);

  // The re-run: Quick Rig again on the character (nothing selected) seeds the markers from its joints.
  const ids = [...(await jointsByKey(page, full)).values()].map((joint) => joint.id).sort();
  await page.getByTestId('rtk-btn-skel.quickRig.start').click();
  await expect.poll(async () => (await quickRig(page))?.moved.length ?? 0).toBe(9);
  await expect(page.getByTestId('quickrig-preset')).toBeDisabled();
  const zRight = await sideZSign(page);
  const knee = await markerAt(page, 'knee', 'R', RIG_SIDE_PANE);
  await drag(page, knee, { dx: 6 * zRight, dy: 0 });
  await createSkeleton(page, 'Refit Skeleton');
  expect([...(await jointsByKey(page, full)).values()].map((joint) => joint.id).sort()).toEqual(ids);
  expect(await characters(page)).toEqual([full]);

  // Bound: the re-run asks before it rebinds.
  await runOk(page, 'skin.bind', {});
  await page.getByTestId('rtk-btn-skel.quickRig.start').click();
  await expect.poll(async () => (await quickRig(page))?.moved.length ?? 0).toBe(9);
  await page.getByTestId('quickrig-commit').click();
  await expect(page.getByTestId('quickrig-rebind-confirm')).toContainText('Rebind replaces painted weights');
  await page.getByTestId('quickrig-rebind-no').click();
  expect(await quickRig(page)).not.toBeNull();
});

test(`E2E-QR-02: the generated humanoid body and an A-posed Cube Lad`, async ({ page }) => {
  await openEditor(page);
  await expectKernelStarted(page);
  await enterModel(page);
  // The generated body (smooth): its CR-2 pre-fit (Skeleton Template) is the truth Quick Rig must meet.
  const { root } = await runOk<{ root: string }>(page, 'mesh.create.template', {
    template: 'humanoidBody',
    style: 'smooth',
  });
  await runOk(page, 'select.objects', { ids: [root], mode: 'replace' });
  await enterRig(page);
  const reference = await runOk<{ character: string }>(page, 'skel.template.create', { objects: [root] });
  const bodyTruth = new Map(
    [...(await jointsByKey(page, reference.character)).values()].map((joint) => [joint.key, joint.restPosition]),
  );
  const H = Math.max(...[...bodyTruth.values()].map((p) => p[1] ?? 0));
  await runOk(page, 'edit.undo');
  await runOk(page, 'rig.mode', { mode: 'object' });
  await runOk(page, 'select.objects', { ids: [root], mode: 'replace' });
  const state = await startQuickRig(page);
  const body = await createSkeleton(page);
  // On the generated body the guessed elbow is 0.041 H from the CR-2 elbow (C2's calibration, M6B-C2 spike table), so
  // the guess → fit chain meets the guess gate (0.05 H), not the fit gate (docs/wp-notes/m6b-skeleton-ui.md, M6B-C3-12).
  await expectCommitted(page, body, state.preview, bodyTruth, H, 0.05);

  // An A-posed Cube Lad (arms 35° down): the A-pose notice; after Create Skeleton Validation reports skel.tpose.
  await runOk(page, 'edit.undo');
  await runOk(page, 'scene.delete', { ids: [root] });
  await buildAPosedCubeLad(page, 35);
  await enterRig(page);
  await startQuickRig(page);
  await expect(page.getByTestId('quickrig-apose')).toContainText('A-posed arms');
  expect((await quickRig(page))?.aPose).toBe(true);
  await createSkeleton(page);
  await expect
    .poll(async () => (await call(page, 'validation', 'ekza/space-avatar-v1')).map((row) => row.code))
    .toContain('skel.tpose');
});
