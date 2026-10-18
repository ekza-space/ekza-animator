// M2A-SPEC §5.14 (A4) on Seed-san through the production kernel (real store, AnimX engine with cycle-aware tangents,
// real rig): mirror animation skips the humanoid secondary controls (their rest frames are not world-aligned) with
// a warning naming how many, writes the FK arms half a cycle later exactly at every frame (the FR-POSE-05 gate on
// world-aligned controls), and undoes and redoes exactly.
import { curveEngine } from '@ekza-animator/anim-core';
import type { ChannelId, ControlId, ControlRecord } from '@ekza-animator/doc';
import type { EditorApp } from '@ekza-animator/editor-core';
import { describe, expect, it } from 'vitest';
import {
  BLOCKED,
  expectUndoRedoExact,
  importFixture,
  realApp,
  runOk,
  SIBLINGS_READY,
  setSceneFrame,
} from './ops.support';

const ALIGNED = 1e-9;
const aligned = (control: ControlRecord): boolean => {
  const q = control.restWorld.q;
  return Math.abs(q[0]) < ALIGNED && Math.abs(q[1]) < ALIGNED && Math.abs(q[2]) < ALIGNED;
};

function controlsOf(app: EditorApp): readonly ControlRecord[] {
  const character = app.session.getState().activeCharacter;
  const rig = character === null ? undefined : app.store.query.rigOfCharacter(character);
  return rig === undefined ? [] : app.store.query.controlsOfRig(rig.id);
}

/** Keys `channel` of `control` at (frame, value) pairs through the kernel (forced keys, auto tangents). */
async function key(
  app: EditorApp,
  control: ControlId,
  channel: ChannelId,
  keys: readonly (readonly [number, number])[],
) {
  for (const [frame, value] of keys) {
    setSceneFrame(app, frame);
    await runOk(app, 'channel.setValues', { edits: [{ control, channel, value }], key: 'force' });
  }
}

function curveOf(app: EditorApp, control: ControlId, channel: ChannelId) {
  const state = app.session.getState();
  const character = state.activeCharacter;
  const clip = character === null ? undefined : state.activeClip[character];
  const layer = clip === undefined ? undefined : app.store.query.baseLayer(clip);
  return clip === undefined || layer === undefined
    ? undefined
    : app.store.query.curveFor(clip, layer.id, control, channel);
}

describe.skipIf(!SIBLINGS_READY)(`mirror animation on Seed-san ${BLOCKED}`, { timeout: 120_000 }, () => {
  it('skips the secondary controls with a warning and mirrors the FK arms half a cycle later', async () => {
    const { app, services } = realApp();
    await importFixture(app, 'seed-san.vrm');
    const { clip } = (await runOk(app, 'clip.new', { name: 'walk' })) as { clip: string };
    await runOk(app, 'clip.setSettings', { clip, range: { start: 0, end: 24 }, loop: true });
    const controls = controlsOf(app);
    const byKey = new Map(controls.map((control) => [control.key, control]));
    const secondary = controls.filter((control) => control.group === 'secondary' && control.side === 'L');
    expect(secondary.length).toBeGreaterThan(0);
    // The rule the warning counts: right controls written from a left counterpart, either side not world-aligned.
    const skipped = controls.filter((control) => {
      if (control.side !== 'R' || control.mirror === null) return false;
      const source = controls.find((candidate) => candidate.id === control.mirror);
      return source !== undefined && source.side === 'L' && (!aligned(source) || !aligned(control));
    });
    expect(skipped.length).toBeGreaterThan(0);

    const upper = byKey.get('fk.upperArm.L');
    const upperR = byKey.get('fk.upperArm.R');
    const sec = secondary[0];
    if (upper === undefined || upperR === undefined || sec === undefined) throw new Error('controls missing');
    // A periodic arm swing with auto tangents and no key at 12; a key on a secondary control.
    await key(app, upper.id, 'rx', [
      [0, 0.3],
      [9, -0.4],
      [15, 0.1],
      [24, 0.3],
    ]);
    await key(app, upper.id, 'ry', [
      [0, 0.1],
      [8, 0.25],
      [24, 0.1],
    ]);
    await key(app, sec.id, 'rz', [
      [0, 0.2],
      [24, 0.2],
    ]);

    await expectUndoRedoExact(app, 'pose.mirrorAnimation', { mode: 'leftToRight', offset: 'halfCycle' });
    const warning = services.toasts.map((toast) => toast.text).find((text) => text.includes('secondary'));
    expect(warning).toContain(
      `${skipped.length} secondary control${skipped.length === 1 ? ' was' : 's were'} not mirrored`,
    );
    // The secondary right counterpart got nothing.
    expect(sec.mirror).not.toBeNull();
    expect(curveOf(app, sec.mirror as ControlId, 'rz')).toBeUndefined();
    // The gate: R(s + ((t − s + T/2) mod T)) = mirror(L(t)) at every integer frame, 1e-9.
    for (const [channel, sign] of [
      ['rx', 1],
      ['ry', -1],
    ] as const) {
      const left = curveOf(app, upper.id, channel);
      const right = curveOf(app, upperR.id, channel);
      if (left === undefined || right === undefined) throw new Error(`no ${channel} curves`);
      expect(right).toMatchObject({ pre: 'cycle', post: 'cycle' });
      // Compiled by the editor's engine (cycle-aware tangents on these cyclic curves), evaluated by AnimX.
      const l = app.evaluation.compiledCurve(left.id);
      const r = app.evaluation.compiledCurve(right.id);
      for (let t = 0; t < 24; t++) {
        const lv = curveEngine.evaluate(l, t);
        const rv = curveEngine.evaluate(r, (t + 12) % 24);
        expect([channel, t, rv]).toEqual([channel, t, expect.closeTo(sign * lv, 9)]);
      }
    }
  });
});

// Acceptance fix round 1, bug 6: Polybot's secondary controls pair badly (sec.mixamorig_* against Right*), and a
// whole-character mirror listed every unpaired control in one toast of ~1,000 characters over the panels. Unpaired
// controls are summarised in one short line (count and at most three names), for Mirror Animation and Mirror Pose.
describe.skipIf(!SIBLINGS_READY)(`mirror warnings on Polybot ${BLOCKED}`, { timeout: 120_000 }, () => {
  it('a whole-character mirror warns in one short line', async () => {
    const { app, services } = realApp();
    await importFixture(app, 'polybot.vrm');
    const { clip } = (await runOk(app, 'clip.new', { name: 'walk' })) as { clip: string };
    await runOk(app, 'clip.setSettings', { clip, range: { start: 0, end: 24 }, loop: true });
    const controls = controlsOf(app);
    const unpaired = controls.filter((control) => control.side !== 'C' && control.mirror === null);
    expect(unpaired.length).toBeGreaterThan(3);
    const upper = controls.find((control) => control.key === 'fk.upperArm.L');
    if (upper === undefined) throw new Error('no fk.upperArm.L');
    await key(app, upper.id, 'rx', [
      [0, 0.3],
      [12, -0.3],
      [24, 0.3],
    ]);
    await runOk(app, 'select.controls', { ids: [], mode: 'replace' });
    for (const [operator, args] of [
      ['pose.mirrorAnimation', { mode: 'leftToRight', offset: 'halfCycle' }],
      ['pose.mirrorAnimation', { mode: 'flip' }],
      ['pose.mirror', { mode: 'flip' }],
    ] as const) {
      const before = services.toasts.length;
      await runOk(app, operator, args);
      const warnings = services.toasts.slice(before).filter((toast) => toast.kind === 'warning');
      const text = warnings[0]?.text ?? '';
      expect([operator, warnings.length]).toEqual([operator, 1]);
      expect(`${operator}: ${text}`).toMatch(
        /^[a-zA-Z.]+: \d+ controls have no mirror counterpart and were left unchanged \(/,
      );
      expect([operator, text, text.length <= 240]).toEqual([operator, text, true]);
    }
  });
});
