// CHARACTER-CONTRACT-SPEC §8.1, §5.3 (C1): the bundled contract snapshots are consistent (index ↔ files, recomputed
// revisions, the fixture = the live revision); the sync takes a game's file, refuses a revision that does not match its
// content (unless `--restamp`, for draft data) and keeps earlier revisions listed.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { canonical, checkContracts, fixturePath, revisionOf, syncContract } from '../sync-contract.mjs';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const FIXTURE = join(repoRoot, fixturePath('omoba.character-contract.v1'));

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

    writeFileSync(join(root, 'apps/web/public/contracts/omoba', `${one.revision}.json`), '{}');
    assert.ok(checkContracts(root).some((problem) => problem.includes('SHA-256')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
