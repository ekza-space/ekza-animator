// GAME-PROTOCOL-SPEC §8.10, CHARACTER-CONTRACT-SPEC §8.1 (C1): the bundled contract snapshots are consistent (index ↔
// files, recomputed revisions, profiles, the fixture = the live revision); the sync takes a game's file, refuses a
// revision that does not match its content (unless `--restamp`, for draft data) and keeps earlier revisions listed.
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  canonical,
  checkContracts,
  fixturePath,
  fixturesPath,
  revisionOf,
  syncContract,
  syncFixtures,
} from '../sync-contract.mjs';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const FIXTURE = join(repoRoot, fixturePath('omoba'));

test('the committed snapshots are consistent', () => {
  assert.deepEqual(checkContracts(repoRoot), []);
});

test('canonical JSON: sorted keys, integers, plain decimals; refuses tiny fractions', () => {
  assert.equal(canonical({ b: 1.0, a: [0.5, -0, 'x'] }), '{"a":[0.5,0,"x"],"b":1}');
  assert.throws(() => canonical({ x: 1e-7 }));
});

test('sync: refuses a stale revision, restamps draft data, keeps earlier revisions listed', () => {
  const root = mkdtempSync(join(tmpdir(), 'sync-contract-'));
  try {
    const doc = JSON.parse(readFileSync(FIXTURE, 'utf8'));
    const first = join(root, 'first.json');
    writeFileSync(first, JSON.stringify(doc));
    const one = syncContract({ root, from: first });
    assert.equal(one.revision, doc.revision);
    assert.equal(one.restamped, false);
    assert.deepEqual(checkContracts(root), []);

    doc.slots['base.run'].label = 'Sprint';
    const second = join(root, 'second.json');
    writeFileSync(second, JSON.stringify(doc));
    assert.throws(() => syncContract({ root, from: second }), /does not match its content/);
    const two = syncContract({ root, from: second, restamp: true });
    assert.equal(two.restamped, true);
    assert.equal(two.revision, revisionOf({ ...doc, revision: undefined }));
    assert.deepEqual(checkContracts(root), []);
    const index = JSON.parse(readFileSync(join(root, 'apps/web/public/contracts/omoba/index.json'), 'utf8'));
    assert.equal(index.revisions.length, 2);
    assert.equal(index.channels.live, two.revision);
    assert.equal(index.contractSchema, 'ekza.game-contract.v1');
    assert.deepEqual(index.profiles, ['omoba.character.v1']);

    writeFileSync(join(root, 'apps/web/public/contracts/omoba', `${one.revision}.json`), '{}');
    assert.ok(checkContracts(root).some((problem) => problem.includes('SHA-256')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('fixtures (C2): copied pinned to the manifest SHA-256, big files named, tampering found by --check', () => {
  const root = mkdtempSync(join(tmpdir(), 'sync-fixtures-'));
  try {
    cpSync(join(repoRoot, 'apps/web/public/contracts'), join(root, 'apps/web/public/contracts'), { recursive: true });
    cpSync(join(repoRoot, 'fixtures/contracts/omoba.game-contract.json'), join(root, fixturePath('omoba')));
    const source = join(repoRoot, fixturesPath('omoba'));
    const result = syncFixtures({ root, from: source, cap: 100_000 });
    assert.equal(result.game, 'omoba');
    assert.ok(result.skipped.includes('packages/clip-4097-keys.glb'));
    assert.ok(!existsSync(join(root, fixturesPath('omoba'), 'packages/clip-4097-keys.glb')));
    assert.deepEqual(checkContracts(root), []);
    writeFileSync(join(root, fixturesPath('omoba'), 'expected/ok-all-default.json'), '{}');
    assert.ok(checkContracts(root).some((problem) => problem.includes('ok-all-default.json')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
