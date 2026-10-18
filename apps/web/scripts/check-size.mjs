#!/usr/bin/env node
// Editor route JS size report (M2A-SPEC §5.21.2, M-2). A0 lands this as a report-only stub: it never fails the build.
// A5 turns it into the CI gate (fail above 900,000 B gzip -9) with the initial script set taken from the same
// definition as the budget bench, and prints every lazy chunk group.
//
// Today's approximation of the initial set: the scripts the prerendered `/editor` page references
// (`.next/server/app/editor.html`: `<script src>` and `<link rel="preload" as="script">`), measured gzip -9.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const nextDir = join(appDir, '.next');
const BUDGET = 900_000;

const kb = (bytes) => `${(bytes / 1000).toFixed(1)} kB`;
const gzip9 = (path) => gzipSync(readFileSync(path), { level: 9 }).byteLength;

function walk(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}

function initialScripts() {
  const html = join(nextDir, 'server', 'app', 'editor.html');
  if (!existsSync(html)) return null;
  const text = readFileSync(html, 'utf8');
  const urls = new Set();
  for (const match of text.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)) urls.add(match[1]);
  for (const match of text.matchAll(/<link[^>]*rel="preload"[^>]*as="script"[^>]*href="([^"]+)"/g)) urls.add(match[1]);
  for (const match of text.matchAll(/<link[^>]*href="([^"]+)"[^>]*rel="preload"[^>]*as="script"/g)) urls.add(match[1]);
  const files = [];
  for (const url of urls) {
    const path = url.replace(/^\/_next\//, '').split('?')[0];
    const file = join(nextDir, path);
    if (path.endsWith('.js') && existsSync(file)) files.push(file);
  }
  return files;
}

function main() {
  if (!existsSync(nextDir)) {
    console.warn(
      'check:size: no production build found (.next is missing); run `pnpm build` first. Nothing to report.',
    );
    return;
  }
  const all = walk(join(nextDir, 'static', 'chunks')).filter((path) => path.endsWith('.js'));
  const allBytes = all.reduce((sum, path) => sum + gzip9(path), 0);
  const initial = initialScripts();
  if (initial === null) {
    console.warn('check:size: .next/server/app/editor.html not found; reporting every chunk only.');
  } else {
    const sizes = initial.map((path) => ({ path, bytes: gzip9(path) })).sort((a, b) => b.bytes - a.bytes);
    const total = sizes.reduce((sum, { bytes }) => sum + bytes, 0);
    process.stdout.write(`check:size (report only): /editor initial scripts ${initial.length}, ${kb(total)} gzip -9\n`);
    for (const { path, bytes } of sizes.slice(0, 12)) {
      process.stdout.write(`  ${kb(bytes).padStart(10)}  ${relative(nextDir, path)}\n`);
    }
    process.stdout.write(
      `  budget ${kb(BUDGET)} (M-2 target ≤ 800.0 kB): ${total <= BUDGET ? 'within' : 'OVER'} — not gated yet (A5)\n`,
    );
  }
  process.stdout.write(`  all client chunks: ${all.length}, ${kb(allBytes)} gzip -9\n`);
}

main();
