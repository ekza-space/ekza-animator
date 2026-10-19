import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    globals: true,
    setupFiles: ['test/setup.ts'],
    // property tests take seconds on 2-core CI runners; the 5 s default is too tight there
    testTimeout: 30_000,
    benchmark: { include: ['bench/**/*.bench.ts'] },
  },
});
