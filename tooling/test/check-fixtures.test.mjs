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
