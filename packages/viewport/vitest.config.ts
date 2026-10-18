import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

// Locally the installed Google Chrome runs with its GPU; CI uses bundled Chromium with SwiftShader WebGL
// (MVP-SPEC §6.1). Run `pnpm exec playwright install chromium` once on CI images.
const ci = process.env['CI'] === 'true' || process.env['CI'] === '1';

export default defineConfig({
  // Pre-bundled together up front: discovering them mid-run reloads the page, and bundling a three addon on its own
  // would give it a second copy of three.
  optimizeDeps: {
    include: [
      'three',
      'three/examples/jsm/lines/LineMaterial.js',
      'three/examples/jsm/lines/LineSegments2.js',
      'three/examples/jsm/lines/LineSegmentsGeometry.js',
      'three/examples/jsm/loaders/GLTFLoader.js',
      'camera-controls',
    ],
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
