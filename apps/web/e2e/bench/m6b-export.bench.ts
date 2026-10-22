// M6B-SPEC §5.25 row "Character export (3k tris, 34 joints, five clips × 60 frames, validator off) ≤ 500 ms" in the
// browser (C10 bench, report-only): the bound Cube Lad with five 60-frame slot clips, `file.exportCharacter` (VRM 1.0,
// Space profile, validator off) timed three times; the median goes to annotations, stdout and
// `.acceptance/budgets/m6b-export.json`. The headless twin (`packages/headless-tests/test/m6b.writer.bench.test.ts`)
// measures the same row on Polybot's 2,130 triangles; this one needs the template and the bind (C2, C4: merged).
// Run: `EKZA_E2E_PORT=<port> pnpm --filter web exec playwright test -c e2e/bench/playwright.config.ts m6b-export`.
import { mkdirSync, writeFileSync } from 'node:fs';
import { type Page, test } from '@playwright/test';
import { buildCubeLad } from '../helpers/m6b-cube-lad';
import { enterRig } from '../helpers/m6b-rig';
import { expectKernelStarted, openEditor, runOk } from '../helpers/test-api';

const OUT = new URL('../../../../.acceptance/budgets/', import.meta.url);
const SLOTS = ['idle', 'walk', 'attack', 'cast', 'death'] as const;

async function timedExport(page: Page, character: string): Promise<number> {
  return page.evaluate(async (id) => {
    const api = window.__EKZA_STUDIO_TEST__;
    if (api === undefined) throw new Error('no test API');
    const start = performance.now();
    const result = await api.run('file.exportCharacter', { character: id, validate: false });
    if (result.status !== 'finished') throw new Error(`file.exportCharacter: ${JSON.stringify(result)}`);
    return performance.now() - start;
  }, character);
}

test('character export, bound Cube Lad, five clips × 60 frames', async ({ page }) => {
  test.setTimeout(300_000);
  await openEditor(page);
  await expectKernelStarted(page);
  const mesh = await buildCubeLad(page);
  await enterRig(page);
  const { character } = await runOk<{ character: string }>(page, 'skel.template.create', {
    preset: 'standard33',
    objects: [mesh],
  });
  await runOk(page, 'skin.bind', {});
  await runOk(page, 'char.setVrmMeta', { character, patch: { authors: ['Bench'], licensePreset: 'cc0' } });
  await runOk(page, 'char.renderThumbnail', { character });
  await runOk(page, 'workspace.set', { workspace: 'animate' });
  for (const slot of SLOTS) {
    const { clip } = await runOk<{ clip: string }>(page, 'clip.new', {
      character,
      name: slot,
      range: { start: 0, end: 60 },
    });
    await runOk(page, 'clip.setSettings', { clip, slot });
    await runOk(page, 'key.set', { target: 'character' });
  }
  const times: number[] = [];
  for (let run = 0; run < 3; run++) times.push(await timedExport(page, character));
  const median = [...times].sort((a, b) => a - b)[1] ?? Number.NaN;
  const line = `character export: median ${median.toFixed(0)} ms (budget 500 ms, report-only)`;
  test.info().annotations.push({ type: 'budget', description: line });
  console.warn(`[budget] ${line}`);
  mkdirSync(OUT, { recursive: true });
  writeFileSync(new URL('m6b-export.json', OUT), `${JSON.stringify({ median, times }, null, 2)}\n`);
});
