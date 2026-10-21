#!/usr/bin/env node
// The clip library's starter pack (M6B-SPEC §0.4.7, Q-MVP-21; C12): a thin wrapper for humans. The generator and its
// check are one vitest file in io (`packages/io/test/m6b-library/starter-pack.gen.test.ts`), because it needs io's
// TypeScript; this script runs it:
//
//   node tooling/make-starter-pack.mjs          writes apps/web/public/library/animations/ (14 VRMA files,
//                                               starter-pack.json, LICENSE.md) and the "Starter pack" rows of
//                                               fixtures/LICENSES.md from fixtures/animations/quaternius-ual.glb
//   node tooling/make-starter-pack.mjs --check  writes nothing; exits 1 when a committed output differs
//
// `pnpm run test` runs the same check; `check:fixtures` does not (it runs before the tests and cannot load TypeScript).
// Plain Node, `node:` modules only.

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const check = process.argv.includes('--check');
const env = { ...process.env };
if (check) delete env.EKZA_WRITE_STARTER_PACK;
else env.EKZA_WRITE_STARTER_PACK = '1';

const result = spawnSync(
  'pnpm',
  ['--filter', '@ekza-studio/io', 'exec', 'vitest', 'run', 'test/m6b-library/starter-pack.gen.test.ts'],
  { cwd: ROOT, env, stdio: 'inherit' },
);
if (result.error !== undefined) {
  console.error(`make-starter-pack: ${result.error.message}`);
  process.exit(1);
}
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(check ? 'make-starter-pack: the committed starter pack is up to date' : 'make-starter-pack: written');
