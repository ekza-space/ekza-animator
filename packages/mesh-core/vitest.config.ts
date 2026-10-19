import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

// Two projects (M6A-SPEC §9 B1, §5.29 P6): every `*.test.ts` in Node, and the `*.browser.test.ts` files — P1, P4, P5
// and the determinism goldens — again in Chromium (Vitest browser mode), so Node and the browser must produce the
// same manifests. Locally the installed Google Chrome runs; CI uses bundled Chromium (MVP-SPEC §6.1).
const ci = process.env['CI'] === 'true' || process.env['CI'] === '1';

export default defineConfig({
  // Pre-bundled up front: discovering them mid-run makes Vite reload the page under a running test.
  optimizeDeps: { include: ['earcut', 'robust-predicates', 'fast-check'] },
  test: {
    globals: true,
    // property tests take seconds on 2-core CI runners; the 5 s default is too tight there
    testTimeout: 30_000,
    benchmark: { include: ['bench/**/*.bench.ts'] },
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: ['test/**/*.test.ts'],
          exclude: ['test/**/*.browser.test.ts'],
          setupFiles: ['test/setup.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'chromium',
          include: ['test/**/*.browser.test.ts'],
          setupFiles: ['test/setup.ts'],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright({
              launchOptions: ci
                ? { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }
                : { channel: 'chrome' },
            }),
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
});
