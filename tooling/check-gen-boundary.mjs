#!/usr/bin/env node
// Client-bundle boundary of AI generation (M7 G-b, ADR 0017 §1, research 15 §5.7): after `pnpm build`, no browser
// chunk of apps/web may contain a provider key or secret variable name, a provider host, or the gen-gateway marker
// (the server package itself). The typed GenerationClient of @ekza-studio/gen-core is allowed: it names none of them.
// The lists live in tooling/gen-boundary.json.
//
// Usage: node tooling/check-gen-boundary.mjs [dir …]   (default: apps/web/.next/static, and apps/web/out when present)

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

export function loadBoundary(file = join(ROOT, 'tooling/gen-boundary.json')) {
  const { keyNames, hosts, markers } = JSON.parse(readFileSync(file, 'utf8'));
  return [...keyNames, ...hosts, ...markers];
}

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (/\.(m?js|html|json|txt)$/.test(entry.name)) yield path;
  }
}

/** Returns `file: needle` findings; [] means the bundles are clean. Throws when a directory is missing or empty. */
export function checkBundles(dirs, needles = loadBoundary()) {
  const findings = [];
  for (const dir of dirs) {
    if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new Error(`no build output at ${dir} (run pnpm build)`);
    let files = 0;
    for (const file of walk(dir)) {
      files += 1;
      const text = readFileSync(file, 'utf8');
      for (const needle of needles) if (text.includes(needle)) findings.push(`${relative(ROOT, file)}: ${needle}`);
    }
    if (files === 0) throw new Error(`no client files under ${dir}`);
  }
  return findings;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const given = process.argv.slice(2).map((d) => resolve(d));
  const dirs =
    given.length > 0
      ? given
      : [join(ROOT, 'apps/web/.next/static'), join(ROOT, 'apps/web/out')].filter((d, i) => i === 0 || existsSync(d));
  try {
    const findings = checkBundles(dirs);
    if (findings.length > 0) {
      console.error(`check-gen-boundary: ${findings.length} forbidden string(s) in browser bundles:`);
      for (const f of findings) console.error(`  ${f}`);
      process.exit(1);
    }
    console.log(
      `check-gen-boundary: no provider key name, provider host or gateway code in ${dirs.map((d) => relative(ROOT, d)).join(', ')}`,
    );
  } catch (err) {
    console.error(`check-gen-boundary: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
