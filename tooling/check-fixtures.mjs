#!/usr/bin/env node
// Fixture licence gate (MVP-SPEC §3 convention 13, ADR 0012): every file under fixtures/models/ and
// fixtures/animations/ has exactly one row in fixtures/LICENSES.md whose SHA-256 matches the file, and every row
// points at an existing file. fixtures/synthetic/ is generated test data under the repository licence and is not
// checked here.
//
// Usage: node tooling/check-fixtures.mjs [repoRoot]

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const LICENSED_DIRS = ['models', 'animations'];

/**
 * Parses the fixture table: a row's first cell holds the file path relative to fixtures/ (in backticks) and its last
 * cell the lowercase SHA-256 (in backticks).
 */
export function parseLicenseTable(markdown) {
  const rows = [];
  for (const line of markdown.split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (cells.length < 2) continue;
    const path = /^`([^`]+)`$/.exec(cells[0] ?? '')?.[1];
    const sha256 = /^`([0-9a-f]{64})`$/.exec(cells[cells.length - 1] ?? '')?.[1];
    if (path !== undefined && sha256 !== undefined) rows.push({ path, sha256 });
  }
  return rows;
}

/** Returns human-readable problems; an empty list means every licensed fixture is recorded and unchanged. */
export function checkFixtures(root) {
  const fixturesDir = join(root, 'fixtures');
  const problems = [];
  const rows = parseLicenseTable(readFileSync(join(fixturesDir, 'LICENSES.md'), 'utf8'));
  const byPath = new Map();
  for (const row of rows) {
    if (byPath.has(row.path)) problems.push(`fixtures/LICENSES.md: duplicate row for ${row.path}`);
    byPath.set(row.path, row);
  }

  const files = LICENSED_DIRS.flatMap((dir) => listFiles(join(fixturesDir, dir))).map((file) =>
    relative(fixturesDir, file).split(sep).join('/'),
  );
  for (const file of files) {
    const row = byPath.get(file);
    if (row === undefined) {
      problems.push(`fixtures/${file}: no row in fixtures/LICENSES.md (source, licence and SHA-256 are required)`);
      continue;
    }
    const actual = createHash('sha256')
      .update(readFileSync(join(fixturesDir, file)))
      .digest('hex');
    if (actual !== row.sha256)
      problems.push(`fixtures/${file}: SHA-256 ${actual} does not match the recorded ${row.sha256}`);
  }
  const present = new Set(files);
  for (const row of rows) {
    const inLicensedDir = LICENSED_DIRS.some((dir) => row.path.startsWith(`${dir}/`));
    if (!inLicensedDir) problems.push(`fixtures/LICENSES.md: ${row.path} is outside ${LICENSED_DIRS.join('/ and ')}/`);
    else if (!present.has(row.path))
      problems.push(`fixtures/LICENSES.md: ${row.path} is listed but the file is missing`);
  }
  return { problems, checked: files.length };
}

function listFiles(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith('.')) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(path));
    else if (entry.isFile()) out.push(path);
  }
  return out;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(process.argv[2] ?? join(fileURLToPath(new URL('.', import.meta.url)), '..'));
  const { problems, checked } = checkFixtures(root);
  if (problems.length > 0) {
    console.error(`check-fixtures: ${problems.length} problem(s)`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`check-fixtures: ${checked} licensed fixture(s) match fixtures/LICENSES.md`);
}
