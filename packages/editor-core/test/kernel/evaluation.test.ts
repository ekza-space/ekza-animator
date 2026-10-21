import { quatAngle, quatFromAxisAngle, type ReadonlyQuat } from '@ekza-studio/anim-core';
import type { CharacterId, ControlId, ClipRecord, KeyRecord } from '@ekza-studio/doc';
import { HUMAN_BONE_NAMES } from '@ekza-studio/rig';
import { describe, expect, it } from 'vitest';
import { activeClip, activeClipFrame, activeRuntime, applyChannelEdits, ensureCurve } from '../../src';
import { createFakeEditorApp } from '../../src/testing';
import { DEG, edit, kernelApp, SECOND, setFrame, twoCharacterDoc, W, waveApp, waveDoc } from './support';

const LOWER_ARM = HUMAN_BONE_NAMES.indexOf('leftLowerArm');
const humanRotation = (pose: { readonly humanLocal: Float64Array }, bone: number): ReadonlyQuat =>
  Array.from(pose.humanLocal.subarray(bone * 4, bone * 4 + 4)) as unknown as ReadonlyQuat;

describe('evaluation service', () => {
  it('reports the six channel states', () => {
    const app = waveApp();
    const state = (control: ControlId, channel: 'tx' | 'rx' | 'rz' | 'ry' | '@x') =>
      app.evaluation.channelState(control, channel);
    expect(state(W.lowerArmL, 'rz')).toBe('keyed-on-frame');
    setFrame(app, 4);
    expect(state(W.lowerArmL, 'rz')).toBe('keyed');
    expect(state(W.lowerArmL, 'rx')).toBe('static');
    edit(app, 'Curve', (tx) => ensureCurve(app, tx, W.clip, W.lowerArmL, 'ry'));
    expect(state(W.lowerArmL, 'ry')).toBe('static');
    expect(state(W.lowerArmL, 'tx')).toBe('non-keyable');
    expect(state(W.lowerArmL, '@x')).toBe('non-keyable');
    expect(state('rig_X:missing' as ControlId, 'rz')).toBe('non-keyable');
    app.session.setState({ overrides: new Map([[W.lowerArmL, { rz: 0.5 }]]) });
    expect(state(W.lowerArmL, 'rz')).toBe('changed');
    edit(app, 'Lock', (tx) =>
      tx.patch('controls', W.lowerArmL, {
        locked: { t: [false, false, false], r: [false, false, true], s: [false, false, false] },
      }),
    );
    expect(state(W.lowerArmL, 'rz')).toBe('locked');
  });

  it('reads channel values as curves ⊕ static values ⊕ overrides at the clip frame', () => {
    const app = waveApp();
    edit(app, 'Static', (tx) => {
      const curve = ensureCurve(app, tx, W.clip, W.lowerArmL, 'rx');
      tx.patch('curves', curve, { staticValue: 0.2 });
    });
    setFrame(app, 15);
    const values = app.evaluation.channelValues(W.lowerArmL);
    expect(values.rz).toBeCloseTo(-30 * DEG, 12);
    expect({ ...values, rz: 0 }).toEqual({ tx: 0, ty: 0, tz: 0, rx: 0.2, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1 });
    app.session.setState({ overrides: new Map([[W.lowerArmL, { rz: 0.1, ry: 0.3 }]]) });
    expect(app.evaluation.channelValues(W.lowerArmL)).toMatchObject({ rx: 0.2, ry: 0.3, rz: 0.1 });
    // Without an active clip only defaults and overrides remain (switching clips drops the old overrides);
    // unknown controls read as defaults.
    app.session.setState({ activeClip: {} });
    expect(app.session.getState().overrides.size).toBe(0);
    app.session.setState({ overrides: new Map([[W.lowerArmL, { rz: 0.1, ry: 0.3 }]]) });
    expect(app.evaluation.channelValues(W.lowerArmL)).toMatchObject({ rx: 0, ry: 0.3, rz: 0.1 });
    expect(app.evaluation.clipFrame(W.character)).toBeNull();
    expect(app.evaluation.channelValues('rig_X:missing' as ControlId)).toMatchObject({ rz: 0, sx: 1 });
  });

  it('evaluates once per change: frames, active-clip edits and overrides re-evaluate, other edits do not', () => {
    const app = waveApp();
    const events: { poseVersion: number; characters: readonly CharacterId[] }[] = [];
    app.evaluation.subscribe((e) => events.push({ poseVersion: e.poseVersion, characters: [...e.characters] }));
    expect(app.evaluation.tick()).toBe(true);
    expect(app.evaluation.tick()).toBe(false);
    setFrame(app, 15);
    expect(app.evaluation.tick()).toBe(true);
    const runtime = activeRuntime(app);
    expect(
      quatAngle(
        humanRotation(runtime?.pose ?? { humanLocal: new Float64Array(220) }, LOWER_ARM),
        quatFromAxisAngle([0, 0, 1], -30 * DEG),
      ),
    ).toBeLessThan(1e-9);
    edit(app, 'Key', (tx) => tx.patch('keys', W.keys[1], { v: -40 * DEG }));
    expect(app.evaluation.tick()).toBe(true);
    // A clip that is not active is edited: nothing to evaluate.
    edit(app, 'Other Clip', (tx) =>
      tx.put('clips', {
        ...(tx.get('clips', W.clip) as ClipRecord),
        id: 'clp_OtherClip0000001' as ClipRecord['id'],
        name: 'b',
        order: 'a1',
      }),
    );
    expect(app.evaluation.tick()).toBe(false);
    app.session.setState({ overrides: new Map([[W.lowerArmL, { rz: 0.5 }]]) });
    expect(app.evaluation.tick()).toBe(true);
    expect(
      quatAngle(
        humanRotation(runtime?.pose ?? { humanLocal: new Float64Array(220) }, LOWER_ARM),
        quatFromAxisAngle([0, 0, 1], 0.5),
      ),
    ).toBeLessThan(1e-9);
    expect(events.map((e) => e.poseVersion)).toEqual([1, 2, 3, 4]);
    expect(events.every((e) => e.characters.length === 1 && e.characters[0] === W.character)).toBe(true);
    expect(app.evaluation.poseVersion).toBe(4);
  });

  it('does not re-evaluate when the clip frame stays (held end pose of a non-looping clip)', () => {
    const app = waveApp();
    edit(app, 'Once', (tx) => tx.patch('clips', W.clip, { loop: false }));
    setFrame(app, 40);
    app.evaluation.tick();
    setFrame(app, 50);
    expect(app.evaluation.clipFrame(W.character)).toBe(30);
    expect(app.evaluation.tick()).toBe(false);
  });

  it("maps the scene clock to each character's clip frame (24 fps, sceneStart 6; §4.11.8)", () => {
    const app = kernelApp({
      snapshot: twoCharacterDoc({
        first: { fps: { num: 24, den: 1 }, range: { start: 0, end: 48 } },
        second: { sceneStart: 6, range: { start: 0, end: 48 } },
      }),
    });
    setFrame(app, 30);
    expect(app.evaluation.clipFrame(W.character)).toBe(24);
    expect(app.evaluation.clipFrame(SECOND.character)).toBe(24);
    app.session.setState({ activeCharacter: SECOND.character });
    expect(app.session.getState().time.sceneFrame).toBe(30);
    expect(activeClipFrame(app)).toBe(24);
    expect(activeClip(app)?.id).toBe(SECOND.clip);
    expect(app.evaluation.tick()).toBe(true);
    expect(app.characters.list().map((r) => r.id)).toEqual([W.character, SECOND.character]);
  });

  it('wraps looping clips into [start, end) and holds non-looping ones', () => {
    const app = waveApp();
    setFrame(app, 45);
    expect(app.evaluation.clipFrame(W.character)).toBe(15);
    expect(app.evaluation.channelValues(W.lowerArmL).rz).toBeCloseTo(-30 * DEG, 12);
    edit(app, 'Once', (tx) => tx.patch('clips', W.clip, { loop: false }));
    expect(app.evaluation.clipFrame(W.character)).toBe(30);
    setFrame(app, -5);
    expect(app.evaluation.clipFrame(W.character)).toBe(0);
  });

  it('evaluateAt writes a caller buffer without touching the runtime pose; overrides on request', () => {
    const app = waveApp();
    app.evaluation.tick();
    const runtime = activeRuntime(app);
    if (runtime === null) throw new Error('no runtime');
    const shown = Float64Array.from(runtime.pose.boneWorld);
    const out = runtime.program.allocPose();
    app.evaluation.evaluateAt(W.character, W.clip, 15, out);
    expect(quatAngle(humanRotation(out, LOWER_ARM), quatFromAxisAngle([0, 0, 1], -30 * DEG))).toBeLessThan(1e-9);
    expect(runtime.pose.boneWorld).toEqual(shown);
    app.session.setState({ overrides: new Map([[W.lowerArmL, { rz: 0.25 }]]) });
    app.evaluation.evaluateAt(W.character, W.clip, 15, out);
    expect(quatAngle(humanRotation(out, LOWER_ARM), quatFromAxisAngle([0, 0, 1], -30 * DEG))).toBeLessThan(1e-9);
    app.evaluation.evaluateAt(W.character, W.clip, 15, out, { withOverrides: true });
    expect(quatAngle(humanRotation(out, LOWER_ARM), quatFromAxisAngle([0, 0, 1], 0.25))).toBeLessThan(1e-9);
    const bare = createFakeEditorApp({ snapshot: waveDoc() });
    expect(() => bare.evaluation.evaluateAt(W.character, W.clip, 0, out)).toThrow(
      expect.objectContaining({ code: 'unsupported' }),
    );
  });

  it('serves compiled curves that follow edits and preview overlays', () => {
    const app = waveApp();
    expect(app.evaluation.compiledCurve(W.curve).keyCount).toBe(3);
    const preview = app.store.beginPreview('Drag');
    preview.update((tx) => tx.put('keys', { ...(tx.get('keys', W.keys[1]) as KeyRecord), v: 0 }));
    setFrame(app, 15);
    expect(app.evaluation.channelValues(W.lowerArmL).rz).toBe(0);
    expect(app.evaluation.tick()).toBe(true);
    preview.cancel();
    expect(app.evaluation.channelValues(W.lowerArmL).rz).toBeCloseTo(-30 * DEG, 12);
    expect(app.evaluation.tick()).toBe(true);
    edit(app, 'Add', (tx) =>
      applyChannelEdits(app, tx, [{ control: W.lowerArmL, channel: 'rz', value: 0 }], { key: 'force' }),
    );
    setFrame(app, 20);
    edit(app, 'Add', (tx) =>
      applyChannelEdits(app, tx, [{ control: W.lowerArmL, channel: 'rz', value: 0 }], { key: 'force' }),
    );
    expect(app.evaluation.compiledCurve(W.curve).keyCount).toBe(4);
  });
});
