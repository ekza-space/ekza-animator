// M6B-SPEC §9.0 C3 DoD, §5.25 (report-only): the joint overlay rebuild ≤ 2 ms. Measured through the editor on the
// Cube Lad character (Standard 33, 34 joints) in Skeleton mode: each sample changes the joint selection (the overlay's
// instance colours and axes) and reads a joint's screen point, which rebuilds the overlay before it answers — so a
// sample is an upper bound of one rebuild (it includes the `select.joints` run). Results go to annotations, stdout and
// `.acceptance/budgets/m6b-joints.json`. Needs a model character (Create Skeleton through C1's `char.fromModel`).
// Run: `EKZA_E2E_PORT=<port> pnpm --filter web exec playwright test -c e2e/bench/playwright.config.ts m6b-joints`.
import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { RIG_FRONT_PANE } from '../helpers/m6b-rig';
import { createSkeleton, cubeLadInRig, jointsByKey, startQuickRig } from '../helpers/m6b-skeleton-ui';

const OUT = new URL('../../../../.acceptance/budgets/', import.meta.url);
const BUDGET_MS = 2;

test('C3 bench: joint overlay rebuild (34 joints) ≤ 2 ms', async ({ page }, info) => {
  await cubeLadInRig(page);
  await startQuickRig(page);
  const character = await createSkeleton(page);
  const ids = [...(await jointsByKey(page, character)).values()].map((joint) => joint.id);
  expect(ids).toHaveLength(34);
  const samples = await page.evaluate(
    async ([joints, pane]) => {
      const api = window.__EKZA_STUDIO_TEST__;
      if (api === undefined) throw new Error('no test API');
      const out: number[] = [];
      for (let i = 0; i < 200; i++) {
        const id = joints[i % joints.length] as string;
        await api.run('select.joints', { ids: [id], mode: 'replace' });
        const start = performance.now();
        api.screenOfJoint(id, pane);
        out.push(performance.now() - start);
      }
      return out;
    },
    [ids, RIG_FRONT_PANE] as const,
  );
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q: number): number => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] as number;
  const result = {
    joints: ids.length,
    samples: samples.length,
    medianMs: at(0.5),
    p95Ms: at(0.95),
    budgetMs: BUDGET_MS,
  };
  const line = `joint overlay rebuild: median ${result.medianMs.toFixed(3)} ms, p95 ${result.p95Ms.toFixed(3)} ms (budget ≤ ${BUDGET_MS} ms)`;
  console.warn(`[budget] ${line}`);
  info.annotations.push({ type: 'budget', description: line });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(new URL('m6b-joints.json', OUT), `${JSON.stringify(result, null, 2)}\n`);
});
