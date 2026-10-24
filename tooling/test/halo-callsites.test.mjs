import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ANY, argsMatch, ID, scanCallSites, shapeKey, stableKey, summarize } from '../halo-callsites.mjs';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const fixture = fileURLToPath(new URL('./fixtures/halo-callsites', import.meta.url));

const DEMO = 'packages/editor/src/panels/demo/DemoPanel.tsx';
const MENUS = 'packages/editor/src/overlays/menus/items.ts';
const SHELL = 'packages/editor/src/shell/Shell.ts';
const DIALOG = 'packages/editor/src/dialogs/Dialog.tsx';
const STEP = 'packages/autorig/src/steps/Step.tsx';

const pair = (op, args, ...sites) => ({ op, args, sites });

test('the fixture lists every recognised form, and nothing else', () => {
  const { pairs, unresolved } = scanCallSites(fixture);
  assert.deepEqual(pairs, [
    pair('autorig.controls', { hidden: true }, `${STEP}:5`), // ctx.run
    pair('autorig.intake', { bytes: ANY, name: ANY }, `${STEP}:6`), // runIntake(ctx, name, op, args)
    pair('char.renderThumbnail', null, `${MENUS}:30`), // menu row, `undefined` arguments
    pair('clip.rename', { clip: ANY, name: ANY }, `${DEMO}:10`), // runOperator(app, panel, op, args)
    pair('edit.redo', null, `${DEMO}:15`), // run(op, undefined)
    pair('edit.repeat', ANY, `${DEMO}:40`), // JSX op with a spread and no args attribute
    pair('edit.undo', null, `${DEMO}:14`), // app.runUntyped(op)
    pair('file.export', ANY, `${DEMO}:20`), // arguments that are not an object literal
    pair('graph.tangent.set', { type: 'flat' }, `${DEMO}:26`), // runGraphOperator(app, op, args)
    // act(app, clip, op, undefined, panel), quiet(ctx, op) and quiet(shell.app, op): one pair, three sites
    pair('library.stop', null, `${STEP}:7`, `${DEMO}:27`, `${SHELL}:3`),
    pair('library.useClip', { '...': ANY, loop: false, slot: 'idle' }, `${DEMO}:17`), // a spread
    { ...pair('mesh.create.*', null, `${MENUS}:7`, `${DEMO}:21`), pattern: true }, // template ids
    pair('mesh.extrude', null, `${MENUS}:12`), // op(id, label)
    pair('mesh.freezeTransforms', { rotate: false, translate: true }, `${MENUS}:13`), // op(id, label, args)
    pair(
      'prefs.set',
      { patch: { firstRunDone: true, rigging: { '...': ANY, jointSize: 2 }, theme: null } }, // nested shapes
      `${DEMO}:16`,
    ),
    pair('scene.delete', { depth: 0, ids: 'selected' }, `${STEP}:2`), // an Auto-Rig keymap binding
    pair('select.mode', ANY, `${MENUS}:21`), // `args: MODE_ARGS`
    pair('time.play', null, `${DEMO}:23`), // a conditional id: both branches
    pair('time.step', { delta: -1 }, `${DEMO}:11`), // a negative number
    pair('time.step', { delta: 2.5 }, `${DEMO}:12`),
    pair('time.stop', null, `${DEMO}:23`),
    pair('ui.close', null, `${DIALOG}:2`, `${SHELL}:2`), // null arguments, runFromUi(op)
    pair('ui.open', { dialog: ANY }, `${DEMO}:18`), // a shorthand property
    pair('ui.open', { dialog: 'about' }, `${MENUS}:17`), // an `op:` descriptor
    pair('ui.open', { dialog: 'export' }, `${DEMO}:13`, `${SHELL}:4`),
    pair('view.camera.setSettings', { fovY: 50 }, `${DEMO}:22`), // a same-file `const` id
    pair('view.display.toggle', { flag: 'xrayJoints' }, `${MENUS}:29`), // a menu row
    pair('view.frame', { what: 'all' }, `${DEMO}:24`, `${DEMO}:25`), // `as const` is the same shape
    pair('view.isolate', null, `${MENUS}:18`, `${DEMO}:39`), // `op:` and `op={'…'}` without arguments
    pair('view.selectionMask', { mask: { '[*]': ANY } }, `${DEMO}:19`), // a computed key
    pair('view.tool', ANY, `${MENUS}:20`), // a spread that may supply `args`
    pair('workspace.showPanel', { panel: 'validation' }, `${DEMO}:38`), // JSX op + args, a PANEL member
    pair('workspace.toggleFocus', null, `${MENUS}:19`), // a spread without `args`
  ]);
  assert.deepEqual(unresolved, [
    { site: `${MENUS}:3`, expr: 'op', via: 'op:', forwarded: true },
    { site: `${MENUS}:23`, expr: 'props.item.op', via: 'op:' },
    { site: `${DEMO}:28`, expr: 'props.op', via: 'run()' },
    { site: `${DEMO}:29`, expr: 'op', via: 'app.runUntyped()', forwarded: true },
    { site: `${DEMO}:41`, expr: 'props.op', via: '<OpButton op>' },
  ]);
});

test('shape keys are stable JSON with sorted keys at every level', () => {
  assert.equal(stableKey(null), 'null');
  assert.equal(stableKey(ANY), '"*"');
  assert.equal(stableKey({ b: 1, a: { d: null, c: '*' } }), '{"a":{"c":"*","d":null},"b":1}');
  assert.equal(stableKey({ a: 1, b: 2 }), stableKey({ b: 2, a: 1 }));
  assert.equal(shapeKey('ui.open', { dialog: 'export' }), 'ui.open {"dialog":"export"}');
});

test('argsMatch: listed literals, explicit wildcards, null for absent keys, dot paths', () => {
  const shape = { dialog: 'export', mode: ANY, patch: { jointAxes: 'none', more: ANY }, clip: null };
  assert.equal(argsMatch(shape, undefined), true);
  assert.equal(argsMatch(shape, {}), true);
  assert.equal(argsMatch(shape, { dialog: 'export' }), true);
  assert.equal(argsMatch(shape, { dialog: ['import', 'export'] }), true);
  assert.equal(argsMatch(shape, { dialog: 'import' }), false);
  assert.equal(argsMatch(shape, { dialog: 'export', mode: 'face' }), false); // '*' needs '*'
  assert.equal(argsMatch(shape, { mode: ['face', ANY] }), true);
  assert.equal(argsMatch(shape, { patch: 'none' }), false); // a nested shape needs '*'
  assert.equal(argsMatch(shape, { patch: ANY }), true);
  assert.equal(argsMatch(shape, { 'patch.jointAxes': 'none' }), true);
  assert.equal(argsMatch(shape, { 'patch.jointAxes': 'all' }), false);
  assert.equal(argsMatch(shape, { 'patch.weights': null }), true);
  assert.equal(argsMatch(shape, { 'patch.more.deep': ANY }), true);
  assert.equal(argsMatch(shape, { panel: 'graph' }), false); // absent needs null
  assert.equal(argsMatch(shape, { panel: [null, 'graph'] }), true);
  assert.equal(argsMatch(shape, { clip: null }), true);
  assert.equal(argsMatch(null, { dialog: null }), true);
  assert.equal(argsMatch(null, { dialog: 'export' }), false);
  assert.equal(argsMatch(ANY, { dialog: 'export' }), false);
  assert.equal(argsMatch(ANY, { dialog: ANY }), true);
  assert.equal(argsMatch({ delta: -1, on: false }, { delta: [-1, 1], on: false }), true);
  const spread = { '...': ANY, slot: 'idle' }; // a key absent beside a spread may be supplied by it
  assert.equal(argsMatch(spread, { loop: null }), false);
  assert.equal(argsMatch(spread, { loop: [null, ANY] }), true);
  assert.equal(argsMatch(spread, { slot: 'idle' }), true);
});

test('the repository scan lists Studio Pro and Auto-Rig sends', () => {
  const scan = scanCallSites(repoRoot);
  const { pairs, unresolved } = scan;
  assert.ok(pairs.length > 100, `only ${pairs.length} pairs`);
  const site = /^packages\/(editor\/src\/(panels|overlays|shell|dialogs)|autorig\/src)\/.+\.tsx?:\d+$/;
  const keys = pairs.map((entry) => shapeKey(entry.op, entry.args));
  assert.equal(new Set(keys).size, keys.length, 'pairs are deduplicated');
  for (const entry of pairs) {
    const id = entry.pattern === true ? entry.op.replaceAll(ANY, 'x') : entry.op;
    assert.match(id, ID, `${entry.op} is an operator id`);
    assert.ok(entry.sites.length > 0 && entry.sites.every((s) => site.test(s)), `${entry.op} sites`);
  }
  for (let i = 1; i < pairs.length; i += 1) {
    const [a, b] = [pairs[i - 1], pairs[i]];
    assert.ok(a.op < b.op || (a.op === b.op && stableKey(a.args) < stableKey(b.args)), `${keys[i]} is sorted`);
  }
  const literals = (op, key) =>
    new Set(pairs.filter((e) => e.op === op && typeof e.args?.[key] === 'string').map((e) => e.args[key]));
  for (const dialog of ['export', 'import', 'preferences', 'firstRun']) {
    assert.ok(literals('ui.open', 'dialog').has(dialog), `ui.open ${dialog}`);
  }
  for (const panel of ['meshCheck', 'attributes', 'validation', 'paintWeights']) {
    assert.ok(literals('workspace.showPanel', 'panel').has(panel), `workspace.showPanel ${panel}`);
  }
  assert.ok(literals('view.tool', 'panel').has('graph'), 'PANEL members read as literals');
  assert.ok(
    pairs.some((entry) => entry.op.startsWith('autorig.')),
    'Auto-Rig is scanned',
  );
  assert.ok(pairs.some((entry) => entry.op === 'mesh.create.*' && entry.pattern === true));
  for (const entry of unresolved) {
    assert.match(entry.site, site);
    assert.ok(entry.expr.length > 0 && entry.via.length > 0);
  }
  assert.match(summarize(scan), /^\d+ \(operator, argument shape\) pairs, \d+ distinct operators/);
});
