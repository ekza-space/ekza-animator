// ops.* (M2A-SPEC §5.5–§5.8, §5.19, A2): the IK editor operators on the real kernel, rig and fixtures — visibility
// and body parts on IK rigs, Add Limb IK on an M1 rig (pose unchanged bit for bit, undo exact), the seamless switch
// (keys and pose at f − 1 and f), match round trips and the hyperextension warning, match range, Plant Feet on IK
// legs, keying and reset with limb attributes, foot pivots. Gated on A1's limb IK (READY.a1, §3 rule 4).
import { EkzaError, mat4Decompose, quatAngle } from '@ekza-animator/anim-core';
import type { ChannelId, CharacterId, ControlId } from '@ekza-animator/doc';
import { controlVisibility, type EditorApp, keyTargetControls } from '@ekza-animator/editor-core';
import { limbIkRecords } from '@ekza-animator/rig';
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

function implemented(probe: () => unknown): boolean {
  try {
    probe();
    return true;
  } catch (error) {
    return !(error instanceof EkzaError && error.code === 'not-implemented');
  }
}

/** A1 (rig limb IK) is merged. */
const READY_A1 = implemented(() =>
  limbIkRecords(undefined as never, undefined as never, { limbs: [], ikFkDefault: 0 }),
);

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

describe.skipIf(!SIBLINGS_READY || !READY_A1)(
  `IK editor operators on the fixtures ${BLOCKED} [needs A1]`,
  { timeout: 120_000 },
  () => {
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
      expect(keyed).toEqual([
        '@bank',
        '@heelTwist',
        '@roll',
        '@toeTwist',
        '@twist',
        'rx',
        'ry',
        'rz',
        'tx',
        'ty',
        'tz',
      ]);
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

    it('match IK to FK then FK to IK keeps the chain (1e-6); a hyperextended knee warns with its angle', async () => {
      const { app, services } = realApp();
      const san = await importFixture(app, 'seed-san.vrm');
      await runOk(app, 'clip.new', { name: 'match' });
      const c = (key: string) => controlOf(app, san.character, key);
      // Legs FK, a bent knee.
      await runOk(app, 'rig.ikFk.switch', { limb: 'leg.L', to: 'fk', key: 'none' });
      await runOk(app, 'channel.setValues', {
        edits: [
          { control: c('fk.upperLeg.L'), channel: 'rx', value: -30 * DEG },
          { control: c('fk.lowerLeg.L'), channel: 'rx', value: 50 * DEG },
        ],
      });
      const fk = LEG.map((bone) => boneWorld(app, san.character, bone));
      await runOk(app, 'rig.ikFk.switch', { limb: 'leg.L', to: 'ik', key: 'none' });
      LEG.forEach((bone, i) =>
        expectSameWorld(boneWorld(app, san.character, bone), fk[i] as never, 1e-6, `${bone} in IK`),
      );
      await runOk(app, 'rig.ikFk.switch', { limb: 'leg.L', to: 'fk', key: 'none' });
      LEG.forEach((bone, i) =>
        expectSameWorld(boneWorld(app, san.character, bone), fk[i] as never, 1e-6, `${bone} back in FK`),
      );

      // A knee hyperextended by 5° cannot be matched in IK: it bends forward instead, with a warning.
      await runOk(app, 'channel.setValues', {
        edits: [
          { control: c('fk.upperLeg.L'), channel: 'rx', value: 0 },
          { control: c('fk.lowerLeg.L'), channel: 'rx', value: -5 * DEG },
        ],
      });
      await runOk(app, 'rig.ikFk.match', { limb: 'leg.L', side: 'ik' });
      const warning = services.toasts.filter((toast) => toast.kind === 'warning').at(-1)?.text ?? '';
      expect(warning).toMatch(/L Leg: the knee is hyperextended by \d+(\.\d)?°; IK bends it forward, the knee moves/);
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
      await runOk(app, 'channel.setValues', {
        edits: [
          { control: ik, channel: 'tx', value: 0.1 },
          { control: controlOf(app, bot.character, 'cog'), channel: 'ty', value: -0.05 },
        ],
        key: 'force',
      });
      const moved = boneWorld(app, bot.character, 'leftFoot');
      const pin = mat4Decompose((pins.find((p) => p.side === 'L')?.footWorld ?? new Float64Array(16)).slice());
      expect(Math.hypot(moved.t[0] - pin.t[0], moved.t[1] - pin.t[1], moved.t[2] - pin.t[2])).toBeGreaterThan(0.05);
      await expectUndoRedoExact(app, 'pose.plantFeet');
      expect(app.history.peekUndo()?.label).toBe('Plant Feet');
      const planted = boneWorld(app, bot.character, 'leftFoot');
      expect(Math.hypot(planted.t[0] - pin.t[0], planted.t[1] - pin.t[1], planted.t[2] - pin.t[2])).toBeLessThan(1e-4);
      expect(quatAngle(planted.q, pin.q)).toBeLessThan(1e-4);
      // The IK foot moved; the FK leg chain stays untouched.
      expect(keysOf(app, ik, 'tx').find((key) => key.t === 10)?.v).not.toBeCloseTo(0.1, 6);
      expect(keysOf(app, controlOf(app, bot.character, 'fk.upperLeg.L'), 'rx')).toEqual([]);
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
  },
);
