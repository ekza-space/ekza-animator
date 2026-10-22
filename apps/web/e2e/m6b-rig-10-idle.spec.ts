import { expect, test } from '@playwright/test';
import { createPrimitive, enterModel } from './helpers/m6a-model';
import { enterRig } from './helpers/m6b-rig';
import { dismissGettingStarted, enterSkin } from './helpers/m6b-skin-ui';
import { call, expectKernelStarted, openEditor, renderedFrames, runOk } from './helpers/test-api';

// E2E-RIG-10 "Idle" (M6B-SPEC §10.1, §5.25 first row, the E2E-00 gate extended to Rig & Skin; owner INT): a bound
// ≈ 3k-point character — the generated humanoid body (249 points) and a dense chest piece (a 50 × 56 sphere, 2,752
// points), Skeleton Template and Bind Skin over both — in Skin mode — the skinned display with the greyscale weight display, the joint overlay
// (small joints in Skin mode), the Paint Skin Weights tool and the pane overlays, the weight numbers off (deferred,
// §0.3) — renders on demand: once the frames settle, nothing renders for 2 s. Then the same in Skeleton mode and in
// the Test view (a test pose held), where the joints are drawn posed. The budget bench (§5.25) is
// `e2e/bench/m6b-budgets.bench.ts`.

/** Waits until no frame renders for 250 ms, then expects none over the next 2 s. */
async function expectIdle(page: Parameters<typeof renderedFrames>[0], what: string): Promise<void> {
  await expect
    .poll(
      async () => {
        const before = await renderedFrames(page);
        await page.waitForTimeout(250);
        return (await renderedFrames(page)) - before;
      },
      { timeout: 15_000, intervals: [0], message: `${what}: the frames settle` },
    )
    .toBe(0);
  const idle = await renderedFrames(page);
  await page.waitForTimeout(2_000);
  expect(await renderedFrames(page), `${what}: no frame over 2 s`).toBe(idle);
}

test('E2E-RIG-10 — idle in Rig & Skin (Skin mode, Skeleton mode, the Test view)', async ({ page }) => {
  test.setTimeout(90_000);
  await openEditor(page);
  await expectKernelStarted(page);
  await enterModel(page);
  const created = await runOk<{ root: string }>(page, 'mesh.create.template', { template: 'humanoidBody' });
  const chest = await createPrimitive(page, 'sphere', { radius: 0.11, subdivisionsAxis: 50, subdivisionsHeight: 56 });
  await runOk(page, 'scene.object.transform', {
    ids: [chest],
    placements: [{ t: [0, 1.2, 0.04], q: [0, 0, 0, 1], s: [1, 1, 1] }],
  });
  await enterRig(page);
  const body = await runOk<{ character: string }>(page, 'skel.template.create', {
    preset: 'standard33',
    objects: [created.root, chest],
  });
  const bound = await runOk<{ meshes: string[] }>(page, 'skin.bind', {});
  expect(bound.meshes).toHaveLength(2);
  let points = 0;
  for (const mesh of bound.meshes) {
    expect((await call(page, 'skin', mesh))?.skeleton).not.toBeNull();
    points += (await call(page, 'meshInfo', mesh))?.counts.v ?? 0;
  }
  expect(points).toBeGreaterThanOrEqual(3_000);
  test.info().annotations.push({ type: 'points', description: `${points} points` });

  // Skin mode (`2`): the Paint Skin Weights tool and the weight display.
  await runOk(page, 'rig.mode', { mode: 'object' });
  await enterSkin(page);
  // Pointer away from the panes (a hovering brush ring follows the pointer; idle means no input).
  await page.mouse.move(2, 2);
  await expectIdle(page, 'Skin mode');

  // Skeleton mode with a joint selected (axes on the selection).
  await runOk(page, 'rig.mode', { mode: 'skeleton' });
  const knee = (await call(page, 'skeleton', body.character))?.joints.find((j) => j.humanBone === 'leftLowerLeg');
  await runOk(page, 'select.joints', { ids: [knee?.id], mode: 'replace' });
  await dismissGettingStarted(page);
  await page.mouse.move(2, 2);
  await expectIdle(page, 'Skeleton mode');

  // The Test view: a held test pose on a control (posed joints and skinned mesh), still on demand.
  await runOk(page, 'rig.mode', { mode: 'object' });
  const arm = (await call(page, 'controls', body.character)).find((control) => control.key === 'fk.lowerArm.L');
  await runOk(page, 'select.controls', { ids: [arm?.id], mode: 'replace' });
  await runOk(page, 'channel.setValues', { edits: [{ control: arm?.id, channel: 'rz', value: 0.5 }] });
  await expect.poll(async () => (await call(page, 'rigState')).poseView).toBe('test');
  await page.mouse.move(2, 2);
  await expectIdle(page, 'Test view');
});
