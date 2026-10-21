import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkFixtures, parseLicenseTable } from '../check-fixtures.mjs';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

test('every licensed fixture matches its fixtures/LICENSES.md row', () => {
  const { problems, checked } = checkFixtures(repoRoot);
  assert.deepEqual(problems, []);
  assert.ok(checked >= 3);
});

test('the table parser reads the path cell and the SHA-256 cell', () => {
  const sha = 'a'.repeat(64);
  const rows = parseLicenseTable(
    ['| File | Licence | SHA-256 |', '| --- | --- | --- |', `| \`models/x.vrm\` | CC0 1.0 | \`${sha}\` |`, 'text'].join(
      '\n',
    ),
  );
  assert.deepEqual(rows, [{ path: 'models/x.vrm', sha256: sha }]);
});

// M6B-SPEC §0.4.7 (C12): repository-rooted rows for the committed starter pack under apps/web/public/library/.
test('repository-rooted rows: resolved against the root, both directions checked', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs');
  const { createHash } = await import('node:crypto');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const root = mkdtempSync(join(tmpdir(), 'check-fixtures-'));
  try {
    const sha = (text) => createHash('sha256').update(text).digest('hex');
    mkdirSync(join(root, 'fixtures', 'animations'), { recursive: true });
    mkdirSync(join(root, 'apps/web/public/library/animations'), { recursive: true });
    writeFileSync(join(root, 'fixtures/animations/source.glb'), 'source');
    writeFileSync(join(root, 'apps/web/public/library/animations/walk.vrma'), 'walk');
    writeFileSync(join(root, 'apps/web/public/library/animations/idle.vrma'), 'idle');
    const table = (rows) =>
      [
        '| File | Licence | SHA-256 |',
        '| --- | --- | --- |',
        ...rows.map(([path, hash]) => `| \`${path}\` | CC0 1.0 | \`${hash}\` |`),
      ].join('\n');
    const write = (rows) => writeFileSync(join(root, 'fixtures/LICENSES.md'), table(rows));
    const source = ['animations/source.glb', sha('source')];
    const walk = ['apps/web/public/library/animations/walk.vrma', sha('walk')];
    const idle = ['apps/web/public/library/animations/idle.vrma', sha('idle')];

    write([source, walk, idle]);
    assert.deepEqual(checkFixtures(root), { problems: [], checked: 3 });

    // A library file without a row.
    write([source, walk]);
    assert.deepEqual(checkFixtures(root).problems, [
      'apps/web/public/library/animations/idle.vrma: no row in fixtures/LICENSES.md (source, licence and SHA-256 are required)',
    ]);

    // A changed library file.
    write([source, walk, [idle[0], sha('other')]]);
    assert.deepEqual(checkFixtures(root).problems, [
      `apps/web/public/library/animations/idle.vrma: SHA-256 ${sha('idle')} does not match the recorded ${sha('other')}`,
    ]);

    // A rooted row whose file is missing.
    write([source, walk, idle, ['apps/web/public/library/animations/gone.vrma', sha('gone')]]);
    assert.deepEqual(checkFixtures(root).problems, [
      'fixtures/LICENSES.md: apps/web/public/library/animations/gone.vrma is listed but the file is missing',
    ]);

    // A row neither under fixtures' licensed dirs nor repository-rooted.
    write([source, walk, idle, ['apps/web/public/samples/x.vrm', sha('x')]]);
    assert.deepEqual(checkFixtures(root).problems, [
      'fixtures/LICENSES.md: apps/web/public/samples/x.vrm is outside models/ and animations/ and apps/web/public/library/',
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
