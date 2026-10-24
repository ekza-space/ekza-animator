import { defineConfig } from 'vitest/config';

// Unit tests of the Halo shell's pure parts run in Node (STUDIO-TOUCH-SPEC §20.7); its browser tests are the app's
// `ha-*` e2e scenarios.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.{ts,tsx}'],
    globals: true,
  },
});
