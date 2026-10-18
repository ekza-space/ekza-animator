import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkLicenses, forbiddenLockfileEntries, isAllowedExpression } from '../check-licenses.mjs';

test('SPDX expressions: OR needs one allowed operand, AND needs all', () => {
  assert.equal(isAllowedExpression('MIT'), true);
  assert.equal(isAllowedExpression('(MIT OR GPL-3.0-only)'), true);
  assert.equal(isAllowedExpression('MIT AND Zlib'), false);
  assert.equal(isAllowedExpression('(Apache-2.0 AND (MIT OR GPL-2.0))'), true);
  assert.equal(isAllowedExpression('Apache-2.0 WITH LLVM-exception'), true);
  assert.equal(isAllowedExpression('LGPL-3.0-or-later'), false);
  assert.equal(isAllowedExpression('Unknown'), false);
});

test('exceptions cover listed packages and platform wildcards only', () => {
  const exceptions = [
    { name: 'caniuse-lite', license: 'CC-BY-4.0', rationale: 'build-time data' },
    { name: 'lightningcss-*', license: 'MPL-2.0', rationale: 'platform binaries' },
  ];
  const { problems } = checkLicenses(
    [
      { name: 'caniuse-lite', version: '1.0.0', license: 'CC-BY-4.0' },
      { name: 'lightningcss-linux-x64-gnu', version: '1.32.0', license: 'MPL-2.0' },
      { name: 'some-gpl-lib', version: '2.0.0', license: 'GPL-3.0-only' },
      { name: 'sharp', version: '0.35.4', license: 'Apache-2.0' },
    ],
    exceptions,
    '',
  );
  assert.deepEqual(problems, [
    `some-gpl-lib@2.0.0: licence 'GPL-3.0-only' is not allowed and has no exception`,
    'sharp@0.35.4: sharp / libvips must never be installed (ADR 0009)',
  ]);
});

test('lockfile scan finds sharp packages but not link: overrides', () => {
  const lockfile = [
    'overrides:',
    '  ndarray-pixels>sharp: link:./tooling/sharp-stub',
    'packages:',
    '  sharp@0.35.4:',
    "  '@img/sharp-libvips-darwin-arm64@1.2.4':",
    '  next@16.3.8:',
    'snapshots:',
    '      sharp: link:tooling/sharp-stub',
  ].join('\n');
  assert.deepEqual(forbiddenLockfileEntries(lockfile), ['@img/sharp-libvips-darwin-arm64', 'sharp']);
});
