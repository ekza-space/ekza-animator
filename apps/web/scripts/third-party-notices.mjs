#!/usr/bin/env node
// Writes public/THIRD_PARTY_NOTICES.txt (ADR 0009 §7): licence texts and NOTICE files of every third-party package
// the web app depends on in production — a superset of the client bundle, collected before `next build` runs —
// plus the project's own NOTICE files (AnimX port). The About dialog and the landing page link the result.

import { existsSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoDir = resolve(appDir, '../..');
const WORKSPACE_SCOPE = '@ekza-studio/';
const LICENSE_FILE = /^(licen[cs]es?|copying|notices?)([.-].*)?$/i;

/** Node's lookup: `node_modules/<name>` in `fromDir` and its ancestors (pnpm keeps a package's deps as siblings). */
function findPackageDir(name, fromDir) {
  let dir = fromDir;
  for (;;) {
    const candidate = join(dir, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return realpathSync(candidate);
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function readManifest(dir) {
  return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
}

function licenseOf(manifest) {
  if (typeof manifest.license === 'string') return manifest.license;
  if (manifest.license && typeof manifest.license.type === 'string') return manifest.license.type;
  if (Array.isArray(manifest.licenses)) return manifest.licenses.map((l) => l.type ?? l).join(' OR ');
  return 'UNKNOWN';
}

/** Production dependency closure of apps/web, walking through workspace packages without listing them. */
function collectPackages() {
  const found = new Map();
  const visited = new Set();
  const queue = [realpathSync(appDir)];
  while (queue.length > 0) {
    const dir = queue.shift();
    if (visited.has(dir)) continue;
    visited.add(dir);
    const manifest = readManifest(dir);
    const isWorkspace = dir === realpathSync(appDir) || manifest.name?.startsWith(WORKSPACE_SCOPE);
    if (!isWorkspace) found.set(`${manifest.name}@${manifest.version}`, { dir, manifest });
    const deps = { ...manifest.dependencies, ...manifest.optionalDependencies };
    for (const name of Object.keys(deps)) {
      const depDir = findPackageDir(name, dir);
      if (depDir !== null) queue.push(depDir);
    }
  }
  return [...found.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, value]) => value);
}

function licenseTexts(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && LICENSE_FILE.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({ name, text: readFileSync(join(dir, name), 'utf8').trim() }));
}

const RULE = '='.repeat(100);
const sections = [];
for (const notice of ['packages/anim-core/NOTICE']) {
  const file = join(repoDir, notice);
  if (existsSync(file)) sections.push(`${RULE}\nEkza Studio: ${notice}\n${RULE}\n${readFileSync(file, 'utf8').trim()}`);
}
const packages = collectPackages();
for (const { dir, manifest } of packages) {
  const texts = licenseTexts(dir);
  const header = [`${manifest.name} ${manifest.version}`, `License: ${licenseOf(manifest)}`];
  if (typeof manifest.homepage === 'string') header.push(`Homepage: ${manifest.homepage}`);
  const body =
    texts.length > 0
      ? texts.map(({ name, text }) => `--- ${name} ---\n${text}`).join('\n\n')
      : '(The package ships no licence file; see its declared licence above.)';
  sections.push(`${RULE}\n${header.join('\n')}\n${RULE}\n${body}`);
}

const preamble = [
  'Ekza Studio — third-party notices',
  '',
  'Ekza Studio is MIT licensed (see LICENSE in the source repository). It includes or depends on the',
  'third-party software listed below, each under its own licence. Bundled sample models are credited in',
  'fixtures/LICENSES.md and in Help → About.',
  `Packages: ${packages.length}.`,
].join('\n');

const out = join(appDir, 'public', 'THIRD_PARTY_NOTICES.txt');
writeFileSync(out, `${preamble}\n\n${sections.join('\n\n')}\n`);
console.log(`third-party-notices: ${packages.length} packages → public/THIRD_PARTY_NOTICES.txt`);
