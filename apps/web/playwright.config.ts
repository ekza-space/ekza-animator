import { defineConfig, devices, type Project } from '@playwright/test';

// MVP-SPEC §6.1. The suite runs against the production build with the e2e test API compiled in.
// EKZA_E2E_PORT lets parallel checkouts (git worktrees) run their own server instead of reusing another's.
const PORT = Number(process.env.EKZA_E2E_PORT ?? 3100);
const ci = process.env.CI === 'true' || process.env.CI === '1';

const viewportAndScale = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 } as const;

const chrome: Project = {
  name: 'chrome',
  use: { ...devices['Desktop Chrome'], ...viewportAndScale, channel: 'chrome' },
};

const swiftshader: Project = {
  name: 'chromium-swiftshader',
  use: {
    ...devices['Desktop Chrome'],
    ...viewportAndScale,
    launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
};

// Default project: real Chrome (GPU) locally, bundled Chromium + SwiftShader on CI. `--project=<name>` selects
// either explicitly (the SwiftShader project needs `pnpm exec playwright install chromium` once).
// Workers load this config again without the runner's argv: the runner hands its choice down through the environment
// (else a worker knows only the default project and fails with "Project … not found in the worker process").
const PROJECTS_ENV = 'EKZA_E2E_ALL_PROJECTS';
const projectSelected =
  process.env[PROJECTS_ENV] === '1' || process.argv.some((arg) => arg === '--project' || arg.startsWith('--project='));
if (projectSelected) process.env[PROJECTS_ENV] = '1';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: ci,
  retries: ci ? 1 : 0,
  reporter: ci ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: projectSelected ? [chrome, swiftshader] : [ci ? swiftshader : chrome],
  webServer: {
    command: `node scripts/copy-assets.mjs && node scripts/third-party-notices.mjs && next build && next start -p ${PORT}`,
    env: { NEXT_PUBLIC_EKZA_E2E: '1' },
    url: `http://localhost:${PORT}/editor?e2e=1`,
    timeout: 300_000,
    reuseExistingServer: !ci,
    stdout: 'pipe',
  },
});
