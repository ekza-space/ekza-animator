import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    globals: true,
    // Remove once the work package adds its first test.
    passWithNoTests: true,
  },
});
