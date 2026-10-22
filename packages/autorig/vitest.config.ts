import { defineConfig } from 'vitest/config';

// Unit tests of the Auto-Rig shell's pure parts (session defaults, progress, tables) run in Node; the shell's browser
// tests are the app's e2e scenarios (AUTORIG-SPEC §11).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.{ts,tsx}'],
    globals: true,
  },
});
