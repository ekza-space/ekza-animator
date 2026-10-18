import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    globals: true,
    // property and browser tests take seconds on 2-core CI runners; the 5 s default is too tight there
    testTimeout: 30_000,
    // Remove once the work package adds its first test.
    passWithNoTests: true,
  },
});
