#!/usr/bin/env node
// Contract snapshot sync (CHARACTER-CONTRACT-SPEC §8.1, §5.3; C1). Studio bundles each game's character contract so a
// project binds and reopens offline. Per game (the document's `projectId`, or `game`):
//
//   apps/web/public/contracts/<game>/<revision>.json   the bundled revisions (served same-origin, never edited)
//   apps/web/public/contracts/<game>/index.json        `ekza.contract-index.v1`: revisions, channels, `submit`
//   fixtures/contracts/<schema>.json                   the live revision, the io tests' fixture
//
// `--from <file>` takes the game's committed snapshot (OMOBA: `omoba-bevy/shared/assets/catalog/
// character-contract.json`, or a registry download), recomputes the canonical revision (the `omoba.asset-catalog.v1`
// rule, below) and refuses a mismatch, writes the revision file, points both channels at it and copies the fixture.
// `--schema <file>` also copies the document's JSON Schema to `fixtures/contracts/<schema>.schema.json`. `--restamp`
// is for draft data only (the C1 prototype export, whose `revision` was illustrative): it replaces the revision with
// the recomputed one instead of refusing. `--check` (the local gate, `tooling/test/sync-contract.test.mjs`) verifies
// every game's index against its files without writing.
//
// Usage: node tooling/sync-contract.mjs --from <file> [--schema <file>] [--restamp] [--root <repo>]
//        node tooling/sync-contract.mjs --check [--root <repo>]
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const PUBLIC_ROOT = 'apps/web/public/contracts';
export const FIXTURE_DIR = 'fixtures/contracts';
const MAX_BYTES = 1_048_576;
const REVISION = /^sha256-[0-9a-f]{64}$/;
const SCHEMA_ID = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*\.v[0-9]+$/;
const GAME = /^[a-z][a-z0-9-]{1,62}$/;

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** Canonical JSON (§3.1): sorted keys, compact, integer-valued numbers as integers, plain decimals ≥ 0.000001. */
export function canonical(value, path = '$') {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) {
      throw new Error(`${path}: not a finite, JavaScript-safe number`);
    }
    if (Number.isInteger(value)) return String(Object.is(value, -0) ? 0 : value);
    if (Math.abs(value) < 0.000001) throw new Error(`${path}: fractional number below 0.000001`);
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map((item, i) => canonical(item, `${path}[${i}]`)).join(',')}]`;
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort();
    for (const key of keys) {
      if (!/^[\x20-\x7e]*$/.test(key)) throw new Error(`${path}.${key}: not an ASCII key`);
    }
    return `{${keys
      .filter((key) => value[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key], `${path}.${key}`)}`)
      .join(',')}}`;
  }
  throw new Error(`${path}: not JSON`);
}

/** `sha256-` + SHA-256 of the canonical JSON of the document without `revision`. */
export function revisionOf(document) {
  const { revision: _revision, ...rest } = document;
  return `sha256-${sha256(Buffer.from(canonical(rest), 'utf8'))}`;
}

/** The game a contract document belongs to (`projectId` in OMOBA's v1 profile). */
export function gameOf(document) {
  const game = document.game ?? document.projectId;
  if (typeof game !== 'string' || !GAME.test(game)) throw new Error('the document names no game (projectId)');
  return game;
}

/** The fixture file of a document schema. */
export const fixturePath = (schema) => `${FIXTURE_DIR}/${schema}.json`;

/** The document with its identity keys first (schema … previousRevision), the rest in the source's order. */
function ordered(document) {
  const { schema, schemaVersion, projectId, revision, previousRevision, ...rest } = document;
  return { schema, schemaVersion, projectId, revision, previousRevision, ...rest };
}

const textOf = (document) => `${JSON.stringify(ordered(document), null, 1)}\n`;
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

function indexEntry(document, bytes) {
  const characters = document.characters ?? document.heroes ?? [];
  return {
    revision: document.revision,
    file: `${document.revision}.json`,
    bytes: bytes.byteLength,
    sha256: sha256(bytes),
    previousRevision: document.previousRevision ?? null,
    characters: characters.length,
    slots: Object.keys(document.slots ?? {}).length,
  };
}

/** Takes a contract file into the repository (see the header). Returns what it wrote. */
export function syncContract({ root, from, schema = null, restamp = false, submit = null }) {
  const source = readJson(from);
  if (typeof source.schema !== 'string' || !SCHEMA_ID.test(source.schema)) throw new Error(`${from}: no schema id`);
  const game = gameOf(source);
  const computed = revisionOf(source);
  const original = source.revision;
  if (original !== computed) {
    if (!restamp) throw new Error(`${from}: revision ${original} does not match its content (${computed})`);
    source.revision = computed;
  }
  const bytes = Buffer.from(textOf(source), 'utf8');
  if (bytes.byteLength > MAX_BYTES) throw new Error(`${from}: ${bytes.byteLength} B is over the 1 MiB cap`);
  const dir = join(root, PUBLIC_ROOT, game);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${source.revision}.json`), bytes);
  const indexPath = join(dir, 'index.json');
  const previous = existsSync(indexPath) ? readJson(indexPath) : null;
  const revisions = (previous?.revisions ?? []).filter((entry) => entry.revision !== source.revision);
  revisions.push(indexEntry(source, bytes));
  revisions.sort((a, b) => a.revision.localeCompare(b.revision));
  const index = {
    schema: 'ekza.contract-index.v1',
    game,
    contractSchema: source.schema,
    channels: { live: source.revision, test: source.revision },
    submit: submit ?? previous?.submit ?? false,
    revisions,
  };
  writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`);
  mkdirSync(join(root, FIXTURE_DIR), { recursive: true });
  writeFileSync(join(root, fixturePath(source.schema)), bytes);
  if (schema !== null) writeFileSync(join(root, FIXTURE_DIR, `${source.schema}.schema.json`), readFileSync(schema));
  return { game, revision: source.revision, bytes: bytes.byteLength, restamped: original !== computed };
}

/** Problems of one game's bundled snapshot ([] = consistent). */
function checkGame(root, game) {
  const problems = [];
  const base = `${PUBLIC_ROOT}/${game}`;
  const dir = join(root, base);
  const indexPath = join(dir, 'index.json');
  if (!existsSync(indexPath)) return [`${base}/index.json is missing`];
  const index = readJson(indexPath);
  if (index.schema !== 'ekza.contract-index.v1')
    problems.push(`${base}/index.json: schema is not ekza.contract-index.v1`);
  if (index.game !== game) problems.push(`${base}/index.json: game is ${JSON.stringify(index.game)}`);
  const listed = new Set();
  for (const entry of index.revisions ?? []) {
    listed.add(entry.file);
    if (!REVISION.test(entry.revision ?? '') || entry.file !== `${entry.revision}.json`) {
      problems.push(`${base}/index.json: bad entry ${JSON.stringify(entry.revision)}`);
      continue;
    }
    const path = join(dir, entry.file);
    if (!existsSync(path)) {
      problems.push(`${base}/${entry.file}: listed but missing`);
      continue;
    }
    const bytes = readFileSync(path);
    if (bytes.byteLength !== entry.bytes)
      problems.push(`${entry.file}: ${bytes.byteLength} B, index says ${entry.bytes}`);
    if (sha256(bytes) !== entry.sha256) problems.push(`${entry.file}: SHA-256 does not match the index`);
    const document = JSON.parse(bytes.toString('utf8'));
    if (document.revision !== entry.revision) problems.push(`${entry.file}: holds revision ${document.revision}`);
    if (revisionOf(document) !== document.revision) problems.push(`${entry.file}: revision does not match its content`);
    if (document.schema !== index.contractSchema) problems.push(`${entry.file}: schema is not ${index.contractSchema}`);
  }
  for (const file of readdirSync(dir)) {
    if (file !== 'index.json' && file.endsWith('.json') && !listed.has(file)) {
      problems.push(`${base}/${file}: not listed in index.json`);
    }
  }
  for (const channel of ['live', 'test']) {
    if (!(index.revisions ?? []).some((entry) => entry.revision === index.channels?.[channel])) {
      problems.push(`${base}/index.json: channel ${channel} names an unlisted revision`);
    }
  }
  const fixture = join(root, fixturePath(index.contractSchema));
  const live = join(dir, `${index.channels?.live}.json`);
  if (!existsSync(fixture)) problems.push(`${fixturePath(index.contractSchema)} is missing`);
  else if (existsSync(live) && sha256(readFileSync(fixture)) !== sha256(readFileSync(live))) {
    problems.push(`${fixturePath(index.contractSchema)} differs from the live revision ${index.channels.live}`);
  }
  return problems;
}

/** Problems of every bundled game ([] = consistent): index ↔ files, recomputed revisions, the fixture = live. */
export function checkContracts(root) {
  const dir = join(root, PUBLIC_ROOT);
  if (!existsSync(dir)) return [`${PUBLIC_ROOT} is missing`];
  const games = readdirSync(dir).filter((name) => statSync(join(dir, name)).isDirectory());
  if (games.length === 0) return [`${PUBLIC_ROOT} has no game`];
  return games.flatMap((game) => checkGame(root, game));
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const value = (flag) => {
    const i = args.indexOf(flag);
    return i < 0 ? null : (args[i + 1] ?? null);
  };
  const root = resolve(value('--root') ?? join(fileURLToPath(new URL('.', import.meta.url)), '..'));
  if (args.includes('--check')) {
    const problems = checkContracts(root);
    if (problems.length > 0) {
      console.error(`sync-contract: ${problems.length} problem(s)`);
      for (const p of problems) console.error(`  - ${p}`);
      process.exit(1);
    }
    console.log('sync-contract: the bundled contract snapshots are consistent');
  } else {
    const from = value('--from');
    if (from === null) {
      console.error('usage: sync-contract.mjs --from <file> [--schema <file>] [--restamp] | --check');
      process.exit(2);
    }
    const schema = value('--schema');
    const result = syncContract({
      root,
      from: resolve(from),
      schema: schema === null ? null : resolve(schema),
      restamp: args.includes('--restamp'),
    });
    console.log(`sync-contract: ${result.game} ${result.revision} (${result.bytes} B)`);
  }
}
