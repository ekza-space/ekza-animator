// M2A-SPEC §4.9 rig rows, §5.6–§5.8 (A2): the IK operators' editor side — polls, key policies (none, key, seamless,
// auto), the seamless @ikFk keys at f − 1 and f, match and match range keying, match warnings, Add Limb IK on an
// FK-only rig, foot pivots, Plant Feet on IK legs, and the "FK limbs only" notice. The rig math is A1's: these tests
// script it through the workflow's limb seam (`setLimbKit`), so the policies are checked independently of the solver.
// The same operators on real rigs with A1's math run in headless-tests (ops.ik.test.ts, READY.a1).
import type { Mat4, SplineSet } from '@ekza-animator/anim-core';
import type { ChannelId, ChannelValues, ControlId, ControlRecord, SolverRecord } from '@ekza-animator/doc';
import type { ChannelBuffer, LimbId, PoseBuffers, RigProgram } from '@ekza-animator/rig';
import { describe, expect, it } from 'vitest';
import type { EditorApp } from '../../src/types';
import { NOT_AVAILABLE_YET } from '../../src/operators/builtin/stub';
import { importLimbWarnings, type LimbKit, matchWarnings, setLimbKit, watchFkOnlyRigs } from '../../src/workflows/ik';
import { READY } from '../ready';
import { cid, FOOT, ikApp, ikWaveDoc } from './ikFixture';
import { DEG, expectUndoRedoExact, runOk, runResult, setSceneFrame, WAVE, waveDoc } from './support';

/** Keys of a control channel in the wave clip, as { t, v, outType }. */
function keys(app: EditorApp, key: string, channel: ChannelId) {
  const curve = app.store.query.curveFor(WAVE.clip, WAVE.layer, cid(key), channel);
  return curve === undefined
    ? []
    : app.store.query.keysOfCurve(curve.id).map((k) => ({ t: k.t, v: k.v, outType: k.outType }));
}

/** A limb kit with scripted matches: FK side gets fixed rotations, IK side fixed positions, errors as given. */
function scriptedKit(opts?: {
  readonly fk?: ReadonlyMap<string, ChannelValues>;
  readonly ik?: ReadonlyMap<string, ChannelValues>;
  readonly endErrorM?: number;
  readonly midErrorM?: number;
  readonly calls?: string[];
}): Partial<LimbKit> {
  const fk =
    opts?.fk ??
    new Map<string, ChannelValues>([
      ['fk.upperLeg.L', { rx: 0.3, ry: 0, rz: 0 }],
      ['fk.lowerLeg.L', { rx: 0.6, ry: 0, rz: 0 }],
      ['fk.foot.L', { rx: -0.3, ry: 0, rz: 0 }],
      ['fk.toes.L', { rx: 0, ry: 0, rz: 0 }],
    ]);
  const ik =
    opts?.ik ??
    new Map<string, ChannelValues>([
      ['ik.leg.L', { tx: 0.1, ty: 0.05, tz: 0.15, rx: 20 * DEG, ry: 0, rz: 0, '@twist': 0 }],
      ['pole.leg.L', { tx: 0.1, ty: 0.5, tz: 0.9 }],
    ]);
  const byId = (map: ReadonlyMap<string, ChannelValues>) =>
    new Map([...map].map(([key, values]) => [cid(key), { ...values }] as [ControlId, ChannelValues]));
  return {
    evaluateWithLimbMode(
      program: RigProgram,
      ch: ChannelBuffer,
      limb: LimbId,
      ikFk: number,
      scratch: ChannelBuffer,
      out: PoseBuffers,
    ) {
      opts?.calls?.push(`evaluate ${limb} ${ikFk}`);
      scratch.values.set(ch.values);
      scratch.attrs.set(ch.attrs);
      program.evaluate(scratch, out);
    },
    matchFkToIk(_program, _pose, limb) {
      opts?.calls?.push(`matchFkToIk ${limb}`);
      return byId(fk);
    },
    matchIkToFk(_program, _pose, _ch, limb) {
      opts?.calls?.push(`matchIkToFk ${limb}`);
      return {
        values: byId(ik),
        endErrorM: opts?.endErrorM ?? 0,
        midErrorM: opts?.midErrorM ?? 0,
        maxRotationErrorRad: 0,
      };
    },
  };
}

describe('rig.ikFk.switch key policies (§5.6)', () => {
  it('seamless IK → FK at 10 keys @ikFk {9: 1 step} and {10: 0 step} and the matched FK chain at 10', async () => {
    const { app } = ikApp();
    setLimbKit(app, scriptedKit());
    setSceneFrame(app, 10);
    expect(keys(app, 'ik.leg.L', '@ikFk')).toEqual([]);
    await expectUndoRedoExact(app, 'rig.ikFk.switch', { limb: 'leg.L', to: 'fk', key: 'seamless' });
    expect(app.history.peekUndo()?.label).toBe('Switch L Leg to FK');
    expect(keys(app, 'ik.leg.L', '@ikFk')).toEqual([
      { t: 9, v: 1, outType: 'step' },
      { t: 10, v: 0, outType: 'step' },
    ]);
    expect(keys(app, 'fk.upperLeg.L', 'rx')).toEqual([{ t: 10, v: 0.3, outType: 'auto' }]);
    expect(keys(app, 'fk.lowerLeg.L', 'rx')).toEqual([{ t: 10, v: 0.6, outType: 'auto' }]);
    // Every matched channel is keyed (also unchanged ones): the switch holds across frames.
    expect(keys(app, 'fk.toes.L', 'ry')).toEqual([{ t: 10, v: 0, outType: 'auto' }]);
    expect(app.evaluation.ikFk(WAVE.character, 'leg.L')).toBe(0);
    setSceneFrame(app, 9);
    expect(app.evaluation.ikFk(WAVE.character, 'leg.L')).toBe(1);
  });

  it("then FK → IK at 15 with 'key' adds {15: 1 step} and keys the IK control and pole", async () => {
    const { app } = ikApp();
    setLimbKit(app, scriptedKit());
    setSceneFrame(app, 10);
    await runOk(app, 'rig.ikFk.switch', { limb: 'leg.L', to: 'fk', key: 'seamless' });
    setSceneFrame(app, 15);
    await expectUndoRedoExact(app, 'rig.ikFk.switch', { limb: 'leg.L', to: 'ik', key: 'key' });
    expect(app.history.peekUndo()?.label).toBe('Switch L Leg to IK');
    expect(keys(app, 'ik.leg.L', '@ikFk')).toEqual([
      { t: 9, v: 1, outType: 'step' },
      { t: 10, v: 0, outType: 'step' },
      { t: 15, v: 1, outType: 'step' },
    ]);
    expect(keys(app, 'ik.leg.L', 'tz')).toEqual([{ t: 15, v: 0.15, outType: 'auto' }]);
    expect(keys(app, 'ik.leg.L', '@twist')).toEqual([{ t: 15, v: 0, outType: 'auto' }]);
    expect(keys(app, 'pole.leg.L', 'ty')).toEqual([{ t: 15, v: 0.5, outType: 'auto' }]);
  });

  it('seamless does not overwrite a key at f − 1; an existing key at f is patched and made stepped', async () => {
    const { app } = ikApp();
    setLimbKit(app, scriptedKit());
    const ik = cid('ik.leg.L');
    setSceneFrame(app, 9);
    await runOk(app, 'channel.setValues', { edits: [{ control: ik, channel: '@ikFk', value: 0.5 }], key: 'force' });
    setSceneFrame(app, 10);
    await runOk(app, 'channel.setValues', { edits: [{ control: ik, channel: '@ikFk', value: 1 }], key: 'force' });
    // Make the key at 10 linear to see the switch step it.
    const at10 = app.store.query.keysOfCurve(app.store.query.curveFor(WAVE.clip, WAVE.layer, ik, '@ikFk')?.id as never);
    app.store.transact({ label: 'test' }, (tx) => tx.patch('keys', at10[1]?.id as never, { outType: 'linear' }));
    await runOk(app, 'rig.ikFk.switch', { limb: 'leg.L', to: 'fk', key: 'seamless' });
    expect(keys(app, 'ik.leg.L', '@ikFk')).toEqual([
      { t: 9, v: 0.5, outType: 'step' },
      { t: 10, v: 0, outType: 'step' },
    ]);
  });

  it("'auto' is 'none' without @ikFk keys and auto-key off: static ikFk, matched channels as statics", async () => {
    const { app } = ikApp();
    setLimbKit(app, scriptedKit());
    setSceneFrame(app, 10);
    await runOk(app, 'rig.ikFk.switch', { limb: 'leg.L', to: 'fk' });
    expect(keys(app, 'ik.leg.L', '@ikFk')).toEqual([]);
    expect(app.store.query.curveFor(WAVE.clip, WAVE.layer, cid('ik.leg.L'), '@ikFk')?.staticValue).toBe(0);
    expect(app.evaluation.channelValues(cid('fk.upperLeg.L')).rx).toBe(0.3);
    expect(keys(app, 'fk.upperLeg.L', 'rx')).toEqual([]);
    // With keys on @ikFk the default 'auto' is 'seamless'.
    setSceneFrame(app, 20);
    await runOk(app, 'channel.setValues', {
      edits: [{ control: cid('ik.leg.L'), channel: '@ikFk', value: 0 }],
      key: 'force',
    });
    setSceneFrame(app, 25);
    await runOk(app, 'rig.ikFk.switch', { limb: 'leg.L', to: 'ik' });
    expect(keys(app, 'ik.leg.L', '@ikFk').map((k) => k.t)).toEqual([20, 24, 25]);
  });

  it("'auto' is 'seamless' with auto-key on; prefs.ikFkSwitchKey supplies the default", async () => {
    const { app } = ikApp();
    setLimbKit(app, scriptedKit());
    setSceneFrame(app, 10);
    app.prefs.setState({ autoKey: true });
    await runOk(app, 'rig.ikFk.switch', { limb: 'leg.L', to: 'fk' });
    expect(keys(app, 'ik.leg.L', '@ikFk').map((k) => k.t)).toEqual([9, 10]);
    app.prefs.setState({ autoKey: false, ikFkSwitchKey: 'key' });
    setSceneFrame(app, 14);
    await runOk(app, 'rig.ikFk.switch', { limb: 'leg.L', to: 'ik' });
    expect(keys(app, 'ik.leg.L', '@ikFk').map((k) => k.t)).toEqual([9, 10, 14]);
  });

  it("'none' over keyed channels without auto-key leaves overrides; match: false only switches", async () => {
    const { app } = ikApp();
    const calls: string[] = [];
    setLimbKit(app, scriptedKit({ calls }));
    setSceneFrame(app, 10);
    await runOk(app, 'channel.setValues', {
      edits: [{ control: cid('fk.upperLeg.L'), channel: 'rx', value: 0.1 }],
      key: 'force',
    });
    await runOk(app, 'rig.ikFk.switch', { limb: 'leg.L', to: 'fk', key: 'none' });
    expect(app.session.getState().overrides.get(cid('fk.upperLeg.L'))).toEqual({ rx: 0.3 });
    calls.length = 0;
    await runOk(app, 'rig.ikFk.switch', { limb: 'leg.L', to: 'ik', match: false, key: 'key' });
    expect(calls).toEqual([]);
    expect(keys(app, 'ik.leg.L', '@ikFk')).toEqual([{ t: 10, v: 1, outType: 'step' }]);
  });

  it('polls: limb, to, key mode, a character with that limb, an active clip', async () => {
    const { app } = ikApp({ snapshot: ikWaveDoc({ limbs: ['leg.L'] }) });
    setLimbKit(app, scriptedKit());
    const reason = async (args: unknown) => {
      const result = await runResult(app, 'rig.ikFk.switch', args);
      return result.status === 'cancelled' ? result.reason : result.status;
    };
    expect(await reason({ limb: 'leg.X', to: 'fk' })).toMatch(/^expects/);
    expect(await reason({ limb: 'leg.L', to: 'up' })).toBe("to must be 'ik' or 'fk'");
    expect(await reason({ limb: 'leg.L', to: 'fk', key: 'often' })).toMatch(/^key must be/);
    expect(await reason({ limb: 'leg.L', to: 'fk', match: 1 })).toBe('match must be a boolean');
    expect(await reason({ limb: 'arm.R', to: 'ik' })).toBe('The character has no R Arm IK (Rig › Add Limb IK)');
    expect(await reason({ limb: 'leg.L', to: 'fk', character: 'chr_nope' })).toBe('The character is still loading');
  });
});

describe('rig.ikFk.match and matchRange (§5.6)', () => {
  it('match IK to FK sets the IK control and pole without touching ikFk; key: true keys them', async () => {
    const { app } = ikApp();
    setLimbKit(app, scriptedKit());
    setSceneFrame(app, 5);
    await expectUndoRedoExact(app, 'rig.ikFk.match', { limb: 'leg.L', side: 'ik' });
    expect(app.history.peekUndo()?.label).toBe('Match L Leg IK to FK');
    expect(app.evaluation.channelValues(cid('ik.leg.L')).tz).toBe(0.15);
    expect(keys(app, 'ik.leg.L', 'tz')).toEqual([]);
    expect(app.evaluation.ikFk(WAVE.character, 'leg.L')).toBe(1);
    await runOk(app, 'rig.ikFk.match', { limb: 'leg.L', side: 'ik', key: true });
    expect(keys(app, 'ik.leg.L', 'tz')).toEqual([{ t: 5, v: 0.15, outType: 'auto' }]);
    expect(keys(app, 'ik.leg.L', '@ikFk')).toEqual([]);
    await runOk(app, 'rig.ikFk.match', { limb: 'leg.L', side: 'fk', key: true });
    expect(app.history.peekUndo()?.label).toBe('Match L Leg FK to IK');
    expect(keys(app, 'fk.lowerLeg.L', 'rx')).toEqual([{ t: 5, v: 0.6, outType: 'auto' }]);
  });

  it('warns when the mid joint moves (> 1 mm) or the end misses (> 0.1 mm)', async () => {
    const { app, services } = ikApp();
    setLimbKit(app, scriptedKit({ midErrorM: 0.012, endErrorM: 3e-4 }));
    await runOk(app, 'rig.ikFk.match', { limb: 'leg.L', side: 'ik' });
    const text = services.toasts.at(-1)?.text ?? '';
    expect(services.toasts.at(-1)?.kind).toBe('warning');
    // The naive program runs no ik2 op: FK and the matched IK pose bend alike, so it is a non-hinge message.
    expect(text).toContain('L Leg: the knee is not a clean hinge; IK moves it 12 mm');
    expect(text).toContain('L Leg: IK misses the FK foot by 0.3 mm (soft IK)');
    const before = services.toasts.length;
    setLimbKit(app, scriptedKit({ midErrorM: 5e-4, endErrorM: 5e-5 }));
    await runOk(app, 'rig.ikFk.switch', { limb: 'leg.L', to: 'ik', key: 'key' });
    expect(services.toasts.length).toBe(before);
  });

  it('names a hyperextension with its angle; elbows bend "the normal way"; import rows of limbs kept FK', () => {
    expect(matchWarnings('leg.L', { endErrorM: 0, midErrorM: 0.012, hyperextensionRad: 5 * DEG })).toEqual([
      'L Leg: the knee is hyperextended by 5.0°; IK bends it forward, the knee moves 12 mm',
    ]);
    expect(matchWarnings('arm.R', { endErrorM: 2e-4, midErrorM: 0.0034, hyperextensionRad: 12 * DEG })).toEqual([
      'R Arm: the elbow is hyperextended by 12°; IK bends it the normal way, the elbow moves 3.4 mm',
      'R Arm: IK misses the FK hand by 0.2 mm (soft IK)',
    ]);
    expect(matchWarnings('leg.R', { endErrorM: 1e-4, midErrorM: 1e-3, hyperextensionRad: 0 })).toEqual([]);
    const rows = [
      { limb: 'leg.L' as const, mode: 'ik' as const, maxRotationErrorRad: 0.001, maxMidErrorM: 0 },
      { limb: 'leg.R' as const, mode: 'fk' as const, maxRotationErrorRad: 6.3 * DEG, maxMidErrorM: 0.004 },
    ];
    expect(importLimbWarnings('Walk_Loop', { warnings: [], limbs: rows })).toEqual([
      "R Leg kept FK in 'Walk_Loop': the knee is not a clean hinge (max 6.3°, 4.0 mm). Rig › IK/FK › Match Range to " +
        'IK converts it if you accept the difference.',
    ]);
    // A row the rig already reported is not repeated.
    expect(importLimbWarnings('Walk_Loop', { warnings: ['R Leg kept FK in Walk_Loop'], limbs: rows })).toEqual([]);
    expect(importLimbWarnings('x', { warnings: [] })).toEqual([]);
  });

  it("matchRange 'frames' keys the side controls at every integer frame of the range, one step", async () => {
    const { app } = ikApp();
    const calls: string[] = [];
    setLimbKit(app, scriptedKit({ calls }));
    const { value } = await expectUndoRedoExact(app, 'rig.ikFk.matchRange', {
      limb: 'leg.L',
      side: 'fk',
      range: { start: 2, end: 5 },
    });
    expect(app.history.peekUndo()?.label).toBe('Match Range L Leg to FK');
    // 4 controls × 9 TRS channels where keyable (the fixture's FK controls rotate only: 3 each) × 4 frames.
    expect(value).toEqual({ count: 4 * 3 * 4 });
    expect(keys(app, 'fk.upperLeg.L', 'rx').map((k) => k.t)).toEqual([2, 3, 4, 5]);
    expect(calls.filter((call) => call.startsWith('matchFkToIk'))).toHaveLength(4);
  });

  it("matchRange 'keys' (default for side 'ik') matches at the influence key times of the chain's tracks", async () => {
    const { app } = ikApp();
    const leg = app.characters.get(WAVE.character)?.program.limbs.find((limb) => limb.id === 'leg.L');
    const mid = leg?.nodes.mid ?? -1;
    expect(mid).toBeGreaterThanOrEqual(0);
    setLimbKit(app, {
      ...scriptedKit(),
      computeInfluenceKeyTimes: (_program, _sampler, range) => {
        expect(range).toEqual({ start: 0, end: 30 });
        return new Map([
          [`${mid}/rotation`, [0, 7, 40]],
          ['9999/rotation', [3]],
        ]) as never;
      },
    });
    // Frames 0 and 7 (40 is outside the clip range; node 9999 is not on the chain): the IK control (6 TRS + twist)
    // and the pole (3) per frame.
    expect(await runOk(app, 'rig.ikFk.matchRange', { limb: 'leg.L', side: 'ik' })).toEqual({ count: 2 * 10 });
    expect(keys(app, 'ik.leg.L', 'tx').map((k) => k.t)).toEqual([0, 7]);
    expect(app.history.peekUndo()?.label).toBe('Match Range L Leg to IK');
    expect(
      (await runResult(app, 'rig.ikFk.matchRange', { limb: 'leg.L', side: 'ik', range: { start: 5, end: 1 } })).status,
    ).toBe('cancelled');
    expect((await runResult(app, 'rig.ikFk.matchRange', { limb: 'leg.L', side: 'ik', step: 'often' })).status).toBe(
      'cancelled',
    );
  });
});

describe('rig.addLimbIk (§5.7)', () => {
  /** Records of the IK fixture, renamed to ikFk default 0, as limbIkRecords would return for the requested limbs. */
  function recordsKit(): Partial<LimbKit> {
    const doc = ikWaveDoc({ ikFkDefault: 0 }) as unknown as {
      tables: { controls: Record<string, ControlRecord>; solvers: Record<string, SolverRecord> };
    };
    return {
      limbIkRecords(_def, _skeleton, opts) {
        const solvers = Object.values(doc.tables.solvers).filter((solver) =>
          opts.limbs.includes((solver.params as { limb: LimbId }).limb),
        );
        const ids = new Set(
          solvers.flatMap((solver) => {
            const params = solver.params as { ikControl: ControlId; pole: ControlId };
            return [params.ikControl, params.pole];
          }),
        );
        const controls = Object.values(doc.tables.controls).filter((control) => ids.has(control.id));
        return { controls, solvers, warnings: opts.limbs.length > 0 ? ['scripted warning'] : [] };
      },
    };
  }

  it.skipIf(READY.a1)('is "not available yet" until the rig implements limb records (before A1)', async () => {
    const { app } = ikApp({ snapshot: waveDoc() });
    expect(await runResult(app, 'rig.addLimbIk')).toEqual({ status: 'cancelled', reason: NOT_AVAILABLE_YET });
  });

  it('adds IK controls and ik2 solvers with ikFk 0 (FK unchanged), structural, one undoable step', async () => {
    const { app, services } = ikApp({ snapshot: waveDoc() });
    setLimbKit(app, recordsKit());
    const { value } = await expectUndoRedoExact(app, 'rig.addLimbIk');
    expect(value).toEqual({ added: ['leg.L', 'leg.R', 'arm.L', 'arm.R'], warnings: ['scripted warning'] });
    expect(app.history.peekUndo()?.label).toBe('Add Limb IK');
    expect(services.toasts.at(-1)).toMatchObject({ kind: 'warning', text: 'scripted warning' });
    expect(app.store.list('solvers')).toHaveLength(4);
    expect(
      app.characters
        .get(WAVE.character)
        ?.program.limbs.map((limb) => limb.id)
        .sort(),
    ).toEqual(['arm.L', 'arm.R', 'leg.L', 'leg.R']);
    for (const limb of ['leg.L', 'leg.R', 'arm.L', 'arm.R'] as const) {
      expect(app.evaluation.ikFk(WAVE.character, limb)).toBe(0);
    }
    expect(await runResult(app, 'rig.addLimbIk')).toEqual({
      status: 'cancelled',
      reason: 'Those limbs have IK already',
    });
    await runOk(app, 'edit.undo');
    expect(app.store.list('solvers')).toHaveLength(0);
    expect(app.characters.get(WAVE.character)?.program.limbs).toEqual([]);
  });

  it('adds only the requested limbs that lack IK; validates its arguments', async () => {
    const { app } = ikApp({ snapshot: ikWaveDoc({ limbs: ['leg.L', 'leg.R'] }) });
    setLimbKit(app, recordsKit());
    expect(await runOk(app, 'rig.addLimbIk', { limbs: ['leg.L', 'arm.R'] })).toMatchObject({ added: ['arm.R'] });
    expect((await runResult(app, 'rig.addLimbIk', { limbs: ['tail'] })).status).toBe('cancelled');
    expect((await runResult(app, 'rig.addLimbIk', { character: 4 })).status).toBe('cancelled');
  });
});

describe('rig.setFootParams (§5.2.3)', () => {
  const kit: Partial<LimbKit> = {
    validateFootParams(current, patch) {
      if ((patch.heelBack ?? 0) > 1) return { error: 'The heel is more than 1 m behind the ankle' };
      return { ...current, ...patch };
    },
    footprintShape(params): SplineSet {
      return {
        v: 1,
        splines: [
          {
            kind: 'poly',
            closed: true,
            points: [
              [0, 0, -params.heelBack],
              [0, 0, params.ballFront],
            ],
          },
        ],
      };
    },
  };

  it('writes the foot distances and rewrites the footprint shape in one structural step', async () => {
    const { app } = ikApp();
    setLimbKit(app, kit);
    await expectUndoRedoExact(app, 'rig.setFootParams', { limb: 'leg.L', params: { heelBack: 0.08, breakAngle: 0.4 } });
    expect(app.history.peekUndo()?.label).toBe('Edit Foot Pivots');
    const solver = app.store.list('solvers').find((s) => (s.params as { limb: string }).limb === 'leg.L');
    expect((solver?.params as { foot: unknown } | undefined)?.foot).toEqual({
      ...FOOT,
      side: 1,
      heelBack: 0.08,
      breakAngle: 0.4,
    });
    const control = app.store.get('controls', cid('ik.leg.L'));
    expect(control?.shape.kind).toBe('custom');
    expect(control?.shape.custom?.splines[0]?.points).toEqual([
      [0, 0, -0.08],
      [0, 0, 0.1],
    ]);
    // The compiled limb carries the new pivots (structural change → recompile).
    expect(app.characters.get(WAVE.character)?.program.limbs.find((l) => l.id === 'leg.L')?.params.foot?.heelBack).toBe(
      0.08,
    );
  });

  it('refuses negative values, a break angle above 90°, unknown fields, arms and the rig validation', async () => {
    const { app } = ikApp();
    setLimbKit(app, kit);
    const reason = async (args: unknown) => {
      const result = await runResult(app, 'rig.setFootParams', args);
      return result.status === 'cancelled' ? result.reason : result.status;
    };
    expect(await reason({ limb: 'leg.L', params: { heelBack: -0.01 } })).toBe('heelBack must be a number ≥ 0');
    expect(await reason({ limb: 'leg.L', params: { breakAngle: 2 } })).toBe('breakAngle must be at most 90°');
    expect(await reason({ limb: 'leg.L', params: { yaw: 1 } })).toBe("unknown foot parameter 'yaw'");
    expect(await reason({ limb: 'leg.L', params: {} })).toBe('params names no foot parameter');
    expect(await reason({ limb: 'arm.L', params: { heelBack: 0.1 } })).toMatch(/^expects/);
    expect(await reason({ limb: 'leg.L', params: { heelBack: 2 } })).toBe('The heel is more than 1 m behind the ankle');
  });
});

describe('Plant Feet on IK legs (§5.8)', () => {
  it('an IK leg gets IK control channels from the pin; an FK leg the M1 solve; one step', async () => {
    const { app } = ikApp({ snapshot: ikWaveDoc({ limbs: ['leg.L'] }) });
    const ends: Mat4[] = [];
    setLimbKit(app, {
      ikControlForEndWorld(_program, _pose, _ch, limb, endWorld) {
        expect(limb).toBe('leg.L');
        ends.push(endWorld);
        return { tx: endWorld[12] ?? 0, ty: (endWorld[13] ?? 0) + 0.25, tz: endWorld[14] ?? 0 };
      },
    });
    await runOk(app, 'pose.pinFeet');
    setSceneFrame(app, 10);
    await runOk(app, 'channel.setValues', { edits: [{ control: WAVE.cog, channel: 'ty', value: -0.05 }] });
    await runOk(app, 'pose.plantFeet');
    expect(app.history.peekUndo()?.label).toBe('Plant Feet');
    expect(ends).toHaveLength(1);
    const pin = app.session.getState().feetPins?.pins.find((p) => p.side === 'L')?.footWorld;
    expect(app.evaluation.channelValues(cid('ik.leg.L')).ty).toBeCloseTo((pin?.[13] ?? 0) + 0.25, 12);
    // The right leg (no IK) was solved by the M1 path: its FK chain moved.
    expect(app.evaluation.channelValues(cid('fk.upperLeg.R')).rx).not.toBe(0);
    await runOk(app, 'edit.undo');
    expect(app.evaluation.channelValues(cid('ik.leg.L')).ty).toBe(0);
  });
});

describe('the "FK limbs only" notice (§5.7)', () => {
  it('shows once per FK-only humanoid character when limb IK is available; never for IK rigs', () => {
    const fkOnly = ikApp({ snapshot: waveDoc() });
    setLimbKit(fkOnly.app, { limbIkRecords: () => ({ controls: [], solvers: [], warnings: [] }) });
    const stop = watchFkOnlyRigs(fkOnly.app);
    const again = watchFkOnlyRigs(fkOnly.app);
    const notices = () => fkOnly.services.toasts.filter((toast) => toast.text.startsWith('This rig has FK limbs only'));
    expect(notices()).toHaveLength(1);
    expect(notices()[0]).toMatchObject({
      kind: 'info',
      action: { label: 'Add Limb IK', op: 'rig.addLimbIk', args: { character: WAVE.character } },
    });
    fkOnly.app.session.setState({ activeCharacter: null });
    fkOnly.app.session.setState({ activeCharacter: WAVE.character });
    stop();
    again();
    watchFkOnlyRigs(fkOnly.app)();
    expect(notices()).toHaveLength(1);

    const withIk = ikApp();
    setLimbKit(withIk.app, { limbIkRecords: () => ({ controls: [], solvers: [], warnings: [] }) });
    watchFkOnlyRigs(withIk.app)();
    expect(withIk.services.toasts).toHaveLength(0);
  });

  it.skipIf(READY.a1)('says nothing without the rig limb records (before A1)', () => {
    const early = ikApp({ snapshot: waveDoc() });
    watchFkOnlyRigs(early.app)();
    expect(early.services.toasts).toHaveLength(0);
  });

  it.runIf(READY.a1)("with A1, Add Limb IK on the synthetic humanoid uses the rig's records (ikFk 0)", async () => {
    const { app } = ikApp({ snapshot: waveDoc() });
    const value = (await runOk(app, 'rig.addLimbIk')) as { added: string[] };
    expect([...value.added].sort()).toEqual(['arm.L', 'arm.R', 'leg.L', 'leg.R']);
    for (const limb of ['leg.L', 'leg.R', 'arm.L', 'arm.R'] as const) {
      expect(app.evaluation.ikFk(WAVE.character, limb)).toBe(0);
    }
  });
});
