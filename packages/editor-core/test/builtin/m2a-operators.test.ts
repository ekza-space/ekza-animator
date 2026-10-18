// M2A-SPEC §3 rule 1–2, §4.9, §6, §7 (A0): every new operator resolves and poll-fails cleanly, the keymap carries
// every §6 row, the menus the §7 items, `view.tool` accepts the Dope Sheet and the Graph scale tool, and the key
// panels of select/edit include the Dope Sheet.
import { describe, expect, it } from 'vitest';
import { BUILTIN_MENU_ITEMS, MAYA_KEYMAP } from '../../src';
import { BUILTIN_OPERATORS } from '../../src/operators/builtin';
import { NOT_AVAILABLE_YET } from '../../src/operators/builtin/stub';
import type { Chord, KeyBinding } from '../../src/types';
import { opsApp, runOk, runResult, WAVE } from './support';

/** Every M2a operator the built-ins register, with arguments that would be valid once implemented. */
const M2A_STUB_RUNS: readonly (readonly [string, unknown])[] = [
  ['rig.addLimbIk', undefined],
  ['rig.ikFk.switch', { limb: 'leg.L', to: 'fk' }],
  ['rig.ikFk.match', { limb: 'arm.R', side: 'ik' }],
  ['rig.ikFk.matchRange', { limb: 'leg.R', side: 'fk' }],
  ['rig.setFootParams', { limb: 'leg.L', params: { heelBack: 0.05 } }],
  ['select.pickWalk', { direction: 'up' }],
  ['key.setTarget', { target: 'bodyPart' }],
  ['key.toggleRipple', undefined],
  ['key.tween', { mode: 'tween', amount: 50 }],
  ['key.convert', { to: 'breakdown' }],
  ['pose.mirrorAnimation', { mode: 'leftToRight', offset: 'halfCycle' }],
  ['time.insertTime', { at: 10, frames: 1 }],
  ['time.insertTime', { frames: -1 }],
  ['time.deleteTime', undefined],
  ['time.deleteTime', { range: { start: 4, end: 6 }, target: 'character' }],
  ['graph.keys.copyTo', { dFrames: 4 }],
  ['graph.buffer.snapshot', undefined],
  ['graph.buffer.swap', undefined],
  ['graph.buffer.clear', undefined],
  ['file.recover', { slot: 'as_0000000000000000' }],
  ['file.discardRecovery', { slot: 'as_0000000000000000' }],
  ['file.autosaveNow', undefined],
];

describe('M2a operator stubs (§3 rule 1)', () => {
  it('resolve and poll-fail with "not available yet"', async () => {
    const app = opsApp();
    for (const [id, args] of M2A_STUB_RUNS) {
      expect([id, app.operators.get(id) !== undefined]).toEqual([id, true]);
      expect([id, app.operators.poll(id, {}, args)]).toEqual([id, { ok: false, reason: NOT_AVAILABLE_YET }]);
      const result = await runResult(app, id, args);
      expect([id, result]).toEqual([id, { status: 'cancelled', reason: NOT_AVAILABLE_YET }]);
    }
    expect(app.history.canUndo()).toBe(false);
  });

  it('are listed with the other built-ins', () => {
    const ids = new Set<string>(BUILTIN_OPERATORS.map((def) => def.id));
    for (const [id] of M2A_STUB_RUNS) expect([id, ids.has(id)]).toEqual([id, true]);
  });

  it('key.set refuses body-part targets and breakdown keys until A2 lands them', async () => {
    const app = opsApp();
    app.session.setState({ selection: { ...app.session.getState().selection, controls: [WAVE.handL] } });
    const breakdown = await runResult(app, 'key.set', { breakdown: true });
    expect(breakdown).toEqual({ status: 'cancelled', reason: 'Breakdown keys are not available yet' });
    const part = await runResult(app, 'key.set', { target: 'bodyPart' });
    expect(part).toEqual({ status: 'cancelled', reason: 'Keying by body part is not available yet' });
    expect((await runResult(app, 'key.set', { channels: 'rotate' })).status).toBe('finished');
  });
});

describe('view.tool widening (§4.5)', () => {
  it('accepts the Dope Sheet tools and the Graph Editor scale tool, and writes tools.dopeSheet', async () => {
    const app = opsApp();
    await runOk(app, 'view.tool', { panel: 'dopeSheet', tool: 'move' });
    expect(app.session.getState().tools.dopeSheet).toBe('move');
    await runOk(app, 'view.tool', { panel: 'dopeSheet', tool: 'scale' });
    expect(app.session.getState().tools.dopeSheet).toBe('scale');
    expect((await runResult(app, 'view.tool', { panel: 'dopeSheet', tool: 'insert' })).status).toBe('cancelled');
    await runOk(app, 'view.tool', { panel: 'graph', tool: 'scale' });
    expect(app.session.getState().tools).toMatchObject({ graph: 'scale', viewport: 'select' });
    // Registered Dope Sheet tools decide, as for the other panels.
    app.tools.register({ id: 'select', panel: 'dopeSheet', label: 'Select', create: () => ({}) });
    expect((await runResult(app, 'view.tool', { panel: 'dopeSheet', tool: 'move' })).status).toBe('cancelled');
    expect((await runResult(app, 'view.tool', { panel: 'dopeSheet', tool: 'select' })).status).toBe('finished');
  });

  it('with the M1 Graph Editor tools registered, the unregistered scale tool is "not available yet" (§3 rule 1)', async () => {
    const app = opsApp();
    for (const id of ['select', 'move', 'insert']) {
      app.tools.register({ id, panel: 'graph', label: id, create: () => ({}) });
    }
    expect(await runResult(app, 'view.tool', { panel: 'graph', tool: 'scale' })).toEqual({
      status: 'cancelled',
      reason: NOT_AVAILABLE_YET,
    });
    expect(await runResult(app, 'view.tool', { panel: 'graph', tool: 'lasso' })).toEqual({
      status: 'cancelled',
      reason: "Unknown graph tool 'lasso'",
    });
    await runOk(app, 'view.tool', { panel: 'graph', tool: 'insert' });
    expect(app.session.getState().tools.graph).toBe('insert');
    // The owner registers it (A4): the same chord then switches the tool.
    app.tools.register({ id: 'scale', panel: 'graph', label: 'Scale', create: () => ({}) });
    await runOk(app, 'view.tool', { panel: 'graph', tool: 'scale' });
    expect(app.session.getState().tools.graph).toBe('scale');
    // The Dope Sheet's tools follow the same rule once any of them registers.
    app.tools.register({ id: 'select', panel: 'dopeSheet', label: 'Select', create: () => ({}) });
    expect(await runResult(app, 'view.tool', { panel: 'dopeSheet', tool: 'scale' })).toEqual({
      status: 'cancelled',
      reason: NOT_AVAILABLE_YET,
    });
    // The viewport has no M2a tools: an unregistered id stays unknown.
    app.tools.register({ id: 'select', panel: 'viewport', label: 'Select', create: () => ({}) });
    expect((await runResult(app, 'view.tool', { panel: 'viewport', tool: 'scale' })).status).toBe('cancelled');
  });
});

describe('the Dope Sheet is a key panel of select and edit (§5.10)', () => {
  it('select.all and select.none act on keys in the Dope Sheet', async () => {
    const app = opsApp();
    expect((await app.runUntyped('select.all', undefined, { panel: 'dopeSheet' })).status).toBe('finished');
    expect([...app.session.getState().selection.keys.keys()].sort()).toEqual([...WAVE.keys].sort());
    expect(app.session.getState().selection.controls).toEqual([]);
    expect((await app.runUntyped('select.none', undefined, { panel: 'dopeSheet' })).status).toBe('finished');
    expect(app.session.getState().selection.keys.size).toBe(0);
  });

  it('edit.copy and edit.delete forward to the key operators in the Dope Sheet', async () => {
    const app = opsApp();
    await app.runUntyped('select.keys', { items: [{ key: WAVE.keys[0] }], mode: 'replace' });
    expect((await app.runUntyped('edit.copy', undefined, { panel: 'dopeSheet' })).status).toBe('finished');
    expect((await app.runUntyped('edit.delete', undefined, { panel: 'dopeSheet' })).status).toBe('finished');
    const ids = app.calls.map((call) => call.id);
    expect(ids).toContain('graph.keys.copy');
    expect(ids).toContain('graph.keys.delete');
    expect(app.store.get('keys', WAVE.keys[0])).toBeUndefined();
  });
});

describe('keymap (§6)', () => {
  const has = (chord: Chord, op: string, scope: string, args: unknown): boolean =>
    MAYA_KEYMAP.some(
      (binding: KeyBinding) =>
        binding.op === op &&
        binding.scope === scope &&
        binding.chord.code === chord.code &&
        (binding.chord.shift ?? false) === (chord.shift ?? false) &&
        (binding.chord.alt ?? false) === (chord.alt ?? false) &&
        (binding.chord.mod ?? false) === (chord.mod ?? false) &&
        JSON.stringify(binding.args) === JSON.stringify(args),
    );
  const rows: (readonly [Chord, string, readonly string[], unknown])[] = [
    ...(['up', 'down', 'left', 'right'] as const).flatMap((direction) => {
      const code = `Arrow${direction.charAt(0).toUpperCase()}${direction.slice(1)}`;
      return [
        [{ code }, 'select.pickWalk', ['viewport', 'channelBox'], { direction }] as const,
        [{ code, shift: true }, 'select.pickWalk', ['viewport', 'channelBox'], { direction, add: true }] as const,
      ];
    }),
    [{ code: 'ArrowLeft' }, 'graph.keys.move', ['graph', 'dopeSheet', 'timeline'], { dFrames: -1, dValue: 0 }],
    [{ code: 'ArrowRight' }, 'graph.keys.move', ['graph', 'dopeSheet', 'timeline'], { dFrames: 1, dValue: 0 }],
    [
      { code: 'KeyS', alt: true },
      'key.set',
      ['viewport', 'outliner', 'channelBox', 'timeline', 'dopeSheet'],
      { breakdown: true },
    ],
    [{ code: 'KeyQ' }, 'view.tool', ['dopeSheet'], { panel: 'dopeSheet', tool: 'select' }],
    [{ code: 'KeyW' }, 'view.tool', ['dopeSheet'], { panel: 'dopeSheet', tool: 'move' }],
    [{ code: 'KeyR' }, 'view.tool', ['dopeSheet'], { panel: 'dopeSheet', tool: 'scale' }],
    [{ code: 'KeyR' }, 'view.tool', ['graph'], { panel: 'graph', tool: 'scale' }],
    [{ code: 'KeyN' }, 'graph.view.setMode', ['graph'], { mode: 'toggleNormalized' }],
    [{ code: 'KeyN', shift: true }, 'graph.view.setMode', ['graph'], { mode: 'toggleStacked' }],
    [{ code: 'KeyS' }, 'key.set', ['dopeSheet'], { channels: 'all' }],
    [{ code: 'Delete' }, 'graph.keys.delete', ['dopeSheet'], undefined],
    [{ code: 'Backspace' }, 'graph.keys.delete', ['dopeSheet'], undefined],
    [{ code: 'KeyC', mod: true }, 'graph.keys.copy', ['dopeSheet'], undefined],
    [{ code: 'KeyV', mod: true }, 'graph.keys.paste', ['dopeSheet'], undefined],
    [{ code: 'KeyA', mod: true }, 'select.all', ['dopeSheet'], undefined],
    ...(['auto', 'spline', 'clamped', 'linear', 'flat', 'step', 'plateau'] as const).map(
      (type, i) => [{ code: `Digit${i + 1}` }, 'graph.tangent.set', ['dopeSheet'], { type }] as const,
    ),
    [{ code: 'KeyF' }, 'dopeSheet.frame', ['dopeSheet'], { what: 'selection' }],
    [{ code: 'KeyA' }, 'dopeSheet.frame', ['dopeSheet'], { what: 'all' }],
  ];

  it('includes every §6 row', () => {
    for (const [chord, op, scopes, args] of rows) {
      for (const scope of scopes) {
        expect([op, scope, chord, has(chord, op, scope, args)]).toEqual([op, scope, chord, true]);
      }
    }
  });

  it('resolves the Dope Sheet scope before global and keeps M1 bindings', () => {
    const app = opsApp();
    const input = (code: string, mods: { shift?: boolean; alt?: boolean } = {}) => ({
      code,
      ctrlKey: false,
      metaKey: false,
      shiftKey: mods.shift ?? false,
      altKey: mods.alt ?? false,
      repeat: false,
    });
    expect(app.keymap.resolve(input('KeyR'), ['dopeSheet', 'global'], 'press')?.args).toEqual({
      panel: 'dopeSheet',
      tool: 'scale',
    });
    expect(app.keymap.resolve(input('KeyS', { alt: true }), ['viewport', 'global'], 'press')?.args).toEqual({
      breakdown: true,
    });
    expect(app.keymap.resolve(input('KeyS'), ['viewport', 'global'], 'press')?.args).toEqual({ channels: 'all' });
    expect(app.keymap.resolve(input('ArrowUp'), ['outliner', 'global'], 'press')).toBeNull();
    expect(app.keymap.resolve(input('KeyW'), ['graph', 'global'], 'press')?.args).toEqual({
      panel: 'graph',
      tool: 'move',
    });
  });
});

describe('menus (§7)', () => {
  const find = (menu: string, op: string, args?: unknown) =>
    BUILTIN_MENU_ITEMS.find(
      (item) => item.menu === menu && item.op === op && JSON.stringify(item.args) === JSON.stringify(args),
    );

  it('carry the M2a items', () => {
    expect(find('key', 'key.set', { breakdown: true })?.label).toBe('Set Breakdown');
    expect(find('key', 'key.convert', { to: 'breakdown' })?.label).toBe('Convert to Breakdown');
    expect(find('key', 'key.convert', { to: 'key' })?.label).toBe('Convert to Key');
    expect(find('key', 'key.toggleRipple')?.label).toBe('Ripple Edit');
    for (const mode of ['tween', 'neighbor', 'ease', 'pushPull', 'toDefault']) {
      expect(find('key.tween', 'key.tween', { mode, amount: -50 })).toBeDefined();
      expect(find('key.tween', 'key.tween', { mode, amount: 50 })).toBeDefined();
    }
    for (const target of ['selected', 'bodyPart', 'character']) {
      expect(find('key.key-target', 'key.setTarget', { target })).toBeDefined();
    }
    for (const mode of ['flip', 'leftToRight', 'rightToLeft']) {
      expect(find('pose.mirror-animation', 'pose.mirrorAnimation', { mode, offset: 'none' })).toBeDefined();
      expect(find('pose.mirror-animation', 'pose.mirrorAnimation', { mode, offset: 'halfCycle' })).toBeDefined();
    }
    expect(find('rig', 'rig.addLimbIk')?.label).toBe('Add Limb IK');
    for (const limb of ['leg.L', 'leg.R', 'arm.L', 'arm.R']) {
      expect(find('rig.ik-fk', 'rig.ikFk.switch', { limb, to: 'ik' })).toBeDefined();
      expect(find('rig.ik-fk', 'rig.ikFk.switch', { limb, to: 'fk' })).toBeDefined();
      expect(find('rig.ik-fk', 'rig.ikFk.match', { limb, side: 'fk' })).toBeDefined();
      expect(find('rig.ik-fk', 'rig.ikFk.match', { limb, side: 'ik' })).toBeDefined();
      expect(find('rig.ik-fk', 'rig.ikFk.matchRange', { limb, side: 'fk' })).toBeDefined();
      expect(find('rig.ik-fk', 'rig.ikFk.matchRange', { limb, side: 'ik' })).toBeDefined();
    }
    expect(find('time', 'time.insertTime', { frames: 1 })?.label).toBe('Insert Frame');
    expect(find('time', 'time.insertTime', { frames: -1 })?.label).toBe('Remove Frame');
    expect(find('time', 'time.deleteTime')?.label).toBe('Delete Time');
    // The menu-bar items carry no frame: `at` and `range` default to the current frame and the band (§5.9).
    for (const item of BUILTIN_MENU_ITEMS.filter((candidate) => candidate.menu === 'time')) {
      expect([item.label, item.args !== undefined && Object.hasOwn(item.args as object, 'at')]).toEqual([
        item.label,
        false,
      ]);
    }
    for (const op of ['graph.buffer.snapshot', 'graph.buffer.swap', 'graph.buffer.clear']) {
      expect(find('graph.buffer', op)).toBeDefined();
    }
    for (const mode of ['absolute', 'normalized', 'stacked']) {
      expect(find('graph.view', 'graph.view.setMode', { mode })).toBeDefined();
    }
    expect(find('file', 'file.autosaveNow')?.label).toBe('Save Recovery Point');
  });
});
