import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    globals: true,
    // property tests run ~1 s each on an idle machine; leave headroom for loaded CI runners and parallel builds
    testTimeout: 30_000,
  },
});
