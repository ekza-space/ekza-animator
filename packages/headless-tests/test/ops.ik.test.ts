// ops.* (M2A-SPEC §5.5–§5.8, §5.19, A2): the IK editor operators on the real kernel, rig and fixtures — visibility
// and body parts on IK rigs, Add Limb IK on an M1 rig (pose unchanged bit for bit, undo exact), the seamless switch
// (keys and pose at f − 1 and f), match round trips and the hyperextension warning, match range, Plant Feet on IK
// legs, keying and reset with limb attributes, foot pivots. Needs A1's limb IK (merged; the gate became a failure).
import { mat4Decompose, quatAngle } from '@ekza-animator/anim-core';
import type { ChannelId, CharacterId, ControlId } from '@ekza-animator/doc';
import { controlVisibility, type EditorApp, keyTargetControls } from '@ekza-animator/editor-core';
import { describe, expect, it } from 'vitest';
import {
  BLOCKED,
  docJson,
  expectUndoRedoExact,
  importFixture,
  realApp,
  runOk,
  SIBLINGS_READY,
  setSceneFrame,
} from './ops.support';

const DEG = Math.PI / 180;

function controlOf(app: EditorApp, character: CharacterId, key: string): ControlId {
  const rig = app.store.query.rigOfCharacter(character);
  const control = rig === undefined ? undefined : app.store.query.controlByKey(rig.id, key);
  if (control === undefined) throw new Error(`no control ${key}`);
  return control.id;
}

function select(
  app: EditorApp,
  ids: readonly ControlId[],
  channels: readonly { control: ControlId; channel: ChannelId }[] = [],
) {
  app.session.setState({ selection: { ...app.session.getState().selection, controls: ids, channels } });
}

/** World (t, q) of a humanoid bone at the current frame with overrides, or at a clip frame. */
function boneWorld(app: EditorApp, character: CharacterId, bone: string, clipFrame?: number) {
  const runtime = app.characters.get(character);
  if (runtime === undefined) throw new Error('no runtime');
  const node = (runtime.skeleton.humanoid as Record<string, number> | null)?.[bone];
  if (node === undefined) throw new Error(`no bone ${bone}`);
  const clip = app.session.getState().activeClip[character];
  const pose = runtime.program.allocPose();
  const frame = clipFrame ?? app.evaluation.clipFrame(character) ?? 0;
  app.evaluation.evaluateAt(character, clip as never, frame, pose, { withOverrides: clipFrame === undefined });
  return mat4Decompose(pose.boneWorld.slice(node * 16, node * 16 + 16));
}

function expectSameWorld(
  a: ReturnType<typeof boneWorld>,
  b: ReturnType<typeof boneWorld>,
  tolerance: number,
  what: string,
) {
  const d = Math.hypot(a.t[0] - b.t[0], a.t[1] - b.t[1], a.t[2] - b.t[2]);
  expect(d, `${what} position`).toBeLessThanOrEqual(tolerance);
  expect(quatAngle(a.q, b.q), `${what} rotation`).toBeLessThanOrEqual(tolerance);
}

const LEG = ['leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'leftToes'] as const;

function keysOf(app: EditorApp, control: ControlId, channel: ChannelId) {
  const character = app.session.getState().activeCharacter as CharacterId;
  const clip = app.session.getState().activeClip[character];
  const layer = clip === undefined ? undefined : app.store.query.baseLayer(clip);
  const curve =
    clip === undefined || layer === undefined ? undefined : app.store.query.curveFor(clip, layer.id, control, channel);
  return curve === undefined
    ? []
    : app.store.query.keysOfCurve(curve.id).map((key) => ({ t: key.t, v: key.v, outType: key.outType }));
}

describe.skipIf(!SIBLINGS_READY)(`IK editor operators on the fixtures ${BLOCKED}`, { timeout: 120_000 }, () => {
  it('a default Seed-san has four limbs (legs IK, arms FK); visibility and body parts follow (§5.5, §5.19)', async () => {
    const { app } = realApp();
    const san = await importFixture(app, 'seed-san.vrm');
    await runOk(app, 'clip.new', { name: 'ik' });
    const runtime = app.characters.get(san.character);
    expect(runtime?.program.limbs.map((limb) => limb.id).sort()).toEqual(['arm.L', 'arm.R', 'leg.L', 'leg.R']);
    expect(app.evaluation.ikFk(san.character, 'leg.L')).toBe(1);
    expect(app.evaluation.ikFk(san.character, 'arm.R')).toBe(0);
    const c = (key: string) => controlOf(app, san.character, key);
    expect(controlVisibility(app, c('fk.upperLeg.L'))).toBe('hidden');
    expect(controlVisibility(app, c('fk.toes.L'))).toBe('visible');
    expect(controlVisibility(app, c('ik.leg.L'))).toBe('visible');
    expect(controlVisibility(app, c('ik.arm.L'))).toBe('hidden');
    select(app, [c('fk.hand.L')]);
    expect(new Set(keyTargetControls(app, 'bodyPart'))).toEqual(
      new Set(['fk.shoulder.L', 'fk.upperArm.L', 'fk.lowerArm.L', 'fk.hand.L', 'ik.arm.L', 'pole.arm.L'].map(c)),
    );
    // S on the IK foot keys t, r and the five pose attributes, never @ikFk or @soft (§5.1 rule 4).
    select(app, [c('ik.leg.L')]);
    await runOk(app, 'key.set');
    const clip = app.session.getState().activeClip[san.character];
    const keyed = app.store.query
      .curvesOfClip(clip as never)
      .filter((curve) => curve.control === c('ik.leg.L') && app.store.query.keysOfCurve(curve.id).length > 0)
      .map((curve) => curve.channel)
      .sort();
    expect(keyed).toEqual(['@bank', '@heelTwist', '@roll', '@toeTwist', '@twist', 'rx', 'ry', 'rz', 'tx', 'ty', 'tz']);
  });

  it('rig.addLimbIk on an M1 rig: four FK limbs, the pose unchanged bit for bit at every frame, undo exact', async () => {
    const { app, services } = realApp();
    app.prefs.setState({ autoRigIk: { legs: false, arms: false } });
    const bot = await importFixture(app, 'polybot.vrm');
    await runOk(app, 'clip.new', { name: 'walk' });
    const upper = controlOf(app, bot.character, 'fk.upperLeg.L');
    for (const [frame, degrees] of [
      [0, 0],
      [10, 30],
    ] as const) {
      setSceneFrame(app, frame);
      await runOk(app, 'channel.setValues', {
        edits: [{ control: upper, channel: 'rx', value: degrees * DEG }],
        key: 'force',
      });
    }
    expect(app.characters.get(bot.character)?.program.limbs).toEqual([]);
    const locals = (): Float64Array[] =>
      [0, 5, 10].map((frame) => {
        const runtime = app.characters.get(bot.character);
        if (runtime === undefined) throw new Error('no runtime');
        const pose = runtime.program.allocPose();
        const clip = app.session.getState().activeClip[bot.character];
        app.evaluation.evaluateAt(bot.character, clip as never, frame, pose);
        return pose.boneLocal.slice();
      });
    const before = locals();
    app.prefs.setState({ autoRigIk: { legs: true, arms: true } });
    const value = (await expectUndoRedoExact(app, 'rig.addLimbIk')) as { added: string[] };
    expect([...value.added].sort()).toEqual(['arm.L', 'arm.R', 'leg.L', 'leg.R']);
    const runtime = app.characters.get(bot.character);
    expect(runtime?.program.limbs).toHaveLength(4);
    for (const limb of ['leg.L', 'leg.R', 'arm.L', 'arm.R'] as const)
      expect(app.evaluation.ikFk(bot.character, limb)).toBe(0);
    const after = locals();
    after.forEach((frame, i) => expect([i, Array.from(frame)]).toEqual([i, Array.from(before[i] as Float64Array)]));
    expect(controlVisibility(app, upper)).toBe('visible');
    expect((await app.runUntyped('rig.addLimbIk')).status).toBe('cancelled');
    expect(services.toasts.filter((toast) => toast.kind === 'error')).toEqual([]);
  });

  // Acceptance fix round 1, bug 4: the seamless switch inserts its f − 1 hold keys shape-preserving; on flat spans
  // their in-handles were −0, which a JSON round trip (autosave and recovery, save and open) turns into +0.
  it('seamless switches on flat curves write no −0: the document survives a JSON round trip', async () => {
    const { app } = realApp();
    const bot = await importFixture(app, 'polybot.vrm');
    const { clip } = (await runOk(app, 'clip.new', { name: 'walk' })) as { clip: string };
    // A loop clip, as the acceptance walk: its curves cycle (cycle-aware auto tangents, M2A-SPEC §5.23).
    await runOk(app, 'clip.setSettings', { clip, range: { start: 0, end: 24 }, loop: true });
    const ik = controlOf(app, bot.character, 'ik.leg.L');
    const pole = controlOf(app, bot.character, 'pole.leg.L');
    select(app, [ik, pole]);
    // tz and pole tx move; every other channel keyed by S holds its value, so its curve is flat where the switch at
    // 21 inserts its hold keys (slope 0).
    for (const [frame, tz, tx] of [
      [0, 0.1, 0],
      [12, 0.05, 0.03],
      [24, 0.1, 0],
    ] as const) {
      setSceneFrame(app, frame);
      await runOk(app, 'channel.setValues', {
        edits: [
          { control: ik, channel: 'tz', value: tz },
          { control: pole, channel: 'tx', value: tx },
        ],
      });
      await runOk(app, 'key.set');
    }
    setSceneFrame(app, 18);
    await runOk(app, 'rig.ikFk.switch', { limb: 'leg.L', to: 'fk', key: 'seamless' });
    setSceneFrame(app, 21);
    await runOk(app, 'rig.ikFk.switch', { limb: 'leg.L', to: 'ik', key: 'seamless' });
    // The store's own snapshot (docJson goes through JSON, which would hide a −0).
    const json = app.store.snapshot() as unknown;
    const negative: string[] = [];
    const walk = (value: unknown, path: string): void => {
      if (Object.is(value, -0)) negative.push(path);
      else if (Array.isArray(value)) value.forEach((v, i) => walk(v, `${path}[${i}]`));
      else if (value !== null && typeof value === 'object')
        for (const [k, v] of Object.entries(value)) walk(v, `${path}.${k}`);
    };
    walk(json, 'doc');
    expect(negative).toEqual([]);
    expect(JSON.parse(JSON.stringify(json))).toEqual(json);
  });

  it('seamless IK → FK at 10: @ikFk {9: 1, 10: 0} stepped; the pose at 9 and 10 kept (1e-6); one undo', async () => {
    const { app } = realApp();
    const san = await importFixture(app, 'seed-san.vrm');
    await runOk(app, 'clip.new', { name: 'switch' });
    const ik = controlOf(app, san.character, 'ik.leg.L');
    select(app, [ik]);
    setSceneFrame(app, 0);
    await runOk(app, 'key.set');
    setSceneFrame(app, 10);
    await runOk(app, 'channel.setValues', {
      edits: [
        { control: ik, channel: 'tx', value: 0.1 },
        { control: ik, channel: 'ty', value: 0.05 },
        { control: ik, channel: 'tz', value: 0.15 },
        { control: ik, channel: 'rx', value: 20 * DEG },
      ],
    });
    await runOk(app, 'key.set');
    const at9 = LEG.map((bone) => boneWorld(app, san.character, bone, 9));
    const at10 = LEG.map((bone) => boneWorld(app, san.character, bone, 10));
    const before = docJson(app);
    await runOk(app, 'rig.ikFk.switch', { limb: 'leg.L', to: 'fk', key: 'seamless' });
    expect(keysOf(app, ik, '@ikFk')).toEqual([
      { t: 9, v: 1, outType: 'step' },
      { t: 10, v: 0, outType: 'step' },
    ]);
    LEG.forEach((bone, i) => {
      expectSameWorld(boneWorld(app, san.character, bone, 9), at9[i] as never, 1e-6, `${bone} @9`);
      expectSameWorld(boneWorld(app, san.character, bone, 10), at10[i] as never, 1e-6, `${bone} @10`);
    });
    expect(controlVisibility(app, controlOf(app, san.character, 'fk.upperLeg.L'))).toBe('visible');
    await runOk(app, 'edit.undo');
    expect(docJson(app)).toEqual(before);
  });

  it('seamless IK → FK with a ball roll and animated toes keeps frames 0…10 (1e-6); IK → FK is exact, FK → IK warns', async () => {
    const { app, services } = realApp();
    const san = await importFixture(app, 'seed-san.vrm');
    await runOk(app, 'clip.new', { name: 'roll' });
    const c = (key: string) => controlOf(app, san.character, key);
    const ik = c('ik.leg.L');
    const toes = c('fk.toes.L');
    // fk.toes.L rx 0° / 30° at 0 / 20 (auto tangents): under IK the toes rule reads it, so it shapes frames 0…9.
    for (const [frame, degrees] of [
      [0, 0],
      [20, 30],
    ] as const) {
      setSceneFrame(app, frame);
      await runOk(app, 'channel.setValues', {
        edits: [{ control: toes, channel: 'rx', value: degrees * DEG }],
        key: 'force',
      });
    }
    // The IK foot: rest at 0; at 10 raised, forward and rolled 20° over the ball (inside the ball range).
    select(app, [ik]);
    setSceneFrame(app, 0);
    await runOk(app, 'key.set');
    setSceneFrame(app, 10);
    await runOk(app, 'channel.setValues', {
      edits: [
        { control: ik, channel: 'ty', value: 0.05 },
        { control: ik, channel: 'tz', value: 0.1 },
        { control: ik, channel: '@roll', value: 20 * DEG },
      ],
    });
    await runOk(app, 'key.set');
    const frames = [0, 3, 6, 9, 10];
    const before = frames.map((frame) => LEG.map((bone) => boneWorld(app, san.character, bone, frame)));
    await runOk(app, 'rig.ikFk.switch', { limb: 'leg.L', to: 'fk', key: 'seamless' });
    // Up to f − 1 the pose is unchanged: the switch held the FK chain (toes included) at 9.
    frames
      .slice(0, -1)
      .forEach((frame, f) =>
        LEG.forEach((bone, i) =>
          expectSameWorld(
            boneWorld(app, san.character, bone, frame),
            before[f]?.[i] as never,
            1e-6,
            `${bone} @${frame}`,
          ),
        ),
      );
    expect(keysOf(app, toes, 'rx').map((key) => [key.t, key.outType])).toEqual([
      [0, expect.any(String)],
      [9, 'step'],
      [10, expect.any(String)],
      [20, expect.any(String)],
    ]);
    // At f the chain and the toes match too: the ball roll turns the foot about the toes joint, so the IK toes keep
    // their rest offset from the foot and FK reproduces them with fk.toes alone (acceptance fix round 1, bug 2;
    // before, the ball pivot lay on the ground below the joint and FK missed the IK toes by 5.4 mm). No toes warning.
    const at10 = before[4] ?? [];
    LEG.forEach((bone, i) =>
      expectSameWorld(boneWorld(app, san.character, bone, 10), at10[i] as never, 1e-6, `${bone} @10`),
    );
    const warnings = services.toasts.filter((toast) => toast.kind === 'warning').map((toast) => toast.text);
    expect(warnings.join('\n')).not.toContain('FK moves the toes');

    // Back to IK at 15 with the roll still 20°: the foot matches, but the toes rule bends the toes by the ball
    // roll, and the switch says so.
    setSceneFrame(app, 15);
    await runOk(app, 'rig.ikFk.switch', { limb: 'leg.L', to: 'ik', key: 'key' });
    const ikWarning = services.toasts.filter((toast) => toast.kind === 'warning').at(-1)?.text ?? '';
    expect(ikWarning).toMatch(/L Leg: IK bends the toes by 20° \(foot roll\)/);
  });

  it('IK → FK → IK keeps the chain (1e-6) on a clean hinge; a hyperextended knee warns with its angle', async () => {
    const { app, services } = realApp();
    const san = await importFixture(app, 'seed-san.vrm');
    await runOk(app, 'clip.new', { name: 'match' });
    const c = (key: string) => controlOf(app, san.character, key);
    // An IK pose (the solver bends the knee about its hinge): the foot moved up and forward.
    await runOk(app, 'channel.setValues', {
      edits: [
        { control: c('ik.leg.L'), channel: 'ty', value: 0.2 },
        { control: c('ik.leg.L'), channel: 'tz', value: 0.15 },
        { control: c('ik.leg.L'), channel: 'rx', value: 15 * DEG },
      ],
    });
    const ik = LEG.map((bone) => boneWorld(app, san.character, bone));
    await runOk(app, 'rig.ikFk.switch', { limb: 'leg.L', to: 'fk', key: 'none' });
    expect(app.evaluation.ikFk(san.character, 'leg.L')).toBe(0);
    LEG.forEach((bone, i) =>
      expectSameWorld(boneWorld(app, san.character, bone), ik[i] as never, 1e-6, `${bone} in FK`),
    );
    await runOk(app, 'rig.ikFk.switch', { limb: 'leg.L', to: 'ik', key: 'none' });
    expect(app.evaluation.ikFk(san.character, 'leg.L')).toBe(1);
    LEG.forEach((bone, i) =>
      expectSameWorld(boneWorld(app, san.character, bone), ik[i] as never, 1e-6, `${bone} back in IK`),
    );
    expect(services.toasts.filter((toast) => toast.kind === 'warning')).toEqual([]);

    // A knee hyperextended by 5° (FK) cannot be matched in IK: it bends forward instead, with a warning.
    await runOk(app, 'rig.ikFk.switch', { limb: 'leg.L', to: 'fk', key: 'none' });
    await runOk(app, 'pose.resetToRest', { controls: [c('fk.upperLeg.L'), c('fk.lowerLeg.L'), c('fk.foot.L')] });
    await runOk(app, 'channel.setValues', {
      edits: [{ control: c('fk.lowerLeg.L'), channel: 'rx', value: -5 * DEG }],
    });
    await runOk(app, 'rig.ikFk.match', { limb: 'leg.L', side: 'ik' });
    const warning = services.toasts.filter((toast) => toast.kind === 'warning').at(-1)?.text ?? '';
    expect(warning).toMatch(/L Leg: the knee is hyperextended by \d+(\.\d)?°; IK bends it forward, the knee moves/);
  });

  it('a switch to the mode the limb is in is refused: the IK foot stays, the FK pose stays (§5.6)', async () => {
    const { app, services } = realApp();
    const san = await importFixture(app, 'seed-san.vrm');
    await runOk(app, 'clip.new', { name: 'same' });
    const c = (key: string) => controlOf(app, san.character, key);
    // The IK foot raised 0.2 m: the FK chain is at rest, so an IK match would drop the foot back to it.
    await runOk(app, 'channel.setValues', { edits: [{ control: c('ik.leg.L'), channel: 'ty', value: 0.2 }] });
    await runOk(app, 'channel.setValues', { edits: [{ control: c('fk.lowerArm.L'), channel: 'ry', value: -0.5 }] });
    const doc = docJson(app);
    const overrides = app.session.getState().overrides;
    const leg = LEG.map((bone) => boneWorld(app, san.character, bone));
    const arm = ['leftUpperArm', 'leftLowerArm', 'leftHand'].map((bone) => boneWorld(app, san.character, bone));
    expect(await app.runUntyped('rig.ikFk.switch', { limb: 'leg.L', to: 'ik' })).toEqual({
      status: 'cancelled',
      reason: 'L Leg is IK already',
    });
    expect(await app.runUntyped('rig.ikFk.switch', { limb: 'arm.L', to: 'fk', key: 'key' })).toEqual({
      status: 'cancelled',
      reason: 'L Arm is FK already',
    });
    expect(docJson(app)).toEqual(doc);
    expect(app.session.getState().overrides).toBe(overrides);
    LEG.forEach((bone, i) => expectSameWorld(boneWorld(app, san.character, bone), leg[i] as never, 0, bone));
    ['leftUpperArm', 'leftLowerArm', 'leftHand'].forEach((bone, i) =>
      expectSameWorld(boneWorld(app, san.character, bone), arm[i] as never, 0, bone),
    );
    expect(services.toasts.filter((toast) => toast.kind === 'warning')).toEqual([]);
  });

  it('a seamless switch on a loop clip holds the new mode after f (the curves it starts are constant)', async () => {
    const { app } = realApp();
    const san = await importFixture(app, 'seed-san.vrm');
    const { clip } = (await runOk(app, 'clip.new', { name: 'walk', range: { start: 0, end: 24 } })) as {
      clip: string;
    };
    await runOk(app, 'clip.setSettings', { clip, loop: true });
    const ik = controlOf(app, san.character, 'ik.leg.L');
    setSceneFrame(app, 10);
    await runOk(app, 'channel.setValues', { edits: [{ control: ik, channel: 'tz', value: 0.15 }] });
    const atF = LEG.slice(0, 3).map((bone) => boneWorld(app, san.character, bone));
    await runOk(app, 'rig.ikFk.switch', { limb: 'leg.L', to: 'fk', key: 'seamless' });
    for (const frame of [11, 12, 17, 24]) {
      setSceneFrame(app, frame);
      expect([frame, app.evaluation.ikFk(san.character, 'leg.L')]).toEqual([frame, 0]);
      // The FK chain holds the matched pose (the IK foot at tz 0.15) to the clip's end.
      LEG.slice(0, 3).forEach((bone, i) =>
        expectSameWorld(boneWorld(app, san.character, bone), atF[i] as never, 1e-6, `${bone} @${frame}`),
      );
    }
    setSceneFrame(app, 9);
    expect(app.evaluation.ikFk(san.character, 'leg.L')).toBe(1);
  });

  it('matchRange to FK keys the FK chain at every frame of the range, matching the IK pose (1e-5)', async () => {
    const { app } = realApp();
    const san = await importFixture(app, 'seed-san.vrm');
    await runOk(app, 'clip.new', { name: 'range', range: { start: 0, end: 10 } });
    const ik = controlOf(app, san.character, 'ik.leg.L');
    for (const [frame, tz] of [
      [0, 0],
      [10, 0.2],
    ] as const) {
      setSceneFrame(app, frame);
      await runOk(app, 'channel.setValues', { edits: [{ control: ik, channel: 'tz', value: tz }], key: 'force' });
    }
    const ikWorlds = [0, 3, 7, 10].map((frame) =>
      LEG.slice(0, 3).map((bone) => boneWorld(app, san.character, bone, frame)),
    );
    const value = (await runOk(app, 'rig.ikFk.matchRange', { limb: 'leg.L', side: 'fk' })) as { count: number };
    expect(value.count).toBeGreaterThan(0);
    expect(keysOf(app, controlOf(app, san.character, 'fk.lowerLeg.L'), 'rx').map((key) => key.t)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
    // Switch the limb to FK (no match, no keys): the FK pose equals the IK pose at the matched frames.
    await runOk(app, 'rig.ikFk.switch', { limb: 'leg.L', to: 'fk', match: false, key: 'none' });
    [0, 3, 7, 10].forEach((frame, f) =>
      LEG.slice(0, 3).forEach((bone, i) =>
        expectSameWorld(
          boneWorld(app, san.character, bone, frame),
          ikWorlds[f]?.[i] as never,
          1e-5,
          `${bone} @${frame}`,
        ),
      ),
    );
  });

  it('Plant Feet on IK legs puts the foot back on its pin through the IK control (one step, undo exact)', async () => {
    const { app } = realApp();
    const bot = await importFixture(app, 'polybot.vrm');
    await runOk(app, 'clip.new', { name: 'plant' });
    await runOk(app, 'pose.pinFeet');
    const pins = app.session.getState().feetPins?.pins ?? [];
    setSceneFrame(app, 10);
    const ik = controlOf(app, bot.character, 'ik.leg.L');
    // The hips keyed lower, the IK foot moved off its pin (a static value: Plant Feet then writes statics; keyed
    // channels without auto-key would become overrides).
    await runOk(app, 'channel.setValues', {
      edits: [{ control: controlOf(app, bot.character, 'cog'), channel: 'ty', value: -0.05 }],
      key: 'force',
    });
    await runOk(app, 'channel.setValues', { edits: [{ control: ik, channel: 'tx', value: 0.1 }] });
    const moved = boneWorld(app, bot.character, 'leftFoot');
    const pin = mat4Decompose((pins.find((p) => p.side === 'L')?.footWorld ?? new Float64Array(16)).slice());
    expect(Math.hypot(moved.t[0] - pin.t[0], moved.t[1] - pin.t[1], moved.t[2] - pin.t[2])).toBeGreaterThan(0.05);
    await expectUndoRedoExact(app, 'pose.plantFeet');
    expect(app.history.peekUndo()?.label).toBe('Plant Feet');
    const planted = boneWorld(app, bot.character, 'leftFoot');
    expect(Math.hypot(planted.t[0] - pin.t[0], planted.t[1] - pin.t[1], planted.t[2] - pin.t[2])).toBeLessThan(1e-4);
    expect(quatAngle(planted.q, pin.q)).toBeLessThan(1e-4);
    // The IK foot moved back; the FK leg chain stays untouched.
    expect(Math.abs((app.evaluation.channelValues(ik).tx ?? 0) - 0.1)).toBeGreaterThan(0.05);
    expect(app.evaluation.channelValues(controlOf(app, bot.character, 'fk.upperLeg.L'))).toMatchObject({ rx: 0 });
  });

  it('pose.resetToRest leaves ikFk and soft; rig.setFootParams rewrites the footprint (undo exact)', async () => {
    const { app } = realApp();
    const san = await importFixture(app, 'seed-san.vrm');
    await runOk(app, 'clip.new', { name: 'reset' });
    const ik = controlOf(app, san.character, 'ik.leg.L');
    await runOk(app, 'channel.setValues', {
      edits: [
        { control: ik, channel: '@roll', value: 0.3 },
        { control: ik, channel: '@soft', value: 0.1 },
        { control: ik, channel: '@ikFk', value: 0.5 },
      ],
    });
    select(app, [ik]);
    await runOk(app, 'pose.resetToRest');
    expect(app.evaluation.attrValues(ik)).toMatchObject({ roll: 0, soft: 0.1, ikFk: 0.5 });

    const shape = app.store.get('controls', ik)?.shape;
    await expectUndoRedoExact(app, 'rig.setFootParams', {
      limb: 'leg.L',
      params: { heelBack: 0.09, breakAngle: 0.4 },
    });
    const limb = app.characters.get(san.character)?.program.limbs.find((candidate) => candidate.id === 'leg.L');
    expect(limb?.params.foot?.heelBack).toBeCloseTo(0.09, 12);
    expect(limb?.params.foot?.breakAngle).toBeCloseTo(0.4, 12);
    expect(app.store.get('controls', ik)?.shape.kind).toBe('custom');
    expect(app.store.get('controls', ik)?.shape.custom).not.toEqual(shape?.custom);
    expect((await app.runUntyped('rig.setFootParams', { limb: 'leg.L', params: { breakAngle: 2 } })).status).toBe(
      'cancelled',
    );
  });
});
