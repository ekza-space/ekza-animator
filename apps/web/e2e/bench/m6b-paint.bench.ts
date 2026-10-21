// C6 paint bench (M6B-SPEC §5.25 "Paint stroke at 10k points ≤ 4 ms per pointer frame"; report-only): the generated
// humanoid body made a character (Standard 33) and bound with the defaults, Skin mode, the Paint Skin Weights tool; a
// stroke of synthetic pointer events dispatched on the perspective pane, each pointermove timed synchronously (the
// tool's posed pick, the surface flood of the stamp, the kernel stroke session and the partial weight upload it
// queues). Also the stroke commit (pointerup → the undo step) and an undo. Results go to stdout, annotations and
// `.acceptance/budgets/m6b-paint.json`. Needs C2 (`skel.template.create`) merged. Run: `pnpm --filter web
// bench:budgets -g m6b-paint` (EKZA_E2E_PORT as for e2e).
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { createBodyCharacter, RIG_PERSP_PANE } from '../helpers/m6b-rig';
import { enterSkin } from '../helpers/m6b-skin-ui';
import { call, openEditor, runOk } from '../helpers/test-api';

const OUT = new URL('../../../../.acceptance/budgets/', import.meta.url);

test('m6b-paint: pointer frames of a paint stroke, the commit and its undo (report)', async ({ page }) => {
  await openEditor(page);
  const body = await createBodyCharacter(page);
  // The character adopted the scene mesh under a new id: Bind Skin names it.
  const bound = await runOk<{ meshes: string[] }>(page, 'skin.bind', {});
  const mesh = bound.meshes[0] ?? '';
  await enterSkin(page);
  const skeleton = await call(page, 'skeleton', body.character);
  const arm = skeleton?.joints.find((joint) => joint.humanBone === 'leftLowerArm')?.id ?? '';
  await runOk(page, 'skin.influence.setActive', { mesh: mesh, joint: arm });
  const points = (await call(page, 'meshInfo', mesh))?.counts.v ?? 0;
  const labels = (await call(page, 'weightLabels', RIG_PERSP_PANE)).filter((label) => label.mesh === mesh);
  expect(labels.length).toBeGreaterThan(0);
  const centre = {
    x: labels.reduce((sum, label) => sum + label.x, 0) / labels.length,
    y: labels.reduce((sum, label) => sum + label.y, 0) / labels.length,
  };
  const result = await page.evaluate(
    async ({ pane, at }) => {
      const element = document.elementFromPoint(at.x, at.y) as HTMLElement | null;
      if (element === null) throw new Error(`nothing under the pointer in ${pane}`);
      const fire = (type: string, x: number, y: number, buttons: number): number => {
        const t0 = performance.now();
        element.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            clientX: x,
            clientY: y,
            button: 0,
            buttons,
            pointerId: 1,
            pointerType: 'mouse',
          }),
        );
        return performance.now() - t0;
      };
      fire('pointerdown', at.x, at.y, 1);
      const frames: number[] = [];
      for (let i = 1; i <= 40; i++) frames.push(fire('pointermove', at.x + i * 2, at.y + Math.sin(i / 4) * 6, 1));
      const commit = fire('pointerup', at.x + 80, at.y, 0);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return { frames, commit };
    },
    { pane: RIG_PERSP_PANE, at: centre },
  );
  await expect.poll(async () => (await call(page, 'history')).undo.at(-1)).toBe('Paint Skin Weights');
  const t0 = Date.now();
  await runOk(page, 'edit.undo');
  const undoMs = Date.now() - t0;
  const sorted = [...result.frames].sort((a, b) => a - b);
  const report = {
    points,
    pointerFrames: result.frames.length,
    meanMs: result.frames.reduce((a, b) => a + b, 0) / result.frames.length,
    p95Ms: sorted[Math.floor(0.95 * (sorted.length - 1))],
    maxMs: sorted.at(-1),
    commitDispatchMs: result.commit,
    undoRoundTripMs: undoMs,
    budgetMs: 4,
  };
  // oxlint-disable-next-line no-console -- the bench reports to stdout (report-only, like budgets.bench.ts)
  console.log('m6b-paint', JSON.stringify(report));
  test.info().annotations.push({ type: 'm6b-paint', description: JSON.stringify(report) });
  const dir = fileURLToPath(OUT);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(new URL('m6b-paint.json', OUT), `${JSON.stringify(report, null, 2)}\n`);
});
