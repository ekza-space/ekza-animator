import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    globals: true,
    setupFiles: ['test/setup.ts'],
    // Fixture tests hash, validate and re-parse 10 MB models; leave headroom on loaded machines.
    testTimeout: 30_000,
  },
});
