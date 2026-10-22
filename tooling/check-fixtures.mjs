#!/usr/bin/env node
// Fixture licence gate (MVP-SPEC §3 convention 13, ADR 0012): every file under fixtures/models/ and
// fixtures/animations/ has exactly one row in fixtures/LICENSES.md whose SHA-256 matches the file, and every row
// points at an existing file. fixtures/synthetic/ is generated test data under the repository licence and is not
// checked here.
//
// M6B-SPEC §0.4.7 (C12): the clip library's committed starter pack is licensed the same way. A row whose path starts
// with `apps/web/public/library/` is repository-rooted: it resolves against the repository root, must exist and match
// its SHA-256, and every file under `apps/web/public/library/` needs a row (the same two-way rule).
//
// Usage: node tooling/check-fixtures.mjs [repoRoot]

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const LICENSED_DIRS = ['models', 'animations'];
/** Repository-rooted licensed trees (§0.4.7): rows with this prefix resolve against the repository root. */
export const ROOTED_PREFIX = 'apps/web/public/library/';

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

  const posix = (base, file) => relative(base, file).split(sep).join('/');
  // A row path names a fixture relative to fixtures/, or a repository-rooted file (ROOTED_PREFIX).
  const files = [
    ...LICENSED_DIRS.flatMap((dir) => listFiles(join(fixturesDir, dir))).map((file) => ({
      row: posix(fixturesDir, file),
      shown: `fixtures/${posix(fixturesDir, file)}`,
      path: file,
    })),
    ...listFiles(join(root, ROOTED_PREFIX)).map((file) => ({
      row: posix(root, file),
      shown: posix(root, file),
      path: file,
    })),
  ];
  for (const file of files) {
    const row = byPath.get(file.row);
    if (row === undefined) {
      problems.push(`${file.shown}: no row in fixtures/LICENSES.md (source, licence and SHA-256 are required)`);
      continue;
    }
    const actual = createHash('sha256').update(readFileSync(file.path)).digest('hex');
    if (actual !== row.sha256)
      problems.push(`${file.shown}: SHA-256 ${actual} does not match the recorded ${row.sha256}`);
  }
  const present = new Set(files.map((file) => file.row));
  for (const row of rows) {
    const inLicensedDir =
      LICENSED_DIRS.some((dir) => row.path.startsWith(`${dir}/`)) || row.path.startsWith(ROOTED_PREFIX);
    if (!inLicensedDir) {
      problems.push(
        `fixtures/LICENSES.md: ${row.path} is outside ${LICENSED_DIRS.join('/ and ')}/ and ${ROOTED_PREFIX}`,
      );
    } else if (!present.has(row.path)) {
      problems.push(`fixtures/LICENSES.md: ${row.path} is listed but the file is missing`);
    }
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
