// Selection operators (MVP-SPEC §4.9 `select.*`): modes and lead, one character at a time, pruning of the key and
// channel selections, panel-dependent select all / none, mirror selection, key parts.
import type { ControlId, KeyId } from '@ekza-animator/doc';
import { describe, expect, it } from 'vitest';
import { registerBuiltinOperators } from '../../src';
import { combine, combineKeys } from '../../src/operators/builtin/select';
import { createFakeEditorApp } from '../../src/testing';
import { SECOND, twoCharacterDoc } from '../kernel/support';
import { humanoidSkeleton, opsApp, runOk, WAVE } from './support';

const R = (key: string) => `${WAVE.rig}:${key}` as ControlId;
const K = (n: number) => WAVE.keys[n] as KeyId;

function controls(app: ReturnType<typeof opsApp>): readonly ControlId[] {
  return app.session.getState().selection.controls;
}

describe('combine (selection modes)', () => {
  it('replace, add, remove and toggle keep the last added id as the lead', () => {
    expect(combine(['a', 'b'], ['c', 'a'], 'replace')).toEqual(['c', 'a']);
    expect(combine(['a', 'b'], ['a', 'c'], 'add')).toEqual(['b', 'a', 'c']);
    expect(combine(['a', 'b', 'c'], ['b'], 'remove')).toEqual(['a', 'c']);
    expect(combine(['a', 'b'], ['b', 'c'], 'toggle')).toEqual(['a', 'c']);
    expect(combine(['a'], ['b', 'b'], 'replace')).toEqual(['b']);
  });

  it('combines key parts by mode', () => {
    const current = new Map([[K(0), { key: true, in: false, out: false }]]);
    expect([...combineKeys(current, [{ key: K(1) }], 'replace')]).toEqual([
      [K(1), { key: true, in: false, out: false }],
    ]);
    expect(combineKeys(current, [{ key: K(0), parts: { out: true } }], 'add').get(K(0))).toEqual({
      key: true,
      in: false,
      out: true,
    });
    expect(combineKeys(current, [{ key: K(0) }], 'remove').has(K(0))).toBe(false);
    expect(combineKeys(current, [{ key: K(0), parts: { key: true, in: true } }], 'toggle').get(K(0))).toEqual({
      key: false,
      in: true,
      out: false,
    });
  });
});

describe('select.controls', () => {
  it('selects by mode and ignores unknown ids', async () => {
    const app = opsApp();
    await runOk(app, 'select.controls', { ids: [R('fk.upperArm.L'), R('nope')], mode: 'replace' });
    expect(controls(app)).toEqual([R('fk.upperArm.L')]);
    await runOk(app, 'select.controls', { ids: [R('fk.hand.L')], mode: 'add' });
    expect(controls(app)).toEqual([R('fk.upperArm.L'), R('fk.hand.L')]);
    await runOk(app, 'select.controls', { ids: [R('fk.upperArm.L')], mode: 'toggle' });
    expect(controls(app)).toEqual([R('fk.hand.L')]);
    await runOk(app, 'select.controls', { ids: [R('fk.hand.L')], mode: 'remove' });
    expect(controls(app)).toEqual([]);
    expect(app.history.canUndo()).toBe(false);
  });

  it("makes another character's controls active and replaces the selection", async () => {
    const app = createFakeEditorApp({ snapshot: twoCharacterDoc(), skeleton: humanoidSkeleton() });
    registerBuiltinOperators(app);
    await runOk(app, 'select.controls', { ids: [WAVE.lowerArmL], mode: 'replace' });
    await runOk(app, 'select.controls', { ids: [SECOND.lowerArmL], mode: 'add' });
    expect(app.session.getState().activeCharacter).toBe(SECOND.character);
    expect(app.session.getState().selection.controls).toEqual([SECOND.lowerArmL]);
    // Removing another character's control changes nothing.
    await runOk(app, 'select.controls', { ids: [WAVE.lowerArmL], mode: 'remove' });
    expect(app.session.getState().activeCharacter).toBe(SECOND.character);
    expect(app.session.getState().selection.controls).toEqual([SECOND.lowerArmL]);
  });

  it('drops selected keys of curves no longer shown and channels of deselected controls', async () => {
    const app = opsApp();
    await runOk(app, 'select.controls', { ids: [WAVE.lowerArmL, WAVE.hips], mode: 'replace' });
    await runOk(app, 'select.keys', { items: [{ key: K(0) }, { key: K(1) }], mode: 'replace' });
    app.session.setState({
      selection: {
        ...app.session.getState().selection,
        channels: [
          { control: WAVE.lowerArmL, channel: 'rz' },
          { control: WAVE.hips, channel: 'rx' },
        ],
      },
    });
    await runOk(app, 'select.controls', { ids: [WAVE.lowerArmL], mode: 'remove' });
    const selection = app.session.getState().selection;
    expect(selection.keys.size).toBe(0);
    expect(selection.channels).toEqual([{ control: WAVE.hips, channel: 'rx' }]);
    // With nothing selected the Graph Editor shows every curve: selected keys stay.
    await runOk(app, 'select.controls', { ids: [], mode: 'replace' });
    await runOk(app, 'select.keys', { items: [{ key: K(2) }], mode: 'replace' });
    await runOk(app, 'select.controls', { ids: [], mode: 'replace' });
    expect([...app.session.getState().selection.keys.keys()]).toEqual([K(2)]);
  });

  it('refuses malformed arguments', async () => {
    const app = opsApp();
    expect((await app.runUntyped('select.controls', { ids: 'x', mode: 'replace' })).status).toBe('cancelled');
    expect((await app.runUntyped('select.controls', { ids: [], mode: 'swap' })).status).toBe('cancelled');
  });
});

describe('select.all / select.none / select.mirror', () => {
  it('selects every visible control of the character in the viewport, all shown keys in the Graph Editor', async () => {
    const app = opsApp();
    app.session.setState({ hiddenControls: new Set([WAVE.cog]) });
    await runOk(app, 'select.all');
    const all = app.store.query.controlsOfRig(WAVE.rig).map((c) => c.id);
    expect(controls(app)).toEqual(all.filter((id) => id !== WAVE.cog));
    // Graph Editor: the keys of the selected controls' curves (all curves when nothing is selected).
    expect(await app.runUntyped('select.all', undefined, { panel: 'graph' })).toMatchObject({ status: 'finished' });
    expect([...app.session.getState().selection.keys.keys()]).toEqual([...WAVE.keys]);
    await runOk(app, 'select.controls', { ids: [WAVE.hips], mode: 'replace' });
    await app.runUntyped('select.all', undefined, { panel: 'graph' });
    expect([...app.session.getState().selection.keys.keys()]).toEqual([]);
    await runOk(app, 'select.controls', { ids: [], mode: 'replace' });
    await app.runUntyped('select.all', undefined, { panel: 'graph' });
    expect([...app.session.getState().selection.keys.keys()]).toEqual([...WAVE.keys]);
  });

  it("clears the panel's selection kind", async () => {
    const app = opsApp();
    await runOk(app, 'select.controls', { ids: [WAVE.lowerArmL], mode: 'replace' });
    await runOk(app, 'select.keys', { items: [{ key: K(0) }], mode: 'replace' });
    app.session.setState({ time: { ...app.session.getState().time, band: { start: 0, end: 2 } } });
    await app.runUntyped('select.none', undefined, { panel: 'timeline' });
    expect(app.session.getState().selection.keys.size).toBe(0);
    expect(app.session.getState().time.band).toBeNull();
    expect(controls(app)).toEqual([WAVE.lowerArmL]);
    await app.runUntyped('select.none', undefined, { panel: 'viewport' });
    expect(controls(app)).toEqual([]);
  });

  it('mirrors the selection; centre controls stay', async () => {
    const app = opsApp();
    await runOk(app, 'select.controls', { ids: [R('fk.upperArm.L'), WAVE.hips, R('fk.hand.R')], mode: 'replace' });
    await runOk(app, 'select.mirror');
    expect(controls(app)).toEqual([R('fk.upperArm.R'), WAVE.hips, R('fk.hand.L')]);
    await runOk(app, 'select.none');
    expect((await app.runUntyped('select.mirror')).status).toBe('cancelled');
  });
});

describe('select.keys / select.channels', () => {
  it('selects keys and handles; missing keys are ignored', async () => {
    const app = opsApp();
    await runOk(app, 'select.keys', {
      items: [{ key: K(1), parts: { in: true } }, { key: 'k_missing0000' }],
      mode: 'replace',
    });
    expect([...app.session.getState().selection.keys]).toEqual([[K(1), { key: false, in: true, out: false }]]);
  });

  it('selects channel refs by mode', async () => {
    const app = opsApp();
    await runOk(app, 'select.channels', { refs: [{ control: WAVE.lowerArmL, channel: 'rz' }], mode: 'replace' });
    await runOk(app, 'select.channels', { refs: [{ control: WAVE.lowerArmL, channel: 'rx' }], mode: 'add' });
    expect(app.session.getState().selection.channels).toEqual([
      { control: WAVE.lowerArmL, channel: 'rz' },
      { control: WAVE.lowerArmL, channel: 'rx' },
    ]);
    await runOk(app, 'select.channels', { refs: [{ control: WAVE.lowerArmL, channel: 'rz' }], mode: 'toggle' });
    expect(app.session.getState().selection.channels).toEqual([{ control: WAVE.lowerArmL, channel: 'rx' }]);
  });
});
