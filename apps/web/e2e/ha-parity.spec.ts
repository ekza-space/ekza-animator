import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, type Page, test } from '@playwright/test';
import { call, runOk, waitForTestApi } from './helpers/test-api';

// STUDIO-TOUCH-SPEC §20.5, AS-ST-2, ST-29 (T6b): browser parity in ratchet mode. The host is mounted, then Halo, then
// Studio Pro with every workspace entered and every panel shown, then Auto-Rig — one page, one EditorApp — and every
// lazy operator chunk is loaded; the censuses of all mounts are joined (about 70 ids exist only while a UI is mounted)
// and checked in the page against the Disclosure Manifest, the static call-site scan (`tooling/halo-callsites.mjs`)
// and the `UiDialog` map: every live, non-stub operator (internal ones too) has an entry, every (operator, arguments)
// pair Pro, Auto-Rig, the menus, marking menus and key bindings send is covered, every `UiDialog` asked for has a Halo
// surface. The `searchOnly` count (explicit entries plus entries whose surfaces are all pending) can only go down:
// it must not exceed `searchOnly.baseline.json`, and an entry not in the baseline fails. `EKZA_HALO_PARITY_WRITE=1`
// rewrites the baseline after a deliberate change (review the diff). Chrome only: the census does not depend on input.
//
// Until T6a's frame is integrated the run starts at the T6b harness (`/dev-halo`, dev and e2e builds), which installs
// the parity probe; at integration the Halo shell installs it and the run starts at `/app` (one line below).

const START = '/dev-halo?e2e=1';
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const BASELINE = join(REPO, 'packages', 'halo', 'src', 'manifest', 'searchOnly.baseline.json');

interface CensusLike {
  readonly operators: readonly { readonly id: string; readonly deferred: boolean }[];
}
interface SearchOnlyItem {
  readonly op: string;
  readonly when?: unknown;
  readonly kind: 'explicit' | 'pending';
  readonly stages: readonly string[] | 'all';
  readonly owners: readonly string[];
  readonly reason: string;
}
interface Report {
  readonly violations: readonly string[];
  readonly live: number;
  readonly deferred: readonly string[];
  readonly byKind: Record<string, number>;
  readonly reachable: number;
  readonly searchOnly: {
    readonly total: number;
    readonly byStage: Record<string, number>;
    readonly explicit: number;
    readonly pending: number;
    readonly targets: Record<string, number>;
    readonly items: readonly SearchOnlyItem[];
  };
  readonly pairs: { readonly checked: number; readonly dynamic: number; readonly sources: Record<string, number> };
}
interface Baseline {
  readonly total: number;
  readonly byStage: Record<string, number>;
  readonly targets: Record<string, number>;
  readonly items: readonly string[];
}

declare global {
  interface Window {
    __EKZA_HALO_PARITY__?: {
      loadAll(): Promise<void>;
      census(mount: string): CensusLike;
      join(parts: readonly CensusLike[]): CensusLike;
      check(census: CensusLike, callSites: readonly unknown[]): Report;
    };
  }
}

const itemKey = (item: SearchOnlyItem): string =>
  item.when === undefined ? item.op : `${item.op} ${JSON.stringify(item.when)}`;

async function census(page: Page, mount: string, parts: CensusLike[]): Promise<void> {
  await page.evaluate(async () => {
    await window.__EKZA_HALO_PARITY__?.loadAll();
  });
  const part = await page.evaluate((name) => window.__EKZA_HALO_PARITY__?.census(name) ?? null, mount);
  if (part === null) throw new Error('the parity probe is not installed');
  parts.push(part);
}

async function switchTo(page: Page, to: 'halo' | 'studio' | 'autorig', url: RegExp): Promise<void> {
  await page.evaluate((request) => window.__EKZA_STUDIO_TEST__?.navigate(request), { to, from: 'halo' } as never);
  await expect(page).toHaveURL(url, { timeout: 60_000 });
  await expect.poll(() => call(page, 'mountedShell'), { timeout: 60_000 }).toBe(to);
  await waitForTestApi(page);
}

async function everyWorkspace(page: Page, shell: string, parts: CensusLike[]): Promise<void> {
  for (const workspace of ['model', 'rig', 'animate']) {
    await runOk(page, 'workspace.set', { workspace });
    await expect.poll(async () => (await call(page, 'state')).workspace).toBe(workspace);
    await census(page, `${shell}:${workspace}`, parts);
  }
}

test('every operator, argument shape and kernel question has a Halo surface; searchOnly only goes down', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'chrome', 'The census does not depend on the input device (Chrome only)');
  test.setTimeout(240_000);
  const scan = (await import(pathToFileURL(join(REPO, 'tooling', 'halo-callsites.mjs')).href)) as {
    scanCallSites(root: string): { pairs: readonly unknown[] };
  };
  const { pairs } = scan.scanCallSites(REPO);

  await page.goto(START);
  await waitForTestApi(page);
  await page.waitForFunction(() => window.__EKZA_HALO_PARITY__ !== undefined);
  await runOk(page, 'file.loadSample', { sample: 'polybot' });
  const parts: CensusLike[] = [];
  await census(page, 'host', parts);

  await switchTo(page, 'halo', /\/app(\?|$)/);
  await everyWorkspace(page, 'halo', parts);

  await switchTo(page, 'studio', /\/editor(\?|$)/);
  await everyWorkspace(page, 'studio', parts);
  for (const panel of [
    'graph',
    'dopeSheet',
    'clips',
    'outliner',
    'channels',
    'attributes',
    'palette',
    'meshCheck',
    'toolkit',
    'rigToolkit',
    'paintWeights',
    'validation',
    'clipLibrary',
    'agent',
    'target',
    'quickRig',
  ]) {
    await page.evaluate((name) => window.__EKZA_STUDIO_TEST__?.run('workspace.showPanel', { panel: name }), panel);
  }
  await census(page, 'studio:panels', parts);

  await switchTo(page, 'autorig', /\/autorig(\?|$)/);
  await census(page, 'autorig', parts);

  const report = await page.evaluate(
    ([all, scanned]) => {
      const probe = window.__EKZA_HALO_PARITY__;
      if (probe === undefined) throw new Error('the parity probe is gone');
      return probe.check(probe.join(all), scanned);
    },
    [parts, pairs] as const,
  );
  const summary = {
    live: report.live,
    deferred: report.deferred.length,
    byKind: report.byKind,
    reachable: report.reachable,
    searchOnly: {
      total: report.searchOnly.total,
      explicit: report.searchOnly.explicit,
      pending: report.searchOnly.pending,
      byStage: report.searchOnly.byStage,
      targets: report.searchOnly.targets,
    },
    pairs: report.pairs,
  };
  await testInfo.attach('parity-report.json', {
    body: JSON.stringify({ ...summary, items: report.searchOnly.items }, null, 2),
    contentType: 'application/json',
  });
  expect(report.violations).toEqual([]);
  expect(report.live).toBeGreaterThan(330);
  expect(report.pairs.checked).toBeGreaterThan(900);

  const items = report.searchOnly.items.map(itemKey).sort();
  if (process.env['EKZA_HALO_PARITY_WRITE'] === '1') {
    const next: Baseline & Record<string, unknown> = {
      note: 'STUDIO-TOUCH-SPEC §20.5 test 5: the searchOnly ratchet. Regenerate with EKZA_HALO_PARITY_WRITE=1 (ha-parity).',
      total: report.searchOnly.total,
      explicit: report.searchOnly.explicit,
      pending: report.searchOnly.pending,
      byStage: report.searchOnly.byStage,
      targets: report.searchOnly.targets,
      live: report.live,
      reachable: report.reachable,
      items,
    };
    writeFileSync(BASELINE, `${JSON.stringify(next, null, 2)}\n`);
  }
  const baseline = JSON.parse(readFileSync(BASELINE, 'utf8')) as Baseline;
  // The ratchet: no new search-only entry, never more than the baseline in total or in any stage.
  expect(items.filter((key) => !baseline.items.includes(key))).toEqual([]);
  expect(report.searchOnly.total).toBeLessThanOrEqual(baseline.total);
  for (const [stage, count] of Object.entries(report.searchOnly.byStage)) {
    expect({ stage, count: Math.min(count, baseline.byStage[stage] ?? 0) }).toEqual({ stage, count });
  }
  if (report.searchOnly.total < baseline.total) {
    testInfo.annotations.push({
      type: 'ratchet',
      description: `searchOnly fell to ${report.searchOnly.total} (baseline ${baseline.total}): lower the baseline (EKZA_HALO_PARITY_WRITE=1)`,
    });
  }
});
