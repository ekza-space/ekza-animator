import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    globals: true,
    // App-level unit tests arrive with WP-8; the e2e suite runs through Playwright (`pnpm e2e`).
    passWithNoTests: true,
  },
});
