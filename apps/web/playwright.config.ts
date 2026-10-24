import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices, type Project, webkit } from '@playwright/test';

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

// STUDIO-TOUCH-SPEC §20.7 (Halo T0): two touch projects that run only the `ha-*` family (T1 adds `ar-*` with its
// touch helpers), to keep the local gate affordable.
// - `chrome-touch`: real Chrome with touch at iPad landscape size (1194 × 834 @2x); multi-touch and the Pencil go
//   through CDP (`helpers/touch.ts`, T1).
// - `webkit-ipad`: Playwright's desktop WebKit as an iPad Pro 11 (landscape; specs switch to portrait with
//   `test.use`). Compatibility only — JS, CSS and WebGL: it proves nothing about iOS gestures, Web Share, Files,
//   memory or the Pencil, which the real-device gate checks.
const HALO_FAMILY = /(^|[\\/])ha-[^\\/]*\.spec\.ts$/;

/**
 * The WebKit to launch, never downloaded here: `EKZA_WEBKIT_PATH`; else Playwright's own build when it is installed
 * (undefined: the default); else the newest WebKit build already installed next to it (`webkit-<revision>/pw_run.sh`
 * in the browsers folder), as the design prototypes ran.
 */
function webkitExecutable(): string | undefined {
  const forced = process.env['EKZA_WEBKIT_PATH'];
  if (forced !== undefined && forced !== '') return forced;
  const own = webkit.executablePath();
  if (existsSync(own)) return undefined;
  const root =
    process.env['PLAYWRIGHT_BROWSERS_PATH'] ??
    join(homedir(), process.platform === 'darwin' ? 'Library/Caches/ms-playwright' : '.cache/ms-playwright');
  let builds: string[] = [];
  try {
    builds = readdirSync(root).filter((name) => /^webkit-\d+$/.test(name));
  } catch {
    return undefined;
  }
  builds.sort((a, b) => Number(b.slice('webkit-'.length)) - Number(a.slice('webkit-'.length)));
  const found = builds.map((build) => join(root, build, 'pw_run.sh')).find((path) => existsSync(path));
  return found;
}

const chromeTouch: Project = {
  name: 'chrome-touch',
  testMatch: HALO_FAMILY,
  use: {
    ...devices['Desktop Chrome'],
    channel: 'chrome',
    viewport: { width: 1194, height: 834 },
    deviceScaleFactor: 2,
    hasTouch: true,
  },
};

const webkitExecutablePath = webkitExecutable();
const webkitIpad: Project = {
  name: 'webkit-ipad',
  testMatch: HALO_FAMILY,
  // Desktop WebKit's GPU process can drop a fresh WebGL context while the full suite's Chrome workers load the GPU
  // (seen in the local gate: "WebGL: context lost" at creation). One WebKit worker, and one retry on a fresh page;
  // a retried test still shows as flaky in the report.
  workers: 1,
  retries: 1,
  use: {
    ...devices['iPad Pro 11 landscape'],
    ...(webkitExecutablePath === undefined ? {} : { launchOptions: { executablePath: webkitExecutablePath } }),
  },
};

/** `EKZA_E2E_WEBKIT=0` leaves the WebKit project out of a local run (a machine without WebKit). */
const withWebkit = process.env['EKZA_E2E_WEBKIT'] !== '0';

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
  // Locally the default run adds the touch projects (the `ha-*` family only); CI keeps SwiftShader alone.
  projects: projectSelected
    ? [chrome, swiftshader, chromeTouch, webkitIpad]
    : ci
      ? [swiftshader]
      : [chrome, chromeTouch, ...(withWebkit ? [webkitIpad] : [])],
  webServer: {
    command: `node scripts/copy-assets.mjs && node scripts/third-party-notices.mjs && next build && next start -p ${PORT}`,
    env: { NEXT_PUBLIC_EKZA_E2E: '1' },
    url: `http://localhost:${PORT}/editor?e2e=1`,
    timeout: 300_000,
    reuseExistingServer: !ci,
    stdout: 'pipe',
  },
});
