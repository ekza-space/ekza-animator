import { defineConfig } from 'vitest/config';

// Node tests of the Decimator and the intake chain (MODELING-PLAN §7.2 G-a); the benches report the worker budgets
// (§3.12, report-only).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/setup.ts'],
    globals: true,
    testTimeout: 60_000,
    benchmark: { include: ['bench/**/*.bench.ts'] },
  },
});
