import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    globals: true,
    // M6A-SPEC §3 rule 8: the kernel debug switch is on in every test setup.
    setupFiles: ['test/setup.ts'],
    // property and browser tests take seconds on 2-core CI runners; the 5 s default is too tight there
    testTimeout: 30_000,
  },
});
