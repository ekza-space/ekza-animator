#!/usr/bin/env node
// Removes the previous build from `apps/web/.next` before `pnpm run ci` builds (D0 fix round 1, AUTORIG-SPEC §7.2).
// The e2e suite's webServer builds into the same `.next` with the test routes; a later `turbo run build` cache hit
// restores the production outputs on top of it without deleting the e2e files, and `check:size` would then measure a
// mix of both builds. Turbopack's persistent cache (`.next/cache`, not a turbo output) is kept.
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Removes every entry of `nextDir` except `cache`; returns the removed names. */
export function cleanNext(nextDir) {
  if (!existsSync(nextDir)) return [];
  const removed = [];
  for (const entry of readdirSync(nextDir)) {
    if (entry === 'cache') continue;
    rmSync(join(nextDir, entry), { recursive: true, force: true });
    removed.push(entry);
  }
  return removed;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const nextDir = join(dirname(fileURLToPath(import.meta.url)), '..', '.next');
  const removed = cleanNext(nextDir);
  process.stdout.write(`clean:next: removed ${removed.length} entries of ${nextDir} (kept cache)\n`);
}
