import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { lintParams, registryViolations, staticViolations } from '../param-lint.mjs';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const violationFixture = fileURLToPath(new URL('./fixtures/param-lint-violation', import.meta.url));

test('the repository passes param-lint (forms, UI wrappers, agent policy, importers)', async () => {
  const { violations, summary } = await lintParams(repoRoot);
  assert.deepEqual(violations, []);
  assert.match(summary, /^20 forms, 10 UI wrappers, \d+ operators/);
});

test('only the touch shell imports the forms, and nothing declares addParams', () => {
  assert.deepEqual(staticViolations(violationFixture).sort(), [
    `${join('packages', 'editor-core', 'src', 'operators', 'extend.ts')}: declares or calls addParams; forms are Halo-only data (§20.3 item 6)`,
    `${join('packages', 'editor-core', 'src', 'operators', 'peek.ts')}: imports the Halo-only forms ('../forms'); only packages/halo may (§20.3 item 6)`,
    `${join('packages', 'editor', 'src', 'peek.ts')}: imports the Halo-only forms ('@ekza-studio/editor-core/forms'); only packages/halo may (§20.3 item 6)`,
  ]);
});

test('forms, wrappers and surfaces are checked against the registry', () => {
  const param = { name: 'size', label: 'Size', kind: 'number', bound: 'value', default: 1 };
  const label = () => 'Label';
  const operators = [
    { id: 'a.form' },
    { id: 'a.adjustable', flags: { adjustable: true }, params: [param] },
    { id: 'a.params', params: [param] },
    { id: 'w.ok', flags: { undo: true }, undoLabel: label },
    { id: 'w.internal', flags: { undo: true, internal: true }, undoLabel: label },
    { id: 'w.repeat', flags: { undo: true, repeatable: true }, params: [], undoLabel: label },
    { id: 'w.allowed', flags: {}, undoLabel: label },
  ];
  const forms = ['a.form', 'a.adjustable', 'a.params', 'a.gone', 'w.ok', 'w.internal', 'w.repeat', 'w.allowed'].map(
    (id) => ({ id, params: [] }),
  );
  const base = {
    operators,
    forms,
    formProblems: (form) => (form.id === 'a.form' ? ['a.form: bad'] : []),
    wrappers: ['w.ok', 'w.internal', 'w.repeat', 'w.allowed', 'w.missing'],
    policyOf: (id) => ({ policy: id === 'w.allowed' ? 'allowed' : 'denied' }),
  };
  assert.deepEqual(registryViolations({ ...base, surfaces: null }), [
    'form a.form: bad',
    'form a.adjustable: the operator is adjustable; it gets after-run chips, not a form (§5.6)',
    'form a.adjustable: the operator declares ParamDefs; its pre-run form is those (§5.6)',
    'form a.params: the operator declares ParamDefs; its pre-run form is those (§5.6)',
    'form a.gone: names no registered operator',
    'form w.repeat: the operator declares ParamDefs; its pre-run form is those (§5.6)',
    'wrapper w.internal: internal (wrappers are public)',
    'wrapper w.repeat: declares ParamDefs or is adjustable/repeatable (Studio Pro would change)',
    'wrapper w.allowed: not undoable (one step per run)',
    'wrapper w.allowed: not denied to agents (agent-tools policy)',
    'wrapper w.missing: not registered by its chunk (loadUiWrappers)',
  ]);
  const surfaces = [
    { op: 'a.form', surface: 'chips' },
    { op: 'a.adjustable', surface: 'chips' },
    { op: 'a.params', surface: 'form' },
    { op: 'a.none', surface: 'form' },
    { op: 'w.ok', surface: 'form' },
    { op: 'a.params', surface: 'options' },
  ];
  const surfaceViolations = registryViolations({ ...base, wrappers: [], surfaces }).filter(
    (violation) => !violation.startsWith('form '),
  );
  assert.deepEqual(surfaceViolations, [
    'surface chips of a.form: not adjustable; use a pre-run form (§5.6)',
    'surface form of a.none: names no registered operator',
    'a.adjustable: has a Studio Pro option box but no Options surface in the touch shell (§6.3)',
  ]);
});
