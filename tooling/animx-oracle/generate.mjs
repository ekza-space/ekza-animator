#!/usr/bin/env node
// Regenerates the AnimX goldens of @ekza-studio/anim-core (MVP-SPEC §6.3, ADR 0003; see README.md):
//
//   1. fetches Autodesk AnimX at the pinned commit into tooling/animx-oracle/.cache/animx (or uses --animx <dir>);
//   2. compiles oracle.cpp together with AnimX's animx.cpp (float64 time, no FMA contraction);
//   3. runs it and writes packages/anim-core/test/goldens/animx-goldens.json, formatted with Biome.
//
// Usage: node tooling/animx-oracle/generate.mjs [--animx <dir>] [--seed <n>] [--curves <n>] [--check]
//   --check  write nothing; exit 1 when the committed goldens differ from a fresh run
//
// Needs git, a C++11 compiler ($CXX, default clang++) and network access for the first fetch. Not part of CI: the
// goldens are committed and the unit tests read them.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ANIMX_REPO = 'https://github.com/Autodesk/animx.git';
export const ANIMX_COMMIT = '11c31ac74e526b599031414866db639383c9a5e0';

const HERE = resolve(fileURLToPath(new URL('.', import.meta.url)));
const ROOT = resolve(HERE, '..', '..');
const CACHE = join(HERE, '.cache');
export const GOLDENS = join(ROOT, 'packages', 'anim-core', 'test', 'goldens', 'animx-goldens.json');

function parseArgs(argv) {
  const args = { animx: null, seed: null, curves: null, check: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--check') args.check = true;
    else if (arg === '--animx') args.animx = resolve(argv[++i]);
    else if (arg === '--seed') args.seed = String(Number.parseInt(argv[++i], 10));
    else if (arg === '--curves') args.curves = String(Number.parseInt(argv[++i], 10));
    else throw new Error(`Unknown argument ${arg}`);
  }
  return args;
}

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 1 << 28, ...opts });
}

function fetchAnimx() {
  const dir = join(CACHE, 'animx');
  if (!existsSync(join(dir, '.git'))) {
    mkdirSync(CACHE, { recursive: true });
    run('git', ['clone', '--quiet', ANIMX_REPO, dir]);
  }
  run('git', ['-C', dir, 'checkout', '--quiet', '--detach', ANIMX_COMMIT]);
  return dir;
}

function compile(animx) {
  const head = run('git', ['-C', animx, 'rev-parse', 'HEAD']).toString().trim();
  if (head !== ANIMX_COMMIT) throw new Error(`AnimX checkout is at ${head}, expected ${ANIMX_COMMIT}`);
  mkdirSync(CACHE, { recursive: true });
  const binary = join(CACHE, 'animx-oracle');
  const cxx = process.env.CXX ?? 'clang++';
  run(cxx, [
    '-std=c++11',
    '-O2',
    '-ffp-contract=off',
    '-DMAYA_64BIT_TIME_PRECISION',
    '-DANIMX_STATIC',
    `-DANIMX_COMMIT="${ANIMX_COMMIT}"`,
    '-include',
    'limits',
    '-I',
    join(animx, 'src'),
    join(HERE, 'oracle.cpp'),
    join(animx, 'src', 'animx.cpp'),
    '-o',
    binary,
  ]);
  return binary;
}

function generate(binary, args, out) {
  const flags = [];
  if (args.seed !== null) flags.push('--seed', args.seed);
  if (args.curves !== null) flags.push('--curves', args.curves);
  const json = run(binary, flags).toString();
  JSON.parse(json); // well-formed
  writeFileSync(out, json);
  run(join(ROOT, 'node_modules', '.bin', 'biome'), ['format', '--write', out], { cwd: ROOT });
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const animx = args.animx ?? fetchAnimx();
  const binary = compile(animx);
  if (args.check) {
    // Biome formats only files inside the repository, so the fresh copy goes next to the committed one.
    const fresh = `${GOLDENS}.check.json`;
    try {
      generate(binary, args, fresh);
      if (readFileSync(fresh, 'utf8') !== readFileSync(GOLDENS, 'utf8')) {
        console.error('animx-goldens.json differs from a fresh AnimX run; regenerate it.');
        process.exitCode = 1;
      }
    } finally {
      rmSync(fresh, { force: true });
    }
    return;
  }
  generate(binary, args, GOLDENS);
  console.warn(`wrote ${GOLDENS}`);
}

main();
