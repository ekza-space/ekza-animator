#!/usr/bin/env node
// OMOBA's own runtime check of an exported avatar (M6B-SPEC §0.4.6 "External validator", §0.7 AS-MVP-1 step 12; C10):
// runs `cargo run -p omoba-passport --bin validate-runtime-vrm -- <file>` in the local omoba-bevy checkout, which is
// read-only for this project.
//
// - Local only, never part of `pnpm run ci`.
// - The build uses that repository's existing shared cargo cache (`CARGO_TARGET_DIR` = `<git common dir>/../target`,
//   omoba-bevy's AGENTS.md cache A): never a new target dir, never `cargo clean`. `cargo run` rebuilds a stale
//   validator binary in place (a prebuilt `target/debug/validate-runtime-vrm` may predate the rules).
// - Exits 0 with "skipped" when the checkout is absent; otherwise with the validator's exit code (0 = admitted).
//
// Usage: node tooling/omoba-validate.mjs <file.vrm> [more.vrm …]
//   EKZA_OMOBA_BEVY=<path>  the checkout (default /Users/wotori/git/ekza/omoba-bevy, then ../omoba-bevy beside
//                           this repository's parent)

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const DEFAULT_CHECKOUTS = ['/Users/wotori/git/ekza/omoba-bevy', resolve(ROOT, '..', 'omoba-bevy')];

/** The omoba-bevy checkout to use, or null when none exists (a checkout has passport/src/humanoid.rs). */
export function findCheckout(env = process.env, candidates = DEFAULT_CHECKOUTS) {
  const list = env.EKZA_OMOBA_BEVY ? [env.EKZA_OMOBA_BEVY] : candidates;
  for (const dir of list) if (existsSync(join(dir, 'passport', 'src', 'humanoid.rs'))) return resolve(dir);
  return null;
}

/** The shared cargo cache of a checkout (`<git common dir>/../target`), from git when it can tell, else `<dir>/target`. */
export function targetDirOf(checkout, git = spawnSync) {
  const out = git('git', ['-C', checkout, 'rev-parse', '--path-format=absolute', '--git-common-dir'], {
    encoding: 'utf8',
  });
  const common = out.status === 0 ? String(out.stdout).trim() : '';
  return common === '' ? join(checkout, 'target') : resolve(dirname(common), 'target');
}

/** The cargo invocation for one file (absolute path; cwd = the checkout). */
export function commandFor(checkout, file, targetDir) {
  return {
    command: 'cargo',
    args: ['run', '-q', '-p', 'omoba-passport', '--bin', 'validate-runtime-vrm', '--', file],
    options: { cwd: checkout, env: { ...process.env, CARGO_TARGET_DIR: targetDir }, stdio: 'inherit' },
  };
}

export function main(argv = process.argv.slice(2), env = process.env) {
  const files = argv.filter((arg) => !arg.startsWith('-'));
  if (files.length === 0) {
    console.error('Usage: node tooling/omoba-validate.mjs <file.vrm> [more.vrm …]');
    return 2;
  }
  const checkout = findCheckout(env);
  if (checkout === null) {
    process.stdout.write('omoba-validate: skipped (no omoba-bevy checkout; set EKZA_OMOBA_BEVY)\n');
    return 0;
  }
  const targetDir = targetDirOf(checkout);
  let status = 0;
  for (const file of files) {
    const path = isAbsolute(file) ? file : resolve(process.cwd(), file);
    if (!existsSync(path)) {
      console.error(`omoba-validate: ${path} does not exist`);
      status = 1;
      continue;
    }
    const { command, args, options } = commandFor(checkout, path, targetDir);
    const run = spawnSync(command, args, options);
    if (run.error !== undefined) {
      console.error(`omoba-validate: cannot run cargo: ${run.error.message}`);
      return 1;
    }
    if (run.status !== 0) status = run.status ?? 1;
  }
  return status;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exit(main());
