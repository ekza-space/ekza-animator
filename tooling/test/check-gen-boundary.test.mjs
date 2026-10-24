import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { checkBundles, loadBoundary } from '../check-gen-boundary.mjs';

test('the boundary lists key names, hosts and the gateway marker', () => {
  const needles = loadBoundary();
  for (const n of [
    'TRIPO_API_KEY',
    'MESHY_API_KEY',
    'GEN_GATEWAY_TOKEN',
    'meshy.ai',
    'tripo3d.ai',
    'ekza-gen-gateway:server-only',
  ])
    assert.ok(needles.includes(n), n);
});

test('clean chunks pass; a key name, a provider host or gateway code in a chunk fails', () => {
  const dir = mkdtempSync(join(tmpdir(), 'm7gbc-boundary-'));
  try {
    mkdirSync(join(dir, 'chunks'));
    writeFileSync(join(dir, 'chunks', 'a.js'), 'const client = createGenerationClient({ baseUrl: "/api/gen" });');
    assert.deepEqual(checkBundles([dir]), []);
    writeFileSync(
      join(dir, 'chunks', 'b.js'),
      'fetch("https://api.meshy.ai/openapi", { headers: { k: process.env.MESHY_API_KEY } })',
    );
    writeFileSync(join(dir, 'chunks', 'c.js'), 'const M = "ekza-gen-gateway:server-only";');
    const findings = checkBundles([dir]);
    assert.equal(findings.length, 3);
    assert.ok(findings.some((f) => f.endsWith('b.js: meshy.ai')));
    assert.ok(findings.some((f) => f.endsWith('b.js: MESHY_API_KEY')));
    assert.ok(findings.some((f) => f.endsWith('c.js: ekza-gen-gateway:server-only')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a missing build is an error, not a pass', () => {
  assert.throws(() => checkBundles([join(tmpdir(), 'm7gbc-does-not-exist')]), /no build output/);
});
