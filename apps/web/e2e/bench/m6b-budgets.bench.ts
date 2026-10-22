// M6B-SPEC §5.25 and §0.4.9 (INT): the end-to-end rows of the MVP budget table through the merged editor, after
// every package merged. The package rows have their own benches (C3 `m6b-joints.bench.ts`, C6 `m6b-paint.bench.ts`,
// C10 `m6b-export.bench.ts`, the C4 and C1 package benches); this file measures the rows only the whole flow has, on
// the Cube Lad and on a bound ≈ 3k-point character (the generated body plus a dense chest piece, as E2E-RIG-10):
// Quick Rig's live preview per pointer frame (`skel.quickRig.setMarker` + the next frame), Create Skeleton, a rest
// edit with `rig.autoRig.update` inside (`skel.joint.move`), Bind Skin through the skin worker (Cube Lad and 3k
// points, ≤ 200 ms), a test-pose frame (evaluate + GPU skinning, ≤ 4 ms per frame), a library preview start and its
// frames, Use Clip, and the idle row (0 frames over 2 s, the E2E-RIG-10 gate, repeated). Report-only: results go to
// annotations, stdout and `.acceptance/budgets/m6b-budgets.json`; only the idle row asserts.
// Run: `EKZA_E2E_PORT=<port> pnpm --filter web exec playwright test -c e2e/bench/playwright.config.ts m6b-budgets`.
import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { createPrimitive, enterModel } from '../helpers/m6a-model';
import { cubeLadTruth } from '../helpers/m6b-cube-lad';
import { charactersSettled } from '../helpers/m6b-mvp-script';
import { enterRig } from '../helpers/m6b-rig';
import { cubeLadInRig, startQuickRig } from '../helpers/m6b-skeleton-ui';
import { call, expectKernelStarted, openEditor, renderedFrames, runOk } from '../helpers/test-api';

const OUT = new URL('../../../../.acceptance/budgets/', import.meta.url);

/**
 * Runs an operator in the page and times it: `frame: true` up to the next animation frame (the GPU upload of its
 * result; at 60 Hz that includes the wait for the frame), `frame: false` the run alone (its CPU cost).
 */
async function timedRun(page: Page, op: string, args?: unknown, frame = true): Promise<number> {
  return page.evaluate(
    async ({ op, args, frame }) => {
      const api = window.__EKZA_STUDIO_TEST__;
      if (api === undefined) throw new Error('no test API');
      const start = performance.now();
      const result = await api.run(op, args);
      if (result.status !== 'finished') throw new Error(`${op}: ${JSON.stringify(result)}`);
      if (frame) await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      return performance.now() - start;
    },
    { op, args, frame },
  );
}

/** CPU time of `n` animation frames while the page draws (mean and p95 of rAF-to-rAF busy time is not observable;
 *  this reports the wall time per frame, an upper bound of the frame's CPU cost at 60 Hz). */
async function frameTimes(page: Page, n: number): Promise<number[]> {
  return page.evaluate(
    (count) =>
      new Promise<number[]>((resolve) => {
        const out: number[] = [];
        let last = performance.now();
        const step = (now: number) => {
          out.push(now - last);
          last = now;
          if (out.length >= count) resolve(out.slice(1));
          else requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }),
    n + 1,
  );
}

function median(samples: readonly number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
}
function p95(samples: readonly number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? Number.NaN;
}

const results: Record<string, unknown> = {};
const lines: string[] = [];

function report(key: string, value: Record<string, unknown>, line: string): void {
  results[key] = value;
  lines.push(line);
  test.info().annotations.push({ type: 'budget', description: line });
  console.warn(`[budget] ${line}`);
}

test.afterAll(() => {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(
    new URL('m6b-budgets.json', OUT),
    `${JSON.stringify({ name: 'm6b-budgets', at: new Date().toISOString(), summary: lines, ...results }, null, 2)}\n`,
  );
});

test.describe.configure({ mode: 'serial' });

test('the Cube Lad flow: Quick Rig preview, Create Skeleton, a rest edit, Bind Skin, a test pose, a preview', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await cubeLadInRig(page);
  await startQuickRig(page);
  // Quick Rig's live preview: one setMarker (U state) and the fit of the whole template, up to the next frame.
  const truth = cubeLadTruth();
  const preview: number[] = [];
  for (let i = 0; i < 20; i++) {
    const knee = truth.markers['knee'] ?? [0, 0, 0];
    preview.push(
      await timedRun(page, 'skel.quickRig.setMarker', {
        name: 'knee',
        point: [knee[0], knee[1], (knee[2] ?? 0) + 0.001 * (i % 5)],
      }),
    );
  }
  const commit = await page.evaluate(async () => {
    const api = window.__EKZA_STUDIO_TEST__;
    if (api === undefined) throw new Error('no test API');
    const start = performance.now();
    (document.querySelector('[data-testid="quickrig-commit"]') as HTMLButtonElement).click();
    while (api.quickRig() !== null) await new Promise((resolve) => setTimeout(resolve, 1));
    return performance.now() - start;
  });
  const character = (await call(page, 'rigState')).character ?? '';
  const joints = (await call(page, 'skeleton', character))?.joints ?? [];
  const head = joints.find((joint) => joint.key === 'head')?.id;
  const move: number[] = [];
  for (let i = 0; i < 10; i++) {
    move.push(
      await timedRun(page, 'skel.joint.move', { joints: [head], translateY: i % 2 === 0 ? 0.001 : -0.001 }, false),
    );
  }
  report(
    'skeleton',
    { previewMs: preview, commitMs: commit, moveMs: move },
    `Quick Rig preview per marker edit ${median(preview).toFixed(1)} ms (setMarker + fit + next frame), Create Skeleton ` +
      `${commit.toFixed(0)} ms (click → closed), a rest edit with rig.autoRig.update ${median(move).toFixed(1)} ms ` +
      "(the run; the update alone ≤ 5 ms is C1's bench; medians)",
  );

  // Bind Skin through the skin worker (one click; the Cube Lad's 128 points).
  const bind = await timedRun(page, 'skin.bind', {});
  const mesh = (await call(page, 'meshes')).find((row) => row.owner === `char:${character}`)?.id ?? '';
  // A held test pose on the forearm control: frames of evaluation + GPU skinning while the pose changes every frame.
  await runOk(page, 'rig.mode', { mode: 'object' });
  const arm = (await call(page, 'controls', character)).find((control) => control.key === 'fk.lowerArm.L')?.id;
  await runOk(page, 'select.controls', { ids: [arm], mode: 'replace' });
  const posed: number[] = [];
  for (let i = 0; i < 30; i++) {
    posed.push(
      await timedRun(
        page,
        'channel.setValues',
        { edits: [{ control: arm, channel: 'rz', value: 0.02 * (i % 10) }] },
        false,
      ),
    );
  }
  await runOk(page, 'rig.pose.resetTest');
  // A library preview (Walk): start (fetch, verify, convert) and its frames.
  const preview0 = await timedRun(page, 'library.preview', { character, clip: 'walk' });
  const playing = await frameTimes(page, 60);
  await runOk(page, 'library.stop');
  const use = await timedRun(page, 'library.useClip', { character, clip: 'idle' });
  report(
    'cube-lad',
    { bindMs: bind, testPoseMs: posed, previewStartMs: preview0, previewFrameMs: playing, useClipMs: use, mesh },
    `Cube Lad: Bind Skin ${bind.toFixed(0)} ms (worker + next frame), test-pose edit ${median(posed).toFixed(1)} ms ` +
      `median / ${p95(posed).toFixed(1)} ms p95 (the run: test-pose write + evaluate; GPU skinning, budget ≤ 4 ms per frame), ` +
      `library preview start ${preview0.toFixed(0)} ms, preview frames ${median(playing).toFixed(1)} ms median ` +
      `(rAF interval), Use Clip ${use.toFixed(0)} ms`,
  );
});

test('a bound 3k-point character: Bind Skin (≤ 200 ms), a test-pose frame, idle in Skin mode', async ({ page }) => {
  test.setTimeout(240_000);
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
  const { character } = await runOk<{ character: string }>(page, 'skel.template.create', {
    preset: 'standard33',
    objects: [created.root, chest],
  });
  const binds: number[] = [];
  for (let i = 0; i < 3; i++) binds.push(await timedRun(page, 'skin.bind', i === 0 ? {} : { confirm: true }));
  let points = 0;
  for (const row of (await call(page, 'meshes')).filter((m) => m.owner === `char:${character}`)) {
    points += (await call(page, 'meshInfo', row.id))?.counts.v ?? 0;
  }
  await runOk(page, 'rig.mode', { mode: 'object' });
  const arm = (await call(page, 'controls', character)).find((control) => control.key === 'fk.lowerArm.L')?.id;
  await runOk(page, 'select.controls', { ids: [arm], mode: 'replace' });
  const posed: number[] = [];
  for (let i = 0; i < 30; i++) {
    posed.push(
      await timedRun(
        page,
        'channel.setValues',
        { edits: [{ control: arm, channel: 'rz', value: 0.02 * (i % 10) }] },
        false,
      ),
    );
  }
  await runOk(page, 'rig.pose.resetTest');
  report(
    'character-3k',
    { points, bindMs: binds, testPoseMs: posed },
    `${points} points: Bind Skin ${median(binds).toFixed(0)} ms median of 3 (worker + next frame, budget ≤ 200 ms), ` +
      `test-pose edit ${median(posed).toFixed(1)} ms median / ${p95(posed).toFixed(1)} ms p95 (the run, budget ≤ 4 ms per frame)`,
  );

  // The idle row (the E2E-RIG-10 gate): Skin mode, settled, then 0 frames over 2 s.
  await runOk(page, 'rig.mode', { mode: 'skin' });
  await page.mouse.move(2, 2);
  for (let round = 0; round < 6; round++) {
    const frames = await renderedFrames(page);
    await page.waitForTimeout(2_600);
    await charactersSettled(page);
    if ((await renderedFrames(page)) === frames) break;
  }
  const idle = await renderedFrames(page);
  await page.waitForTimeout(2_000);
  const drawn = (await renderedFrames(page)) - idle;
  report('idle', { frames: drawn }, `idle in Skin mode (${points} points): ${drawn} frames over 2 s (gate 0)`);
  expect(drawn).toBe(0);
});
