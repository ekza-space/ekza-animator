import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkWorkspace, lockedVersions } from '../check-deps.mjs';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const violationFixture = fileURLToPath(new URL('./fixtures/deps-violation', import.meta.url));

test('the repository follows the dependency rules', () => {
  assert.deepEqual(checkWorkspace(repoRoot), []);
});

test('a deliberate violation fixture is rejected for every rule', () => {
  const violations = checkWorkspace(violationFixture);
  const expected = [
    `ekza-studio: 'typescript' must use "catalog:", found "^6.0.3"`,
    `@ekza-studio/anim-core: dependencies must not include 'three'`,
    `@ekza-studio/doc: dependencies must not include '@ekza-studio/rig'`,
    `@ekza-studio/doc-yjs: internal '@ekza-studio/doc' must use "workspace:*", found "1.0.0"`,
    `@ekza-studio/doc-yjs: 'yjs' must be pinned to an exact version, found "^13.6.33"`,
    '@ekza-studio/mystery: unknown workspace package (add it to the allow-list in tooling/check-deps.mjs)',
    `@ekza-studio/rig: devDependencies must not include '@ekza-studio/doc-yjs'`,
    '@ekza-studio/rig: nothing may depend on @ekza-studio/doc-yjs (private, test-only)',
    'dependency cycle: @ekza-studio/doc -> @ekza-studio/rig -> @ekza-studio/doc',
  ];
  for (const violation of expected) assert.ok(violations.includes(violation), `missing violation: ${violation}`);
});

test('the lockfile scan finds every resolved version of a single-copy package', () => {
  const lockfile = [
    'importers:',
    '  .: {}',
    'packages:',
    '  three@0.186.1:',
    "  'three@0.187.0':",
    "  '@pixiv/three-vrm@3.5.5':",
    '  react-dom@19.3.0:',
    'snapshots:',
    '  three@0.170.0: {}',
  ].join('\n');
  const versions = lockedVersions(lockfile, ['three', '@pixiv/three-vrm', 'react']);
  assert.deepEqual([...(versions.get('three') ?? [])], ['0.186.1', '0.187.0']);
  assert.deepEqual([...(versions.get('@pixiv/three-vrm') ?? [])], ['3.5.5']);
  assert.deepEqual([...(versions.get('react') ?? [])], []);
});
