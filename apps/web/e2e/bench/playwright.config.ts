// Budget bench (ARCHITECTURE §14, MVP-SPEC §7 WP-10): measures the in-browser budgets against the e2e build and
// reports them (annotations, stdout and `.acceptance/budgets/*.json`). Report-only: nothing here gates CI, and the
// regular e2e run does not pick up `*.bench.ts`. Run: `pnpm --filter web bench:budgets` (EKZA_E2E_PORT as for e2e).
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';
import base from '../../playwright.config';

export default defineConfig({
  ...base,
  testDir: '.',
  testMatch: /.*\.bench\.ts$/,
  // One page at a time: parallel workers would measure each other.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 300_000,
  reporter: [['list']],
  ...(base.webServer === undefined || Array.isArray(base.webServer)
    ? {}
    : { webServer: { ...base.webServer, cwd: fileURLToPath(new URL('../..', import.meta.url)) } }),
});
