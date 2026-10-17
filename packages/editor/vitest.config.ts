import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

// Locally the installed Google Chrome runs with its GPU; CI uses bundled Chromium with SwiftShader WebGL
// (MVP-SPEC §6.1). Run `pnpm exec playwright install chromium` once on CI images.
const ci = process.env['CI'] === 'true' || process.env['CI'] === '1';

export default defineConfig({
  // Pre-bundled up front: discovering them mid-run makes Vite reload the page under a running test.
  optimizeDeps: {
    include: ['@react-three/fiber', 'react', 'react-dom/client', 'react/jsx-dev-runtime', 'zustand/vanilla'],
  },
  test: {
    include: ['test/**/*.test.{ts,tsx}'],
    globals: true,
    browser: {
      enabled: true,
      headless: true,
      provider: playwright({
        launchOptions: ci
          ? { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }
          : { channel: 'chrome' },
      }),
      instances: [{ browser: 'chromium' }],
      viewport: { width: 1440, height: 900 },
    },
  },
});
